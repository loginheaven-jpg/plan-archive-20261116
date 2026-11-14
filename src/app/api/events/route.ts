import { api, json, readJSON, writeActor } from "../../../server/http";
import { createEvent } from "../../../server/services";
import { createSchema, parse } from "../../../server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return api(async () => {
    const actor = await writeActor(request);
    const { operationId, input } = parse(createSchema, await readJSON(request));
    return json(await createEvent(actor, operationId, input));
  });
}
