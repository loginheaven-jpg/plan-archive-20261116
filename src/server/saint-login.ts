import { createHash } from "node:crypto";
import { authStatus, assertCSRF, LOGOUT_MARKER } from "./auth";
import { api, json, readJSON } from "./http";
import { appendSaintCookies, boundedJSON, clientAuthSession, SAINT_COOKIE, saintResult, saintSetCookies, validateSaintSession, type SaintState } from "./saint-session";
import { APIError } from "./validation";

export const SAINT_LOGIN_URL = "https://saint.yebom.org/api/auth/login";
export const SAINT_LOGOUT_URL = "https://saint.yebom.org/api/auth/logout";
export const LOGIN_TIMEOUT_MS = 12000;
const attempts = new Map<string, { count: number; until: number }>();
const deletionNames = new Set(["prayer_session", "finance-session", "auth-token", "kakao_pending", "yebom_reauth"]);

function allSetCookies(headers: Headers): string[] {
  return typeof headers.getSetCookie === "function" ? headers.getSetCookie() : (headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_-]+=)/);
}
/** Only centrally issued deletions, plus its fixed reauthentication marker. */
export function centralAuxCookies(headers: Headers, logout = false): string[] {
  const raw = allSetCookies(headers);
  if (raw.length > 32) return [];
  return raw.filter(cookie => {
    const pair = cookie.split(";", 1)[0];
    const equals = pair.indexOf("=");
    const name = pair.slice(0, equals);
    const value = pair.slice(equals + 1);
    if (!deletionNames.has(name)) return false;
    const deletion = value === "" && /;\s*max-age=0(?:;|$)/i.test(cookie);
    const marker = logout && name === "yebom_reauth" && value === "1";
    if (!deletion && !marker) return false;
    const probe = new Headers();
    probe.append("Set-Cookie", `${SAINT_COOKIE}=${value}${cookie.slice(pair.length)}`);
    return saintSetCookies(probe).length === 1;
  });
}
function failure(state: SaintState = "unavailable", status = 503, message?: string): Response {
  const snapshot = clientAuthSession(saintResult(state));
  if (message) snapshot.message = message;
  return json(snapshot, status);
}
function enforceEndpoint(request: Request) {
  assertCSRF(request);
  const status = authStatus(request);
  if (!status.configured || !status.onSharedDomain) throw new APIError(403, "SSO_ORIGIN", "실제 예봄일정 운영 주소에서 로그인하세요.");
}
function rateLimit(request: Request, email: string) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const forwarded = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  const key = createHash("sha256").update(forwarded.slice(0, 256) + "\0" + email.toLowerCase()).digest("hex");
  const current = attempts.get(key);
  if ((!current && attempts.size >= 1000) || (current && current.count >= 8)) throw new APIError(429, "LOGIN_RATE_LIMIT", "로그인 시도가 많아요. 1분 뒤 다시 시도하세요.");
  attempts.set(key, { count: (current?.count ?? 0) + 1, until: current?.until ?? now + 60000 });
}
async function centralFetch(url: string, options: RequestInit, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { ...options, signal, redirect: "error", cache: "no-store", credentials: "omit" });
  if (response.redirected || (response.url && response.url !== url)) throw new Error("Unexpected central destination");
  return response;
}

export function loginInPlace(request: Request): Promise<Response> {
  return api(async () => {
    enforceEndpoint(request);
    const value = await readJSON(request, 4096);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new APIError(400, "LOGIN_INPUT", "로그인 항목을 확인하세요.");
    const data = value as Record<string, unknown>;
    if (Object.keys(data).some(key => !["email", "password", "remember"].includes(key)) || typeof data.email !== "string" || !data.email.trim() || data.email.length > 254 || typeof data.password !== "string" || !data.password || data.password.length > 256 || (data.remember !== undefined && typeof data.remember !== "boolean")) throw new APIError(400, "LOGIN_INPUT", "이메일 또는 전화번호와 비밀번호를 확인하세요.");
    const email = data.email.trim();
    rateLimit(request, email);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
    try {
      // Password is forwarded transiently only; never logged, persisted or echoed.
      const central = await centralFetch(SAINT_LOGIN_URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email, password: data.password, remember: data.remember !== false }) }, controller.signal);
      data.password = "";
      if (!central.ok) {
        void central.body?.cancel().catch(() => undefined);
        if (central.status === 401 || central.status === 400) return failure("anonymous", 401, "계정 또는 비밀번호가 일치하지 않아요.");
        if (central.status === 403) return json(clientAuthSession(saintResult("not_approved")), 403);
        if (central.status === 429) return failure("unavailable", 429, "교적부 로그인 시도가 많아요. 1분 뒤 다시 시도하세요.");
        return failure();
      }
      const body = await boundedJSON(central, controller.signal);
      if (!body || typeof body !== "object" || (body as Record<string, unknown>).success !== true) return failure();
      const issued = saintSetCookies(central.headers);
      const live = issued.filter(cookie => cookie.startsWith(`${SAINT_COOKIE}=`) && cookie.split(";", 1)[0] !== `${SAINT_COOKIE}=`);
      const pairs = [...new Set(live.map(cookie => cookie.split(";", 1)[0]))];
      if (pairs.length !== 1) return failure("unavailable", 503, "공유 로그인 쿠키를 확인해야 해요. 교적부 쿠키 도메인 설정을 확인해 주세요.");
      const verification = new Request(request.url, { headers: { Cookie: pairs[0] } });
      // Fresh official check validates approval, revocation, password and profile state.
      const session = await validateSaintSession(verification);
      const snapshot = clientAuthSession(session);
      const response = json(snapshot, snapshot.authenticated ? 200 : ["not_approved", "profile_incomplete", "password_reset_required"].includes(session.state) ? 403 : 503);
      for (const cookie of issued) response.headers.append("Set-Cookie", cookie);
      for (const cookie of centralAuxCookies(central.headers)) response.headers.append("Set-Cookie", cookie);
      appendSaintCookies(response, session);
      if (snapshot.authenticated) response.headers.append("Set-Cookie", `${LOGOUT_MARKER}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
      return response;
    } catch {
      return failure();
    } finally {
      data.password = "";
      clearTimeout(timer);
    }
  });
}

export function logoutInPlace(request: Request): Promise<Response> {
  return api(async () => {
    enforceEndpoint(request);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
    try {
      const central = await centralFetch(SAINT_LOGOUT_URL, { method: "POST", headers: { Accept: "application/json" } }, controller.signal);
      if (!central.ok) { void central.body?.cancel().catch(() => undefined); return failure(); }
      const body = await boundedJSON(central, controller.signal);
      if (!body || typeof body !== "object" || (body as Record<string, unknown>).success !== true) return failure();
      const cookies = saintSetCookies(central.headers).filter(cookie => cookie.split(";", 1)[0] === `${SAINT_COOKIE}=` && /;\s*max-age=0(?:;|$)/i.test(cookie));
      if (!cookies.length) return failure();
      const response = json({ success: true, ...clientAuthSession(saintResult("anonymous")), logoutUrl: null });
      for (const cookie of [...cookies, ...centralAuxCookies(central.headers, true)]) response.headers.append("Set-Cookie", cookie);
      response.headers.append("Set-Cookie", `${LOGOUT_MARKER}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
      // Do not relay Clear-Site-Data: user's unsaved Plan input must not be erased.
      return response;
    } catch { return failure(); }
    finally { clearTimeout(timer); }
  });
}
