import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealData } from "iron-session";
import { getDB } from "../src/db/client";
import { actorFor, authStatus, cookieValue, LOGOUT_MARKER, saintSessionFor, verifiedPerson, verifySaintCookie } from "../src/server/auth";
import { SAINT_COOKIE, SAINT_MAX_BODY_BYTES, SAINT_SESSION_URL, SAINT_TIMEOUT_MS, saintSetCookies, validateSaintSession } from "../src/server/saint-session";
import { GET as checkin } from "../src/app/api/auth/checkin/route";
import { GET as sso } from "../src/app/api/auth/sso/route";
import { GET as status } from "../src/app/api/auth/status/route";
import { GET as bootstrapRoute } from "../src/app/api/bootstrap/route";

vi.mock("../src/db/client", () => ({ getDB: vi.fn() }));
vi.mock("../src/server/services", () => ({ bootstrap: vi.fn(async (_request: Request, actor: unknown) => ({ actor })) }));
const origin = "https://plan.yebom.org";
const password = "isolated-offline-sso-password-at-least-32-characters";
const currentUser = { user_id: "isolated-user", name: "격리된 교인", is_approved: true, needs_profile_completion: false, finance_role: "super_admin", permission_level: "admin", email: "private@example.invalid", group_id: "private-group", privateignored: "private-claim" };
const fetchStub = vi.fn<typeof fetch>();
function req(path = "/api/auth/checkin", cookie: string | null = `${SAINT_COOKIE}=opaque-current-seal`, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, { headers: { host: "plan.yebom.org", "sec-fetch-site": "same-origin", ...(cookie === null ? {} : { cookie }), ...headers } });
}
function response(body: unknown = { isLoggedIn: true, user: currentUser }, code = 200, cookies: string[] = []) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status: code, headers });
}
const deletion = `${SAINT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure`;
const sharedDeletion = `${deletion}; Domain=.yebom.org`;
const renewed = `${SAINT_COOKIE}=centrally-renewed-seal; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.yebom.org; Max-Age=34560000`;

