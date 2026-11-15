import type { Person } from "../domain/types";

export const SAINT_COOKIE = "saint_record_session";
export const SAINT_SESSION_URL = "https://saint.yebom.org/api/auth/session";
export const SAINT_TIMEOUT_MS = 4000;
export const SAINT_MAX_BODY_BYTES = 32768;
const MAX_COOKIE_BYTES = 16000;
const MAX_COOKIE_HEADER_BYTES = 32768;
const CONTROL = /[\u0000-\u001f\u007f]/;
const COOKIE_OCTETS = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/;

export type SaintState = "authenticated" | "anonymous" | "invalid_cookie" | "revoked" | "not_approved" | "profile_incomplete" | "unavailable" | "not_configured" | "wrong_origin" | "logged_out";
export interface SaintSession {
  state: SaintState;
  person: Person | null;
  message: string;
  setCookies: string[];
}
const messages: Record<SaintState, string> = {
  authenticated: "교적부의 현재 승인된 세션을 확인했습니다. 일정 권한은 별도로 부여됩니다.",
  anonymous: "교적부 로그인이 확인되지 않습니다. 교적부 운영 쿠키 도메인이 .yebom.org로 설정되어 있어야 예봄일정과 로그인을 공유할 수 있습니다.",
  invalid_cookie: "공유 로그인 쿠키가 중복되었거나 올바르지 않습니다. 교적부에서 다시 로그인하고 쿠키 도메인 .yebom.org 설정을 확인하세요.",
  revoked: "교적부에서 세션이 취소되었거나 계정이 삭제되었습니다. 교적부에서 다시 로그인하세요.",
  not_approved: "교적부 계정 승인이 필요합니다. 교적부 관리자에게 승인을 요청하세요.",
  profile_incomplete: "교적부에서 프로필 작성을 먼저 완료한 뒤 예봄일정으로 돌아오세요. 반복 로그인으로는 해결되지 않습니다.",
  unavailable: "교적부 세션 확인 서버에 연결할 수 없습니다. 기존 쿠키는 유지됩니다. 잠시 후 다시 시도하세요.",
  not_configured: "신뢰할 수 있는 운영 HTTPS 주소가 아직 설정되지 않았습니다.",
  wrong_origin: "Manus Preview 등 다른 도메인에서는 교적부 공유 쿠키를 받을 수 없습니다. 운영 도메인에서 로그인하세요.",
  logged_out: "예봄일정에서 로그아웃한 상태입니다. 로그인 버튼으로 다시 연결하세요.",
};
export function saintResult(state: SaintState, person: Person | null = null, setCookies: string[] = []): SaintSession {
  return { state, person, message: messages[state], setCookies };
}

/** Raw singleton values only: never decode a cookie into a new header delimiter. */
export function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") ?? "";
  if (raw.length > MAX_COOKIE_HEADER_BYTES || CONTROL.test(raw)) return null;
  const values = raw.split(";").map(part => part.trim()).filter(part => part.startsWith(`${name}=`)).map(part => part.slice(name.length + 1));
  if (!values.length || values.some(value => value !== values[0])) return null;
  const value = values[0];
  if (value.length > MAX_COOKIE_BYTES || !COOKIE_OCTETS.test(value)) return null;
  // Percent-encoded controls/delimiters are unsafe even if a downstream parser decodes them.
  try { const decoded = decodeURIComponent(value); if (CONTROL.test(decoded) || !COOKIE_OCTETS.test(decoded)) return null; } catch { return null; }
  return value;
}
function hasSaintCookie(request: Request): boolean {
  return (request.headers.get("cookie") ?? "").split(";").some(part => part.trim().startsWith(`${SAINT_COOKIE}=`));
}

