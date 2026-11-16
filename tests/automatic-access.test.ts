import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealData } from "iron-session";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect, type AnyMySqlColumn, type MySqlTable } from "drizzle-orm/mysql-core";
import { getDB, getPool } from "../src/db/client";
import { annualDrafts, audit, events, settings, users, venues } from "../src/db/schema";
import { ORGANIZATION_IDS, type Actor, type AnnualDraft, type AnnualDraftInput, type EventInput, type Person } from "../src/domain/types";
import { DEFAULT_CHURCH_SETTINGS } from "../src/domain/church-year";
import { canCreate, canEditEvent } from "../src/domain/permissions";
import { actorFor, requireAdmin, saintSessionFor, verifiedPerson, verifySaintCookie } from "../src/server/auth";
import { actorWithAutomaticAccess, refreshAutomaticAccess } from "../src/server/automatic-access";
import { clientAuthSession, SAINT_COOKIE, SAINT_SESSION_URL, saintResult } from "../src/server/saint-session";
import { createEvent, mutateEvent, putSettings, updateUser, writeActor } from "../src/server/services";
import { createAnnualDraft, getAnnualDraft, listAnnualDrafts, publishAnnualDraft, updateAnnualDraft } from "../src/server/annual";
import { GET as checkin } from "../src/app/api/auth/checkin/route";