// The DB adapter below records only synthetic in-memory values. No real client,
// network account, managed database, configuration or actual user is touched.
function mockDB(role = "viewer", departmentIds: string[] = []) {
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const rows = [[{ id: "church" }], [{ id: currentUser.user_id, name: currentUser.name, role, departmentIds }]];
  const select = () => {
    const result = rows.shift() ?? [];
    const chain = { from: () => chain, where: () => chain, limit: () => chain, for: () => chain, then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve) };
    return chain;
  };
  const tx = { select, insert: () => ({ values: (value: Record<string, unknown>) => { inserted.push(value); return { onDuplicateKeyUpdate: async ({ set }: { set: Record<string, unknown> }) => { updates.push(set); } }; } }) };
  const db = { transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx) };
  vi.mocked(getDB).mockReturnValue(db as unknown as ReturnType<typeof getDB>);
  return { inserted, updates };
}
beforeEach(() => {
  vi.stubEnv("APP_PUBLIC_ORIGIN", origin);
  vi.stubEnv("YEBOM_SSO_SECRET", "");
  vi.stubEnv("YEBOM_CALENDAR_ADMIN_IDS", "");
  vi.stubGlobal("fetch", fetchStub);
  fetchStub.mockReset();
  fetchStub.mockResolvedValue(response());
  vi.mocked(getDB).mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("current Saint identity, never local key authorization", () => {
  it.each(["", "different-key-that-is-not-the-central-secret", "short"])("accepts current central approval with local key %s", async key => {
    vi.stubEnv("YEBOM_SSO_SECRET", key);
    expect(authStatus(req())).toMatchObject({ configured: true, onSharedDomain: true, loginUrl: `${origin}/api/auth/sso` });
    expect(await verifiedPerson(req())).toEqual({ id: currentUser.user_id, name: currentUser.name });
    expect(getDB).not.toHaveBeenCalled();
  });
  it("forwards only one Saint cookie to the exact fixed no-store HTTPS endpoint", async () => {
    await verifiedPerson(req("/api/auth/checkin?redirect=https://evil.invalid", `finance-session=secret; ${SAINT_COOKIE}=opaque-current-seal; prayer_session=secret; other=secret`, { authorization: "Bearer private", origin, "x-forwarded-proto": "http" }));
    expect(fetchStub).toHaveBeenCalledOnce();
    const [url, options] = fetchStub.mock.calls[0];
    expect(url).toBe(SAINT_SESSION_URL);
    expect(options).toMatchObject({ method: "GET", cache: "no-store", redirect: "error", credentials: "omit", headers: { Cookie: `${SAINT_COOKIE}=opaque-current-seal`, Accept: "application/json" } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(options?.headers ?? {})).toEqual(["Cookie", "Accept"]);
  });
  it("projects only id/name, preserves real local grants and ignores finance promotion", async () => {
    const db = mockDB("editor", ["worship"]);
    const result = await actorFor(req());
    expect(result).toEqual({ id: currentUser.user_id, name: currentUser.name, role: "editor", departmentIds: ["worship"] });
    expect(db.inserted[0]).toMatchObject({ id: currentUser.user_id, name: currentUser.name, role: "viewer", departmentIds: [] });
    expect(Object.keys(db.inserted[0]).sort()).toEqual(["departmentIds", "id", "lastSeenAt", "name", "role"]);
    expect(Object.keys(db.updates[0]).sort()).toEqual(["lastSeenAt", "name"]);
    expect(JSON.stringify(result) + JSON.stringify(db)).not.toContain("private");
  });
  it("retains first-login local env grants without regranting existing users", async () => {
    vi.stubEnv("YEBOM_CALENDAR_ADMIN_IDS", currentUser.user_id);
    const db = mockDB("viewer");
    expect(await actorFor(req())).toHaveProperty("role", "viewer");
    expect(db.inserted[0].role).toBe("admin");
    expect(db.updates[0]).not.toHaveProperty("role");
  });
  it("deduplicates within Request only and checks fresh revocation on the next request", async () => {
    const request = req();
    await Promise.all([verifiedPerson(request), verifiedPerson(request), saintSessionFor(request)]);
    expect(fetchStub).toHaveBeenCalledOnce();
    fetchStub.mockResolvedValue(response({ isLoggedIn: false, reason: "revoked" }, 401));
    expect(await verifiedPerson(req())).toBeNull();
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(getDB).not.toHaveBeenCalled();
  });
  it("both legacy and current-format cryptographic cookies cannot bypass central revocation", async () => {
    vi.stubEnv("YEBOM_SSO_SECRET", password);
    const legacy = await sealData({ isLoggedIn: true, ...currentUser }, { password });
    const current = await sealData({ isLoggedIn: true, ...currentUser, sv: 17, renewed_at: 1234 }, { password });
    expect(await verifySaintCookie(legacy, password)).toEqual({ id: currentUser.user_id, name: currentUser.name });
    fetchStub.mockImplementation(async () => response({ isLoggedIn: false, reason: "revoked" }, 401, [sharedDeletion]));
    for (const cookie of [legacy, current]) expect(await actorFor(req("/api/events", `${SAINT_COOKIE}=${cookie}`))).toBeNull();
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(getDB).not.toHaveBeenCalled();
  });
  it.each(["revoked", "user_not_found", "not_logged_in"])("denies central 401 %s without creating a user", async reason => {
    fetchStub.mockResolvedValue(response({ isLoggedIn: false, reason }, 401));
    expect(await actorFor(req())).toBeNull();
    expect(getDB).not.toHaveBeenCalled();
  });
  it("denies 401 unapproval and unapproved premembers even if the center returns 200", async () => {
    for (const central of [response({ isLoggedIn: false, reason: "not_approved" }, 401), response({ isLoggedIn: true, user: { ...currentUser, is_approved: false, permission_level: "premember" } })]) {
      fetchStub.mockResolvedValue(central);
      await expect(actorFor(req())).rejects.toMatchObject({ status: 403, code: "SAINT_APPROVAL_REQUIRED" });
    }
    expect(getDB).not.toHaveBeenCalled();
  });
  it("profile completion fails with a workflow-specific error, not a login retry", async () => {
    fetchStub.mockResolvedValue(response({ isLoggedIn: true, user: { ...currentUser, needs_profile_completion: true } }));
    await expect(actorFor(req())).rejects.toMatchObject({ status: 403, code: "PROFILE_COMPLETION_REQUIRED" });
    expect(getDB).not.toHaveBeenCalled();
  });
  it.each([{ user_id: "" }, { name: "" }, { user_id: 123 }, { user_id: "bad\u007f" }, { name: "bad\nname" }, { is_approved: "true" }, { needs_profile_completion: "false" }])("fails closed on malformed current identity %j", async patch => {
    fetchStub.mockResolvedValue(response({ isLoggedIn: true, user: { ...currentUser, ...patch } }));
    await expect(actorFor(req())).rejects.toMatchObject({ code: "SAINT_UNAVAILABLE" });
    expect(getDB).not.toHaveBeenCalled();
  });
});

describe("singleton safe Cookie boundary", () => {
  it("deduplicates identical copies and forwards one raw value", async () => {
    await verifiedPerson(req("/api/events", `${SAINT_COOKIE}=opaque; ${SAINT_COOKIE}=opaque`));
    expect(fetchStub.mock.calls[0][1]?.headers).toMatchObject({ Cookie: `${SAINT_COOKIE}=opaque` });
  });
  it.each([`${SAINT_COOKIE}=a; ${SAINT_COOKIE}=b`, `${SAINT_COOKIE}=a; ${SAINT_COOKIE}=%61`, `${SAINT_COOKIE}=a%0d%0aX-Evil%3afoo`, `${SAINT_COOKIE}=a%3bother%3dsecret`, `${SAINT_COOKIE}=a%22`, `${SAINT_COOKIE}=a\\b`, `${SAINT_COOKIE}=a,b`, `${SAINT_COOKIE}=%ZZ`, `${SAINT_COOKIE}=${"a".repeat(16001)}`, `${SAINT_COOKIE}=a; other=${"b".repeat(32768)}`])("fails closed without forwarding an unsafe cookie (%s)", async cookie => {
    expect(cookieValue(req("/", cookie), SAINT_COOKIE)).toBeNull();
    expect(await verifiedPerson(req("/", cookie))).toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(getDB).not.toHaveBeenCalled();
  });
  it("rejects controls that Fetch Headers otherwise allows", async () => {
    const request = req("/", `${SAINT_COOKIE}=a\tb`);
    expect(await verifiedPerson(request)).toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();
  });
  it("does not call the center for absent cookies or a local logout marker", async () => {
    expect(await actorFor(req("/", null))).toBeNull();
    expect(await actorFor(req("/", `${SAINT_COOKIE}=a; ${LOGOUT_MARKER}=1`))).toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(getDB).not.toHaveBeenCalled();
  });
});

describe("bounded transport and outage distinction", () => {
  it.each([500, 501, 503, 302, 404])("sanitizes central HTTP %s and never clears cookies or creates users", async code => {
    fetchStub.mockResolvedValue(response({ reason: "raw-secret-DB-cookie" }, code, [sharedDeletion, renewed]));
    const result = await checkin(req());
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ authenticated: false, state: "unavailable" });
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(getDB).not.toHaveBeenCalled();
  });
  it("never falls back to a valid local seal on network failure", async () => {
    vi.stubEnv("YEBOM_SSO_SECRET", password);
    const seal = await sealData({ isLoggedIn: true, ...currentUser }, { password });
    fetchStub.mockRejectedValue(new Error("raw-private-network-information"));
    await expect(actorFor(req("/api/events", `${SAINT_COOKIE}=${seal}`))).rejects.toMatchObject({ status: 503, code: "SAINT_UNAVAILABLE" });
    expect(getDB).not.toHaveBeenCalled();
  });
  it("times out even if a transport ignores abort", async () => {
    vi.useFakeTimers();
    fetchStub.mockImplementation(() => new Promise<Response>(() => undefined));
    const pending = checkin(req());
    await vi.advanceTimersByTimeAsync(SAINT_TIMEOUT_MS);
    const result = await pending;
    expect(result.status).toBe(503);
    expect(fetchStub.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(getDB).not.toHaveBeenCalled();
  });
  it("bounds a body without Content-Length and cancels an oversized stream", async () => {
    const cancel = vi.fn();
    fetchStub.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(SAINT_MAX_BODY_BYTES + 1)); }, cancel }), { headers: { "Content-Type": "application/json" } }));
    expect((await validateSaintSession(req())).state).toBe("unavailable");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels a declared oversized body without reading it", async () => {
    const cancel = vi.fn();
    fetchStub.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json", "Content-Length": String(SAINT_MAX_BODY_BYTES + 1) } }));
    expect((await validateSaintSession(req())).state).toBe("unavailable");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("rejects redirected or changed upstream URLs even if a transport returns success", async () => {
    for (const properties of [{ redirected: true }, { url: "https://evil.invalid/session" }]) {
      const central = response();
      for (const [key, value] of Object.entries(properties)) Object.defineProperty(central, key, { value });
      fetchStub.mockResolvedValue(central);
      expect((await validateSaintSession(req())).state).toBe("unavailable");
    }
    expect(getDB).not.toHaveBeenCalled();
  });
  it("bounds body reading time, not just the initial fetch", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    fetchStub.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); }, cancel }), { headers: { "Content-Type": "application/json" } }));
    const pending = validateSaintSession(req());
    await vi.advanceTimersByTimeAsync(SAINT_TIMEOUT_MS);
    expect((await pending).state).toBe("unavailable");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([
    new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": String(SAINT_MAX_BODY_BYTES + 1) } }),
    new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": "bad" } }),
    new Response("not-json", { headers: { "Content-Type": "application/json" } }),
    new Response("{}", { headers: { "Content-Type": "text/html" } }),
    new Response("[]", { headers: { "Content-Type": "application/json" } }),
  ])("does not authorize malformed/oversized upstream responses", async central => {
    fetchStub.mockResolvedValue(central);
    expect((await validateSaintSession(req())).state).toBe("unavailable");
    expect(getDB).not.toHaveBeenCalled();
  });
});

