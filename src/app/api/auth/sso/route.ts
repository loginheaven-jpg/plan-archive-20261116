import { api, json } from "../../../../server/http";
import { actorFor, authStatus, cookieValue, LOGOUT_MARKER, publicOrigin, SAINT_COOKIE, verifySaintCookie } from "../../../../server/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return api(async () => {
    const status = authStatus(request);
    const origin = publicOrigin();
    if (!status.configured || !status.onSharedDomain || !origin || !status.loginUrl) return json({ error: status.message, code: "SSO_UNAVAILABLE", message: status.message }, 503);
    const person = await verifySaintCookie(cookieValue(request, SAINT_COOKIE));
    if (!person) return Response.redirect(status.loginUrl, 303);
    // Explicit sign-in clears only our local logout marker, never any finance/Saint cookie.
    const headers = new Headers(request.headers);
    headers.set("cookie", (headers.get("cookie") ?? "").split(";").filter(c => !c.trim().startsWith(`${LOGOUT_MARKER}=`)).join(";"));
    await actorFor(new Request(request.url, { headers }));
    return new Response(null, { status: 303, headers: { Location: `${origin}/`, "Cache-Control": "no-store", "Set-Cookie": `${LOGOUT_MARKER}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
  });
}
