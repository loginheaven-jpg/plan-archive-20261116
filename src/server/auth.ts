import { unsealData } from "iron-session";
import { eq } from "drizzle-orm";
import { getDB } from "../db/client";
import { users, settings } from "../db/schema";
import type { Actor, AuthStatus, Person } from "../domain/types";
import { APIError } from "./validation";
import { cookieValue, saintResult, validateSaintSession, type SaintSession } from "./saint-session";

export { SAINT_COOKIE, cookieValue } from "./saint-session";
export const LOGOUT_MARKER = "yebom_plan_logged_out";
export function publicOrigin(): string | null {
  const raw = process.env.APP_PUBLIC_ORIGIN;
  if (!raw) return null;
  try { const u = new URL(raw); return u.protocol === "https:" && u.hostname.endsWith(".yebom.org") && !u.username && !u.password && u.pathname === "/" && !u.search && !u.hash && !u.port ? u.origin : null; } catch { return null; }
}
function secret(): string | null { const value = process.env.YEBOM_SSO_SECRET; return value && value.length >= 32 ? value : null; }
function requestOrigin(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host");
  const rawHost = forwarded ?? request.headers.get("host") ?? new URL(request.url).host;
  if (!/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(rawHost)) return null;
  // The forwarding gateway must overwrite this header, not append client values.
  try { return new URL(`https://${rawHost}`).origin; } catch { return null; }
}
export function authStatus(request: Request): AuthStatus {
  const origin = publicOrigin();
  const current = requestOrigin(request);
  const configured = !!origin;
  const onSharedDomain = !!origin && current === origin;
  const loginUrl = configured && onSharedDomain ? `${origin}/api/auth/sso` : null;
  return { configured, onSharedDomain, loginUrl, message: !origin ? "신뢰할 수 있는 운영 HTTPS 주소가 아직 설정되지 않았습니다." : !onSharedDomain ? "Manus Preview 등 다른 도메인에서는 교적부 공유 쿠키를 받을 수 없습니다. 운영 도메인에서 로그인하세요." : "기존 교적부 계정의 현재 세션을 교적부 서버에서 확인합니다. 공유 쿠키 도메인 .yebom.org가 필요하며 일정 권한은 별도로 부여됩니다." };
}
// Legacy seal inspection is retained only for offline interoperability tests.
// Active authentication must never call it, including on a central outage.
export async function verifySaintCookie(seal: string | null, password: string | null = secret()): Promise<Person | null> {
  if (!seal || seal.length > 16000 || !password || password.length < 32) return null;
  // iron-session's version parser uses parseInt; reject trailing garbage instead of accepting ~2forged.
  if (!/^Fe26\.2\*\d+\*[a-fA-F0-9]{64}\*[A-Za-z0-9_-]+\*[A-Za-z0-9_-]+\*\d{0,17}\*[a-fA-F0-9]{64}\*[A-Za-z0-9_-]+~2$/.test(seal)) return null;
  try {
    const data = await unsealData<Record<string, unknown>>(seal, { password });
    if (data.isLoggedIn !== true || data.is_approved !== true || data.needs_profile_completion === true || typeof data.user_id !== "string" || !data.user_id.trim() || data.user_id.length > 128 || typeof data.name !== "string" || !data.name.trim() || data.name.length > 100 || /[\u0000-\u001f]/.test(data.user_id + data.name)) return null;
    return { id: data.user_id, name: data.name.trim() };
  } catch { return null; }
}
export interface AuthOptions { allowLogoutMarker?: boolean }
export async function saintSessionFor(request: Request, options: AuthOptions = {}): Promise<SaintSession> {
  const status = authStatus(request);
  if (!status.configured) return saintResult("not_configured");
  if (!status.onSharedDomain) return saintResult("wrong_origin");
  // Treat malformed/ambiguous local logout markers as logged out too.
  const hasMarker = (request.headers.get("cookie") ?? "").split(";").some(part => part.trim().startsWith(`${LOGOUT_MARKER}=`));
  if (!options.allowLogoutMarker && hasMarker && cookieValue(request, LOGOUT_MARKER) !== "") return saintResult("logged_out");
  return validateSaintSession(request);
}
export async function verifiedPerson(request: Request, options: AuthOptions = {}): Promise<Person | null> {
  const session = await saintSessionFor(request, options);
  if (session.state === "unavailable") throw new APIError(503, "SAINT_UNAVAILABLE", session.message);
  if (session.state === "profile_incomplete") throw new APIError(403, "PROFILE_COMPLETION_REQUIRED", session.message);
  if (session.state === "password_reset_required") throw new APIError(403, "PASSWORD_RESET_REQUIRED", session.message);
  if (session.state === "not_approved") throw new APIError(403, "SAINT_APPROVAL_REQUIRED", session.message);
  return session.person;
}
export async function actorFor(request: Request, options: AuthOptions = {}): Promise<Actor | null> {
  const person = await verifiedPerson(request, options);
  if (!person) return null;
  const adminIds = new Set((process.env.YEBOM_CALENDAR_ADMIN_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean));
  // Serialize first-login grants with settings/user admin mutations. Existing roles are never re-granted from env.
  return getDB().transaction(async tx => {
    await tx.select({ id: settings.id }).from(settings).where(eq(settings.id, "church")).limit(1).for("update");
    await tx.insert(users).values({ ...person, role: adminIds.has(person.id) ? "admin" : "viewer", departmentIds: [], lastSeenAt: new Date().toISOString() }).onDuplicateKeyUpdate({ set: { name: person.name, lastSeenAt: new Date().toISOString() } });
    const [user] = await tx.select().from(users).where(eq(users.id, person.id)).limit(1);
    return { id: user.id, name: user.name, role: user.role, departmentIds: user.departmentIds };
  });
}
export function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new APIError(401, "AUTH_REQUIRED", "승인된 교적부 계정으로 로그인하세요.");
  return actor;
}
export function requireAdmin(actor: Actor | null): Actor {
  const value = requireActor(actor);
  if (value.role !== "admin") throw new APIError(403, "ADMIN_REQUIRED", "일정 관리자 권한이 필요합니다.");
  return value;
}
function allowedOrigin(origin: string): boolean {
  if (origin === publicOrigin()) return true;
  for (const item of (process.env.APP_ALLOWED_ORIGINS ?? "").split(",").map(v => v.trim()).filter(Boolean)) {
    if (item === "https://*.manus.computer") {
      const u = new URL(origin);
      if (u.protocol === "https:" && !u.port && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.manus\.computer$/.test(u.hostname)) return true;
    } else { try { const u = new URL(item); if (u.protocol === "https:" && u.origin === item && origin === item) return true; } catch { /* Ignore invalid configuration. */ } }
  }
  return false;
}
export function assertCSRF(request: Request): void {
  const raw = request.headers.get("origin");
  let origin: string;
  try { const u = new URL(raw ?? ""); if (u.origin !== raw || u.protocol !== "https:") throw new Error(); origin = u.origin; } catch { throw new APIError(403, "CSRF_ORIGIN", "안전한 같은 출처 요청만 저장할 수 있습니다."); }
  if (!allowedOrigin(origin) || origin !== requestOrigin(request)) throw new APIError(403, "CSRF_ORIGIN", "요청 출처가 현재 앱 주소와 일치하지 않습니다.");
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) throw new APIError(403, "CSRF_SITE", "다른 사이트에서는 저장할 수 없습니다.");
}
