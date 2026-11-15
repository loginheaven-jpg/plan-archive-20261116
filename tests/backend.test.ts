import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealData } from "iron-session";
import { getDB } from "../src/db/client";
import { APIError, createSchema, eventSchema, mutationSchema, occurrencePatch, parseYear, settingsUpdateSchema, validateEvent, validDate } from "../src/server/validation";
import { assertCSRF, authStatus, cookieValue, publicOrigin, verifySaintCookie, verifiedPerson } from "../src/server/auth";
import { assertUniqueJSONKeys, readJSON, readActor } from "../src/server/http";
import { canReadEvent, canEditEvent, canCreate, publicEvent } from "../src/domain/permissions";
import { bootstrap, canonical, createEvent, getChanges, getEvent, mutateEvent, publicChange, readableMaster, updateUser } from "../src/server/services";
import { occurrenceForDate } from "../src/domain/calendar";
import { GET as calendarFeed } from "../src/app/api/calendar.ics/route";
import { DEFAULT_CHURCH_SETTINGS } from "../src/domain/church-year";
import type { Actor, CalendarEvent, ChangeRecord, EventInput } from "../src/domain/types";

vi.mock("../src/db/client", () => ({ getDB: vi.fn() }));
const password = "isolated-test-secret-never-for-live-use-0123456789";
const viewer: Actor = { id: "test-viewer", name: "테스트 조회자", role: "viewer", departmentIds: [] };
const editor: Actor = { id: "test-editor", name: "테스트 담당자", role: "editor", departmentIds: ["worship"] };
const admin: Actor = { id: "test-admin", name: "테스트 관리자", role: "admin", departmentIds: [] };
const input: EventInput = { title: "격리된 테스트", organizationId: "worship", startDate: "2026-11-15", endDate: "2026-11-15", allDay: true, startTime: null, endTime: null, audience: "all", audienceIds: [], visibility: "public", locationId: null, location: "", description: "공개 안내", internalNote: "비공개 테스트 메모", recurrence: null, status: "confirmed" };
const event: CalendarEvent = { ...input, id: "98bf5fa5-f4a5-4775-87de-d43710988791", version: 1, cancelReason: "", deleted: false, createdAt: "2026-11-14T10:00:00.000Z", createdBy: { id: editor.id, name: editor.name }, updatedAt: null, updatedBy: null, exceptions: [] };
function request(origin = "https://plan.yebom.org", host = "plan.yebom.org", extras: Record<string,string> = {}) { return new Request(`https://${host}/api/events`, { method: "POST", headers: { origin, host, "sec-fetch-site": "same-origin", ...extras } }); }
beforeEach(() => { vi.stubEnv("YEBOM_SSO_SECRET", password); vi.stubEnv("APP_PUBLIC_ORIGIN", "https://plan.yebom.org"); vi.stubEnv("APP_ALLOWED_ORIGINS", ""); vi.stubEnv("YEBOM_CALENDAR_ADMIN_IDS", ""); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("calendar input validation", () => {
  it("accepts exact valid input, and rejects impossible dates", () => { expect(validateEvent(input)).toEqual(input); expect(validDate("2024-02-29")).toBe(true); expect(validDate("2026-02-29")).toBe(false); expect(() => validateEvent({ ...input, startDate: "2026-04-31" })).toThrow(); });
  it("rejects invalid/overnight same-day times and permits next-day end", () => { const timed = { ...input, allDay: false, startTime: "23:00", endTime: "01:00" }; expect(() => validateEvent(timed)).toThrow(); expect(validateEvent({ ...timed, endDate: "2026-11-16" }).endDate).toBe("2026-11-16"); expect(() => validateEvent({ ...timed, startTime: "24:00" })).toThrow(); });
  it("rejects reversed ranges, huge durations, or a timed all-day input", () => { expect(() => validateEvent({ ...input, endDate: "2026-11-14" })).toThrow(); expect(() => validateEvent({ ...input, endDate: "2028-11-15" })).toThrow(); expect(() => validateEvent({ ...input, startTime: "10:00" })).toThrow(); });
  it("enforces known organizations, strict keys, and audience consistency", () => { for (const patch of [{ organizationId: "unknown" }, { audienceIds: ["worship"] }, { audience: "departments" }, { audience: "departments", audienceIds: ["worship", "worship"] }, { createdBy: admin }, { title: " " }]) expect(() => validateEvent({ ...input, ...patch })).toThrow(); });
  it("bounds recurrence at five years, validates weekday sets and kinds", () => { const base = { ...input, recurrence: { frequency: "weekly", interval: 1, until: "2031-11-15", weekdays: [0,2] } }; expect(eventSchema.safeParse(base).success).toBe(true); for (const rule of [{ ...base.recurrence, until: "2031-11-16" }, { ...base.recurrence, weekdays: [0,0] }, { ...base.recurrence, interval: 0 }, { ...base.recurrence, frequency: "monthly" }, { ...base.recurrence, until: "2026-01-01" }]) expect(eventSchema.safeParse({ ...base, recurrence: rule }).success).toBe(false); });
  it("requires explicit cancellation reasons and UUID operation IDs", () => { expect(mutationSchema.safeParse({ version: 1, action: "cancel", reason: " " }).success).toBe(false); expect(mutationSchema.safeParse({ version: 0, action: "delete" }).success).toBe(false); expect(createSchema.safeParse({ operationId: "fake-id", input }).success).toBe(false); expect(createSchema.safeParse({ operationId: event.id, input }).success).toBe(true); });
  it("rejects forbidden occurrence owner/visibility/audience/recurrence changes", () => { for (const patch of [{ organizationId: "mission" }, { visibility: "members" }, { audience: "departments" }, { recurrence: { frequency: "weekly", interval: 1, until: "2027-01-01" } }]) expect(() => occurrencePatch(patch as Partial<EventInput>, event)).toThrow(APIError); expect(occurrencePatch({ ...input, title: "한 회차" }, event)).toHaveProperty("title", "한 회차"); expect(occurrencePatch(input, event)).not.toHaveProperty("organizationId"); });
  it("validates venue IDs, duplicate venue IDs, and settings dates", () => { const v = { settings: DEFAULT_CHURCH_SETTINGS, venues: [{ id: "hall", name: "장소" }] }; expect(settingsUpdateSchema.safeParse(v).success).toBe(true); expect(settingsUpdateSchema.safeParse({ ...v, venues: [...v.venues, ...v.venues] }).success).toBe(false); expect(settingsUpdateSchema.safeParse({ ...v, venues: [{ id: "../bad", name: "장소" }] }).success).toBe(false); expect(settingsUpdateSchema.safeParse({ ...v, settings: { ...DEFAULT_CHURCH_SETTINGS, thanksgiving: { enabled: true, rule: "fixedDate", month: 4, nth: 1, day: 31 } } }).success).toBe(false); });
  it("checks year bounds and canonical object key ordering", () => { expect(parseYear(null, 2026)).toBe(2026); expect(() => parseYear("2026;DROP", 2026)).toThrow(); expect(canonical({ b: 2, a: { x: 1 } })).toBe(canonical({ a: { x: 1 }, b: 2 })); });
});

describe("Saint SSO verification without any database identity writes", () => {
  const approved = { user_id: "isolated-sso-user", name: "격리 검증", isLoggedIn: true, is_approved: true, needs_profile_completion: false, finance_role: "super_admin" };
  it("only accepts authentic approved sealed data", async () => { const seal = await sealData(approved, { password }); expect(await verifySaintCookie(seal, password)).toEqual({ id: approved.user_id, name: approved.name }); expect(await verifySaintCookie(`${seal}forged`, password)).toBeNull(); expect(await verifySaintCookie(seal, "incorrect-secret-at-least-32-characters")).toBeNull(); expect(await verifySaintCookie(JSON.stringify(approved), password)).toBeNull(); });
  it("rejects an expired cryptographically authentic seal", async () => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T00:00:00Z")); const seal = await sealData(approved, { password, ttl: 60 }); vi.setSystemTime(new Date("2026-11-02T00:00:00Z")); expect(await verifySaintCookie(seal, password)).toBeNull(); });
  it("legacy verification rejects invalid keys while central authentication needs no local key", async () => { expect(await verifySaintCookie(null, password)).toBeNull(); expect(await verifySaintCookie("eyJ.fake.jwt", password)).toBeNull(); expect(await verifySaintCookie("fake", "short")).toBeNull(); vi.stubEnv("YEBOM_SSO_SECRET", ""); expect(await verifySaintCookie("fake")).toBeNull(); expect(authStatus(request()).configured).toBe(true); expect(authStatus(request()).loginUrl).toBe("https://plan.yebom.org/api/auth/sso"); });
  it("rejects unapproved, incomplete, and missing identity claims", async () => { for (const patch of [{ is_approved: false }, { is_approved: "true" }, { isLoggedIn: false }, { needs_profile_completion: true }, { user_id: "" }, { name: "" }, { user_id: 123 }]) expect(await verifySaintCookie(await sealData({ ...approved, ...patch }, { password }), password)).toBeNull(); });
  it("never authenticates in cross-site Preview even with a supplied sealed cookie", async () => { const seal = await sealData(approved, { password }); const req = request("https://preview.manus.computer", "preview.manus.computer", { cookie: `saint_record_session=${seal}` }); expect(authStatus(req)).toMatchObject({ configured: true, onSharedDomain: false, loginUrl: null }); expect(await verifiedPerson(req)).toBeNull(); expect(getDB).not.toHaveBeenCalled(); });
  it("only trusts an explicit HTTPS yebom subdomain, and rejects open redirect inputs", () => { for (const origin of ["http://plan.yebom.org", "https://yebom.org", "https://plan.yebom.org.evil.test", "https://evil.test", "https://plan.yebom.org/else", "https://u:p@plan.yebom.org", "https://plan.yebom.org?redirect=evil"]) { vi.stubEnv("APP_PUBLIC_ORIGIN", origin); expect(publicOrigin()).toBeNull(); } });
  it("detects duplicate cookie values and public mode never reads an actor", async () => { const req = request(undefined, undefined, { cookie: "saint_record_session=a; saint_record_session=b" }); expect(cookieValue(req, "saint_record_session")).toBeNull(); expect(await readActor(new Request("https://plan.yebom.org/api/bootstrap?public=1"))).toBeNull(); expect(getDB).not.toHaveBeenCalled(); });
});

describe("exact-origin CSRF", () => {
  it("accepts configured same-origin browser writes", () => expect(() => assertCSRF(request())).not.toThrow());
  it("rejects absent/null/mismatched origins and forwarded-host mismatches", () => { for (const req of [new Request("https://plan.yebom.org/api/events", { method: "POST" }), request("null"), request("https://evil.test"), request("https://plan.yebom.org", "evil.test"), request(undefined, undefined, { "x-forwarded-host": "evil.test" }), request(undefined, undefined, { "x-forwarded-host": "plan.yebom.org,evil.test" }), request(undefined, undefined, { "sec-fetch-site": "cross-site" })]) expect(() => assertCSRF(req)).toThrow(APIError); });
  it("only allows explicitly configured safe Preview patterns with exact host equality", () => { const req = request("https://3000-preview.sg2.manus.computer", "3000-preview.sg2.manus.computer"); expect(() => assertCSRF(req)).toThrow(); vi.stubEnv("APP_ALLOWED_ORIGINS", "https://*.manus.computer"); expect(() => assertCSRF(req)).not.toThrow(); expect(() => assertCSRF(request("https://evilmanus.computer", "evilmanus.computer"))).toThrow(); expect(() => assertCSRF(request("https://a.manus.computer", "b.manus.computer"))).toThrow(); });
});

describe("strict JSON transport", () => {
  it("rejects nested and escaped duplicate keys without rejecting equal keys in separate objects", () => { for (const source of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}']) expect(() => assertUniqueJSONKeys(source)).toThrow(); expect(() => assertUniqueJSONKeys('[{"a":1},{"a":2}]')).not.toThrow(); });
  it("accepts JSON and rejects malformed, oversized, deep, or non-JSON bodies", async () => { const make = (body: string, type = "application/json") => new Request("https://plan.yebom.org/api/events", { method: "POST", headers: { "content-type": type }, body }); expect(await readJSON(make('{"x":1}'))).toEqual({ x: 1 }); await expect(readJSON(make('{"x":1,"x":2}'))).rejects.toThrow(); await expect(readJSON(make("{"))).rejects.toThrow(); await expect(readJSON(make(JSON.stringify({ x: "a".repeat(65536) })))).rejects.toThrow(); await expect(readJSON(make("[]", "text/plain"))).rejects.toThrow(); await expect(readJSON(make("[".repeat(30)+"0"+"]".repeat(30)))).rejects.toThrow(); });
});

describe("shared real calendar permissions and public privacy", () => {
  it("enforces anonymous/member/department read and explicit department editor grants", () => { expect(canReadEvent(event, null)).toBe(true); expect(canReadEvent({ ...event, visibility: "members" }, null)).toBe(false); expect(canReadEvent({ ...event, visibility: "members" }, viewer)).toBe(true); expect(canReadEvent({ ...event, visibility: "department" }, viewer)).toBe(false); expect(canReadEvent({ ...event, visibility: "department" }, editor)).toBe(true); expect(canEditEvent(event, viewer)).toBe(false); expect(canEditEvent(event, editor)).toBe(true); expect(canEditEvent({ ...event, organizationId: "mission" }, editor)).toBe(false); expect(canEditEvent(event, admin)).toBe(true); expect(canCreate(viewer)).toBe(false); });
  it("removes private notes, actor provenance, and old snapshot data", () => { const projected = publicEvent({ ...event, exceptions: [{ date: input.startDate, patch: { internalNote: "private", title: "한 회차" }, cancelled: false, reason: "", updatedAt: event.createdAt, updatedBy: admin }] }); const wire = JSON.stringify(projected); expect(wire).not.toContain("internalNote"); expect(wire).not.toContain("createdBy"); expect(wire).not.toContain("updatedBy"); const change: ChangeRecord = { id: event.id, eventId: event.id, title: "과거 비공개 제목", organizationId: "mission", kind: "update", at: event.createdAt, by: admin, reason: "비공개 이유", changedFields: ["internalNote","title"], before: { title: "비공개" }, after: { internalNote: "private" } }; const safe = publicChange(change, event); expect(safe).toMatchObject({ title: event.title, organizationId: "worship", by: null, before: null, after: null, reason: "", changedFields: ["title"] }); });
  it("redacts a legacy private override from public and ungranted member masters", () => { const legacy = { ...event, exceptions: [{ date: input.startDate, patch: { title: "숨겨진 제목", visibility: "department" as const, organizationId: "mission" as const, internalNote: "비밀" }, cancelled: false, reason: "내부 사유", updatedAt: event.createdAt, updatedBy: admin }] }; for (const actor of [null, viewer, editor]) expect(readableMaster(legacy, actor).exceptions[0]).toMatchObject({ patch: {}, cancelled: true, reason: "", updatedBy: null }); expect(readableMaster(legacy, admin).exceptions[0].patch.title).toBe("숨겨진 제목"); });
});

// This adapter is a query-contract mock, not a managed DB. All rows and write logs stay in memory.
function fakeDB(selectRows: unknown[][]) {
  const writes: { action: string; value: unknown }[] = [];
  const select = () => {
    const rows = selectRows.shift() ?? [];
    const chain = { from: () => chain, where: () => chain, limit: () => chain, for: () => chain, orderBy: () => chain, innerJoin: () => chain, then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return chain;
  };
  const tx = { select, insert: () => ({ values: async (value: unknown) => { writes.push({ action: "insert", value }); } }), update: () => ({ set: (value: unknown) => ({ where: async () => { writes.push({ action: "update", value }); } }) }), delete: () => ({ where: async () => undefined }) };
  const db = { ...tx, transaction: async (fn: (t: typeof tx) => Promise<unknown>) => { const count = writes.length; try { return await fn(tx); } catch (error) { writes.splice(count); throw error; } } };
  vi.mocked(getDB).mockReturnValue(db as unknown as ReturnType<typeof getDB>);
  return writes;
}
const userRow = (actor: Actor) => ({ ...actor, lastSeenAt: event.createdAt });
function auditRecord(before: CalendarEvent | null, after: CalendarEvent, patch: Partial<ChangeRecord> = {}): ChangeRecord {
  return { id: event.id, eventId: event.id, title: after.title, organizationId: after.organizationId, kind: "update", at: after.updatedAt ?? after.createdAt, by: admin, reason: "내부 변경 사유", changedFields: ["title", "internalNote", "exceptions"], before: before ? structuredClone(before) as unknown as Record<string, unknown> : null, after: structuredClone(after) as unknown as Record<string, unknown>, ...patch };
}
const exceptionEvent: CalendarEvent = { ...event, updatedAt: event.createdAt, updatedBy: admin, exceptions: [{ date: input.startDate, patch: { title: "읽을 수 있는 회차", internalNote: "비공개 회차 메모" }, cancelled: false, reason: "", updatedAt: event.createdAt, updatedBy: editor }] };
describe("permission-aware service presentation using only in-memory query mocks", () => {
  it("keeps approved reader provenance and timestamps but omits master and exception notes", async () => {
    const change = auditRecord(exceptionEvent, exceptionEvent);
    for (const actor of [viewer, { ...editor, departmentIds: ["mission" as const] }]) {
      const writes = fakeDB([[{ payload: exceptionEvent }], [{ payload: change }]]);
      const result = await getEvent(event.id, actor);
      expect(result.event).not.toHaveProperty("internalNote");
      expect(result.event.exceptions[0].patch).not.toHaveProperty("internalNote");
      expect(result.event).toMatchObject({ createdBy: event.createdBy, createdAt: event.createdAt, updatedBy: admin, updatedAt: event.createdAt });
      expect(result.event.exceptions[0]).toMatchObject({ updatedBy: editor, updatedAt: event.createdAt });
      expect(result.history[0]).toMatchObject({ by: admin, at: change.at, reason: "", changedFields: ["title", "exceptions"] });
      for (const value of [result.history[0].before, result.history[0].after]) {
        expect(JSON.stringify(value)).not.toContain("internalNote");
        expect(value).toMatchObject({ createdBy: event.createdBy, updatedBy: admin });
      }
      expect(writes).toHaveLength(0);
    }
    expect(exceptionEvent.internalNote).toBe(input.internalNote);
    expect(exceptionEvent.exceptions[0].patch.internalNote).toBe("비공개 회차 메모");
  });
  it("applies the same note projection to bootstrap masters and upcoming occurrences", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(event.createdAt));
    const writes = fakeDB([[{ payload: exceptionEvent }], [{ payload: exceptionEvent }], [{ payload: DEFAULT_CHURCH_SETTINGS, version: 1 }], []]);
    const result = await bootstrap(new Request("https://plan.yebom.org/api/bootstrap"), viewer, 2026);
    expect(result.events).toHaveLength(1); expect(result.upcoming).toHaveLength(1);
    for (const entry of [...result.events, ...result.upcoming]) {
      expect(JSON.stringify(entry)).not.toContain("internalNote");
      expect(entry.createdBy).toEqual(event.createdBy);
    }
    expect(result.upcoming[0]).toMatchObject({ updatedBy: editor, updatedAt: event.createdAt });
    expect(writes).toHaveLength(0);
  });
  it("hides inaccessible former department snapshots and historical title/reason in detail and recent changes", async () => {
    const before: CalendarEvent = { ...exceptionEvent, title: "과거 비공개 제목", description: "과거 비공개 안내", organizationId: "mission", visibility: "department" };
    const change = auditRecord(before, exceptionEvent, { title: before.title, organizationId: before.organizationId });
    for (const actor of [viewer, editor]) {
      fakeDB([[{ payload: exceptionEvent }], [{ payload: change }]]);
      const detail = await getEvent(event.id, actor);
      fakeDB([[{ change, event: exceptionEvent }]]);
      const recent = await getChanges(actor);
      expect(recent).toEqual(detail.history);
      expect(recent[0]).toMatchObject({ title: exceptionEvent.title, organizationId: "worship", before: null, by: admin, reason: "", changedFields: ["title", "exceptions"] });
      expect(JSON.stringify(recent)).not.toContain(before.title);
      expect(JSON.stringify(recent)).not.toContain(before.description);
      if (actor === viewer) expect(JSON.stringify(recent)).not.toContain("internalNote");
      else expect(recent[0].after?.internalNote).toBe(input.internalNote);
    }
  });
  it("sanitizes readable historical snapshots outside the current editor's owner grant", async () => {
    const oldOwner: CalendarEvent = { ...exceptionEvent, organizationId: "mission" };
    const change = auditRecord(oldOwner, exceptionEvent, { title: "과거 제목" });
    fakeDB([[{ payload: exceptionEvent }], [{ payload: change }]]);
    const result = await getEvent(event.id, editor);
    expect(result.event.internalNote).toBe(input.internalNote);
    expect(JSON.stringify(result.history[0].before)).not.toContain("internalNote");
    expect(result.history[0].after?.internalNote).toBe(input.internalNote);
    expect(result.history[0]).toMatchObject({ title: event.title, reason: "", by: admin, changedFields: ["title", "exceptions"] });
  });
  it("redacts inaccessible legacy exception patches and moved dates from accessible historical snapshots", async () => {
    const before: CalendarEvent = { ...event, exceptions: [{ date: input.startDate, patch: { title: "숨겨진 회차", startDate: "2026-12-03", endDate: "2026-12-03", visibility: "department", organizationId: "mission", internalNote: "숨겨진 메모" }, cancelled: false, reason: "숨겨진 사유", updatedAt: event.createdAt, updatedBy: admin }] };
    const change = auditRecord(before, event);
    for (const actor of [viewer, editor]) {
      fakeDB([[{ change, event }]]);
      const [projected] = await getChanges(actor);
      expect((projected.before?.exceptions as CalendarEvent["exceptions"])[0]).toMatchObject({ date: input.startDate, patch: {}, cancelled: true, reason: "", updatedBy: null });
      for (const hidden of ["숨겨진 회차", "2026-12-03", "숨겨진 메모", "숨겨진 사유"]) expect(JSON.stringify(projected)).not.toContain(hidden);
    }
  });
  it("keeps authorized editor/admin notes and history while checking each effective exception owner", async () => {
    const change = auditRecord(exceptionEvent, exceptionEvent);
    for (const actor of [editor, admin]) {
      fakeDB([[{ payload: exceptionEvent }], [{ payload: change }]]);
      const result = await getEvent(event.id, actor);
      expect(result.event).toEqual(exceptionEvent);
      expect(result.history).toEqual([change]);
      fakeDB([[{ change, event: exceptionEvent }]]);
      expect(await getChanges(actor)).toEqual([change]);
    }
    const legacy: CalendarEvent = { ...exceptionEvent, exceptions: [{ ...exceptionEvent.exceptions[0], patch: { organizationId: "mission", internalNote: "다른 부서 메모", title: "공개 회차" } }] };
    fakeDB([[{ payload: legacy }], [{ payload: auditRecord(legacy, legacy) }]]);
    const scoped = await getEvent(event.id, editor);
    expect(scoped.event.internalNote).toBe(input.internalNote);
    expect(scoped.event.exceptions[0].patch).toMatchObject({ title: "공개 회차" });
    expect(scoped.event.exceptions[0].patch).not.toHaveProperty("internalNote");
    expect(JSON.stringify(scoped.history)).not.toContain("다른 부서 메모");
    fakeDB([[{ payload: legacy }], [{ payload: auditRecord(legacy, legacy) }]]);
    expect((await getEvent(event.id, admin)).event.exceptions[0].patch.internalNote).toBe("다른 부서 메모");
  });
  it("only retains readable original occurrence metadata, never private moved dates", async () => {
    const weekly: CalendarEvent = { ...event, recurrence: { frequency: "weekly", interval: 1, until: "2026-12-31" } };
    const moved: CalendarEvent = { ...weekly, exceptions: [{ date: "2026-11-22", patch: { startDate: "2026-11-23", endDate: "2026-11-23" }, cancelled: true, reason: "취소", updatedAt: event.createdAt, updatedBy: editor }] };
    const change = auditRecord(weekly, moved, { kind: "cancel-occurrence", occurrenceDate: "2026-11-22" });
    expect(publicChange(change, moved)).toMatchObject({ occurrenceDate: "2026-11-22", before: null, after: null, by: null, reason: "" });
    expect(JSON.stringify(publicChange(change, moved))).not.toContain("2026-11-23");
    fakeDB([[{ change, event: moved }]]);
    expect((await getChanges(viewer))[0].occurrenceDate).toBe("2026-11-22");
    for (const date of ["2026-11-23", "2026-02-30", "private"]) expect(publicChange({ ...change, occurrenceDate: date }, moved)).not.toHaveProperty("occurrenceDate");
    const privatePast: CalendarEvent = { ...weekly, organizationId: "mission", visibility: "department" };
    const pastChange = auditRecord(privatePast, moved, { kind: change.kind, occurrenceDate: change.occurrenceDate });
    fakeDB([[{ change: pastChange, event: moved }]]);
    expect((await getChanges(viewer))[0]).not.toHaveProperty("occurrenceDate");
    expect(publicChange(pastChange, moved)).not.toHaveProperty("occurrenceDate");
    const privateOverride: CalendarEvent = { ...moved, exceptions: [{ ...moved.exceptions[0], patch: { ...moved.exceptions[0].patch, visibility: "department", organizationId: "mission" } }] };
    expect(publicChange(auditRecord(weekly, privateOverride, { kind: change.kind, occurrenceDate: change.occurrenceDate }), privateOverride)).not.toHaveProperty("occurrenceDate");
    fakeDB([[{ change: auditRecord(privateOverride, moved, { kind: change.kind, occurrenceDate: change.occurrenceDate }), event: moved }]]);
    expect((await getChanges(viewer))[0]).not.toHaveProperty("occurrenceDate");
  });
});

describe("calendar ICS organization filter parsing using only in-memory query mocks", () => {
  it("treats absent org as all and explicitly empty org as none", async () => {
    for (const [suffix, includesEvent] of [["", true], ["&org=", false], ["&org=worship", true]] as const) {
      const writes = fakeDB([[{ payload: event }], [{ payload: DEFAULT_CHURCH_SETTINGS, version: 1 }], []]);
      const response = await calendarFeed(new Request(`https://plan.yebom.org/api/calendar.ics?year=2026${suffix}`));
      expect(response.status).toBe(200);
      expect((await response.text()).includes("BEGIN:VEVENT")).toBe(includesEvent);
      expect(writes).toHaveLength(0);
    }
  });
  it("continues to reject nonempty invalid and duplicate organization IDs", async () => {
    for (const org of ["unknown", "worship,", ",", "worship,worship"]) {
      const writes = fakeDB([]);
      const response = await calendarFeed(new Request(`https://plan.yebom.org/api/calendar.ics?year=2026&org=${org}`));
      expect(response.status).toBe(400);
      expect(getDB).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    }
  });
});

describe("transactional mutation contract using only in-memory query mocks", () => {
  it("keeps immutable creation metadata and does not bump version for a no-op", async () => { const writes = fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: event }]]); const result = await mutateEvent(event.id, editor, { version: 1, action: "update", input }); expect(result.event).toEqual(event); expect(writes).toHaveLength(0); });
  it("does not create an override or bump version for an unchanged complete occurrence input", async () => { const recurrence = { frequency: "weekly" as const, interval: 1, until: "2026-12-31" }; const weekly = { ...event, recurrence }; const writes = fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: weekly }]]); const result = await mutateEvent(event.id, editor, { version: 1, action: "update", occurrenceDate: "2026-11-22", input: { ...input, startDate: "2026-11-22", endDate: "2026-11-22", recurrence } }); expect(result.event.version).toBe(1); expect(result.event.exceptions).toEqual([]); expect(writes).toHaveLength(0); });
  it("writes event and audit together and preserves createdBy/createdAt", async () => { const writes = fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: event }]]); const result = await mutateEvent(event.id, editor, { version: 1, action: "update", input: { ...input, title: "변경" }, reason: "확인" }); expect(result.event.version).toBe(2); expect(result.event.createdAt).toBe(event.createdAt); expect(result.event.createdBy).toEqual(event.createdBy); expect(writes.map(w => w.action)).toEqual(["update", "insert"]); const entry = writes[1].value as { payload: ChangeRecord }; expect(entry.payload).toMatchObject({ kind: "update", reason: "확인", by: { id: editor.id }, changedFields: ["title"] }); expect(entry.payload.before?.title).toBe(input.title); expect(entry.payload.after?.title).toBe("변경"); });
  it("rejects stale versions and revoked grants without writes", async () => { const writes = fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: { ...event, version: 2 } }]]); await expect(mutateEvent(event.id, editor, { version: 1, action: "delete" })).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" }); expect(writes).toHaveLength(0); const revokedWrites = fakeDB([[{ id: "church" }], [userRow(viewer)], [{ payload: event }]]); await expect(mutateEvent(event.id, editor, { version: 1, action: "delete" })).rejects.toMatchObject({ status: 404 }); expect(revokedWrites).toHaveLength(0); });
  it("soft deletes and restores without losing original metadata", async () => { fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: event }]]); const deleted = (await mutateEvent(event.id, editor, { version: 1, action: "delete" })).event; expect(deleted.deleted).toBe(true); fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: deleted }]]); const restored = (await mutateEvent(event.id, editor, { version: 2, action: "restore" })).event; expect(restored).toMatchObject({ deleted: false, version: 3, createdAt: event.createdAt, createdBy: event.createdBy }); });
  it("does not silently undo a series cancellation through an ordinary edit", async () => { const cancelled = { ...event, status: "cancelled" as const, cancelReason: "취소" }; const writes = fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: cancelled }]]); await expect(mutateEvent(event.id, editor, { version: 1, action: "update", input })).rejects.toMatchObject({ code: "REASON_REQUIRED" }); expect(writes).toHaveLength(0); fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: cancelled }]]); const result = await mutateEvent(event.id, editor, { version: 1, action: "update", input, reason: "다시 진행" }); expect(result.event.status).toBe("confirmed"); });
  it("validates original recurrence dates and records a moved single override", async () => { const weekly = { ...event, recurrence: { frequency: "weekly" as const, interval: 1, until: "2026-12-31" } }; const writes = fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: weekly }]]); await expect(mutateEvent(event.id, editor, { version: 1, action: "update", occurrenceDate: "2026-11-16", input: { title: "수정" } })).rejects.toMatchObject({ code: "INVALID_OCCURRENCE" }); expect(writes).toHaveLength(0); fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: weekly }]]); const result = await mutateEvent(event.id, editor, { version: 1, action: "update", occurrenceDate: "2026-11-22", input: { startDate: "2026-11-23", endDate: "2026-11-23" } }); expect(result.event.exceptions[0]).toMatchObject({ date: "2026-11-22", patch: { startDate: "2026-11-23" }, updatedBy: { id: editor.id } }); expect(result.event.version).toBe(2); });
  it("records the original date for occurrence cancellation/move and preserves cancellation no-ops", async () => {
    const weekly: CalendarEvent = { ...event, recurrence: { frequency: "weekly", interval: 1, until: "2026-12-31" } };
    const writes = fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: weekly }]]);
    const cancelled = (await mutateEvent(event.id, editor, { version: 1, action: "cancel", occurrenceDate: "2026-11-22", reason: "회차 취소" })).event;
    const change = (writes[1].value as { payload: ChangeRecord }).payload;
    expect(change).toMatchObject({ kind: "cancel-occurrence", occurrenceDate: "2026-11-22" });
    expect(occurrenceForDate(cancelled, change.occurrenceDate!)).toMatchObject({ recurrenceDate: "2026-11-22", status: "cancelled", cancelReason: "회차 취소" });
    expect(publicChange(change, cancelled).occurrenceDate).toBe("2026-11-22");
    const noOpWrites = fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: cancelled }]]);
    expect((await mutateEvent(event.id, editor, { version: 2, action: "cancel", occurrenceDate: "2026-11-22", reason: "회차 취소" })).event).toEqual(cancelled);
    expect(noOpWrites).toHaveLength(0);
    const movedWrites = fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: weekly }]]);
    const moved = (await mutateEvent(event.id, editor, { version: 1, action: "update", occurrenceDate: "2026-11-22", input: { startDate: "2026-11-23", endDate: "2026-11-23" } })).event;
    const movedChange = (movedWrites[1].value as { payload: ChangeRecord }).payload;
    expect(movedChange).toMatchObject({ kind: "update-occurrence", occurrenceDate: "2026-11-22" });
    expect(occurrenceForDate(moved, movedChange.occurrenceDate!)).toMatchObject({ recurrenceDate: "2026-11-22", startDate: "2026-11-23" });
  });
  it("does not add occurrence metadata to whole-event audits", async () => {
    const writes = fakeDB([[{ id: "church" }], [userRow(editor)], [{ payload: event }]]);
    await mutateEvent(event.id, editor, { version: 1, action: "update", input: { ...input, title: "일정 전체 변경" } });
    expect((writes[1].value as { payload: ChangeRecord }).payload).not.toHaveProperty("occurrenceDate");
  });
  it("retries the same creator and same canonical create payload, rejects operation reuse", async () => { const existing = { creatorId: editor.id, initialPayload: input, payload: event }; let writes = fakeDB([[{ id: "church" }], [userRow(editor)], [existing]]); expect((await createEvent(editor, event.id, input)).event.id).toBe(event.id); expect(writes).toHaveLength(0); writes = fakeDB([[{ id: "church" }], [userRow(editor)], [existing]]); await expect(createEvent(editor, event.id, { ...input, title: "다른 입력" })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" }); expect(writes).toHaveLength(0); });
  it("prevents last-admin lockout and only grants users already present", async () => { const writes = fakeDB([[{ id: "church" }], [userRow(admin)], [userRow(admin)], [{ id: admin.id }]]); await expect(updateUser(admin, { id: admin.id, role: "viewer", departmentIds: [] })).rejects.toMatchObject({ code: "LAST_ADMIN" }); expect(writes).toHaveLength(0); fakeDB([[{ id: "church" }], [userRow(admin)], []]); await expect(updateUser(admin, { id: "not-a-real-login", role: "admin", departmentIds: [] })).rejects.toMatchObject({ status: 404 }); });
});