describe("safe central cookie propagation and check-in privacy", () => {
  it("check-in relays central renewal/deletion only, with original lifetime, no local user writes", async () => {
    fetchStub.mockResolvedValue(response(undefined, 200, [deletion, renewed, "finance-session=private; Path=/; Secure; HttpOnly", "prayer_session=private; Path=/; Secure; HttpOnly"]));
    const result = await checkin(req());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ authenticated: true, state: "authenticated", message: expect.any(String) });
    expect(result.headers.getSetCookie()).toEqual([deletion, renewed]);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(result.headers.get("access-control-allow-origin")).toBeNull();
    expect(getDB).not.toHaveBeenCalled();
  });
  it("relays only Saint revocation deletions on current 401", async () => {
    fetchStub.mockResolvedValue(response({ isLoggedIn: false, reason: "revoked", private: "secret" }, 401, [deletion, sharedDeletion, "finance-session=; Path=/; Max-Age=0; Secure; HttpOnly"]));
    const result = await checkin(req());
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ authenticated: false, state: "revoked", message: expect.any(String) });
    expect(result.headers.getSetCookie()).toEqual([deletion, sharedDeletion]);
    expect(getDB).not.toHaveBeenCalled();
  });
  it.each([
    renewed.replace(".yebom.org", "evil.invalid"), renewed.replace(".yebom.org", "saint.yebom.org"), renewed.replace("Path=/", "Path=/api"), renewed.replace("; Secure", ""), renewed.replace("; HttpOnly", ""), renewed.replace("; Domain=.yebom.org", ""), renewed + "; Domain=evil.invalid", renewed + "; Path=/", renewed + "; Evil=private", renewed.replace("centrally-renewed-seal", "unsafe%0d%0a"), renewed.replace("34560000", "not-an-age"), renewed + "; Expires=garbage",
  ])("does not relay unsafe centrally supplied attributes (%s)", cookie => {
    const headers = new Headers(); headers.append("Set-Cookie", cookie);
    expect(saintSetCookies(headers)).toEqual([]);
  });
  it("retains a session cookie with no invented expiration", async () => {
    const sessionCookie = renewed.replace("; Max-Age=34560000", "");
    fetchStub.mockResolvedValue(response(undefined, 200, [sessionCookie]));
    expect((await checkin(req())).headers.getSetCookie()).toEqual([sessionCookie]);
  });
  it("preserves the centrally issued Expires date exactly", async () => {
    const expiring = `${renewed}; Expires=Thu, 01 Jan 2027 00:00:00 GMT`;
    fetchStub.mockResolvedValue(response(undefined, 200, [expiring]));
    expect((await checkin(req())).headers.getSetCookie()).toEqual([expiring]);
  });
  it.each<Record<string, string>>([{ origin: "https://evil.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }])("rejects non-same-origin check-in without consulting Saint %j", async headers => {
    const result = await checkin(req("/api/auth/checkin", undefined, headers));
    expect(result.status).toBe(403);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(getDB).not.toHaveBeenCalled();
  });
});

