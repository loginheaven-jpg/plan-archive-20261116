import { api, json, readActor } from "../../../server/http";
import { getTrash } from "../../../server/services";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return api(async () => json({ events: await getTrash(await readActor(request)) })); }
