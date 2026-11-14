import { z } from "zod";
import { ORGANIZATION_IDS, type CalendarEvent, type EventInput, type EventMutation } from "../domain/types";

export class APIError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new APIError(400, "INVALID_INPUT", result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).slice(0, 8).join(" / "));
  return result.data;
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2200) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const dateSchema = z.string().refine(validDate, "실제 달력 날짜(YYYY-MM-DD)를 입력하세요.");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "시간은 HH:mm 형식입니다.");
const text = (max: number) => z.string().max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), "허용되지 않는 제어문자입니다.");
export const organizationSchema = z.enum(ORGANIZATION_IDS);
const departmentIds = z.array(organizationSchema).max(10).refine(v => new Set(v).size === v.length, "중복 부서입니다.");
export const recurrenceSchema = z.object({ frequency: z.enum(["weekly", "monthly", "yearly"]), interval: z.number().int().min(1).max(52), until: dateSchema, weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v => new Set(v).size === v.length, "중복 요일입니다.").optional() }).strict().superRefine((v, ctx) => {
  if (v.weekdays && v.frequency !== "weekly") ctx.addIssue({ code: "custom", path: ["weekdays"], message: "요일 선택은 매주 반복에만 사용할 수 있습니다." });
});
export const inputShape = {
  title: text(200).trim().min(1), organizationId: organizationSchema,
  startDate: dateSchema, endDate: dateSchema, allDay: z.boolean(),
  startTime: timeSchema.nullable(), endTime: timeSchema.nullable(),
  audience: z.enum(["all", "departments"]), audienceIds: departmentIds,
  visibility: z.enum(["public", "members", "department"]),
  locationId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable(), location: text(200),
  description: text(10000), internalNote: text(10000), recurrence: recurrenceSchema.nullable(),
  status: z.enum(["confirmed", "tentative"]),
};
export const eventSchema = z.object(inputShape).strict().superRefine((v, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (v.endDate < v.startDate) issue("endDate", "종료일이 시작일보다 빠릅니다.");
  const days = (Date.parse(`${v.endDate}T00:00:00Z`) - Date.parse(`${v.startDate}T00:00:00Z`)) / 86400000;
  if (days > 366) issue("endDate", "한 일정의 기간은 366일 이하여야 합니다.");
  if (v.allDay && (v.startTime !== null || v.endTime !== null)) issue("startTime", "종일 일정에는 시간을 지정하지 않습니다.");
  if (!v.allDay && (!v.startTime || !v.endTime)) issue("startTime", "시간 일정에는 시작·종료 시간이 필요합니다.");
  if (!v.allDay && v.startDate === v.endDate && v.startTime && v.endTime && v.endTime <= v.startTime) issue("endTime", "종료는 시작 이후여야 합니다. 자정을 넘으면 종료일을 다음 날로 입력하세요.");
  if (v.audience === "all" && v.audienceIds.length) issue("audienceIds", "전교회 대상에는 부서 대상을 별도 지정하지 않습니다.");
  if (v.audience === "departments" && !v.audienceIds.length) issue("audienceIds", "참여 대상 부서를 선택하세요.");
  if (v.recurrence) {
    if (v.recurrence.until < v.startDate) issue("recurrence", "반복 종료일이 시작일보다 빠릅니다.");
    const max = new Date(`${v.startDate}T00:00:00Z`); max.setUTCFullYear(max.getUTCFullYear() + 5);
    if (v.recurrence.until > max.toISOString().slice(0, 10)) issue("recurrence", "반복은 최대 5년입니다.");
    if (days > 31) issue("endDate", "반복 회차의 기간은 최대 31일입니다.");
  }
});
export const createSchema = z.object({ operationId: z.string().uuid(), input: eventSchema }).strict();
export const mutationSchema = z.object({ version: z.number().int().positive().max(2147483646), action: z.enum(["update", "cancel", "delete", "restore"]), input: z.object(inputShape).partial().strict().optional(), reason: text(1000).optional(), occurrenceDate: dateSchema.optional() }).strict().superRefine((v, ctx) => {
  if (v.action === "cancel" && !v.reason?.trim()) ctx.addIssue({ code: "custom", path: ["reason"], message: "취소 사유를 입력하세요." });
  if (v.action === "update" && !v.input) ctx.addIssue({ code: "custom", path: ["input"], message: "변경 입력이 필요합니다." });
  if (v.action !== "update" && v.input) ctx.addIssue({ code: "custom", path: ["input"], message: "이 작업에는 변경 입력을 제출하지 않습니다." });
  if (v.occurrenceDate && !["update", "cancel"].includes(v.action)) ctx.addIssue({ code: "custom", path: ["occurrenceDate"], message: "한 회차는 수정 또는 취소만 가능합니다." });
});
export type ValidMutation = Omit<EventMutation, "input"> & { input?: Partial<EventInput> };
export const reasonSchema = text(1000);
export const settingsSchema = z.object({ denomination: text(100), ashWednesday: z.boolean(), ascension: z.boolean(), thanksgiving: z.object({ enabled: z.boolean(), rule: z.enum(["nthSunday", "fixedDate"]), month: z.number().int().min(1).max(12), nth: z.number().int().min(1).max(5), day: z.number().int().min(1).max(31) }).strict().superRefine((v, ctx) => { if (v.rule === "fixedDate" && !validDate(`2000-${String(v.month).padStart(2,"0")}-${String(v.day).padStart(2,"0")}`)) ctx.addIssue({ code: "custom", message: "실제 날짜를 설정하세요." }); }), reformationSunday: z.boolean(), newYear: z.boolean(), yearEnd: z.boolean() }).strict();
export const venueSchema = z.object({ id: inputShape.locationId.unwrap(), name: text(100).trim().min(1) }).strict();
export const settingsUpdateSchema = z.object({ settings: settingsSchema, venues: z.array(venueSchema).max(200).refine(v => new Set(v.map(x => x.id)).size === v.length, "중복 장소 ID입니다.").optional(), version: z.number().int().positive().optional() }).strict();
export const userUpdateSchema = z.object({ id: text(128).min(1), role: z.enum(["viewer", "editor", "admin"]), departmentIds }).strict();
export function validateEvent(input: unknown): EventInput { return parse(eventSchema, input); }
export function eventInput(event: CalendarEvent): EventInput {
  const out = Object.fromEntries(Object.keys(inputShape).map(k => [k, event[k as keyof CalendarEvent]]));
  out.status = event.status === "cancelled" ? "confirmed" : event.status;
  return out as unknown as EventInput;
}
export const OCCURRENCE_FIELDS = ["title", "startDate", "endDate", "allDay", "startTime", "endTime", "locationId", "location", "description", "internalNote", "status"] as const;
export function occurrencePatch(input: Partial<EventInput>, event: CalendarEvent): Partial<EventInput> {
  const allowed = new Set<string>(OCCURRENCE_FIELDS);
  const patch: Partial<EventInput> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) {
      if (JSON.stringify(value) !== JSON.stringify(event[key as keyof CalendarEvent])) throw new APIError(400, "INVALID_OVERRIDE", "한 회차에서는 주관부서·공개범위·참여대상·반복을 변경할 수 없습니다.");
    } else Object.assign(patch, { [key]: value });
  }
  return patch;
}
export function parseYear(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^\d{4}$/.test(value) || Number(value) < 1900 || Number(value) > 2200) throw new APIError(400, "INVALID_YEAR", "연도는 1900–2200 범위입니다.");
  return Number(value);
}
