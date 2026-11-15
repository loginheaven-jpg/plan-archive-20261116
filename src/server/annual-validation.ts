import { z } from "zod";
import { ORGANIZATION_IDS, type AnnualDraftInput, type EventInput } from "../domain/types";
import { APIError, validateEvent } from "./validation";

export const ANNUAL_MAX_BYTES = 512 * 1024;
export const ANNUAL_MAX_ROWS = 200;
const text = (max: number) => z.string().max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), "허용되지 않는 제어문자입니다.");
const organization = z.enum(ORGANIZATION_IDS);
const organizations = z.array(organization).max(10).refine(v => new Set(v).size === v.length, "중복 부서입니다.");
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "올바른 UUID를 입력하세요.").transform(v => v.toLowerCase());
export const annualYearSchema = z.number().int().min(1900).max(2200);
const version = z.number().int().positive().max(2147483646);
// Incomplete dates/times/ranges and blank titles belong in private drafts, not events.
const recurrence = z.object({
  frequency: z.enum(["weekly", "monthly", "yearly"]), interval: z.number().int().min(1).max(52),
  until: text(32).nullable(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v => new Set(v).size === v.length, "중복 요일입니다.").optional(),
  monthWeek: z.number().int().min(-1).max(5).refine(v => v !== 0, "주 순번은 1–5 또는 마지막(-1)입니다.").optional(),
}).strict();
export const annualRowInputSchema = z.object({
  title: text(200), organizationId: organization,
  startDate: text(32), endDate: text(32), allDay: z.boolean(),
  startTime: text(32).nullable(), endTime: text(32).nullable(),
  audience: z.enum(["all", "departments"]), audienceIds: organizations,
  visibility: z.enum(["public", "members", "department"]),
  locationId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "올바른 장소 ID를 선택하세요.").nullable(), location: text(200),
  description: text(10000), internalNote: text(10000), recurrence: recurrence.nullable(),
  status: z.enum(["confirmed", "tentative"]),
}).strict();
export const annualDraftInputSchema = z.object({
  year: annualYearSchema, organizationId: organization,
  rows: z.array(z.object({ id: uuid, dateText: text(500), input: annualRowInputSchema, timeConfirmed: z.boolean().optional(), sourceEventId: uuid.optional() }).strict()).max(ANNUAL_MAX_ROWS)
    .refine(rows => new Set(rows.map(row => row.id)).size === rows.length, "행 등록 ID가 중복되었습니다."),
}).strict();
export const annualCreateSchema = z.object({ id: uuid, input: annualDraftInputSchema }).strict();
export const annualUpdateSchema = z.object({ version, input: annualDraftInputSchema }).strict();
export const annualPublishSchema = z.object({ version, rowIds: z.array(uuid).min(1).max(ANNUAL_MAX_ROWS).refine(ids => new Set(ids).size === ids.length, "선택한 행 ID가 중복되었습니다.") }).strict();

export function parseAnnual<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const paths = result.error.issues.slice(0, 8).map(issue => issue.path.join(".") || "요청").join(", ");
    throw new APIError(400, "INVALID_ANNUAL_INPUT", `연간계획 입력 형식·허용 항목·길이를 확인하세요. (${paths})`);
  }
  if (Buffer.byteLength(JSON.stringify(result.data), "utf8") > ANNUAL_MAX_BYTES) throw new APIError(413, "INPUT_TOO_LARGE", "연간계획 입력은 512KiB 이내로 나누어 저장하세요.");
  return result.data;
}
export function validateAnnualDraft(value: unknown): AnnualDraftInput { return parseAnnual(annualDraftInputSchema, value); }

// Drafts are permissive, but publication always uses the same complete-event
// validator as individual registration (including actual recurrence existence).
export function validateAnnualEvent(value: unknown): EventInput {
  return validateEvent(parseAnnual(annualRowInputSchema, value));
}
