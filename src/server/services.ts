import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lte, or } from "drizzle-orm";
import { getDB } from "../db/client";
import { events, audit, users, settings, venues } from "../db/schema";
import { expandEvents, todayKST, addDaysISO, isOriginalRecurrenceDate, occurrenceForDate } from "../domain/calendar";
import { canReadEvent, canEditEvent, canCreate, publicEvent } from "../domain/permissions";
import { DEFAULT_CHURCH_SETTINGS } from "../domain/church-year";
import type { Actor, Bootstrap, CalendarEvent, ChangeRecord, ChurchSettings, EventInput, Occurrence, OrganizationId, Venue } from "../domain/types";
import { APIError, eventInput, occurrencePatch, validateEvent, validDate, type ValidMutation } from "./validation";
import { authStatus, requireActor, requireAdmin } from "./auth";

type DB = ReturnType<typeof getDB>;
export type TX = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Reader = DB | TX;
const MAX_EVENTS = 2000;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",") + "}";
  return JSON.stringify(value);
}
function snapshot(event: CalendarEvent): Record<string, unknown> { return structuredClone(event) as unknown as Record<string, unknown>; }
function normalized(event: CalendarEvent) {
  const duration = (Date.parse(`${event.endDate}T00:00:00Z`) - Date.parse(`${event.startDate}T00:00:00Z`)) / 86400000;
  const starts = [event.startDate, ...event.exceptions.flatMap(e => e.patch.startDate ? [e.patch.startDate] : [])];
  const ends = [event.endDate, ...event.exceptions.map(e => e.patch.endDate ?? addDaysISO(e.patch.startDate ?? e.date, duration))];
  // NULL in this denormalized index means NON-recurring. The payload retains
  // actual until:null for open recurrence, while its query index stays searchable.
  return { organizationId: event.organizationId, visibility: event.visibility, startDate: starts.sort()[0], endDate: ends.sort().at(-1)!, recurrenceUntil: event.recurrence ? event.recurrence.until ?? "2200-12-31" : null, locationId: event.locationId, version: event.version, deleted: event.deleted, payload: event };
}
async function masters(from: string, to: string, actor: Actor | null, includeDeleted = false, reader: Reader = getDB()): Promise<CalendarEvent[]> {
  const clauses = [lte(events.startDate, to), or(gte(events.endDate, from), gte(events.recurrenceUntil, addDaysISO(from, -31)))!];
  if (!includeDeleted) clauses.push(eq(events.deleted, false));
  if (!actor) clauses.push(eq(events.visibility, "public"));
  const rows = await reader.select({ payload: events.payload }).from(events).where(and(...clauses)).limit(MAX_EVENTS + 1);
  if (rows.length > MAX_EVENTS) throw new APIError(422, "RANGE_TOO_LARGE", "조회 범위의 일정이 너무 많습니다. 관리자에게 문의하세요.");
  return rows.map(row => row.payload).filter(event => canReadEvent(event, actor));
}
export function readableMaster(event: CalendarEvent, actor: Actor | null): CalendarEvent {
  return { ...event, exceptions: event.exceptions.map(exception => canReadEvent({ ...event, ...exception.patch }, actor) ? exception : { ...exception, patch: {}, cancelled: true, reason: "", updatedBy: null }) };
}
function withoutInternalNote<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "internalNote")) as T;
}
// Wire DTOs omit notes without dropping the provenance approved readers may see.
export function present(event: CalendarEvent, actor: Actor | null, editScope = true): CalendarEvent {
  const readable = readableMaster(event, actor);
  if (!actor) return publicEvent(readable) as unknown as CalendarEvent;
  return {
    ...(editScope && canEditEvent(event, actor) ? readable : withoutInternalNote(readable)),
    exceptions: readable.exceptions.map(exception => ({
      ...exception,
      patch: editScope && canEditEvent({ ...event, ...exception.patch }, actor) ? exception.patch : withoutInternalNote(exception.patch),
    })),
  };
}
function presentOccurrence(event: Occurrence, actor: Actor | null): Occurrence { return { ...present(event, actor), key: event.key, eventId: event.eventId, recurrenceDate: event.recurrenceDate, isException: event.isException }; }
export async function getSettings(reader: Reader = getDB()): Promise<{ settings: ChurchSettings; venues: Venue[]; version: number }> {
  const [row] = await reader.select().from(settings).where(eq(settings.id, "church")).limit(1);
  if (!row) throw new APIError(503, "MIGRATION_REQUIRED", "데이터베이스 초기 설정이 필요합니다.");
  const places = await reader.select().from(venues).orderBy(venues.name).limit(201);
  if (places.length > 200) throw new APIError(503, "VENUE_LIMIT", "장소 설정 한도를 확인하세요.");
  return { settings: row.payload, venues: places, version: row.version };
}
export async function bootstrap(request: Request, actor: Actor | null, year: number): Promise<Bootstrap> {
  const today = todayKST();
  const [yearEvents, upcomingEvents, config] = await Promise.all([masters(`${year}-01-01`, `${year}-12-31`, actor), masters(today, addDaysISO(today, 59), actor), getSettings()]);
  return { events: yearEvents.map(e => present(e, actor)), upcoming: expandEvents(upcomingEvents, today, addDaysISO(today, 59)).filter(e => e.status !== "cancelled" && canReadEvent(e, actor)).map(e => presentOccurrence(e, actor)).sort((a,b) => `${a.startDate}${a.startTime ?? "00:00"}`.localeCompare(`${b.startDate}${b.startTime ?? "00:00"}`)).slice(0, 500), actor, venues: config.venues, settings: config.settings, auth: authStatus(request) };
}
const publicChangeFields = new Set(["title", "organizationId", "startDate", "endDate", "allDay", "startTime", "endTime", "audience", "audienceIds", "visibility", "locationId", "location", "description", "recurrence", "status", "cancelReason", "deleted", "exceptions"]);
function historicalEvent(value: Record<string, unknown> | null): CalendarEvent | null {
  // Fail closed for incomplete legacy snapshots rather than inferring their scope from the current owner.
  if (!value || typeof value.organizationId !== "string" || !["public", "members", "department"].includes(String(value.visibility)) || !Array.isArray(value.exceptions)) return null;
  return value as unknown as CalendarEvent;
}
function safeOccurrenceDate(change: ChangeRecord, current: CalendarEvent, actor: Actor | null): string | undefined {
  const date = change.occurrenceDate;
  if (!date || !validDate(date) || !["update-occurrence", "cancel-occurrence", "uncancel-occurrence"].includes(change.kind)) return undefined;
  const readableOriginal = (event: CalendarEvent) => Boolean(event.recurrence && canReadEvent(event, actor) && isOriginalRecurrenceDate(event, date) && canReadEvent(occurrenceForDate(event, date), actor));
  if (!readableOriginal(current)) return undefined;
  for (const value of [change.before, change.after]) {
    if (!value) continue;
    const event = historicalEvent(value);
    if (!event || !readableOriginal(event)) return undefined;
  }
  return date;
}
function presentChange(change: ChangeRecord, current: CalendarEvent, actor: Actor | null): ChangeRecord {
  const editable = canEditEvent(current, actor);
  const fullHistory = editable && [current, ...[change.before, change.after].filter(value => value !== null).map(historicalEvent)].every(event => event && canEditEvent(event, actor) && event.exceptions.every(exception => canEditEvent({ ...event, ...exception.patch }, actor)));
  const projectSnapshot = (value: Record<string, unknown> | null): Record<string, unknown> | null => {
    const event = historicalEvent(value);
    if (!actor || !event || !canReadEvent(event, actor)) return null;
    return snapshot(present(event, actor, editable && canEditEvent(event, actor)));
  };
  const projected: ChangeRecord = {
    ...change,
    title: fullHistory ? change.title : current.title,
    organizationId: fullHistory ? change.organizationId : current.organizationId,
    by: actor ? change.by : null,
    reason: fullHistory ? change.reason : "",
    changedFields: fullHistory ? change.changedFields : change.changedFields.filter(field => publicChangeFields.has(field)),
    before: projectSnapshot(change.before),
    after: projectSnapshot(change.after),
  };
  delete projected.occurrenceDate;
  const date = safeOccurrenceDate(change, current, actor);
  if (date) projected.occurrenceDate = date;
  return projected;
}
export function publicChange(change: ChangeRecord, current: CalendarEvent): ChangeRecord {
  return presentChange(change, current, null);
}
export async function getEvent(id: string, actor: Actor | null): Promise<{ event: CalendarEvent; history: ChangeRecord[] }> {
  const [row] = await getDB().select({ payload: events.payload }).from(events).where(eq(events.id, id)).limit(1);
  if (!row || !canReadEvent(row.payload, actor) || (row.payload.deleted && !canEditEvent(row.payload, actor))) throw new APIError(404, "NOT_FOUND", "일정을 찾을 수 없습니다.");
  const rows = await getDB().select({ payload: audit.payload }).from(audit).where(eq(audit.eventId, id)).orderBy(desc(audit.at)).limit(100);
  return { event: present(row.payload, actor), history: rows.map(r => presentChange(r.payload, row.payload, actor)) };
}
export async function getChanges(actor: Actor | null): Promise<ChangeRecord[]> {
  const rows = await getDB().select({ change: audit.payload, event: events.payload }).from(audit).innerJoin(events, eq(audit.eventId, events.id)).where(actor ? undefined : eq(events.visibility, "public")).orderBy(desc(audit.at)).limit(100);
  return rows.filter(r => canReadEvent(r.event, actor) && (!r.event.deleted || canEditEvent(r.event, actor))).map(r => presentChange(r.change, r.event, actor));
}
export async function getTrash(actor: Actor | null): Promise<CalendarEvent[]> {
  requireActor(actor);
  const rows = await getDB().select({ event: events.payload }).from(events).where(eq(events.deleted, true)).limit(MAX_EVENTS + 1);
  if (rows.length > MAX_EVENTS) throw new APIError(422, "RANGE_TOO_LARGE", "휴지통 조회 한도를 초과했습니다.");
  return rows.map(r => r.event).filter(e => canEditEvent(e, actor));
}
export async function writeActor(tx: TX, actor: Actor): Promise<Actor> {
  // Consistent lock order for all mutations; also protects concurrent grant changes/last-admin checks.
  const [config] = await tx.select({ id: settings.id }).from(settings).where(eq(settings.id, "church")).limit(1).for("update");
  if (!config) throw new APIError(503, "MIGRATION_REQUIRED", "데이터베이스 초기 설정이 필요합니다.");
  const [current] = await tx.select().from(users).where(eq(users.id, actor.id)).limit(1).for("update");
  if (!current) throw new APIError(401, "AUTH_REQUIRED", "등록된 교적부 사용자 권한을 확인하세요.");
  return { id: current.id, name: current.name, role: current.role, departmentIds: current.departmentIds };
}
async function insertAudit(tx: TX, before: CalendarEvent | null, after: CalendarEvent, actor: Actor, kind: string, reason: string, fields: string[], occurrenceDate?: string) {
  const change: ChangeRecord = { id: randomUUID(), eventId: after.id, title: after.title, organizationId: after.organizationId, kind, at: after.updatedAt ?? after.createdAt, by: { id: actor.id, name: actor.name }, reason, changedFields: fields, before: before ? snapshot(before) : null, after: snapshot(after), ...(occurrenceDate ? { occurrenceDate } : {}) };
  await tx.insert(audit).values({ id: change.id, eventId: change.eventId, at: change.at, payload: change });
}
async function validateVenue(tx: TX, event: CalendarEvent) {
  const ids = new Set([event.locationId, ...event.exceptions.map(e => e.patch.locationId)].filter((id): id is string => !!id));
  for (const id of ids) {
    const [venue] = await tx.select({ id: venues.id }).from(venues).where(eq(venues.id, id)).limit(1);
    if (!venue) throw new APIError(400, "UNKNOWN_VENUE", "선택한 장소가 등록되어 있지 않습니다. 자유 입력 장소를 사용하거나 관리자에게 문의하세요.");
  }
}
function intervals(event: CalendarEvent, from: string, to: string, actor: Actor) {
  return expandEvents([event], from, to).filter(e => !e.deleted && e.status !== "cancelled" && canReadEvent(e, actor)).map(e => ({ locationId: e.locationId, start: Date.parse(`${e.startDate}T${e.allDay ? "00:00" : e.startTime}:00+09:00`), end: Date.parse(`${e.allDay ? addDaysISO(e.endDate, 1) : e.endDate}T${e.allDay ? "00:00" : e.endTime}:00+09:00`) })).sort((a,b) => a.start-b.start);
}
async function overlapWarnings(tx: TX, event: CalendarEvent, actor: Actor, additionalEvents: CalendarEvent[] = []): Promise<string[]> {
  if (event.deleted || event.status === "cancelled" || (!event.locationId && !event.exceptions.some(e => e.patch.locationId))) return [];
  const from = normalized(event).startDate;
  // A legacy/moved exception may precede the master by years. Bound the total
  // interval from its actual lower edge too, not just the master start date.
  const horizon = [addDaysISO(from, 366), addDaysISO(event.startDate, 366), "2200-12-31"].sort()[0];
  const duration = Math.round((Date.parse(`${event.endDate}T00:00:00Z`) - Date.parse(`${event.startDate}T00:00:00Z`)) / 86400000);
  const finiteEnd = event.recurrence?.until ? addDaysISO(event.recurrence.until, duration) : event.recurrence ? horizon : normalized(event).endDate;
  const to = [finiteEnd, horizon].sort()[0];
  const limitWarnings = event.recurrence && (!event.recurrence.until || finiteEnd > horizon) ? [`장소 겹침은 ${from}부터 ${to}까지만 확인했습니다. 이후 반복 회차의 충돌은 보장하지 않습니다.`] : [];
  const candidates = [...await masters(from, to, actor, false, tx), ...additionalEvents.filter(other => canReadEvent(other, actor))];
  const own = intervals(event, from, to, actor);
  for (const other of candidates) {
    if (other.id === event.id) continue;
    const theirs = intervals(other, from, to, actor);
    for (const locationId of new Set(own.map(i => i.locationId).filter(Boolean))) {
      const a = own.filter(i => i.locationId === locationId), b = theirs.filter(i => i.locationId === locationId);
      let i = 0, j = 0;
      while (i < a.length && j < b.length) {
        if (a[i].start < b[j].end && b[j].start < a[i].end) return ["선택 장소에 겹치는 일정이 있어요.", ...limitWarnings];
        if (a[i].end <= b[j].start) i++; else j++;
      }
    }
  }
  // Invisible conflicts are omitted; no private title/time inference is possible through warnings.
  return limitWarnings;
}
export interface PreparedEventCreation { event: CalendarEvent; input: EventInput; warnings: string[]; existing: boolean }
// Caller must refresh the actor and hold the church/user locks. No writes here:
// annual publishing can validate every selected row before the first event insert.
export async function prepareEventCreation(tx: TX, current: Actor, operationId: string, input: EventInput, additionalEvents: CalendarEvent[] = []): Promise<PreparedEventCreation> {
  const id = operationId.toLowerCase();
  if (!canCreate(current) || !canEditEvent(input, current)) throw new APIError(403, "EDIT_FORBIDDEN", "이 부서의 일정 입력 권한이 없습니다.");
  const [existing] = await tx.select().from(events).where(eq(events.operationId, id)).limit(1).for("update");
  if (existing) {
    if (existing.creatorId !== current.id || canonical(existing.initialPayload) !== canonical(input)) throw new APIError(409, "OPERATION_CONFLICT", "이 등록 번호는 다른 입력에 이미 사용되었습니다.");
    if (!canReadEvent(existing.payload, current) || (existing.payload.deleted && !canEditEvent(existing.payload, current))) throw new APIError(404, "NOT_FOUND", "열람 가능한 일정을 찾을 수 없습니다.");
    return { event: existing.payload, input, warnings: [], existing: true };
  }
  const event: CalendarEvent = { ...input, id, version: 1, cancelReason: "", deleted: false, createdAt: new Date().toISOString(), createdBy: { id: current.id, name: current.name }, updatedAt: null, updatedBy: null, exceptions: [] };
  await validateVenue(tx, event);
  const warnings = await overlapWarnings(tx, event, current, additionalEvents);
  return { event, input, warnings, existing: false };
}
export async function writePreparedEvent(tx: TX, current: Actor, prepared: PreparedEventCreation): Promise<void> {
  if (prepared.existing) return;
  const { event, input } = prepared;
  await tx.insert(events).values({ id: event.id, operationId: event.id, creatorId: current.id, initialPayload: input as unknown as Record<string, unknown>, ...normalized(event) });
  await insertAudit(tx, null, event, current, "create", "", Object.keys(input));
}
export async function createEvent(actor: Actor | null, operationId: string, input: EventInput): Promise<{ event: CalendarEvent; warnings: string[] }> {
  const authenticated = requireActor(actor);
  return getDB().transaction(async tx => {
    const current = await writeActor(tx, authenticated);
    const prepared = await prepareEventCreation(tx, current, operationId, input);
    await writePreparedEvent(tx, current, prepared);
    return { event: present(prepared.event, current), warnings: prepared.warnings };
  });
}
function originalOccurrence(event: CalendarEvent, date: string): CalendarEvent {
  if (!event.recurrence) throw new APIError(400, "NOT_RECURRING", "반복 일정만 한 회차를 변경할 수 있습니다.");
  const plain: CalendarEvent = { ...event, status: "confirmed", deleted: false, exceptions: [] };
  const match = expandEvents([plain], date, date, true).find(e => e.recurrenceDate === date);
  if (!match) throw new APIError(400, "INVALID_OCCURRENCE", "반복 규칙에 없는 원래 회차 날짜입니다.");
  return match;
}
export async function mutateEvent(id: string, actor: Actor | null, mutation: ValidMutation): Promise<{ event: CalendarEvent; warnings: string[] }> {
  const authenticated = requireActor(actor);
  return getDB().transaction(async tx => {
    const current = await writeActor(tx, authenticated);
    const [row] = await tx.select().from(events).where(eq(events.id, id)).limit(1).for("update");
    if (!row || !canEditEvent(row.payload, current)) throw new APIError(404, "NOT_FOUND", "편집 가능한 일정을 찾을 수 없습니다.");
    const before = row.payload;
    if (before.version !== mutation.version) throw new APIError(409, "VERSION_CONFLICT", "다른 담당자가 먼저 변경했습니다. 최신 내용을 확인한 후 다시 저장하세요.");
    if (before.deleted && mutation.action !== "restore" && mutation.action !== "delete") throw new APIError(409, "EVENT_DELETED", "휴지통의 일정은 먼저 복구하세요.");
    let after = structuredClone(before);
    let kind: string = mutation.action;
    const reason = mutation.reason?.trim() ?? "";
    let affectedOccurrenceDate: string | undefined;
    if (mutation.action === "cancel" && !reason) throw new APIError(400, "REASON_REQUIRED", "취소 사유를 입력하세요.");
    if (mutation.occurrenceDate) {
      if (before.status === "cancelled") throw new APIError(409, "SERIES_CANCELLED", "전체 반복이 취소되어 있습니다. 전체 취소를 먼저 해제하세요.");
      const original = originalOccurrence(before, mutation.occurrenceDate);
      const previous = before.exceptions.find(e => e.date === mutation.occurrenceDate);
      const patch = mutation.action === "update" ? { ...(previous?.patch ?? {}), ...occurrencePatch(mutation.input ?? {}, before) } : previous?.patch ?? {};
      const duration = (Date.parse(`${before.endDate}T00:00:00Z`) - Date.parse(`${before.startDate}T00:00:00Z`)) / 86400000;
      const effectiveStart = patch.startDate ?? original.startDate;
      const effective = validateEvent({ ...eventInput(original), ...patch, startDate: effectiveStart, endDate: patch.endDate ?? addDaysISO(effectiveStart, duration), recurrence: null });
      const cancelled = mutation.action === "cancel";
      if (previous?.cancelled && !cancelled && !reason) throw new APIError(400, "REASON_REQUIRED", "회차 취소를 해제하려면 사유를 입력하세요.");
      const next = { date: mutation.occurrenceDate, patch, cancelled, reason: cancelled ? reason : "", updatedAt: new Date().toISOString(), updatedBy: { id: current.id, name: current.name } };
      // Metadata alone is not a change; repeated identical cancellation/update is a no-op.
      const oldStart = previous?.patch.startDate ?? original.startDate;
      const oldEffective = validateEvent({ ...eventInput(original), ...previous?.patch, startDate: oldStart, endDate: previous?.patch.endDate ?? addDaysISO(oldStart, duration), recurrence: null });
      const oldContent = { input: oldEffective, cancelled: previous?.cancelled ?? false, reason: previous?.reason ?? "" };
      const newContent = { input: effective, cancelled: next.cancelled, reason: next.reason };
      if (canonical(oldContent) === canonical(newContent)) return { event: before, warnings: [] };
      after.exceptions = [...before.exceptions.filter(e => e.date !== mutation.occurrenceDate), next].sort((a,b) => a.date.localeCompare(b.date));
      kind = cancelled ? "cancel-occurrence" : previous?.cancelled ? "uncancel-occurrence" : "update-occurrence";
      affectedOccurrenceDate = mutation.occurrenceDate;
    } else if (mutation.action === "update") {
      const input = validateEvent(mutation.input);
      if (!canCreate(current) || !canEditEvent(input, current)) throw new APIError(403, "EDIT_FORBIDDEN", "변경할 주관부서의 권한이 없습니다.");
      if (before.status === "cancelled" && !reason) throw new APIError(400, "REASON_REQUIRED", "전체 취소를 해제하려면 상태와 사유를 명시하세요.");
      kind = before.status === "cancelled" ? "uncancel" : "update";
      after = { ...after, ...input, cancelReason: "" };
      // Recurrence changes may not silently strand existing exception identities.
      for (const exception of after.exceptions) originalOccurrence(after, exception.date);
    } else if (mutation.action === "cancel") { after.status = "cancelled"; after.cancelReason = reason; }
    else if (mutation.action === "delete") after.deleted = true;
    else if (mutation.action === "restore") after.deleted = false;
    const fields = Object.keys(after).filter(k => canonical(after[k as keyof CalendarEvent]) !== canonical(before[k as keyof CalendarEvent]));
    if (!fields.length) return { event: before, warnings: [] };
    after.version = before.version + 1; after.updatedAt = new Date().toISOString(); after.updatedBy = { id: current.id, name: current.name };
    await validateVenue(tx, after);
    const warnings = await overlapWarnings(tx, after, current);
    await tx.update(events).set(normalized(after)).where(and(eq(events.id, id), eq(events.version, before.version)));
    await insertAudit(tx, before, after, current, kind, reason, fields, affectedOccurrenceDate);
    return { event: after, warnings };
  });
}
export async function publicFeedEvents(year: number): Promise<CalendarEvent[]> {
  return (await masters(`${year}-01-01`, `${year}-12-31`, null, true)).map(event => present(event, null));
}
async function adminAudit(tx: TX, actor: Actor, eventId: string, kind: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  const change: ChangeRecord = { id: randomUUID(), eventId, title: "관리 설정", organizationId: "admin", kind, at: new Date().toISOString(), by: { id: actor.id, name: actor.name }, reason: "", changedFields: Object.keys(after).filter(k => canonical(after[k]) !== canonical(before[k])), before, after };
  await tx.insert(audit).values({ id: change.id, eventId, at: change.at, payload: change });
}
export async function putSettings(actor: Actor | null, value: { settings: ChurchSettings; venues?: Venue[]; version?: number }) {
  const admin = requireAdmin(actor);
  return getDB().transaction(async tx => {
    const current = requireAdmin(await writeActor(tx, admin));
    const before = await getSettings(tx);
    if (value.version !== undefined && value.version !== before.version) throw new APIError(409, "VERSION_CONFLICT", "설정이 변경되었습니다. 최신 설정을 확인하세요.");
    const nextVenues = value.venues ?? before.venues;
    const removed = before.venues.filter(v => !nextVenues.some(n => n.id === v.id));
    if (removed.length) {
      const rows = await tx.select({ payload: events.payload }).from(events).limit(MAX_EVENTS + 1);
      if (rows.length > MAX_EVENTS) throw new APIError(422, "RANGE_TOO_LARGE", "사용 중인 장소 확인 범위를 초과했습니다.");
      if (rows.some(r => removed.some(v => r.payload.locationId === v.id || r.payload.exceptions.some(e => e.patch.locationId === v.id)))) throw new APIError(409, "VENUE_IN_USE", "일정이나 휴지통에서 사용 중인 장소 ID는 제거할 수 없습니다.");
    }
    if (canonical(before.settings) === canonical(value.settings) && canonical(before.venues.slice().sort((a,b) => a.id.localeCompare(b.id))) === canonical(nextVenues.slice().sort((a,b) => a.id.localeCompare(b.id)))) return before;
    if (value.venues) {
      for (const venue of value.venues) await tx.insert(venues).values(venue).onDuplicateKeyUpdate({ set: { name: venue.name } });
      for (const venue of removed) await tx.delete(venues).where(eq(venues.id, venue.id));
    }
    await tx.update(settings).set({ version: before.version + 1, payload: value.settings }).where(eq(settings.id, "church"));
    const after = { settings: value.settings, venues: nextVenues, version: before.version + 1 };
    await adminAudit(tx, current, "settings", "settings-update", before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    return after;
  });
}
export async function getUsers(actor: Actor | null) {
  requireAdmin(actor);
  return getDB().select().from(users).orderBy(users.name).limit(2000);
}
export async function updateUser(actor: Actor | null, input: { id: string; role: Actor["role"]; departmentIds: OrganizationId[] }) {
  const admin = requireAdmin(actor);
  return getDB().transaction(async tx => {
    const current = requireAdmin(await writeActor(tx, admin));
    const [before] = await tx.select().from(users).where(eq(users.id, input.id)).limit(1).for("update");
    if (!before) throw new APIError(404, "NOT_FOUND", "실제로 로그인한 사용자만 권한을 부여할 수 있습니다.");
    if (before.role === "admin" && input.role !== "admin") {
      const admins = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(2).for("update");
      if (admins.length < 2) throw new APIError(409, "LAST_ADMIN", "마지막 일정 관리자의 권한은 해제할 수 없습니다.");
    }
    if (before.role === input.role && canonical(before.departmentIds) === canonical(input.departmentIds)) return before;
    await tx.update(users).set({ role: input.role, departmentIds: input.departmentIds }).where(eq(users.id, input.id));
    const after = { ...before, role: input.role, departmentIds: input.departmentIds };
    await adminAudit(tx, current, `user:${input.id}`, "user-grant-update", before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    return after;
  });
}
export { DEFAULT_CHURCH_SETTINGS };
