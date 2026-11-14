import { api } from "../../../server/http";
import { getSettings, publicFeedEvents } from "../../../server/services";
import { buildICS } from "../../../domain/ics";
import { todayKST } from "../../../domain/calendar";
import { APIError, parseYear, organizationSchema, parse } from "../../../server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return api(async () => {
    const query = new URL(request.url).searchParams;
    const year = parseYear(query.get("year"), Number(todayKST().slice(0,4)));
    const raw = query.get("org");
    const organizationIds = raw === null ? undefined : raw === "" ? [] : raw.split(",").map(id => parse(organizationSchema, id));
    if (organizationIds && new Set(organizationIds).size !== organizationIds.length) throw new APIError(400, "DUPLICATE_ORGANIZATION", "중복 부서 필터입니다.");
    const [events, config] = await Promise.all([publicFeedEvents(year), getSettings()]);
    const headers = new Headers({ "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" });
    if (query.get("download") === "1") headers.set("Content-Disposition", `attachment; filename="yebom-${year}.ics"`);
    return new Response(buildICS(events, config.settings, { organizationIds, includeAllAudience: query.get("all") === "1", includeChurchYear: query.get("churchYear") === "1", year }), { headers });
  });
}
