import { api, json, readActor, readJSON, writeActor } from "../../../server/http";
import { createAnnualDraft, listAnnualDrafts } from "../../../server/annual";
import { ANNUAL_MAX_BYTES } from "../../../server/annual-validation";
import { APIError, parseYear } from "../../../server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return api(async () => {
    const value = new URL(request.url).searchParams.get("year");
    if (value === null) throw new APIError(400, "YEAR_REQUIRED", "초안을 조회할 연도를 지정하세요.");
    return json(await listAnnualDrafts(await readActor(request), parseYear(value, 2026)));
  });
}
export function POST(request: Request) {
  return api(async () => {
    const actor = await writeActor(request);
    return json(await createAnnualDraft(actor, await readJSON(request, ANNUAL_MAX_BYTES)));
  });
}
