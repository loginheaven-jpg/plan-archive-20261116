import { api, json } from "../../../../server/http";
import { assertCSRF, authStatus, LOGOUT_MARKER, publicOrigin } from "../../../../server/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function result(request: Request) {
  const status = authStatus(request), origin = publicOrigin();
  return { logoutUrl: status.onSharedDomain && origin ? `https://saint.yebom.org/api/auth/logout?return=${encodeURIComponent(`${origin}/`)}` : null, message: "통합 로그아웃은 교적부에서 처리합니다. 예봄일정은 재정부·교적부 쿠키를 직접 삭제하지 않습니다." };
}
// A GET only exposes the trusted central link; changing even local logout state requires CSRF-safe POST.
export function GET(request: Request) { return json(result(request)); }
export function POST(request: Request) {
  return api(async () => {
    assertCSRF(request);
    const response = json(result(request));
    response.headers.set("Set-Cookie", `${LOGOUT_MARKER}=1; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`);
    return response;
  });
}