/** Relay only centrally issued Saint cookies; never rewrite lifetime or mint a seal. */
export function saintSetCookies(headers: Headers): string[] {
  const rawCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : (headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  if (rawCookies.length > 32 || rawCookies.reduce((size, value) => size + value.length, 0) > 65536) return [];
  const safe: string[] = [];
  for (const raw of rawCookies) {
    if (!raw || raw.length > MAX_COOKIE_BYTES + 512 || CONTROL.test(raw)) continue;
    const [pair, ...parts] = raw.split(";").map(part => part.trim());
    if (!pair.startsWith(`${SAINT_COOKIE}=`)) continue;
    const value = pair.slice(SAINT_COOKIE.length + 1);
    if (value.length > MAX_COOKIE_BYTES || !COOKIE_OCTETS.test(value)) continue;
    try { const decoded = decodeURIComponent(value); if (CONTROL.test(decoded) || !COOKIE_OCTETS.test(decoded)) continue; } catch { continue; }
    const attrs = new Map<string, string>();
    let invalid = false;
    for (const part of parts) {
      const equals = part.indexOf("=");
      const key = (equals < 0 ? part : part.slice(0, equals)).toLowerCase();
      const attrValue = equals < 0 ? "" : part.slice(equals + 1);
      if (!key || attrs.has(key) || !["path", "domain", "secure", "httponly", "samesite", "max-age", "expires"].includes(key)) { invalid = true; break; }
      if (["secure", "httponly"].includes(key) && equals >= 0) { invalid = true; break; }
      attrs.set(key, attrValue);
    }
    if (invalid || attrs.get("path") !== "/" || !attrs.has("secure") || !attrs.has("httponly") || !["lax", "strict", "none"].includes((attrs.get("samesite") ?? "").toLowerCase())) continue;
    const domain = attrs.get("domain")?.toLowerCase();
    if (domain !== undefined && domain !== ".yebom.org" && domain !== "yebom.org") continue;
    const maxAge = attrs.get("max-age");
    if (maxAge !== undefined && (!/^\d{1,8}$/.test(maxAge) || Number(maxAge) > 34560000)) continue;
    const expires = attrs.get("expires");
    if (expires !== undefined && (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(expires) || !Number.isFinite(Date.parse(expires)))) continue;
    // Saint's host-only deletion also removes stale Plan host-only copies. A live
    // host-only Saint cookie cannot be shared and must never become a Plan cookie.
    if (domain === undefined && !(value === "" && maxAge !== undefined && Number(maxAge) === 0)) continue;
    safe.push(raw);
  }
  return safe;
}
export function appendSaintCookies(response: Response, session: SaintSession): Response {
  for (const cookie of session.setCookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

async function boundedJSON(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if ((length && (!/^\d+$/.test(length) || Number(length) > SAINT_MAX_BODY_BYTES)) || !(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json") || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("Invalid response");
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("Timed out");
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > SAINT_MAX_BODY_BYTES) { cancel(); throw new Error("Response too large"); }
      chunks.push(chunk.value);
    }
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
async function check(request: Request): Promise<SaintSession> {
  const cookie = cookieValue(request, SAINT_COOKIE);
  if (!cookie) return saintResult(hasSaintCookie(request) ? "invalid_cookie" : "anonymous");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Timed out")); }, SAINT_TIMEOUT_MS);
    });
    return await Promise.race([timeout, (async () => {
      const response = await fetch(SAINT_SESSION_URL, {
        method: "GET", headers: { Cookie: `${SAINT_COOKIE}=${cookie}`, Accept: "application/json" },
        cache: "no-store", redirect: "error", credentials: "omit", signal: controller.signal,
      });
      if (response.redirected || (response.url && response.url !== SAINT_SESSION_URL) || ![200, 401].includes(response.status)) {
        void response.body?.cancel().catch(() => undefined);
        return saintResult("unavailable");
      }
      const body = await boundedJSON(response, controller.signal);
      if (!object(body)) return saintResult("unavailable");
      const setCookies = saintSetCookies(response.headers);
      if (response.status === 401) {
        const state = body.reason === "not_approved" ? "not_approved" : ["revoked", "user_not_found"].includes(String(body.reason)) ? "revoked" : "anonymous";
        return saintResult(state, null, setCookies);
      }
      if (body.isLoggedIn !== true || !object(body.user)) return saintResult("unavailable");
      const user = body.user;
      if (user.is_approved === false) return saintResult("not_approved", null, setCookies);
      if (user.is_approved !== true || (user.needs_profile_completion !== undefined && typeof user.needs_profile_completion !== "boolean")) return saintResult("unavailable");
      if (user.needs_profile_completion === true) return saintResult("profile_incomplete", null, setCookies);
      if (typeof user.user_id !== "string" || !user.user_id.trim() || user.user_id.length > 128 || typeof user.name !== "string" || !user.name.trim() || user.name.length > 100 || CONTROL.test(user.user_id + user.name)) return saintResult("unavailable");
      // Deliberately ignore email, finance_role, permissions and every private claim.
      return saintResult("authenticated", { id: user.user_id, name: user.name.trim() }, setCookies);
    })()]);
  } catch { return saintResult("unavailable"); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

// Deduplicate only within the exact Request object. Never cache authorization
// between requests: every subsequent request sees current central revocation.
const checks = new WeakMap<Request, Promise<SaintSession>>();
export function validateSaintSession(request: Request): Promise<SaintSession> {
  let pending = checks.get(request);
  if (!pending) { pending = check(request); checks.set(request, pending); }
  return pending;
}
