import {
  actorFor,
  authStatus,
  LOGOUT_MARKER,
  publicOrigin,
  saintSessionFor,
} from "../../../../server/auth";
import {
  appendSaintCookies,
  saintResult,
  type SaintSession,
} from "../../../../server/saint-session";
import { safeLoginReturn } from "../../../../domain/login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function friendly(session: SaintSession, origin: string | null): Response {
  const code = ["unavailable", "not_configured"].includes(session.state)
    ? 503
    : ["not_approved", "profile_incomplete", "password_reset_required", "wrong_origin"].includes(
          session.state,
        )
      ? 403
      : 401;
  // All text and destinations are fixed or derived from the trusted configured
  // origin, never from incoming redirect/reason parameters or the upstream body.
  const home = origin ? `<a href="${origin}/">예봄일정으로 돌아가기</a>` : "";
  const response = new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>예봄일정 로그인 확인</title></head><body><main><h1>로그인 연결을 확인해 주세요</h1><p>${session.message}</p><p><a href="https://saint.yebom.org/">교적부에서 계정·프로필 확인하기</a></p><p>${home}</p></main></body></html>`,
    {
      status: code,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; base-uri 'none'; form-action 'none'",
      },
    },
  );
  return appendSaintCookies(response, session);
}
export async function GET(request: Request) {
  const status = authStatus(request);
  const origin = publicOrigin();
  if (!status.configured || !status.onSharedDomain || !origin)
    return friendly(
      saintResult(status.configured ? "wrong_origin" : "not_configured"),
      origin,
    );
  const callback = new URL(request.url).searchParams.get("callback") === "1";
  const returnTo = safeLoginReturn(
    new URL(request.url).searchParams.get("next"),
  );
  // An explicit login entry is the only path allowed to ignore the local logout
  // marker; the same Request keeps validation deduplicated through actorFor.
  const session = await saintSessionFor(request, { allowLogoutMarker: true });
  if (session.state === "authenticated") {
    try {
      const actor = await actorFor(request, { allowLogoutMarker: true });
      if (!actor)
        return friendly(
          saintResult("unavailable", null, session.setCookies),
          origin,
        );
    } catch {
      return friendly(
        saintResult("unavailable", null, session.setCookies),
        origin,
      );
    }
    const response = new Response(null, {
      status: 303,
      headers: {
        Location: `${origin}${returnTo}`,
        "Cache-Control": "private, no-store",
        "Set-Cookie": `${LOGOUT_MARKER}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      },
    });
    return appendSaintCookies(response, session);
  }
  if (
    !callback &&
    ["anonymous", "invalid_cookie", "revoked"].includes(session.state)
  ) {
    const callbackURL = new URL("/api/auth/sso", origin);
    callbackURL.searchParams.set("callback", "1");
    if (returnTo !== "/") callbackURL.searchParams.set("next", returnTo);
    const destination = `https://saint.yebom.org/login?from=plan&redirect=${encodeURIComponent(callbackURL.href)}`;
    return appendSaintCookies(
      new Response(null, {
        status: 303,
        headers: {
          Location: destination,
          "Cache-Control": "private, no-store",
        },
      }),
      session,
    );
  }
  // In particular callback=1 never redirects to Saint again, even when the
  // domain cookie was not shared. Profile/approval/outage are not login retries.
  return friendly(session, origin);
}