// These imports are replaced before any production DB/client can be initialized.
// Every fetch is stubbed too: no actual account, secret, central API or DB access.
vi.mock("../src/db/client", () => ({
  getDB: vi.fn(),
  getPool: vi.fn(() => { throw new Error("Live DB access forbidden"); }),
}));
const origin = "https://plan.yebom.org";
const person: Person = { id: "isolated-auto-user", name: "격리된 사용자" };
const manualViewer: Actor = { ...person, role: "viewer", departmentIds: [] };
const centralUser = {
  user_id: person.id, name: person.name, is_approved: true,
  needs_profile_completion: false, password_reset_required: false,
  permission_level: "member", finance_role: "member",
  email: "private@example.invalid", phone: "private-phone",
  birth_date: "private-birth", group_id: "private-group", private_claim: "private-claim",
};
const fetchStub = vi.fn<typeof fetch>();
function request() {
  return new Request(`${origin}/api/auth/checkin`, { headers: {
    host: "plan.yebom.org", origin, "sec-fetch-site": "same-origin",
    cookie: `${SAINT_COOKIE}=opaque-isolated-token`,
  } });
}
function central(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function claims(patch: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  fetchStub.mockImplementation(async () => central({ isLoggedIn: true, user: { ...centralUser, ...patch }, ...extra }));
}
const input: EventInput = {
  title: "격리 행사", organizationId: "worship", startDate: "2026-11-15", endDate: "2026-11-15",
  allDay: true, startTime: null, endTime: null, audience: "all", audienceIds: [], visibility: "public",
  locationId: null, location: "", description: "", internalNote: "격리 내부 메모", recurrence: null, status: "confirmed",
};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Bounded deterministic in-memory SQL adapter. Unsupported expressions fail
// explicitly, rather than silently accepting SQL scopes/subjects/lock contracts.
type Row = Record<string, unknown>;
const dialect = new MySqlDialect();
const property = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
function matches(condition: SQL | undefined, row: Row): boolean {
  if (!condition) return true;
  const { sql: source, params } = dialect.sqlToQuery(condition);
  if (source.includes("JSON_CONTAINS")) {
    const draft = row.payload as AnnualDraft;
    return row.id !== params[0] && draft.rows.some(item => params.slice(1).map(value => JSON.parse(String(value))).includes(item.id));
  }
  const text = source.replace(/`[^`]+`\.`([^`]+)`/g, (_, name: string) => property(name));
  const tokens = text.match(/<>|<=|>=|=|\(|\)|,|\?|\b(?:and|or|in)\b|[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  let cursor = 0, parameter = 0;
  const take = () => tokens[cursor++];
  const operand = () => {
    const token = take();
    if (token === "?") return params[parameter++];
    if (!(token in row)) throw new Error(`Unsupported mock operand: ${token}`);
    return row[token];
  };
  const factor = (): boolean => {
    if (tokens[cursor] === "(") {
      take(); const result = parseOr();
      if (take() !== ")") throw new Error("Unbalanced mock SQL");
      return result;
    }
    let left = operand();
    const op = take();
    if (op === "in") {
      if (take() !== "(") throw new Error("Bad IN");
      const values = [operand()];
      while (tokens[cursor] === ",") { take(); values.push(operand()); }
      if (take() !== ")") throw new Error("Bad IN close");
      return values.includes(left);
    }
    const right = operand();
    if (typeof left === "boolean" && typeof right === "number") left = Number(left);
    if (op === "=") return left === right;
    if (op === "<>") return left !== right;
    if (left == null || right == null) return false;
    if (op === "<=") return (left as string) <= (right as string);
    if (op === ">=") return (left as string) >= (right as string);
    throw new Error(`Unsupported mock operator: ${op}`);
  };
  const parseAnd = (): boolean => {
    let result = factor();
    while (tokens[cursor] === "and") { take(); const next = factor(); result = result && next; }
    return result;
  };
  const parseOr = (): boolean => {
    let result = parseAnd();
    while (tokens[cursor] === "or") { take(); const next = parseAnd(); result = result || next; }
    return result;
  };
  const result = parseOr();
  if (cursor !== tokens.length || parameter !== params.length) throw new Error(`Unsupported mock SQL: ${source}`);
  return result;
}
function project(column: AnyMySqlColumn | SQL, row: Row): unknown {
  if ("name" in column) return row[property(column.name)];
  const { sql: source } = dialect.sqlToQuery(column);
  const payload = row.payload as AnnualDraft;
  if (source.includes("JSON_LENGTH") && source.includes("'$.rows'")) return payload.rows.length;
  if (source.includes("JSON_LENGTH") && source.includes("'$.publishedRowIds'")) return payload.publishedRowIds.length;
  if (source.includes("'$.rows[*].input.organizationId'")) return payload.rows.map(item => item.input.organizationId);
  throw new Error(`Unsupported mock projection: ${source}`);
}
function memoryDB() {
  let state = new Map<string, Row[]>();
  for (const table of [annualDrafts, audit, events, settings, users, venues]) state.set(getTableName(table), []);
  state.set(getTableName(settings), [{ id: "church", version: 1, payload: DEFAULT_CHURCH_SETTINGS }]);
  state.set(getTableName(users), [{ ...structuredClone(manualViewer), lastSeenAt: "2026-11-01T00:00:00Z" }]);
  const rows = (table: MySqlTable) => state.get(getTableName(table))!;
  const writes: { table: string; action: string; value: Row }[] = [];
  const reads: { table: string; locked: boolean; params: unknown[]; transaction: number }[] = [];
  let depth = 0, transaction = 0;
  const tx = {
    select: (fields?: Record<string, AnyMySqlColumn | SQL>) => {
      let table: MySqlTable, condition: SQL | undefined, limit = Infinity, locked = false;
      const chain = {
        from: (value: MySqlTable) => { table = value; return chain; },
        where: (value: SQL | undefined) => { condition = value; return chain; },
        limit: (value: number) => { limit = value; return chain; },
        for: (value: string) => {
          if (value !== "update" || depth !== 1) throw new Error("Invalid lock contract");
          locked = true; return chain;
        },
        orderBy: () => chain,
        then: (resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => {
          reads.push({ table: getTableName(table), locked, params: condition ? dialect.sqlToQuery(condition).params : [], transaction });
          return structuredClone(rows(table).filter(row => matches(condition, row)).slice(0, limit).map(row => fields ? Object.fromEntries(Object.entries(fields).map(([key, column]) => [key, project(column, row)])) : row));
        }).then(resolve, reject),
      };
      return chain;
    },
    insert: (table: MySqlTable) => ({ values: (value: Row) => {
      const commit = () => {
        if (rows(table).some(row => row.id === value.id || (table === events && row.operationId === value.operationId))) throw new Error("Duplicate mock row");
        rows(table).push(structuredClone(value));
        writes.push({ table: getTableName(table), action: "insert", value: structuredClone(value) });
      };
      return {
        then: (resolve: (value: void) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(commit).then(resolve, reject),
        onDuplicateKeyUpdate: async ({ set }: { set: Row }) => {
          if (table !== users) throw new Error("Unexpected mock upsert");
          const existing = rows(table).find(row => row.id === value.id);
          if (!existing) return commit();
          Object.assign(existing, structuredClone(set));
          writes.push({ table: getTableName(table), action: "upsert-update", value: structuredClone(set) });
        },
      };
    } }),
    update: (table: MySqlTable) => ({ set: (value: Row) => ({ where: async (condition: SQL) => {
      for (const row of rows(table).filter(row => matches(condition, row))) Object.assign(row, structuredClone(value));
      writes.push({ table: getTableName(table), action: "update", value: structuredClone(value) });
    } }) }),
  };
  const db = { ...tx, transaction: async (fn: (value: typeof tx) => Promise<unknown>) => {
    if (depth) throw new Error("Nested mock transaction");
    const before = structuredClone(state), count = writes.length;
    depth++; transaction++;
    try { return await fn(tx); }
    catch (error) { state = before; writes.splice(count); throw error; }
    finally { depth--; }
  } };
  vi.mocked(getDB).mockReturnValue(db as unknown as ReturnType<typeof getDB>);
  return {
    rows, writes, reads,
    setManual: (patch: Partial<Actor>) => Object.assign(rows(users)[0], structuredClone(patch)),
    seed: (table: MySqlTable, row: Row) => rows(table).push(structuredClone(row)),
  };
}
let db: ReturnType<typeof memoryDB>;
beforeEach(() => {
  vi.stubEnv("APP_PUBLIC_ORIGIN", origin);
  vi.stubEnv("YEBOM_CALENDAR_ADMIN_IDS", "");
  vi.stubEnv("YEBOM_SSO_SECRET", "");
  vi.stubGlobal("fetch", fetchStub);
  fetchStub.mockReset();
  vi.mocked(getDB).mockReset();
  claims(); db = memoryDB();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function actor(patch: Record<string, unknown> = { permission_level: "pastor" }) {
  claims(patch); return (await actorFor(request()))!;
}
async function refreshed(value: Actor) {
  return getDB().transaction(async tx => writeActor(tx, value));
}
function expectAllEditors(value: Actor) {
  expect(value.role).toBe("editor");
  expect(value.departmentIds).toEqual([...ORGANIZATION_IDS]);
  expect(canCreate(value)).toBe(true);
  for (const organizationId of ORGANIZATION_IDS) expect(canEditEvent({ ...input, organizationId }, value)).toBe(true);
  expect(() => requireAdmin(value)).toThrow();
}
function draftInput(): AnnualDraftInput {
  return { year: 2026, organizationId: "admin", rows: ORGANIZATION_IDS.map((organizationId, index) => ({ id: uuid(index + 100), dateText: "11/15", input: { ...input, organizationId } })) };
}

describe("exact latest central OR policy", () => {
  it.each(["super_admin", "admin", "shepherd", "caretaker", "pastor"])("permission_level %s alone grants all ten, independently of finance", async permission_level => {
    for (const finance_role of ["member", "admin", "super_admin", null]) expectAllEditors(await actor({ permission_level, finance_role }));
  });
  it.each([{ permission_level: "member" }, { permission_level: "premember" }, { permission_level: null }, { permission_level: ["admin"] }])("finance deacon alone grants for permission %j", async ({ permission_level }) => {
    expectAllEditors(await actor({ permission_level, finance_role: "deacon" }));
  });
  it("both conditions give editor, never automatic service admin", async () => {
    expectAllEditors(await actor({ permission_level: "super_admin", finance_role: "deacon" }));
    expect(db.rows(users)[0]).toMatchObject({ role: "viewer", departmentIds: [] });
  });
  it.each([
    ["member", "member"], ["member", "admin"], ["member", "super_admin"],
    ["premember", "member"], ["unknown", "unknown"], [null, null], [undefined, undefined],
    ["ADMIN", "DEACON"], [" admin", "deacon "],
  ])("does not infer automatic edit from permission %j / finance %j", async (permission_level, finance_role) => {
    expect(await actor({ permission_level, finance_role })).toEqual(manualViewer);
    expect(canCreate(await refreshed(manualViewer))).toBe(false);
  });
  it.each([
    { permission_level: ["admin"], finance_role: ["deacon"] },
    { permission_level: { role: "admin" }, finance_role: { role: "deacon" } },
    { permission_level: true, finance_role: true },
    { permission_level: 1, finance_role: 1 },
    { permission_level: null, finance_role: null, role: "admin", roles: ["admin", "deacon"], source: "saint", automaticEditor: true, permissions: ["admin"] },
  ])("malformed or legacy user claims cannot mint access %j", async patch => {
    expect(await actor(patch)).toEqual(manualViewer);
  });
  it("ignores privileged top-level claims and privileged email prefixes", async () => {
    claims({ email: "super_admin@example.invalid" }, { permission_level: "super_admin", finance_role: "deacon", role: "admin", automaticEditor: true });
    expect(await actorFor(request())).toEqual(manualViewer);
  });
  it("uses only the approved fixed GET, not unsealed cookie claims", async () => {
    expectAllEditors(await actor());
    expect(fetchStub.mock.calls[0]).toEqual([SAINT_SESSION_URL, expect.objectContaining({ method: "GET", cache: "no-store", redirect: "error", credentials: "omit", headers: { Cookie: `${SAINT_COOKIE}=opaque-isolated-token`, Accept: "application/json" } })]);
  });
});

describe("manual DB rows are preserved and re-read under locks", () => {
  it("an existing viewer row becomes effective editor without changing its manual grants", async () => {
    db.setManual({ departmentIds: ["worship"] });
    expectAllEditors(await actor());
    expect(db.rows(users)[0]).toMatchObject({ role: "viewer", departmentIds: ["worship"] });
    expect(db.writes).toHaveLength(1);
    expect(Object.keys(db.writes[0].value).sort()).toEqual(["lastSeenAt", "name"]);
  });
  it("new automatically eligible people are inserted only as manual viewer", async () => {
    db.rows(users).splice(0);
    expectAllEditors(await actor());
    expect(db.rows(users)[0]).toMatchObject({ role: "viewer", departmentIds: [] });
    expect(db.writes[0].value).toMatchObject({ role: "viewer", departmentIds: [] });
  });
  it.each(["admin", "editor"] as const)("keeps manual %s with and without automatic eligibility", async role => {
    db.setManual({ role, departmentIds: ["mission"] });
    const manual = { ...person, role, departmentIds: ["mission"] };
    expect(await actor({})).toEqual(manual);
    const eligible = await actor();
    if (role === "admin") expect(eligible).toEqual(manual);
    else expectAllEditors(eligible);
    expect(db.rows(users)[0]).toMatchObject(manual);
    expect(await actor({})).toEqual(manual);
  });
  it("TX writeActor preserves automatic all-ten editor even though DB remains viewer", async () => {
    const original = await actor();
    const count = db.writes.length;
    const effective = await refreshed(original);
    expectAllEditors(effective);
    expect(db.rows(users)[0].role).toBe("viewer");
    expect(db.writes).toHaveLength(count);
    expect(db.reads.slice(-2)).toEqual([
      { table: "plan_settings", locked: true, params: ["church"], transaction: 2 },
      { table: "plan_users", locked: true, params: [person.id], transaction: 2 },
    ]);
    expectAllEditors(await refreshed(effective));
  });
  it("TX-output Actor evidence survives another writeActor inside the same TX", async () => {
    const original = await actor();
    const count = db.writes.length;
    await getDB().transaction(async tx => {
      const first = await writeActor(tx, original);
      const second = await writeActor(tx, first);
      expectAllEditors(first);
      expectAllEditors(second);
      expect(second).not.toBe(first);
    });
    expect(db.writes).toHaveLength(count);
    expect(db.rows(users)[0].role).toBe("viewer");
  });
  it("TX current.id mismatch cannot inherit the original Actor's automatic proof", async () => {
    const original = await actor();
    const other: Actor = { id: "other-isolated-user", name: "다른 사용자", role: "viewer", departmentIds: [] };
    expect(refreshAutomaticAccess(original, other)).toEqual(other);
    const req = request();
    const verified = (await verifiedPerson(req))!;
    const bothMutated = (await actorFor(req))!;
    bothMutated.id = other.id;
    verified.id = other.id;
    // Even mutating both visible IDs cannot change the captured approved ID.
    expect(refreshAutomaticAccess(bothMutated, other)).toEqual(other);
  });
  it("concurrent manual admin demotion does not erase automatic edit or preserve admin", async () => {
    db.setManual({ role: "admin" });
    const original = await actor();
    expect(original.role).toBe("admin");
    db.setManual({ role: "viewer", departmentIds: [], name: "최신 DB 이름" });
    const effective = await refreshed(original);
    expectAllEditors(effective);
    expect(effective.name).toBe("최신 DB 이름");
    await expect(putSettings(original, { settings: DEFAULT_CHURCH_SETTINGS })).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
    await expect(updateUser(original, { id: person.id, role: "admin", departmentIds: [] })).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
    expect(db.rows(users)[0].role).toBe("viewer");
  });
  it("concurrent manual promotion is honored, while automatic proof cannot create admin", async () => {
    const original = await actor();
    db.setManual({ role: "admin", departmentIds: ["care"] });
    expect(await refreshed(original)).toEqual({ ...person, role: "admin", departmentIds: ["care"] });
  });
  it("without automatic eligibility concurrent manual role/department revocation still wins", async () => {
    db.setManual({ role: "editor", departmentIds: ["worship"] });
    const original = await actor({});
    db.setManual({ departmentIds: ["mission"] });
    expect(await refreshed(original)).toEqual({ ...person, role: "editor", departmentIds: ["mission"] });
    db.setManual({ role: "viewer", departmentIds: [] });
    expect(await refreshed(original)).toEqual(manualViewer);
  });
  it("deletion of the manual user row still denies TX writes", async () => {
    const original = await actor();
    db.rows(users).splice(0);
    await expect(refreshed(original)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

describe("next request downgrade, removal, revocation and required gates", () => {
  it("deduplicates only the exact Request; the same token sees fresh downgrade next request", async () => {
    claims({ permission_level: "pastor" });
    const req = request();
    await Promise.all([verifiedPerson(req), saintSessionFor(req)]);
    expectAllEditors((await actorFor(req))!);
    expect(fetchStub).toHaveBeenCalledOnce();
    claims({ permission_level: "member", finance_role: "member" });
    const next = (await actorFor(request()))!;
    expect(next).toEqual(manualViewer);
    expect(await refreshed(next)).toEqual(manualViewer);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    const count = db.writes.length;
    await expect(createEvent(next, uuid(1), input)).rejects.toMatchObject({ code: "EDIT_FORBIDDEN" });
    expect(db.writes).toHaveLength(count);
  });
  it("removing either condition keeps the other OR grant, removing both removes it", async () => {
    expectAllEditors(await actor({ permission_level: "pastor", finance_role: "deacon" }));
    expectAllEditors(await actor({ permission_level: "member", finance_role: "deacon" }));
    expectAllEditors(await actor({ permission_level: "pastor", finance_role: "member" }));
    expect(await actor({ permission_level: "member", finance_role: "admin" })).toEqual(manualViewer);
    expect(db.rows(users)[0].role).toBe("viewer");
  });
  it("deacon removal restores manual department editor rather than an automatic permanent grant", async () => {
    db.setManual({ role: "editor", departmentIds: ["children"] });
    expectAllEditors(await actor({ finance_role: "deacon" }));
    const next = await actor({ finance_role: "super_admin" });
    expect(await refreshed(next)).toEqual({ ...person, role: "editor", departmentIds: ["children"] });
    expect(canEditEvent({ ...input, organizationId: "mission" }, next)).toBe(false);
  });
  it.each(["revoked", "user_not_found"])("central %s removes identity and automatic access on next request", async reason => {
    expectAllEditors(await actor());
    fetchStub.mockImplementation(async () => central({ isLoggedIn: false, reason }, 401));
    vi.mocked(getDB).mockClear();
    const next = await actorFor(request());
    expect(next).toBeNull();
    await expect(createEvent(next, uuid(1), input)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(getDB).not.toHaveBeenCalled();
  });
  it.each([
    [{ is_approved: false }, "SAINT_APPROVAL_REQUIRED"],
    [{ needs_profile_completion: true }, "PROFILE_COMPLETION_REQUIRED"],
    [{ password_reset_required: true }, "PASSWORD_RESET_REQUIRED"],
    [{ password_reset_required: "false" }, "SAINT_UNAVAILABLE"],
    [{ is_approved: "true" }, "SAINT_UNAVAILABLE"],
  ] as const)("automatic conditions never bypass central gates %j", async (patch, code) => {
    claims({ permission_level: "super_admin", finance_role: "deacon", ...patch });
    await expect(actorFor(request())).rejects.toMatchObject({ code });
    expect(getDB).not.toHaveBeenCalled();
    const session = await saintSessionFor(request());
    if (session.person) expect(actorWithAutomaticAccess(session.person, manualViewer)).toEqual(manualViewer);
  });
  it("central outage cannot reuse a previous request's automatic authorization", async () => {
    expectAllEditors(await actor());
    fetchStub.mockRejectedValue(new Error("isolated outage"));
    vi.mocked(getDB).mockClear();
    await expect(actorFor(request())).rejects.toMatchObject({ code: "SAINT_UNAVAILABLE" });
    expect(getDB).not.toHaveBeenCalled();
  });
});

describe("only uncopyable server evidence authorizes automatic access", () => {
  it("spread/JSON/structured copies and role/source/claim forgeries fail TX automatic grants", async () => {
    const original = await actor();
    const forgeries: Actor[] = [
      { ...original }, structuredClone(original), JSON.parse(JSON.stringify(original)) as Actor,
      { ...manualViewer, role: "admin", departmentIds: [...ORGANIZATION_IDS], source: "saint", automaticEditor: true, claims: { permission_level: "super_admin", finance_role: "deacon" } } as Actor,
      Object.create(original) as Actor,
    ];
    for (const forged of forgeries) {
      expect(await refreshed(forged)).toEqual(manualViewer);
      await expect(createEvent(forged, uuid(1), input)).rejects.toMatchObject({ code: "EDIT_FORBIDDEN" });
    }
    expectAllEditors(await refreshed(original));
  });
  it("copied/fake Person or saintResult cannot create a server evidence token", async () => {
    claims({ permission_level: "pastor" });
    const verified = (await verifiedPerson(request()))!;
    expectAllEditors(actorWithAutomaticAccess(verified, manualViewer));
    const fakePeople = [
      { ...verified }, JSON.parse(JSON.stringify(verified)) as Person,
      { ...person, permission_level: "super_admin", finance_role: "deacon", automaticEditor: true },
      saintResult("authenticated", { ...person }).person!,
    ];
    for (const fake of fakePeople) {
      const forged = actorWithAutomaticAccess(fake, { ...manualViewer, role: "editor", departmentIds: [...ORGANIZATION_IDS] });
      expect(await refreshed(forged)).toEqual(manualViewer);
    }
    expect(refreshAutomaticAccess({ ...manualViewer, role: "editor", departmentIds: [...ORGANIZATION_IDS] }, manualViewer)).toEqual(manualViewer);
  });
  it("changing the actor subject cannot transfer auto proof to another viewer", async () => {
    const original = await actor();
    db.seed(users, { id: "other-isolated-user", name: "다른 사용자", role: "viewer", departmentIds: [], lastSeenAt: "2026-11-01T00:00:00Z" });
    original.id = "other-isolated-user";
    expect(await refreshed(original)).toEqual({ id: "other-isolated-user", name: "다른 사용자", role: "viewer", departmentIds: [] });
  });
  it("an authentic offline legacy seal has identity only, never automatic proof", async () => {
    const isolatedPassword = "isolated-offline-fixture-never-production-0123456789";
    const seal = await sealData({ ...centralUser, isLoggedIn: true, permission_level: "super_admin", finance_role: "deacon" }, { password: isolatedPassword });
    const legacy = (await verifySaintCookie(seal, isolatedPassword))!;
    expect(legacy).toEqual(person);
    expect(await refreshed(actorWithAutomaticAccess(legacy, manualViewer))).toEqual(manualViewer);
  });
});

describe("the same effective writeActor protects single, recurring and annual services", () => {
  it("creates and edits all ten organizations through actual service transactions while DB role stays viewer", async () => {
    const current = await actor();
    for (const [index, organizationId] of ORGANIZATION_IDS.entries()) {
      const created = (await createEvent(current, uuid(index + 1), { ...input, organizationId })).event;
      expect(created.createdBy).toEqual(person);
      const updated = (await mutateEvent(created.id, current, { version: 1, action: "update", input: { ...input, organizationId, title: "격리 수정" } })).event;
      expect(updated.updatedBy).toEqual(person);
    }
    expect(db.rows(events)).toHaveLength(10);
    expect(db.rows(audit)).toHaveLength(20);
    expect(db.rows(users)[0]).toMatchObject(manualViewer);
  });
  it("allows repeated occurrence edits/cancel and whole-series cancel/delete/restore as editor", async () => {
    const current = await actor({ finance_role: "deacon" });
    const weekly = { ...input, organizationId: "admin" as const, recurrence: { frequency: "weekly" as const, interval: 1, until: "2026-12-31", weekdays: [0] } };
    let event = (await createEvent(current, uuid(1), weekly)).event;
    for (const title of ["회차 수정1", "회차 수정2"]) {
      event = (await mutateEvent(event.id, current, { version: event.version, action: "update", occurrenceDate: "2026-11-22", input: { title } })).event;
    }
    event = (await mutateEvent(event.id, current, { version: event.version, action: "cancel", occurrenceDate: "2026-11-22", reason: "격리 회차 취소" })).event;
    expect(event.exceptions[0]).toMatchObject({ cancelled: true, updatedBy: person });
    event = (await mutateEvent(event.id, current, { version: event.version, action: "cancel", reason: "격리 전체 취소" })).event;
    expect(event.status).toBe("cancelled");
    event = (await mutateEvent(event.id, current, { version: event.version, action: "delete" })).event;
    expect(event.deleted).toBe(true);
    event = (await mutateEvent(event.id, current, { version: event.version, action: "restore" })).event;
    expect(event.deleted).toBe(false);
    expect(db.rows(users)[0].role).toBe("viewer");
  });
  it("creates/updates/publishes a ten-organization personal draft using shared TX evidence", async () => {
    const current = await actor();
    const original = draftInput();
    const draft = (await createAnnualDraft(current, { id: uuid(200), input: original })).draft;
    const updatedInput = { ...original, rows: original.rows.map(row => ({ ...row, input: { ...row.input, title: "수정된 초안" } })) };
    const updated = (await updateAnnualDraft(current, draft.id, { version: 1, input: updatedInput })).draft;
    const result = await publishAnnualDraft(current, draft.id, { version: updated.version, rowIds: updated.rows.map(row => row.id) });
    expect(result.events).toHaveLength(10);
    expect(result.events.map(event => event.organizationId)).toEqual([...ORGANIZATION_IDS]);
    expect(result.events.every(event => event.createdBy?.id === person.id)).toBe(true);
    expect(db.rows(users)[0].role).toBe("viewer");
    expect((await listAnnualDrafts(current, 2026)).drafts).toHaveLength(1);
    const count = db.writes.length;
    await publishAnnualDraft(current, draft.id, { version: updated.version, rowIds: updated.rows.map(row => row.id) });
    expect(db.writes).toHaveLength(count);
    const noLongerEligible = await actor({});
    await expect(getAnnualDraft(noLongerEligible, draft.id)).rejects.toMatchObject({ code: "ANNUAL_FORBIDDEN" });
    await expect(publishAnnualDraft(noLongerEligible, draft.id, { version: result.draft.version, rowIds: [original.rows[0].id] })).rejects.toMatchObject({ code: "ANNUAL_FORBIDDEN" });
  });
  it("automatic editor cannot see/edit someone else's private draft, unlike manual admin", async () => {
    const current = await actor();
    const draft = (await createAnnualDraft(current, { id: uuid(200), input: draftInput() })).draft;
    db.rows(annualDrafts)[0].ownerId = "other-isolated-owner";
    (db.rows(annualDrafts)[0].payload as AnnualDraft).ownerId = "other-isolated-owner";
    expect((await listAnnualDrafts(current, 2026)).drafts).toEqual([]);
    await expect(getAnnualDraft(current, draft.id)).rejects.toMatchObject({ code: "ANNUAL_NOT_FOUND" });
    await expect(publishAnnualDraft(current, draft.id, { version: 1, rowIds: [draft.rows[0].id] })).rejects.toMatchObject({ code: "ANNUAL_NOT_FOUND" });
    db.setManual({ role: "admin" });
    const admin = await actor();
    expect((await getAnnualDraft(admin, draft.id)).draft.ownerId).toBe("other-isolated-owner");
  });
  it("all-department editor does not automatically get settings or manual permission management", async () => {
    const current = await actor();
    const count = db.writes.length;
    await expect(putSettings(current, { settings: DEFAULT_CHURCH_SETTINGS })).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
    await expect(updateUser(current, { id: person.id, role: "admin", departmentIds: [] })).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
    expect(db.writes).toHaveLength(count);
  });
});

describe("identity and wire privacy remain id/name only", () => {
  it("Person, safe client check-in identity, Actor and DB do not expose raw central roles/PII/evidence", async () => {
    claims({ permission_level: "super_admin", finance_role: "deacon" });
    const req = request();
    const verified = await verifiedPerson(req);
    const session = await saintSessionFor(req);
    const current = (await actorFor(req))!;
    const client = clientAuthSession(session);
    expect(verified).toEqual(person);
    expect(Object.keys(verified!).sort()).toEqual(["id", "name"]);
    expect(Object.getOwnPropertySymbols(verified!)).toEqual([]);
    expect(client.identity).toEqual(person);
    expect(Object.keys(client.identity!).sort()).toEqual(["id", "name"]);
    expect(Object.keys(current).sort()).toEqual(["departmentIds", "id", "name", "role"]);
    expect(Object.getOwnPropertySymbols(current)).toEqual([]);
    const response = await checkin(request());
    expect(response.status).toBe(200);
    const checkinBody = await response.json();
    expect(checkinBody.identity).toEqual(person);
    const wire = JSON.stringify({ verified, session, current, client, checkinBody, stored: db.rows(users) });
    for (const privateValue of ["permission_level", "finance_role", "super_admin", "deacon", "email", "birth_date", "private@example.invalid", "private-phone", "private-group", "private-claim", "automaticEditor", "claims", "source"]) expect(wire).not.toContain(privateValue);
    expect(getPool).not.toHaveBeenCalled();
  });
});
