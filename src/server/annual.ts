import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { getDB } from "../db/client";
import { annualDrafts, events } from "../db/schema";
import { rowToEventInput } from "../domain/annual";
import { canCreate, canEditEvent, canReadEvent } from "../domain/permissions";
import type {
  Actor,
  AnnualDraft,
  AnnualDraftInput,
  AnnualDraftSummary,
  AnnualPlanRow,
  AnnualPublishResult,
  CalendarEvent,
  OrganizationId,
} from "../domain/types";
import { requireActor } from "./auth";
import { APIError } from "./validation";
import {
  annualCreateSchema,
  annualPublishSchema,
  annualUpdateSchema,
  annualYearSchema,
  parseAnnual,
  validateAnnualEvent,
} from "./annual-validation";
import {
  canonical,
  prepareEventCreation,
  present,
  writeActor,
  writePreparedEvent,
  type PreparedEventCreation,
  type TX,
} from "./services";

const LIST_LIMIT = 200;
const canUseOrganization = (actor: Actor, organizationId: OrganizationId) =>
  actor.role === "admin" ||
  (actor.role === "editor" && actor.departmentIds.includes(organizationId));
function requireEditor(actor: Actor): void {
  if (!canCreate(actor))
    throw new APIError(
      403,
      "ANNUAL_FORBIDDEN",
      "연간계획에는 현재 부서 담당자 또는 일정 관리자 권한이 필요합니다.",
    );
}
function permitted(draft: AnnualDraft, actor: Actor): boolean {
  return (
    canCreate(actor) &&
    (draft.ownerId === actor.id || actor.role === "admin") &&
    canUseOrganization(actor, draft.organizationId) &&
    draft.rows.every((row) => canEditEvent(row.input, actor))
  );
}
function requireInputGrants(input: AnnualDraftInput, actor: Actor): void {
  if (
    !canUseOrganization(actor, input.organizationId) ||
    input.rows.some((row) => !canEditEvent(row.input, actor))
  )
    throw new APIError(
      403,
      "EDIT_FORBIDDEN",
      "초안의 모든 주관부서에 현재 입력 권한이 있어야 합니다.",
    );
}
async function lockedDraft(
  tx: TX,
  id: string,
  current: Actor,
): Promise<typeof annualDrafts.$inferSelect> {
  const [row] = await tx
    .select()
    .from(annualDrafts)
    .where(eq(annualDrafts.id, id))
    .limit(1)
    .for("update");
  if (!row || !permitted(row.payload, current))
    throw new APIError(
      404,
      "ANNUAL_NOT_FOUND",
      "열람·편집 가능한 연간계획을 찾을 수 없습니다.",
    );
  return row;
}
async function registeredEvents(
  tx: TX,
  draft: AnnualDraft,
): Promise<Map<string, CalendarEvent>> {
  if (!draft.publishedRowIds.length) return new Map();
  const rows = await tx
    .select({ payload: events.payload })
    .from(events)
    .where(inArray(events.id, draft.publishedRowIds))
    .limit(201);
  return new Map(rows.map((row) => [row.payload.id, row.payload]));
}
function projectDraft(
  draft: AnnualDraft,
  current: Actor,
  registered: Map<string, CalendarEvent>,
): AnnualDraft {
  // Draft rows retain their immutable registration snapshot in storage. Notes in
  // that historical snapshot require BOTH the old row's and current event's edit
  // scope. Moving an event to another department cannot expose its former notes.
  return {
    ...draft,
    rows: draft.rows.map((row) => {
      if (!draft.publishedRowIds.includes(row.id)) return structuredClone(row);
      const event = registered.get(row.id);
      return event && canEditEvent(event, current)
        ? structuredClone(row)
        : {
            ...structuredClone(row),
            input: { ...structuredClone(row.input), internalNote: "" },
          };
    }),
  };
}
async function draftResponse(
  tx: TX,
  draft: AnnualDraft,
  current: Actor,
): Promise<{ draft: AnnualDraft }> {
  return {
    draft: projectDraft(draft, current, await registeredEvents(tx, draft)),
  };
}
function conflict(): never {
  throw new APIError(
    409,
    "VERSION_CONFLICT",
    "다른 담당자 또는 다른 창에서 초안이 변경되었습니다. 입력을 보존한 채 최신 내용을 확인한 후 다시 저장하세요.",
  );
}
async function validateSources(
  tx: TX,
  rows: AnnualPlanRow[],
  current: Actor,
): Promise<void> {
  const ids = [
    ...new Set(
      rows.flatMap((row) => (row.sourceEventId ? [row.sourceEventId] : [])),
    ),
  ];
  if (!ids.length) return;
  const sources = await tx
    .select({ payload: events.payload })
    .from(events)
    .where(inArray(events.id, ids))
    .limit(201);
  if (
    ids.some(
      (id) =>
        !sources.some(
          (row) =>
            row.payload.id === id &&
            canReadEvent(row.payload, current) &&
            (!row.payload.deleted || canEditEvent(row.payload, current)),
        ),
    )
  )
    throw new APIError(
      400,
      "INVALID_SOURCE_EVENT",
      "복사 원본은 현재 실제로 열람 가능한 일정이어야 합니다.",
    );
}
async function assertUnclaimedRows(
  tx: TX,
  draftId: string,
  rows: AnnualPlanRow[],
): Promise<void> {
  const ids = rows.map((row) => row.id);
  if (!ids.length) return;
  // Church settings lock serializes these claims with all other mutations. JSON
  // membership is exact (not substring matching) and bounded to 200 row IDs.
  const claims = ids.map(
    (id) =>
      sql`JSON_CONTAINS(JSON_EXTRACT(${annualDrafts.payload}, '$.rows[*].id'), ${JSON.stringify(id)})`,
  );
  const [claimed] = await tx
    .select({ id: annualDrafts.id })
    .from(annualDrafts)
    .where(and(ne(annualDrafts.id, draftId), or(...claims)))
    .limit(1);
  const [event] = await tx
    .select({ id: events.id })
    .from(events)
    .where(inArray(events.operationId, ids))
    .limit(1);
  if (claimed || event)
    throw new APIError(
      409,
      "ROW_ID_CONFLICT",
      "행 등록 ID가 다른 초안이나 일정에 이미 사용되었습니다. 새 행 ID로 다시 입력하세요.",
    );
}
async function writeDraft(
  tx: TX,
  before: AnnualDraft,
  after: AnnualDraft,
): Promise<void> {
  await tx
    .update(annualDrafts)
    .set({
      year: after.year,
      organizationId: after.organizationId,
      version: after.version,
      updatedAt: after.updatedAt,
      payload: after,
    })
    .where(
      and(
        eq(annualDrafts.id, before.id),
        eq(annualDrafts.version, before.version),
      ),
    );
}

