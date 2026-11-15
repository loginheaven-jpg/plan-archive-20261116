import { api, json, readActor } from "../../../server/http";
import { bootstrap } from "../../../server/services";
import { parseYear } from "../../../server/validation";
import { todayKST } from "../../../domain/calendar";
import { saintSessionFor } from "../../../server/auth";
import { appendSaintCookies } from "../../../server/saint-session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return api(async () => {
    const year = parseYear(
      new URL(request.url).searchParams.get("year"),
      Number(todayKST().slice(0, 4)),
    );
    const response = json(
      await bootstrap(request, await readActor(request), year),
    );
    // Deliver central renewals with the initial identity response as well as check-in.
    return new URL(request.url).searchParams.get("public") === "1"
      ? response
      : appendSaintCookies(response, await saintSessionFor(request));
  });
}
