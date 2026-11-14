import { api, json, readActor } from "../../../server/http";
import { bootstrap } from "../../../server/services";
import { parseYear } from "../../../server/validation";
import { todayKST } from "../../../domain/calendar";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return api(async () => {
    const year = parseYear(new URL(request.url).searchParams.get("year"), Number(todayKST().slice(0,4)));
    return json(await bootstrap(request, await readActor(request), year));
  });
}
