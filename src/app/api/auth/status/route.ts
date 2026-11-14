import { authStatus } from "../../../../server/auth";
import { json } from "../../../../server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return json(authStatus(request)); }
