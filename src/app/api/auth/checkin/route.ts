import { authStatus, publicOrigin, saintSessionFor } from "../../../../server/auth";
import { json } from "../../../../server/http";
import { appendSaintCookies, saintResult } from "../../../../server/saint-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const status = authStatus(request);
  const origin = publicOrigin();
  const suppliedOrigin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (!status.onSharedDomain || (suppliedOrigin !== null && suppliedOrigin !== origin) || (site !== null && !["same-origin", "none"].includes(site))) {
    const session = saintResult(status.configured ? "wrong_origin" : "not_configured");
    return json({ authenticated: false, state: session.state, message: session.message }, status.configured ? 403 : 503);
  }
  // This is a central read/check only: it must never register a local user.
  const session = await saintSessionFor(request);
  const code = session.state === "authenticated" ? 200 : session.state === "unavailable" || session.state === "not_configured" ? 503 : ["not_approved", "profile_incomplete", "wrong_origin"].includes(session.state) ? 403 : 401;
  return appendSaintCookies(json({ authenticated: session.state === "authenticated", state: session.state, message: session.message }, code), session);
}
