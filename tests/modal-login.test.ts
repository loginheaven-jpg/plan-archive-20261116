import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { GET as checkin } from "../src/app/api/auth/checkin/route";
import { LOGOUT_MARKER, verifiedPerson } from "../src/server/auth";
import { SAINT_COOKIE, SAINT_SESSION_URL } from "../src/server/saint-session";
import { centralAuxCookies, LOGIN_TIMEOUT_MS, SAINT_LOGIN_URL, SAINT_LOGOUT_URL } from "../src/server/saint-login";

vi.mock("../src/db/client", () => ({ getDB: vi.fn() }));
const origin = "https://plan.yebom.org";
const fixturePassword = "isolated-modal-password";
const user = { user_id: "fixture-approved", name: "격리 성도", is_approved: true, needs_profile_completion: false, password_reset_required: false, profile_missing_fields: [], finance_role: "super_admin", email: "private@example.invalid" };
const live = `${SAINT_COOKIE}=opaque-fixture-seal; Path=/; Domain=.yebom.org; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`;
const deletion = `${SAINT_COOKIE}=; Path=/; Domain=.yebom.org; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const fetcher = vi.fn<typeof fetch>();
let sequence = 0;
function result(body: unknown, code = 200, cookies: string[] = []) {
  const headers = new Headers({ "Content-Type": "application/json" });
  cookies.forEach(cookie => headers.append("Set-Cookie", cookie));
  return new Response(JSON.stringify(body), { status: code, headers });
}
function request(body: unknown = { email: `fixture-${++sequence}@example.invalid`, password: fixturePassword, remember: true }, patch: Record<string, string> = {}, path = "/api/auth/login") {
  return new Request(origin + path, { method: "POST", headers: { host: "plan.yebom.org", origin, "sec-fetch-site": "same-origin", "Content-Type": "application/json", cookie: "finance-session=private; prayer_session=private", ...patch }, body: JSON.stringify(body) });
}
function success(patch = {}) {
  fetcher.mockResolvedValueOnce(result({ success: true }, 200, [live]));
  fetcher.mockResolvedValueOnce(result({ isLoggedIn: true, user: { ...user, ...patch } }));
}
beforeEach(() => {
  vi.stubEnv("APP_PUBLIC_ORIGIN", origin);
  vi.stubEnv("YEBOM_SSO_SECRET", "");
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("same-screen central credential login", () => {
  it("uses only fixed HTTPS endpoints, returns minimal identity, and never echoes password", async () => {
    success();
    const response = await login(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ authenticated: true, identity: { id: user.user_id, name: user.name }, profileCompletionRequired: false, passwordResetRequired: false });
    expect(JSON.stringify(body)).not.toContain(fixturePassword);
    expect(JSON.stringify(body)).not.toContain("super_admin");
    expect(JSON.stringify(body)).not.toContain("private@example.invalid");
    expect(fetcher.mock.calls[0][0]).toBe(SAINT_LOGIN_URL);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", credentials: "omit" });
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ "Content-Type": "application/json", Accept: "application/json" });
    expect(fetcher.mock.calls[1][0]).toBe(SAINT_SESSION_URL);
    expect(fetcher.mock.calls[1][1]?.headers).toEqual({ Cookie: `${SAINT_COOKIE}=opaque-fixture-seal`, Accept: "application/json" });
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.getSetCookie()).toContain(live);
  });
  it.each<Record<string, string>>([{ origin: "https://evil.invalid" }, { "sec-fetch-site": "cross-site" }, { host: "evil.invalid" }, { origin: "" }])("rejects login CSRF before central call %j", async headers => {
    expect((await login(request(undefined, headers))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ email: "", password: "p" }, { email: "x", password: "" }, { email: "x", password: 42 }, { email: "x", password: "p", redirect: "https://evil.invalid" }, { email: "x", password: "p", remember: "true" }])("rejects malformed login payload without passing it to center %j", async input => {
    expect((await login(request(input))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects oversized credential bodies", async () => {
    expect((await login(request({ email: "fixture", password: "x".repeat(5000) }))).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([400, 401, 429, 500])("sanitizes central denial %i", async code => {
    fetcher.mockResolvedValue(result({ error: fixturePassword }, code));
    const response = await login(request());
    expect(response.status).toBe([400, 401].includes(code) ? 401 : code === 429 ? 429 : 503);
    expect(await response.text()).not.toContain(fixturePassword);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects an untrusted host-only live cookie instead of declaring login success", async () => {
    fetcher.mockResolvedValue(result({ success: true }, 200, [live.replace(" Domain=.yebom.org;", "")]));
    expect((await login(request())).status).toBe(503);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects two different simultaneously issued session values", async () => {
    fetcher.mockResolvedValue(result({ success: true }, 200, [live, live.replace("opaque-fixture-seal", "other-seal")]));
    expect((await login(request())).status).toBe(503);
  });
  it("recognizes profile-pending identity, keeps profile restriction, and whitelists missing names", async () => {
    const patch = { needs_profile_completion: true, profile_missing_fields: ["phone", "birth_date", "private"] };
    success(patch);
    const response = await login(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authenticated: true, state: "profile_incomplete", identity: { id: user.user_id, name: user.name }, profileCompletionRequired: true, profileMissingFields: ["birth_date", "phone"] });
    fetcher.mockResolvedValue(result({ isLoggedIn: true, user: { ...user, ...patch } }));
    await expect(verifiedPerson(new Request(origin + "/api/events", { headers: { host: "plan.yebom.org", cookie: `${SAINT_COOKIE}=opaque-fixture-seal` } }))).rejects.toMatchObject({ status: 403, code: "PROFILE_COMPLETION_REQUIRED" });
  });
  it("recognizes password-change-pending identity but denies editing", async () => {
    success({ password_reset_required: true });
    expect(await (await login(request())).json()).toMatchObject({ authenticated: true, state: "password_reset_required", passwordResetRequired: true });
    fetcher.mockResolvedValue(result({ isLoggedIn: true, user: { ...user, password_reset_required: true } }));
    await expect(verifiedPerson(new Request(origin + "/api/events", { headers: { host: "plan.yebom.org", cookie: `${SAINT_COOKIE}=opaque-fixture-seal` } }))).rejects.toMatchObject({ status: 403, code: "PASSWORD_RESET_REQUIRED" });
  });
  it("requires the centralized password policy instead of authorizing from legacy metadata", async () => {
    const old = { ...user } as Record<string, unknown>;
    delete old.password_reset_required;
    success(old);
    fetcher.mockReset();
    fetcher.mockResolvedValueOnce(result({ success: true }, 200, [live]));
    fetcher.mockResolvedValueOnce(result({ isLoggedIn: true, user: old }));
    expect((await login(request())).status).toBe(503);
  });
  it("does not turn revoked fresh identity into a successful login", async () => {
    fetcher.mockResolvedValueOnce(result({ success: true }, 200, [live]));
    fetcher.mockResolvedValueOnce(result({ isLoggedIn: false, reason: "revoked" }, 401, [deletion]));
    const response = await login(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ authenticated: false, identity: null, state: "revoked" });
    expect(response.headers.getSetCookie().at(-1)).toBe(deletion);
  });
  it("times out without leaking transport or credentials", async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error(fixturePassword)), { once: true })));
    const pending = login(request());
    await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS + 10);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(fixturePassword);
  });
});

describe("automatic shared identity and in-place central logout", () => {
  it.each([false, true])("clears a legacy Plan marker only after a fresh verified shared identity (profile pending: %s)", async pending => {
    fetcher.mockResolvedValue(result({ isLoggedIn: true, user: { ...user, needs_profile_completion: pending } }));
    const response = await checkin(new Request(origin + "/api/auth/checkin", { headers: { host: "plan.yebom.org", cookie: `${SAINT_COOKIE}=opaque-fixture-seal; ${LOGOUT_MARKER}=1`, "sec-fetch-site": "same-origin" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authenticated: true, profileCompletionRequired: pending });
    expect(response.headers.getSetCookie()).toContain(`${LOGOUT_MARKER}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([SAINT_SESSION_URL]);
  });
  it("does not clear the legacy marker or invent identity when the central cookie is revoked", async () => {
    fetcher.mockResolvedValue(result({ isLoggedIn: false, reason: "revoked" }, 401, [deletion]));
    const response = await checkin(new Request(origin + "/api/auth/checkin", { headers: { host: "plan.yebom.org", cookie: `${SAINT_COOKIE}=opaque-fixture-seal; ${LOGOUT_MARKER}=1`, "sec-fetch-site": "same-origin" } }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ authenticated: false, identity: null });
    expect(response.headers.getSetCookie().join(",")).not.toContain(LOGOUT_MARKER);
  });
  it("existing approved shared session checks in without credential login", async () => {
    fetcher.mockResolvedValue(result({ isLoggedIn: true, user }));
    const response = await checkin(new Request(origin + "/api/auth/checkin", { headers: { host: "plan.yebom.org", cookie: `${SAINT_COOKIE}=opaque-fixture-seal`, "sec-fetch-site": "same-origin" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authenticated: true, identity: { id: user.user_id, name: user.name } });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([SAINT_SESSION_URL]);
  });
  it("relays only central deletions/reauth marker and does not clear Plan storage or navigate", async () => {
    const clearPrayer = "prayer_session=; Path=/; Domain=.yebom.org; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
    const marker = "yebom_reauth=1; Path=/; Domain=.yebom.org; Max-Age=86400; HttpOnly; Secure; SameSite=Lax";
    const central = result({ success: true }, 200, [deletion, clearPrayer, marker, "prayer_session=private-live; Path=/; Domain=.yebom.org; HttpOnly; Secure; SameSite=Lax", "evil=private; Path=/; HttpOnly; Secure"]);
    central.headers.set("Clear-Site-Data", '"cache", "storage"');
    fetcher.mockResolvedValue(central);
    const response = await logout(request({}, {}, "/api/auth/logout"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, authenticated: false, identity: null, logoutUrl: null });
    expect(response.headers.getSetCookie()).toContain(clearPrayer);
    expect(response.headers.getSetCookie()).toContain(marker);
    expect(response.headers.getSetCookie().join(",")).not.toContain("private");
    expect(response.headers.get("clear-site-data")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(fetcher.mock.calls[0][0]).toBe(SAINT_LOGOUT_URL);
  });
  it("does not accept central logout success without an actual deletion cookie", async () => {
    fetcher.mockResolvedValue(result({ success: true }));
    expect((await logout(request({}, {}, "/api/auth/logout"))).status).toBe(503);
  });
  it("never propagates malformed auxiliary or live other-service cookies", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "finance-session=private; Path=/; Domain=.yebom.org; HttpOnly; Secure; SameSite=Lax");
    headers.append("Set-Cookie", "finance-session=; Path=/; Domain=.evil.invalid; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
    expect(centralAuxCookies(headers, true)).toEqual([]);
  });
});
