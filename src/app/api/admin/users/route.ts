import { api, json, readActor, readJSON, writeActor } from "../../../../server/http";
import { getUsers, updateUser } from "../../../../server/services";
import { parse, userUpdateSchema } from "../../../../server/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return api(async () => json({ users: await getUsers(await readActor(request)) })); }
export function PATCH(request: Request) { return api(async () => { const actor = await writeActor(request); return json({ user: await updateUser(actor, parse(userUpdateSchema, await readJSON(request))) }); }); }
