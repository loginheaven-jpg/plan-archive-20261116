import { schemaReady } from "../../../db/client";
import { json } from "../../../server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return await schemaReady() ? json({ status: "ready" }) : json({ status: "unavailable", message: "데이터베이스 마이그레이션이 필요합니다." }, 503); }
  catch { return json({ status: "unavailable", message: "데이터베이스 연결 또는 마이그레이션을 확인하세요." }, 503); }
}