describe("SSO entry and non-looping callbacks", () => {
  it("the initial bootstrap relays central cookie renewal with its current identity", async () => {
    fetchStub.mockResolvedValue(response(undefined, 200, [deletion, renewed]));
    mockDB();
    const result = await bootstrapRoute(req("/api/bootstrap?year=2027"));
    expect(result.status).toBe(200);
    expect((await result.json()).actor.id).toBe(currentUser.user_id);
    expect(result.headers.getSetCookie()).toEqual([deletion, renewed]);
    expect(fetchStub).toHaveBeenCalledOnce();
  });
  it("a forced public bootstrap never checks identity or relays its cookies", async () => {
    const result = await bootstrapRoute(req("/api/bootstrap?year=2027&public=1"));
    expect(result.status).toBe(200);
    expect((await result.json()).actor).toBeNull();
    expect(result.headers.getSetCookie()).toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(getDB).not.toHaveBeenCalled();
  });
  it("preserves an annual workspace through the common login callback", async () => {
    const next = "/annual?year=2027&org=children";
    const entry = await sso(req(`/api/auth/sso?next=${encodeURIComponent(next)}`, null));
    const login = new URL(entry.headers.get("location")!);
    const callback = new URL(login.searchParams.get("redirect")!);
    expect(login.searchParams.get("from")).toBe("plan");
    expect(callback.searchParams.get("next")).toBe(next);
    expect(callback.searchParams.get("callback")).toBe("1");
    mockDB();
    const completed = await sso(req(callback.pathname + callback.search));
    expect(completed.status).toBe(303);
    expect(completed.headers.get("location")).toBe(origin + next);
  });
  it.each(["https://evil.invalid", "//evil.invalid", "/api/auth/logout", "/\\evil.invalid"])("an authenticated login cannot redirect to %s", async next => {
    mockDB();
    const result = await sso(req(`/api/auth/sso?next=${encodeURIComponent(next)}`));
    expect(result.headers.get("location")).toBe(origin + "/");
  });
  it("first anonymous entry redirects only to the real fixed Saint login callback", async () => {
    const result = await sso(req("/api/auth/sso?redirect=https://evil.invalid", null));
    expect(result.status).toBe(303);
    const destination = new URL(result.headers.get("location")!);
    expect(destination.origin + destination.pathname).toBe("https://saint.yebom.org/login");
    expect(destination.searchParams.get("from")).toBe("plan");
    expect(destination.searchParams.get("redirect")).toBe(`${origin}/api/auth/sso?callback=1`);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(fetchStub).not.toHaveBeenCalled();
  });
  it("missing callback cookie returns sharing guidance, not another redirect", async () => {
    const result = await sso(req("/api/auth/sso?callback=1&redirect=https://evil.invalid&reason=rawsecret", null));
    expect(result.status).toBe(401);
    expect(result.headers.get("location")).toBeNull();
    const body = await result.text();
    expect(body).toContain(".yebom.org");
    expect(body).not.toContain("evil.invalid");
    expect(body).not.toContain("rawsecret");
    expect(body).toContain('href="https://saint.yebom.org/"');
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it.each([
    [response({ isLoggedIn: false, reason: "revoked" }, 401), 401, "취소"],
    [response({ isLoggedIn: false, reason: "not_approved" }, 401), 403, "승인"],
    [response({ isLoggedIn: true, user: { ...currentUser, needs_profile_completion: true } }), 403, "프로필"],
    [response({ reason: "raw-private-failure" }, 500, [sharedDeletion]), 503, "유지"],
  ] as const)("callback failure is friendly, fixed and never redirects", async (central, code, phrase) => {
    fetchStub.mockResolvedValue(central);
    const result = await sso(req("/api/auth/sso?callback=1"));
    expect(result.status).toBe(code);
    expect(result.headers.get("location")).toBeNull();
    expect(result.headers.get("content-type")).toContain("text/html");
    expect(await result.text()).toContain(phrase);
    expect(getDB).not.toHaveBeenCalled();
    if (code === 503) expect(result.headers.get("set-cookie")).toBeNull();
  });
  it("initial profile-incomplete entry also terminates with dashboard guidance", async () => {
    fetchStub.mockResolvedValue(response({ isLoggedIn: true, user: { ...currentUser, needs_profile_completion: true } }));
    const result = await sso(req("/api/auth/sso"));
    expect(result.status).toBe(403);
    expect(result.headers.get("location")).toBeNull();
    expect(await result.text()).toContain("프로필");
  });
  it.each(["", "?callback=1"])("explicit valid entry %s clears local marker, checks once, relays renewal and redirects fixed home", async suffix => {
    fetchStub.mockResolvedValue(response(undefined, 200, [deletion, renewed]));
    mockDB();
    const result = await sso(req(`/api/auth/sso${suffix}${suffix ? "&" : "?"}redirect=https://evil.invalid`, `${SAINT_COOKIE}=opaque; ${LOGOUT_MARKER}=1`));
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe(`${origin}/`);
    expect(result.headers.getSetCookie()).toEqual([`${LOGOUT_MARKER}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, deletion, renewed]);
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(getDB).toHaveBeenCalledOnce();
  });
  it("local registration failure is sanitized, does not clear the logout marker, and preserves a real central renewal", async () => {
    fetchStub.mockResolvedValue(response(undefined, 200, [renewed]));
    vi.mocked(getDB).mockImplementation(() => { throw new Error("raw-private-database-detail"); });
    const result = await sso(req("/api/auth/sso?callback=1", `${SAINT_COOKIE}=opaque; ${LOGOUT_MARKER}=1`));
    expect(result.status).toBe(503);
    expect(result.headers.get("location")).toBeNull();
    expect(result.headers.getSetCookie()).toEqual([renewed]);
    expect(await result.text()).not.toContain("raw-private");
    expect(fetchStub).toHaveBeenCalledOnce();
  });
  it("sync status uses the local trusted entry and makes no central or DB calls", async () => {
    expect(await (status(req("/api/auth/status"))).json()).toMatchObject({ configured: true, loginUrl: `${origin}/api/auth/sso` });
    expect(fetchStub).not.toHaveBeenCalled();
    expect(getDB).not.toHaveBeenCalled();
  });
  it("missing trusted origin and Preview deny authentication without network/DB writes", async () => {
    for (const request of [new Request("https://preview.manus.computer/api/auth/checkin", { headers: { cookie: `${SAINT_COOKIE}=opaque` } }), req()]) {
      if (request.url.startsWith(origin)) vi.stubEnv("APP_PUBLIC_ORIGIN", "");
      expect(await verifiedPerson(request)).toBeNull();
      expect((await checkin(request)).status).toBeGreaterThanOrEqual(403);
      const callbackRequest = new Request(request.url.replace("checkin", "sso") + "?callback=1", { headers: request.headers });
      expect((await sso(callbackRequest)).headers.get("location")).toBeNull();
    }
    expect(fetchStub).not.toHaveBeenCalled();
    expect(getDB).not.toHaveBeenCalled();
  });
});
