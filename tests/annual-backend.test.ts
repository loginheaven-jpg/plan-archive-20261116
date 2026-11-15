import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import {
  MySqlDialect,
  type AnyMySqlColumn,
  type MySqlTable,
} from "drizzle-orm/mysql-core";
import { getDB, getPool } from "../src/db/client";
import {
  annualDrafts,
  audit,
  events,
  settings,
  users,
  venues,
} from "../src/db/schema";
import type {
  Actor,
  AnnualDraft,
  AnnualDraftInput,
  AnnualPlanRow,
  CalendarEvent,
  ChangeRecord,
  EventInput,
} from "../src/domain/types";
import { DEFAULT_CHURCH_SETTINGS } from "../src/domain/church-year";
import {
  createAnnualDraft,
  getAnnualDraft,
  listAnnualDrafts,
  publishAnnualDraft,
  updateAnnualDraft,
} from "../src/server/annual";
import {
  ANNUAL_MAX_BYTES,
  annualCreateSchema,
  annualPublishSchema,
  parseAnnual,
  validateAnnualDraft,
  validateAnnualEvent,
} from "../src/server/annual-validation";
import { readJSON } from "../src/server/http";
import {
  bootstrap,
  createEvent,
  publicFeedEvents,
} from "../src/server/services";
import { buildICS } from "../src/domain/ics";
import { discoverMigrations, verifyMigrationHistory } from "../scripts/migrate";

vi.mock("../src/db/client", () => ({
  getDB: vi.fn(),
  getPool: vi.fn(() => {
    throw new Error("Live DB access forbidden in tests");
  }),
  closeDB: vi.fn(),
  schemaReady: vi.fn(),
}));
const editor: Actor = {
  id: "isolated-editor",
  name: "현재 담당자",
  role: "editor",
  departmentIds: ["worship"],
};
const admin: Actor = {
  id: "isolated-admin",
  name: "현재 관리자",
  role: "admin",
  departmentIds: [],
};
const viewer: Actor = {
  id: "isolated-viewer",
  name: "조회자",
  role: "viewer",
  departmentIds: [],
};
const other: Actor = { ...editor, id: "other-editor" };
const draftId = "10edb85f-7f0a-44ed-9d50-7c06ae191430";
const rowA = "20edb85f-7f0a-44ed-9d50-7c06ae191430";
const rowB = "30edb85f-7f0a-44ed-9d50-7c06ae191430";
const rowC = "40edb85f-7f0a-44ed-9d50-7c06ae191430";
const input: EventInput = {
  title: "격리 행사",
  organizationId: "worship",
  startDate: "",
  endDate: "",
  allDay: true,
  startTime: null,
  endTime: null,
  audience: "all",
  audienceIds: [],
  visibility: "public",
  locationId: null,
  location: "",
  description: "안내",
  internalNote: "과거 비공개 메모",
  recurrence: null,
  status: "confirmed",
};
function row(id = rowA, patch: Partial<AnnualPlanRow> = {}): AnnualPlanRow {
  return { id, dateText: "11/15", input: structuredClone(input), ...patch };
}
function draftInput(rows = [row()]): AnnualDraftInput {
  return { year: 2026, organizationId: "worship", rows };
}
function event(id = rowA, patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    ...input,
    startDate: "2026-11-15",
    endDate: "2026-11-15",
    id,
    version: 1,
    createdAt: "2026-11-01T00:00:00.000Z",
    createdBy: { id: editor.id, name: editor.name },
    updatedAt: null,
    updatedBy: null,
    deleted: false,
    cancelReason: "",
    exceptions: [],
    ...patch,
  };
}

type MemoryRow = Record<string, unknown>;
const property = (name: string) =>
  name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const dialect = new MySqlDialect();
