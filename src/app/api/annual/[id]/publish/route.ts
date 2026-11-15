import { api, json, eventId, readJSON, writeActor } from "../../../../../server/http";
import { publishAnnualDraft } from "../../../../../server/annual";
import { ANNUAL_MAX_BYTES } from "../../../../../server/annual-validation";
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: Context) {
  return api(async () => {
    const actor = await writeActor(request);
    return json(await publishAnnualDraft(actor, eventId((await context.params).id), await readJSON(request, ANNUAL_MAX_BYTES)));
  });
}
