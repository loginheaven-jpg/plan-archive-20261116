import { api, json, eventId, readActor, readJSON, writeActor } from "../../../../server/http";
import { getEvent, mutateEvent } from "../../../../server/services";
import { parse, mutationSchema } from "../../../../server/validation";
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: Context) {
  return api(async () => json(await getEvent(eventId((await context.params).id), await readActor(request))));
}
export function PATCH(request: Request, context: Context) {
  return api(async () => {
    const actor = await writeActor(request);
    const mutation = parse(mutationSchema, await readJSON(request));
    return json(await mutateEvent(eventId((await context.params).id), actor, mutation));
  });
}
