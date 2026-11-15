import { json } from "../../../../server/http";
import { authStatus, publicOrigin } from "../../../../server/auth";
import { logoutInPlace } from "../../../../server/saint-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Kept for older clients; a GET does not change the session.
export function GET(request: Request) {
  const status = authStatus(request), origin = publicOrigin();
  return json({ logoutUrl: status.onSharedDomain && origin ? `https://saint.yebom.org/api/auth/logout?return=${encodeURIComponent(`${origin}/`)}` : null, message: "중앙 교적부가 이 기기의 공통 로그아웃을 처리합니다." });
}
export function POST(request: Request) { return logoutInPlace(request); }
