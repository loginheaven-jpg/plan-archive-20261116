import { api, json, eventId, readActor, readJSON, writeActor } from "../../../../server/http";
import { getAnnualDraft, updateAnnualDraft } from "../../../../server/annual";
import { ANNUAL_MAX_BYTES } from "../../../../server/annual-validation";
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: Context) {
  return api(async () => json(await getAnnualDraft(await readActor(request), eventId((await context.params).id))));
}
export function PUT(request: Request, context: Context) {
  return api(async () => {
    const actor = await writeActor(request);
    return json(await updateAnnualDraft(actor, eventId((await context.params).id), await readJSON(request, ANNUAL_MAX_BYTES)));
  });
}
