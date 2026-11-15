import { authStatus, LOGOUT_MARKER, publicOrigin, saintSessionFor } from "../../../../server/auth";
import { json } from "../../../../server/http";
import { appendSaintCookies, clientAuthSession, saintResult } from "../../../../server/saint-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const status = authStatus(request);
  const origin = publicOrigin();
  const suppliedOrigin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (!status.onSharedDomain || (suppliedOrigin !== null && suppliedOrigin !== origin) || (site !== null && !["same-origin", "none"].includes(site))) {
    const session = saintResult(status.configured ? "wrong_origin" : "not_configured");
    return json(clientAuthSession(session), status.configured ? 403 : 503);
  }
  // Checks identity only; no local account or role is created here.
  const session = await saintSessionFor(request, { allowLogoutMarker: true });
  const snapshot = clientAuthSession(session);
  const code = snapshot.authenticated ? 200 : ["unavailable", "not_configured"].includes(session.state) ? 503 : session.state === "not_approved" ? 403 : 401;
  const response = appendSaintCookies(json(snapshot, code), session);
  const hasLegacyMarker = (request.headers.get("cookie") ?? "").split(";").some(part => part.trim().startsWith(`${LOGOUT_MARKER}=`));
  if (snapshot.authenticated && hasLegacyMarker) response.headers.append("Set-Cookie", `${LOGOUT_MARKER}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return response;
}
