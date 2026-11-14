import { api, json, readJSON, writeActor } from "../../../server/http";
import { getSettings, putSettings } from "../../../server/services";
import { parse, settingsUpdateSchema } from "../../../server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() { return api(async () => json(await getSettings())); }
export function PUT(request: Request) { return api(async () => { const actor = await writeActor(request); return json(await putSettings(actor, parse(settingsUpdateSchema, await readJSON(request)))); }); }