export async function listAnnualDrafts(
  actor: Actor | null,
  year: number,
): Promise<{ drafts: AnnualDraftSummary[] }> {
  const authenticated = requireActor(actor);
  const selectedYear = parseAnnual(annualYearSchema, year);
  return getDB().transaction(async (tx) => {
    const current = await writeActor(tx, authenticated);
    requireEditor(current);
    const scope =
      current.role === "admin"
        ? eq(annualDrafts.year, selectedYear)
        : and(
            eq(annualDrafts.year, selectedYear),
            eq(annualDrafts.ownerId, current.id),
          );
    // A sidebar never needs draft bodies. SQL extracts bounded metadata and
    // organization IDs for fresh per-row authorization without materializing
    // up to 200 full 512KiB plans or performing an event query per draft.
    const rows = await tx
      .select({
        id: annualDrafts.id,
        ownerId: annualDrafts.ownerId,
        year: annualDrafts.year,
        organizationId: annualDrafts.organizationId,
        version: annualDrafts.version,
        createdAt: annualDrafts.createdAt,
        updatedAt: annualDrafts.updatedAt,
        rowCount: sql<number>`JSON_LENGTH(JSON_EXTRACT(${annualDrafts.payload}, '$.rows'))`,
        publishedCount: sql<number>`JSON_LENGTH(JSON_EXTRACT(${annualDrafts.payload}, '$.publishedRowIds'))`,
        rowOrganizations: sql<unknown>`COALESCE(JSON_EXTRACT(${annualDrafts.payload}, '$.rows[*].input.organizationId'), JSON_ARRAY())`,
      })
      .from(annualDrafts)
      .where(scope)
      .orderBy(desc(annualDrafts.updatedAt))
      .limit(LIST_LIMIT + 1);
    if (rows.length > LIST_LIMIT)
      throw new APIError(
        422,
        "ANNUAL_LIST_LIMIT",
        "이 연도의 초안이 너무 많습니다. 관리자에게 문의하세요.",
      );
    const drafts: AnnualDraftSummary[] = [];
    for (const row of rows) {
      const rowOrganizations: unknown =
        typeof row.rowOrganizations === "string"
          ? JSON.parse(row.rowOrganizations)
          : row.rowOrganizations;
      if (!Array.isArray(rowOrganizations))
        throw new APIError(
          503,
          "ANNUAL_DATA_INVALID",
          "초안 목록의 데이터 형식을 확인해야 합니다.",
        );
      const organizationId = row.organizationId as OrganizationId;
      if (
        !canUseOrganization(current, organizationId) ||
        rowOrganizations.some(
          (id) =>
            typeof id !== "string" ||
            !canUseOrganization(current, id as OrganizationId),
        )
      )
        continue;
      drafts.push({
        id: row.id,
        ownerId: row.ownerId,
        year: row.year,
        organizationId,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        rowCount: Number(row.rowCount),
        publishedCount: Number(row.publishedCount),
      });
    }
    return { drafts };
  });
}
export async function getAnnualDraft(
  actor: Actor | null,
  id: string,
): Promise<{ draft: AnnualDraft }> {
  const authenticated = requireActor(actor);
  return getDB().transaction(async (tx) => {
    const current = await writeActor(tx, authenticated);
    requireEditor(current);
    return draftResponse(
      tx,
      (await lockedDraft(tx, id, current)).payload,
      current,
    );
  });
}
export async function createAnnualDraft(
  actor: Actor | null,
  value: unknown,
): Promise<{ draft: AnnualDraft }> {
  const authenticated = requireActor(actor);
  const { id, input } = parseAnnual(annualCreateSchema, value);
  return getDB().transaction(async (tx) => {
    const current = await writeActor(tx, authenticated);
    requireEditor(current);
    requireInputGrants(input, current);
    const [existing] = await tx
      .select()
      .from(annualDrafts)
      .where(eq(annualDrafts.id, id))
      .limit(1)
      .for("update");
    if (existing) {
      if (
        existing.ownerId !== current.id ||
        !permitted(existing.payload, current) ||
        canonical(existing.initialPayload) !== canonical(input)
      )
        throw new APIError(
          409,
          "ANNUAL_ID_CONFLICT",
          "이 초안 ID는 다른 입력에 이미 사용되었습니다.",
        );
      return draftResponse(tx, existing.payload, current);
    }
    await validateSources(tx, input.rows, current);
    await assertUnclaimedRows(tx, id, input.rows);
    const now = new Date().toISOString();
    const draft: AnnualDraft = {
      ...input,
      id,
      ownerId: current.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
      publishedRowIds: [],
    };
    await tx
      .insert(annualDrafts)
      .values({
        id,
        ownerId: current.id,
        year: input.year,
        organizationId: input.organizationId,
        version: 1,
        createdAt: now,
        updatedAt: now,
        initialPayload: input,
        payload: draft,
      });
    return { draft };
  });
}
export async function updateAnnualDraft(
  actor: Actor | null,
  id: string,
  value: unknown,
): Promise<{ draft: AnnualDraft }> {
  const authenticated = requireActor(actor);
  const { version, input } = parseAnnual(annualUpdateSchema, value);
  return getDB().transaction(async (tx) => {
    const current = await writeActor(tx, authenticated);
    requireEditor(current);
    const before = (await lockedDraft(tx, id, current)).payload;
    if (before.version !== version) conflict();
    requireInputGrants(input, current);
    const registered = await registeredEvents(tx, before);
    const projected = projectDraft(before, current, registered);
    if (before.publishedRowIds.length && input.year !== before.year)
      throw new APIError(
        409,
        "PUBLISHED_ROW_IMMUTABLE",
        "등록한 행이 있는 초안의 연도는 바꿀 수 없습니다.",
      );
    for (const publishedId of before.publishedRowIds) {
      const original = before.rows.find((row) => row.id === publishedId)!;
      const incoming = input.rows.find((row) => row.id === publishedId);
      const safe = projected.rows.find((row) => row.id === publishedId)!;
      // Accept exactly the safe wire projection, but never write that redaction
      // over the immutable registration snapshot stored in the database.
      if (
        !incoming ||
        (canonical(incoming) !== canonical(original) &&
          canonical(incoming) !== canonical(safe))
      )
        throw new APIError(
          409,
          "PUBLISHED_ROW_IMMUTABLE",
          "이미 등록한 행은 삭제·변경·재등록할 수 없습니다. 원본 일정에서 수정하세요.",
        );
    }
    const editable = input.rows.filter(
      (row) => !before.publishedRowIds.includes(row.id),
    );
    await validateSources(tx, editable, current);
    await assertUnclaimedRows(
      tx,
      id,
      editable.filter((row) => !before.rows.some((old) => old.id === row.id)),
    );
    const rows = input.rows.map((row) =>
      before.publishedRowIds.includes(row.id)
        ? before.rows.find((old) => old.id === row.id)!
        : row,
    );
    const nextInput = { ...input, rows };
    if (
      canonical(nextInput) ===
      canonical({
        year: before.year,
        organizationId: before.organizationId,
        rows: before.rows,
      })
    )
      return { draft: projected };
    const after: AnnualDraft = {
      ...before,
      ...nextInput,
      version: before.version + 1,
      updatedAt: new Date().toISOString(),
    };
    await writeDraft(tx, before, after);
    return { draft: projectDraft(after, current, registered) };
  });
}
export async function publishAnnualDraft(
  actor: Actor | null,
  id: string,
  value: unknown,
): Promise<AnnualPublishResult> {
  const authenticated = requireActor(actor);
  const { version, rowIds } = parseAnnual(annualPublishSchema, value);
  return getDB().transaction(async (tx) => {
    const current = await writeActor(tx, authenticated);
    requireEditor(current);
    const before = (await lockedDraft(tx, id, current)).payload;
    const selected = rowIds.map((rowId) =>
      before.rows.find((row) => row.id === rowId),
    );
    if (selected.some((row) => !row))
      throw new APIError(
        400,
        "UNKNOWN_ANNUAL_ROW",
        "이 초안에 없는 행을 선택했습니다.",
      );
    const pending = (selected as AnnualPlanRow[]).filter(
      (row) => !before.publishedRowIds.includes(row.id),
    );
    // A completed selection is retryable even with its pre-publication version.
    // Any NEW row still requires an exact version; no silent overwrite occurs.
    if (
      (pending.length && before.version !== version) ||
      version > before.version
    )
      conflict();
    const warnings: string[] = [];
    const inputs = pending.map((row) => {
      const parsed = rowToEventInput(row, before.year);
      if (parsed.undated || !parsed.input || parsed.errors.length)
        throw new APIError(
          400,
          "ANNUAL_ROW_INVALID",
          `행 ${before.rows.findIndex((item) => item.id === row.id) + 1}: ${parsed.undated ? "날짜가 미정인 행은 초안으로 남겨 주세요." : parsed.errors.join(" / ") || "날짜·시간 해석을 확인하세요."}`,
        );
      warnings.push(...parsed.warnings);
      const input = validateAnnualEvent(parsed.input);
      if (!canEditEvent(input, current))
        throw new APIError(
          403,
          "EDIT_FORBIDDEN",
          "선택한 행의 현재 부서 입력 권한이 없습니다.",
        );
      return { row, input };
    });
    await validateSources(tx, pending, current);
    const prepared: PreparedEventCreation[] = [];
    for (const item of inputs) {
      const next = await prepareEventCreation(
        tx,
        current,
        item.row.id,
        item.input,
        prepared.map((item) => item.event),
      );
      // Only draft-published rows may be retried. A separately registered event
      // must not be adopted by an unpublished draft row, even with equal input.
      if (next.existing)
        throw new APIError(
          409,
          "ROW_ID_CONFLICT",
          "이 행 ID는 이미 다른 일정 등록에 사용되었습니다.",
        );
      prepared.push(next);
      warnings.push(...next.warnings);
    }
    // Every selected pending row has passed parsing, complete-event validation,
    // current grants, source, operation-ID, and venue checks before these writes.
    for (const item of prepared) await writePreparedEvent(tx, current, item);
    const after: AnnualDraft = pending.length
      ? {
          ...before,
          version: before.version + 1,
          updatedAt: new Date().toISOString(),
          publishedRowIds: [
            ...before.publishedRowIds,
            ...pending.map((row) => row.id),
          ],
        }
      : before;
    if (pending.length) await writeDraft(tx, before, after);
    const registered = await registeredEvents(tx, after);
    const visibleEvents = rowIds.flatMap((rowId) => {
      const event = registered.get(rowId);
      return event &&
        canReadEvent(event, current) &&
        (!event.deleted || canEditEvent(event, current))
        ? [present(event, current)]
        : [];
    });
    return {
      draft: projectDraft(after, current, registered),
      events: visibleEvents,
      warnings: [...new Set(warnings)],
    };
  });
}
