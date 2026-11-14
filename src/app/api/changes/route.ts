import { api, json, readActor } from "../../../server/http";
import { getChanges } from "../../../server/services";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return api(async () => json({ changes: await getChanges(await readActor(request)) })); }