// Deterministic SQL-expression adapter: executes ONLY the small query vocabulary
// used by these services. Unknown expressions fail rather than silently matching.
function predicate(condition: SQL | undefined, row: MemoryRow): boolean {
  if (!condition) return true;
  const { sql: source, params } = dialect.sqlToQuery(condition);
  if (source.includes("JSON_CONTAINS")) {
    const draft = row.payload as AnnualDraft;
    return (
      row.id !== params[0] &&
      draft.rows.some((item) =>
        params
          .slice(1)
          .map((value) => JSON.parse(String(value)))
          .includes(item.id),
      )
    );
  }
  const text = source.replace(/`[^`]+`\.`([^`]+)`/g, (_, name: string) =>
    property(name),
  );
  const tokens =
    text.match(
      /<>|<=|>=|=|\(|\)|,|\?|\b(?:and|or|in)\b|[A-Za-z_][A-Za-z0-9_]*/g,
    ) ?? [];
  let cursor = 0,
    parameter = 0;
  const take = () => tokens[cursor++];
  const operand = () => {
    const token = take();
    if (token === "?") return params[parameter++];
    if (!(token in row))
      throw new Error(`Unsupported mock SQL operand: ${token}`);
    return row[token];
  };
  const factor = (): boolean => {
    if (tokens[cursor] === "(") {
      take();
      const result = parseOr();
      if (take() !== ")") throw new Error("Unbalanced mock SQL");
      return result;
    }
    let left = operand();
    const op = take();
    if (op === "in") {
      if (take() !== "(") throw new Error("Bad IN expression");
      const values = [operand()];
      while (tokens[cursor] === ",") {
        take();
        values.push(operand());
      }
      if (take() !== ")") throw new Error("Bad IN close");
      return values.includes(left);
    }
    const right = operand();
    if (typeof left === "boolean" && typeof right === "number")
      left = Number(left);
    if (op === "=") return left === right;
    if (op === "<>") return left !== right;
    if (
      left === null ||
      left === undefined ||
      right === null ||
      right === undefined
    )
      return false;
    if (op === "<=") return (left as string) <= (right as string);
    if (op === ">=") return (left as string) >= (right as string);
    throw new Error(`Unsupported mock SQL operator: ${op}`);
  };
  const parseAnd = (): boolean => {
    let result = factor();
    while (tokens[cursor] === "and") {
      take();
      const next = factor();
      result = result && next;
    }
    return result;
  };
  const parseOr = (): boolean => {
    let result = parseAnd();
    while (tokens[cursor] === "or") {
      take();
      const next = parseAnd();
      result = result || next;
    }
    return result;
  };
  const result = parseOr();
  if (cursor !== tokens.length || parameter !== params.length)
    throw new Error(`Unsupported SQL expression: ${source}`);
  return result;
}
function projectMemoryField(
  column: AnyMySqlColumn | SQL,
  item: MemoryRow,
): unknown {
  if ("name" in column) return item[property(column.name)];
  const { sql: source } = dialect.sqlToQuery(column);
  const payload = item.payload as AnnualDraft;
  if (source.includes("JSON_LENGTH") && source.includes("'$.rows'"))
    return payload.rows.length;
  if (source.includes("JSON_LENGTH") && source.includes("'$.publishedRowIds'"))
    return payload.publishedRowIds.length;
  if (source.includes("'$.rows[*].input.organizationId'"))
    return payload.rows.map((row) => row.input.organizationId);
  throw new Error(`Unsupported isolated projection: ${source}`);
}
function memoryDB() {
  let state = new Map<string, MemoryRow[]>();
  for (const table of [annualDrafts, audit, events, settings, users, venues])
    state.set(getTableName(table), []);
  state.set(getTableName(settings), [
    { id: "church", version: 1, payload: DEFAULT_CHURCH_SETTINGS },
  ]);
  state.set(
    getTableName(users),
    [editor, admin, viewer, other].map((actor) => ({
      ...structuredClone(actor),
      lastSeenAt: "2026-11-01T00:00:00.000Z",
    })),
  );
  const writes: { table: string; action: string; value: MemoryRow }[] = [];
  const reads: {
    table: string;
    sql: string;
    params: unknown[];
    locked: boolean;
    fields: string[];
  }[] = [];
  let failTable: string | null = null;
  let depth = 0;
  const rows = (table: MySqlTable) => state.get(getTableName(table))!;
  const seed = (table: MySqlTable, value: MemoryRow) => {
    rows(table).push(structuredClone(value));
  };
  const tx = {
    select: (fields?: Record<string, AnyMySqlColumn | SQL>) => {
      let table: MySqlTable,
        condition: SQL | undefined,
        limit = Infinity,
        locked = false,
        ordered = false;
      const chain = {
        from: (value: MySqlTable) => {
          table = value;
          return chain;
        },
        where: (value: SQL | undefined) => {
          condition = value;
          return chain;
        },
        limit: (value: number) => {
          limit = value;
          return chain;
        },
        for: (value: string) => {
          if (value !== "update" || depth !== 1)
            throw new Error("Invalid lock contract");
          locked = true;
          return chain;
        },
        orderBy: () => {
          ordered = true;
          return chain;
        },
        then: (
          resolve: (value: MemoryRow[]) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve()
            .then(() => {
              const compiled = condition
                ? dialect.sqlToQuery(condition)
                : { sql: "", params: [] };
              reads.push({
                table: getTableName(table),
                sql: compiled.sql,
                params: compiled.params,
                locked,
                fields: Object.keys(fields ?? {}),
              });
              let result = rows(table).filter((item) =>
                predicate(condition, item),
              );
              if (ordered)
                result = result
                  .slice()
                  .sort((a, b) =>
                    String(b.updatedAt ?? "").localeCompare(
                      String(a.updatedAt ?? ""),
                    ),
                  );
              return structuredClone(
                result
                  .slice(0, limit)
                  .map((item) =>
                    fields
                      ? Object.fromEntries(
                          Object.entries(fields).map(([key, column]) => [
                            key,
                            projectMemoryField(column, item),
                          ]),
                        )
                      : item,
                  ),
              );
            })
            .then(resolve, reject),
      };
      return chain;
    },
    insert: (table: MySqlTable) => ({
      values: async (value: MemoryRow) => {
        const name = getTableName(table);
        if (name === failTable)
          throw new Error("Injected isolated write failure");
        if (
          rows(table).some(
            (item) =>
              item.id === value.id ||
              (table === events && item.operationId === value.operationId),
          )
        )
          throw new Error("Duplicate in-memory primary/operation ID");
        rows(table).push(structuredClone(value));
        writes.push({
          table: name,
          action: "insert",
          value: structuredClone(value),
        });
      },
    }),
    update: (table: MySqlTable) => ({
      set: (value: MemoryRow) => ({
        where: async (condition: SQL) => {
          if (getTableName(table) === failTable)
            throw new Error("Injected isolated write failure");
          for (const item of rows(table).filter((item) =>
            predicate(condition, item),
          ))
            Object.assign(item, structuredClone(value));
          writes.push({
            table: getTableName(table),
            action: "update",
            value: structuredClone(value),
          });
        },
      }),
    }),
  };
  const db = {
    ...tx,
    transaction: async (fn: (transactionTX: typeof tx) => Promise<unknown>) => {
      if (depth) throw new Error("Nested transaction forbidden");
      const before = structuredClone(state),
        writeCount = writes.length;
      depth++;
      try {
        return await fn(tx);
      } catch (error) {
        state = before;
        writes.splice(writeCount);
        throw error;
      } finally {
        depth--;
      }
    },
  };
  vi.mocked(getDB).mockReturnValue(db as unknown as ReturnType<typeof getDB>);
  return {
    rows,
    seed,
    writes,
    reads,
    fail: (table: MySqlTable | null) => {
      failTable = table ? getTableName(table) : null;
    },
    user: (actor: Actor) =>
      Object.assign(rows(users).find((item) => item.id === actor.id)!, actor),
  };
}
let db: ReturnType<typeof memoryDB>;
beforeEach(() => {
  vi.clearAllMocks();
  db = memoryDB();
});
async function saved(rows = [row()]) {
  return (
    await createAnnualDraft(editor, { id: draftId, input: draftInput(rows) })
  ).draft;
}
async function published() {
  await saved();
  return publishAnnualDraft(editor, draftId, { version: 1, rowIds: [rowA] });
}

describe("annual draft schema and bounded JSON", () => {
  it("stores unfinished dates, invalid dates/times, and blank titles without creating events", async () => {
    const incomplete = row(rowA, {
      dateText: "날짜 미정",
      input: {
        ...input,
        title: "",
        startDate: "잘못된 날짜",
        endDate: "",
        allDay: false,
        startTime: "8시",
        endTime: null,
      },
    });
    expect((await saved([incomplete])).rows[0]).toEqual(incomplete);
    expect(db.rows(events)).toHaveLength(0);
    expect(db.rows(audit)).toHaveLength(0);
  });
  it("rejects forged envelope/row/event provenance and published metadata", () => {
    const base = { id: draftId, input: draftInput() };
    for (const value of [
      { ...base, ownerId: admin.id },
      { ...base, version: 10 },
      { ...base, publishedRowIds: [rowA] },
      { ...base, input: { ...base.input, ownerId: admin.id } },
      {
        ...base,
        input: draftInput([{ ...row(), createdBy: admin } as AnnualPlanRow]),
      },
      {
        ...base,
        input: draftInput([
          row(rowA, { input: { ...input, createdBy: admin } as EventInput }),
        ]),
      },
    ])
      expect(() => parseAnnual(annualCreateSchema, value)).toThrow();
  });
  it("enforces organization IDs, row IDs, type and length limits, duplicates and 200 rows", () => {
    for (const value of [
      { ...draftInput(), organizationId: "invented" },
      draftInput([row(rowA, { id: "forged" })]),
      draftInput([row(), row()]),
      draftInput([
        row(rowA, {
          input: {
            ...input,
            organizationId: "fake" as EventInput["organizationId"],
          },
        }),
      ]),
      draftInput([row(rowA, { dateText: "a".repeat(501) })]),
      draftInput([row(rowA, { timeConfirmed: "yes" as unknown as boolean })]),
      draftInput(
        Array.from({ length: 201 }, (_, index) =>
          row(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
        ),
      ),
    ])
      expect(() => validateAnnualDraft(value)).toThrow();
    expect(() =>
      parseAnnual(annualPublishSchema, { version: 1, rowIds: [rowA, rowA] }),
    ).toThrow();
    expect(() =>
      parseAnnual(annualPublishSchema, { version: 1, rowIds: [] }),
    ).toThrow();
  });
  it("permits only the explicit 512KiB route limit, retaining the old 64KiB default", async () => {
    const request = (length: number) =>
      new Request("https://plan.yebom.org/api/annual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "a".repeat(length) }),
      });
    await expect(readJSON(request(70000))).rejects.toMatchObject({
      status: 413,
    });
    await expect(
      readJSON(request(70000), ANNUAL_MAX_BYTES),
    ).resolves.toHaveProperty("text");
    await expect(
      readJSON(request(ANNUAL_MAX_BYTES), ANNUAL_MAX_BYTES),
    ).rejects.toMatchObject({ status: 413 });
    await expect(readJSON(request(1), Infinity)).rejects.toThrow();
    expect(() =>
      validateAnnualDraft(
        draftInput(
          Array.from({ length: 30 }, (_, index) =>
            row(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, {
              input: {
                ...input,
                description: "a".repeat(10000),
                internalNote: "b".repeat(10000),
              },
            }),
          ),
        ),
      ),
    ).toThrow();
  });
  it("supports open and ordinal monthly recurrence while retaining complete event validation", () => {
    const base = { ...input, startDate: "2026-11-15", endDate: "2026-11-15" };
    expect(
      validateAnnualEvent({
        ...base,
        recurrence: {
          frequency: "weekly",
          interval: 1,
          until: null,
          weekdays: [0],
        },
      }).recurrence?.until,
    ).toBeNull();
    expect(
      validateAnnualEvent({
        ...base,
        recurrence: {
          frequency: "monthly",
          interval: 1,
          until: null,
          weekdays: [0],
          monthWeek: -1,
        },
      }).recurrence?.monthWeek,
    ).toBe(-1);
    for (const recurrence of [
      { frequency: "monthly", interval: 1, until: null, weekdays: [0] },
      {
        frequency: "weekly",
        interval: 1,
        until: null,
        weekdays: [0],
        monthWeek: 2,
      },
      { frequency: "yearly", interval: 1, until: null, weekdays: [0] },
      { frequency: "weekly", interval: 1, until: "2032-11-15" },
    ])
      expect(() => validateAnnualEvent({ ...base, recurrence })).toThrow();
    expect(() => validateAnnualEvent({ ...base, title: "" })).toThrow();
  });
});

describe("current rights and private draft ownership", () => {
  it("denies anonymous/viewer requests and does not trust a stale editor role", async () => {
    await expect(
      createAnnualDraft(null, { id: draftId, input: draftInput() }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(listAnnualDrafts(viewer, 2026)).rejects.toMatchObject({
      status: 403,
    });
    db.user({ ...editor, role: "viewer", departmentIds: [] });
    await expect(
      createAnnualDraft(editor, { id: draftId, input: draftInput() }),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.rows(annualDrafts)).toHaveLength(0);
  });
  it("allows only owner or current calendar admin; list and GET check fresh row grants", async () => {
    await saved();
    expect((await listAnnualDrafts(other, 2026)).drafts).toEqual([]);
    await expect(getAnnualDraft(other, draftId)).rejects.toMatchObject({
      status: 404,
    });
    expect((await getAnnualDraft(admin, draftId)).draft.ownerId).toBe(
      editor.id,
    );
    expect((await listAnnualDrafts(admin, 2026)).drafts).toHaveLength(1);
    db.user({ ...editor, departmentIds: ["mission"] });
    expect((await listAnnualDrafts(editor, 2026)).drafts).toEqual([]);
    await expect(getAnnualDraft(editor, draftId)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      db.reads.slice(0, 2).map((read) => [read.table, read.locked]),
    ).toEqual([
      ["plan_settings", true],
      ["plan_users", true],
    ]);
  });
  it("rechecks every per-row department for create/update and refreshes admin revocation", async () => {
    await expect(
      saved([row(rowA, { input: { ...input, organizationId: "mission" } })]),
    ).rejects.toMatchObject({ status: 403 });
    await saved();
    await expect(
      updateAnnualDraft(editor, draftId, {
        version: 1,
        input: draftInput([
          row(rowA, { input: { ...input, organizationId: "mission" } }),
        ]),
      }),
    ).rejects.toMatchObject({ status: 403 });
    db.user({ ...admin, role: "viewer" });
    await expect(getAnnualDraft(admin, draftId)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("rejects fake or inaccessible copy provenance and accepts readable real sources", async () => {
    await expect(
      saved([row(rowA, { sourceEventId: rowC })]),
    ).rejects.toMatchObject({ code: "INVALID_SOURCE_EVENT" });
    db.seed(events, {
      id: rowC,
      operationId: rowC,
      payload: event(rowC, {
        organizationId: "mission",
        visibility: "department",
      }),
    });
    await expect(
      saved([row(rowA, { sourceEventId: rowC })]),
    ).rejects.toMatchObject({ code: "INVALID_SOURCE_EVENT" });
    (db.rows(events)[0].payload as CalendarEvent).visibility = "public";
    expect(
      (await saved([row(rowA, { sourceEventId: rowC })])).rows[0].sourceEventId,
    ).toBe(rowC);
  });
  it("reserves exact UUID rows across drafts and prevents reusing event operation IDs", async () => {
    await saved();
    await expect(
      createAnnualDraft(editor, { id: rowB, input: draftInput() }),
    ).rejects.toMatchObject({ code: "ROW_ID_CONFLICT" });
    db.seed(events, { id: rowC, operationId: rowC, payload: event(rowC) });
    await expect(
      updateAnnualDraft(editor, draftId, {
        version: 1,
        input: draftInput([row(), row(rowC)]),
      }),
    ).rejects.toMatchObject({ code: "ROW_ID_CONFLICT" });
  });
  it("is idempotent for the same draft creation and rejects ID reuse with another input", async () => {
    const before = await saved();
    const count = db.writes.length;
    expect((await saved()).id).toBe(before.id);
    expect(db.writes).toHaveLength(count);
    await expect(
      saved([row(rowA, { dateText: "12/10" })]),
    ).rejects.toMatchObject({ code: "ANNUAL_ID_CONFLICT" });
  });
  it("preserves saved client input on stale update and leaves no-op timestamps unchanged", async () => {
    const original = await saved();
    expect(
      (
        await updateAnnualDraft(editor, draftId, {
          version: 1,
          input: draftInput(),
        })
      ).draft.updatedAt,
    ).toBe(original.updatedAt);
    const updated = await updateAnnualDraft(editor, draftId, {
      version: 1,
      input: draftInput([row(rowA, { dateText: "미정" })]),
    });
    const writes = db.writes.length;
    await expect(
      updateAnnualDraft(editor, draftId, { version: 1, input: draftInput() }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(db.writes).toHaveLength(writes);
    expect((await getAnnualDraft(editor, draftId)).draft).toEqual(
      updated.draft,
    );
  });
});

describe("all-or-nothing annual publication", () => {
  it("creates stable row event IDs, immutable author/timestamps and audit in one transaction", async () => {
    await saved([row(), row(rowB, { dateText: "11/16" })]);
    db.user({ ...editor, name: "서버에서 갱신한 이름" });
    const result = await publishAnnualDraft(editor, draftId, {
      version: 1,
      rowIds: [rowA, rowB],
    });
    expect(result.draft).toMatchObject({
      version: 2,
      ownerId: editor.id,
      publishedRowIds: [rowA, rowB],
    });
    expect(result.events.map((item) => item.id)).toEqual([rowA, rowB]);
    for (const item of result.events) {
      expect(item).toMatchObject({
        version: 1,
        createdBy: { id: editor.id, name: "서버에서 갱신한 이름" },
        updatedAt: null,
        updatedBy: null,
      });
      const change = db
        .rows(audit)
        .find((record) => record.eventId === item.id)!;
      expect(change.payload as ChangeRecord).toMatchObject({
        kind: "create",
        by: item.createdBy,
        at: item.createdAt,
        before: null,
      });
    }
    expect(db.writes.slice(1).map((write) => write.table)).toEqual([
      "plan_events",
      "plan_audit",
      "plan_events",
      "plan_audit",
      "plan_annual_drafts",
    ]);
  });
  it("attributes an admin's publication to that actual admin, not the draft owner", async () => {
    await saved();
    const result = await publishAnnualDraft(admin, draftId, {
      version: 1,
      rowIds: [rowA],
    });
    expect(result.events[0].createdBy).toEqual({
      id: admin.id,
      name: admin.name,
    });
    expect(result.draft.ownerId).toBe(editor.id);
  });
  it("validates all selected rows before writing, rejects undated/invalid/blank/ambiguous rows", async () => {
    for (const bad of [
      row(rowB, { dateText: "날짜 미정" }),
      row(rowB, { dateText: "2/29" }),
      row(rowB, { input: { ...input, title: "" } }),
      row(rowB, { dateText: "11/16 8시" }),
    ]) {
      db = memoryDB();
      await saved([row(), bad]);
      const count = db.writes.length;
      await expect(
        publishAnnualDraft(editor, draftId, {
          version: 1,
          rowIds: [rowA, rowB],
        }),
      ).rejects.toMatchObject({ code: "ANNUAL_ROW_INVALID" });
      expect(db.rows(events)).toHaveLength(0);
      expect(db.rows(audit)).toHaveLength(0);
      expect(db.writes).toHaveLength(count);
      expect(
        (db.rows(annualDrafts)[0].payload as AnnualDraft).publishedRowIds,
      ).toEqual([]);
    }
  });
  it("leaves unselected incomplete rows as private drafts", async () => {
    await saved([
      row(),
      row(rowB, { dateText: "날짜 미정", input: { ...input, title: "" } }),
    ]);
    const result = await publishAnnualDraft(editor, draftId, {
      version: 1,
      rowIds: [rowA],
    });
    expect(result.events).toHaveLength(1);
    expect(result.draft.rows).toHaveLength(2);
    expect(result.draft.publishedRowIds).toEqual([rowA]);
  });
  it("validates all venues before the first write", async () => {
    await saved([
      row(),
      row(rowB, { input: { ...input, locationId: "missing-place" } }),
    ]);
    const count = db.writes.length;
    await expect(
      publishAnnualDraft(editor, draftId, { version: 1, rowIds: [rowA, rowB] }),
    ).rejects.toMatchObject({ code: "UNKNOWN_VENUE" });
    expect(db.rows(events)).toHaveLength(0);
    expect(db.writes).toHaveLength(count);
  });
  it("rolls back event, audit, and draft on audit or final-draft write failure", async () => {
    for (const failure of [audit, annualDrafts]) {
      db = memoryDB();
      await saved([row(), row(rowB)]);
      db.fail(failure);
      await expect(
        publishAnnualDraft(editor, draftId, {
          version: 1,
          rowIds: [rowA, rowB],
        }),
      ).rejects.toThrow("Injected isolated");
      expect(db.rows(events)).toHaveLength(0);
      expect(db.rows(audit)).toHaveLength(0);
      expect(db.writes).toHaveLength(1);
      expect(db.rows(annualDrafts)[0].payload as AnnualDraft).toMatchObject({
        version: 1,
        publishedRowIds: [],
      });
    }
  });
  it("checks grants on publish/retry and rejects stale versions when new rows are selected", async () => {
    await saved([row(), row(rowB)]);
    await publishAnnualDraft(editor, draftId, { version: 1, rowIds: [rowA] });
    const count = db.writes.length;
    await expect(
      publishAnnualDraft(editor, draftId, { version: 1, rowIds: [rowA, rowB] }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    db.user({ ...editor, departmentIds: ["mission"] });
    await expect(
      publishAnnualDraft(editor, draftId, { version: 1, rowIds: [rowA] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.writes).toHaveLength(count);
  });
  it("retries a completed selection with a stale version without duplicate events or audits", async () => {
    const first = await published();
    const count = db.writes.length;
    const retry = await publishAnnualDraft(editor, draftId, {
      version: 1,
      rowIds: [rowA],
    });
    expect(retry.draft).toEqual(first.draft);
    expect(retry.events).toEqual(first.events);
    expect(db.writes).toHaveLength(count);
    expect(db.rows(events)).toHaveLength(1);
    expect(db.rows(audit)).toHaveLength(1);
    await expect(
      publishAnnualDraft(editor, draftId, { version: 999, rowIds: [rowA] }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
  it("publishes explicitly confirmed open weekly and ordinal monthly rows", async () => {
    await saved([
      row(rowA, {
        dateText: "10/10부터 계속 수요일8시",
        timeConfirmed: true,
        input: {
          ...input,
          allDay: false,
          startTime: "20:00",
          endTime: "21:00",
        },
      }),
      row(rowB, { dateText: "매월 둘째 주일" }),
    ]);
    const result = await publishAnnualDraft(editor, draftId, {
      version: 1,
      rowIds: [rowA, rowB],
    });
    expect(result.events[0]).toMatchObject({
      startTime: "20:00",
      recurrence: { frequency: "weekly", until: null, weekdays: [3] },
    });
    expect(result.events[1].recurrence).toMatchObject({
      frequency: "monthly",
      until: null,
      weekdays: [0],
      monthWeek: 2,
    });
    expect(
      db.rows(events).every((item) => item.recurrenceUntil === "2200-12-31"),
    ).toBe(true);
  });
  it("returns only authorized CURRENT events, redacts inaccessible current/historical notes", async () => {
    await published();
    const master = db.rows(events)[0].payload as CalendarEvent;
    master.organizationId = "mission";
    master.internalNote = "새 부서 비공개 메모";
    master.visibility = "public";
    const retry = await publishAnnualDraft(editor, draftId, {
      version: 1,
      rowIds: [rowA],
    });
    expect(retry.events[0]).not.toHaveProperty("internalNote");
    expect(retry.events[0].organizationId).toBe("mission");
    expect(retry.draft.rows[0].input.internalNote).toBe("");
    expect(JSON.stringify(retry)).not.toContain("과거 비공개 메모");
    expect(JSON.stringify(retry)).not.toContain("새 부서 비공개 메모");
    master.visibility = "department";
    expect(
      (
        await publishAnnualDraft(editor, draftId, {
          version: 1,
          rowIds: [rowA],
        })
      ).events,
    ).toEqual([]);
    const safe = (await getAnnualDraft(editor, draftId)).draft;
    await updateAnnualDraft(editor, draftId, {
      version: safe.version,
      input: {
        year: safe.year,
        organizationId: safe.organizationId,
        rows: [...safe.rows, row(rowB)],
      },
    });
    expect(
      (db.rows(annualDrafts)[0].payload as AnnualDraft).rows[0].input
        .internalNote,
    ).toBe("과거 비공개 메모");
  });
  it("forbids removal/edits/year changes of published rows while allowing append", async () => {
    const first = await published();
    for (const candidate of [
      draftInput([]),
      draftInput([row(rowA, { dateText: "11/16" })]),
      draftInput([row(rowA, { input: { ...input, title: "바뀐 제목" } })]),
      { ...draftInput(), year: 2027 },
    ])
      await expect(
        updateAnnualDraft(editor, draftId, { version: 2, input: candidate }),
      ).rejects.toMatchObject({ code: "PUBLISHED_ROW_IMMUTABLE" });
    const appended = await updateAnnualDraft(editor, draftId, {
      version: 2,
      input: draftInput([row(), row(rowB)]),
    });
    expect(appended.draft.rows[0]).toEqual(first.draft.rows[0]);
    const next = await publishAnnualDraft(editor, draftId, {
      version: 3,
      rowIds: [rowA, rowB],
    });
    expect(next.draft.publishedRowIds).toEqual([rowA, rowB]);
    expect(db.rows(audit)).toHaveLength(2);
  });
  it("never adopts an independently registered event, or accepts a row outside the draft", async () => {
    await saved();
    await expect(
      publishAnnualDraft(editor, draftId, { version: 1, rowIds: [rowB] }),
    ).rejects.toMatchObject({ code: "UNKNOWN_ANNUAL_ROW" });
    const complete = {
      ...input,
      startDate: "2026-11-15",
      endDate: "2026-11-15",
    };
    await createEvent(editor, rowA, complete);
    await expect(
      publishAnnualDraft(editor, draftId, { version: 1, rowIds: [rowA] }),
    ).rejects.toMatchObject({ code: "ROW_ID_CONFLICT" });
    expect(
      (db.rows(annualDrafts)[0].payload as AnnualDraft).publishedRowIds,
    ).toEqual([]);
  });
});

describe("bounded recurrence, feed separation, immutable migration history", () => {
  it("indexes open series with sentinel while preserving actual until:null, making future masters queryable", async () => {
    const open = {
      ...input,
      startDate: "2026-11-15",
      endDate: "2026-11-15",
      recurrence: {
        frequency: "weekly" as const,
        interval: 1,
        until: null,
        weekdays: [0],
      },
    };
    await createEvent(editor, rowA, open);
    expect(db.rows(events)[0].recurrenceUntil).toBe("2200-12-31");
    expect(
      (db.rows(events)[0].payload as CalendarEvent).recurrence?.until,
    ).toBeNull();
    expect(await publicFeedEvents(2040)).toHaveLength(1);
  });
  it("bounds open/five-year conflict queries and detects intra-batch venue overlaps", async () => {
    db.seed(venues, { id: "hall", name: "본당" });
    const open = {
      ...input,
      startDate: "2026-11-15",
      endDate: "2026-11-15",
      locationId: "hall",
      recurrence: {
        frequency: "weekly" as const,
        interval: 1,
        until: null,
        weekdays: [0],
      },
    };
    const result = await createEvent(editor, rowC, open);
    expect(result.warnings.join(" ")).toContain("까지만 확인");
    const rangeReads = db.reads.filter(
      (read) => read.table === "plan_events" && read.sql.includes("start_date"),
    );
    expect(rangeReads[0].params[0]).toBe("2027-11-16");
    const finite = {
      ...open,
      recurrence: { ...open.recurrence, until: "2031-11-15" },
    };
    await createEvent(editor, "50edb85f-7f0a-44ed-9d50-7c06ae191430", finite);
    const finiteRead = db.reads
      .filter(
        (read) =>
          read.table === "plan_events" && read.sql.includes("start_date"),
      )
      .at(-1)!;
    expect(finiteRead.params[0]).toBe("2027-11-16");
    await saved([
      row(rowA, { input: { ...input, locationId: "hall" } }),
      row(rowB, { input: { ...input, locationId: "hall" } }),
    ]);
    const batch = await publishAnnualDraft(editor, draftId, {
      version: 1,
      rowIds: [rowA, rowB],
    });
    expect(batch.warnings).toContain("선택 장소에 겹치는 일정이 있어요.");
  });
  it("does not leak invisible venue-conflict titles, times, or notes", async () => {
    db.seed(venues, { id: "hall", name: "본당" });
    const hidden = event(rowC, {
      organizationId: "mission",
      visibility: "department",
      title: "숨긴 제목",
      internalNote: "숨긴 메모",
      locationId: "hall",
    });
    db.seed(events, {
      id: rowC,
      operationId: rowC,
      startDate: hidden.startDate,
      endDate: hidden.endDate,
      recurrenceUntil: null,
      deleted: false,
      visibility: hidden.visibility,
      payload: hidden,
    });
    const result = await createEvent(editor, rowA, {
      ...input,
      startDate: "2026-11-15",
      endDate: "2026-11-15",
      locationId: "hall",
    });
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("숨긴");
  });
  it("does not include unfinished or unpublished draft rows in event bootstrap or public ICS", async () => {
    await saved([row(rowA, { input: { ...input, title: "비밀 초안 제목" } })]);
    const feed = await publicFeedEvents(2026);
    expect(feed).toEqual([]);
    expect(buildICS(feed, DEFAULT_CHURCH_SETTINGS)).not.toContain(
      "비밀 초안 제목",
    );
    const result = await bootstrap(
      new Request("https://plan.yebom.org/api/bootstrap"),
      null,
      2026,
    );
    expect(result.events).toEqual([]);
    expect(result.upcoming).toEqual([]);
    expect(
      db.reads.filter((read) => read.table === "plan_annual_drafts"),
    ).toHaveLength(2); // create lookup and row claim only
  });
  it("discovers ordered SQL and rejects changed, removed, or out-of-order applied checksums without a DB connection", async () => {
    const files = await discoverMigrations();
    expect(files.map((file) => file.id)).toEqual([
      "0001_calendar",
      "0002_annual",
    ]);
    expect(() =>
      verifyMigrationHistory(
        files,
        files.map((file) => ({ id: file.id, checksum: file.checksum })),
      ),
    ).not.toThrow();
    expect(() =>
      verifyMigrationHistory(files, [{ id: files[0].id, checksum: "changed" }]),
    ).toThrow();
    expect(() =>
      verifyMigrationHistory(files, [{ id: "missing", checksum: "x" }]),
    ).toThrow();
    expect(() =>
      verifyMigrationHistory(files, [
        { id: files[1].id, checksum: files[1].checksum },
      ]),
    ).toThrow();
    expect(files[1].content).toMatch(
      /^CREATE TABLE IF NOT EXISTS plan_annual_drafts/,
    );
    expect(files[1].content).not.toMatch(
      /\b(?:DROP|ALTER|UPDATE|DELETE|INSERT)\b/i,
    );
    expect(getPool).not.toHaveBeenCalled();
  });
});

describe("annual metadata list response bound", () => {
  it("lists 70 near-limit drafts without bodies, notes or per-draft event queries", async () => {
    for (let index = 0; index < 70; index++) {
      const rows = Array.from({ length: 24 }, () =>
        row(crypto.randomUUID(), {
          input: {
            ...input,
            description: "a".repeat(10000),
            internalNote: "b".repeat(10000),
          },
        }),
      );
      const body = draftInput(rows);
      const payload: AnnualDraft = {
        ...body,
        id: crypto.randomUUID(),
        ownerId: editor.id,
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        publishedRowIds: [],
      };
      db.seed(annualDrafts, {
        id: payload.id,
        ownerId: editor.id,
        year: 2026,
        organizationId: "worship",
        version: 1,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        payload,
      });
    }
    const result = await listAnnualDrafts(editor, 2026);
    expect(result.drafts).toHaveLength(70);
    expect(result.drafts[0]).toMatchObject({ rowCount: 24, publishedCount: 0 });
    expect(result.drafts[0]).not.toHaveProperty("rows");
    expect(result.drafts[0]).not.toHaveProperty("publishedRowIds");
    expect(
      new TextEncoder().encode(JSON.stringify(result)).length,
    ).toBeLessThan(100000);
    expect(
      db.reads.filter((read) => read.table === "plan_events"),
    ).toHaveLength(0);
    expect(
      db.reads.find((read) => read.table === "plan_annual_drafts")?.fields,
    ).not.toContain("payload");
  });
});
