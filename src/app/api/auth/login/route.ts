import { loginInPlace } from "../../../../server/saint-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return loginInPlace(request); }
