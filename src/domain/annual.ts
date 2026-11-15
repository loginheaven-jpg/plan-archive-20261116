import { addDaysISO, firstRecurrenceDate, floatingDate } from "./calendar";
import type { AnnualPlanRow, CalendarEvent, EventInput, OrganizationId, RecurrenceRule } from "./types";
import { eventSchema } from "../server/validation";

export interface AnnualRowReview {
  input: EventInput | null;
  errors: string[];
  warnings: string[];
  undated: boolean;
}

/** Pure parse result. Null dates mean an undated/invalid row, not an event date.
 * `dateKind === "recurrence"` overrides the configured rule; plain dates retain it.
 * `hasTime` means the expression overrides time (including an explicit 종일).
 * Ambiguous times are proposals only; publication requires row.timeConfirmed.
 */
export interface AnnualDateParseResult {
  kind: "dated" | "undated" | "invalid";
  dateKind: "date" | "range" | "recurrence" | null;
  startDate: string | null;
  endDate: string | null;
  recurrence: RecurrenceRule | null;
  allDay: boolean | null;
  startTime: string | null;
  endTime: string | null;
  endDayOffset: number;
  hasTime: boolean;
  timeAmbiguous: boolean;
  undated: boolean;
  errors: string[];
  warnings: string[];
}

const WEEKDAY_NAMES = ["주일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
const NTH_NAMES: Record<number, string> = { 1: "첫째", 2: "둘째", 3: "셋째", 4: "넷째", 5: "다섯째", [-1]: "마지막" };
const NTH_VALUES: Record<string, number> = { 첫째: 1, 둘째: 2, 셋째: 3, 넷째: 4, 다섯째: 5, 마지막: -1 };
const DATE_TOKEN = "(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s*/\\s*\\d{1,2}|\\d{1,2}월\\s*\\d{1,2}일)";
const WEEKDAY_TOKEN = "(?:주일|일요일|월요일|화요일|수요일|목요일|금요일|토요일)";

function validYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1900 && year <= 2200;
}

function dateToken(text: string, year: number): string {
  const compact = text.replace(/\s/g, "");
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(compact) ?? /^(\d{1,2})월(\d{1,2})일$/.exec(compact);
  const date = match ? `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : compact;
  floatingDate(date);
  if (!validYear(Number(date.slice(0, 4)))) throw new RangeError("Date year outside supported range");
  return date;
}

function weekdayNumber(text: string): number {
  return text === "일요일" ? 0 : WEEKDAY_NAMES.indexOf(text);
}

function timePlusHour(startTime: string): { endTime: string; endDayOffset: number } {
  const [hours, minutes] = startTime.split(":").map(Number);
  const total = hours * 60 + minutes + 60;
  return { endTime: `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`, endDayOffset: Math.floor(total / (24 * 60)) };
}

/** Supported deterministic grammar: M/D, YYYY-MM-DD, M월 D일; ~ ranges;
 * [date부터 [date까지 | 계속]] 매주 weekday / 매월 nth [주] weekday;
 * a trailing 오전/오후 H시[MM분], H:MM, or 종일. A bare repeat starts
 * on selected-year Jan 1 and has NO end, with an explicit review warning.
 * No automatic cross-year range, church-day name, or fuzzy-language inference.
 */
export function parseAnnualDate(text: string, year: number): AnnualDateParseResult {
  const result: AnnualDateParseResult = {
    kind: "invalid", dateKind: null, startDate: null, endDate: null, recurrence: null,
    allDay: null, startTime: null, endTime: null, endDayOffset: 0,
    hasTime: false, timeAmbiguous: false, undated: false, errors: [], warnings: [],
  };
  const fail = (message: string): AnnualDateParseResult => {
    result.kind = "invalid";
    result.dateKind = null;
    result.startDate = null;
    result.endDate = null;
    result.recurrence = null;
    result.errors.push(message);
    return result;
  };
  if (!validYear(year)) return fail("연도는 1900–2200 범위로 선택하세요.");
  if (typeof text !== "string" || text.length > 500) return fail("날짜 표현은 500자 이내로 입력하세요.");
  if (/[\u0000-\u001f\u007f]/.test(text)) return fail("날짜 표현에 줄바꿈이나 제어문자를 넣을 수 없습니다.");
  let expression = text.trim();
  const undatedMonth = /^(\d{1,2})월(?:\s*미정)?$/.exec(expression);
  if (!expression || /^날짜\s*미정$/.test(expression) || undatedMonth) {
    if (undatedMonth && (Number(undatedMonth[1]) < 1 || Number(undatedMonth[1]) > 12)) return fail("미정 월은 1–12월로 입력하세요.");
    result.kind = "undated";
    result.undated = true;
    result.warnings.push("날짜 미정 행은 초안에만 보관하며 달력에 등록하지 않습니다.");
    return result;
  }

  if (/종일$/.test(expression)) {
    expression = expression.replace(/\s*종일$/, "").trim();
    result.hasTime = true;
    result.allDay = true;
  } else {
    const time = /(오전|오후)?\s*(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)(?:\s*)$/.exec(expression);
    if (time) {
      const hour = Number(time[2]);
      const minute = Number(time[3] ?? time[4] ?? 0);
      if (minute > 59 || hour > 23 || (time[1] && (hour < 1 || hour > 12))) return fail("시간을 확인하세요. 오전·오후는 1–12시, 24시간 표기는 0–23시입니다.");
      const actualHour = time[1] ? hour % 12 + (time[1] === "오후" ? 12 : 0) : hour;
      result.startTime = `${String(actualHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      Object.assign(result, timePlusHour(result.startTime));
      result.hasTime = true;
      result.allDay = false;
      result.timeAmbiguous = !time[1] && time[3] === undefined && hour >= 1 && hour <= 12;
      if (result.timeAmbiguous) result.warnings.push("오전·오후가 없는 시간입니다. 시간 선택에서 시작·종료를 확인하세요.");
      expression = expression.slice(0, time.index).trim();
    }
  }

  try {
    let start: string | null = null;
    let until: string | null = null;
    let rest = expression;
    let hasBounds = false;
    let open = false;
    const bounds = new RegExp(`^(${DATE_TOKEN})\\s*부터\\s*(?:(${DATE_TOKEN})\\s*까지\\s*|(계속)\\s*)?(.*)$`).exec(rest);
    const range = new RegExp(`^(${DATE_TOKEN})\\s*[~～]\\s*(${DATE_TOKEN})(.*)$`).exec(rest);
    if (bounds) {
      start = dateToken(bounds[1], year);
      until = bounds[2] ? dateToken(bounds[2], year) : null;
      open = Boolean(bounds[3]);
      rest = bounds[4].trim();
      hasBounds = true;
    } else if (range) {
      start = dateToken(range[1], year);
      until = dateToken(range[2], year);
      rest = range[3].trim();
      hasBounds = true;
    }

    const weekly = new RegExp(`^(?:매주\\s*)?(${WEEKDAY_TOKEN})$`).exec(rest);
    const monthly = new RegExp(`^매월\\s*(첫째|둘째|셋째|넷째|다섯째|마지막)\\s*(?:주\\s+)?(${WEEKDAY_TOKEN})$`).exec(rest);
    const isWeekly = Boolean(weekly && (/^매주/.test(rest) || (hasBounds && (open || /매주/.test(rest)))));
    if (monthly || isWeekly) {
      result.kind = "dated";
      result.dateKind = "recurrence";
      result.startDate = start ?? `${year}-01-01`;
      result.endDate = result.startDate;
      result.recurrence = {
        frequency: monthly ? "monthly" : "weekly", interval: 1, until,
        weekdays: [weekdayNumber(monthly ? monthly[2] : weekly![1])],
        ...(monthly ? { monthWeek: NTH_VALUES[monthly[1]] } : {}),
      };
      if (!hasBounds) result.warnings.push(`시작 날짜가 없어 ${year}년 1월 1일부터 계속 반복합니다. 시작 범위를 확인하세요.`);
      if (until && until < result.startDate) return fail("종료일이 시작일보다 빠릅니다. 연도를 포함하여 범위를 다시 입력하세요.");
      if (until) {
        const max = floatingDate(result.startDate);
        max.setUTCFullYear(max.getUTCFullYear() + 5);
        if (until > max.toISOString().slice(0, 10)) return fail("기간이 정해진 반복은 최대 5년입니다.");
      }
      const first = firstRecurrenceDate({ startDate: result.startDate, recurrence: result.recurrence });
      if (!first) return fail("반복 기간 안에 선택한 요일의 실제 회차가 없습니다.");
      if (first !== result.startDate) result.warnings.push(`범위 시작일이 모임 요일과 달라 첫 회차는 ${first}입니다.`);
    } else if (hasBounds && !rest && until && !open) {
      result.kind = "dated";
      result.dateKind = "range";
      result.startDate = start;
      result.endDate = until;
    } else if (!hasBounds && new RegExp(`^${DATE_TOKEN}$`).test(expression)) {
      result.kind = "dated";
      result.dateKind = "date";
      result.startDate = dateToken(expression, year);
      result.endDate = result.startDate;
    } else {
      return fail("지원하는 날짜 표현을 사용하세요. 예: 1/10, 1/10~1/12, 1/10부터 3/31까지 매주 수요일, 10/10부터 계속 수요일, 매월 둘째 주일.");
    }
    if (result.startDate && result.endDate && result.endDate < result.startDate) return fail("종료일이 시작일보다 빠릅니다. 연도를 포함하여 범위를 다시 입력하세요.");
    if (result.endDate && result.endDayOffset) result.endDate = addDaysISO(result.endDate, result.endDayOffset);
    return result;
  } catch {
    return fail("실제 달력 날짜를 입력하세요. 존재하지 않는 날짜는 자동으로 보정하지 않습니다.");
  }
}

/** Draft rows keep their UUID across edits. Calling this creates a NEW row. */
export function newAnnualRow(organizationId: OrganizationId, year: number): AnnualPlanRow {
  if (!validYear(year)) throw new RangeError("연도는 1900–2200 범위입니다.");
  return {
    id: crypto.randomUUID(), dateText: "",
    input: {
      title: "", organizationId, startDate: "", endDate: "", allDay: true,
      startTime: null, endTime: null, audience: "departments", audienceIds: [organizationId],
      visibility: "public", locationId: null, location: "", description: "", internalNote: "",
      recurrence: null, status: "confirmed",
    },
  };
}

export function rowToEventInput(row: AnnualPlanRow, year: number): AnnualRowReview {
  const parsed = parseAnnualDate(row.dateText, year);
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  if (row.sourceEventId) warnings.push("지난해에서 복사한 초안입니다. 날짜·요일·교회력·반복 범위를 다시 확인하세요.");
  if (parsed.undated || errors.length || !parsed.startDate || !parsed.endDate) return { input: null, errors, warnings, undated: parsed.undated };
  const input: EventInput = structuredClone(row.input);
  input.startDate = parsed.startDate;
  input.endDate = parsed.endDate;
  if (parsed.dateKind === "recurrence") input.recurrence = parsed.recurrence;
  if (parsed.hasTime) {
    input.allDay = parsed.allDay ?? input.allDay;
    if (parsed.timeAmbiguous && row.timeConfirmed === true && row.input.startTime) {
      // The explicit UI confirmation wins over the unqualified parser proposal.
      input.startTime = row.input.startTime;
      input.endTime = row.input.endTime ?? timePlusHour(input.startTime).endTime;
      input.endDate = parsed.dateKind === "range" ? parsed.endDate : input.startDate;
      if (input.endTime <= input.startTime) input.endDate = addDaysISO(input.endDate, 1);
    } else {
      input.startTime = parsed.startTime;
      input.endTime = parsed.endTime;
    }
    if (parsed.timeAmbiguous && row.timeConfirmed !== true) errors.push("오전·오후가 없는 시간은 시간 선택에서 확인한 뒤 등록하세요.");
  } else if (!input.allDay && input.startTime) {
    if (!input.endTime) {
      const end = timePlusHour(input.startTime);
      input.endTime = end.endTime;
      input.endDate = addDaysISO(input.endDate, end.endDayOffset);
    } else if ((parsed.dateKind !== "range" || input.startDate === input.endDate) && input.endTime <= input.startTime) {
      input.endDate = addDaysISO(input.endDate, 1);
    }
  }
  const valid = eventSchema.safeParse(input);
  if (!valid.success) errors.push(...valid.error.issues.map(issue => issue.message));
  if (valid.success && input.recurrence && parsed.dateKind !== "recurrence") {
    const first = firstRecurrenceDate(input);
    if (first && first !== input.startDate) warnings.push(`범위 시작일이 모임 요일과 달라 첫 회차는 ${first}입니다.`);
  }
  return { input: errors.length || !valid.success ? null : valid.data, errors: [...new Set(errors)], warnings: [...new Set(warnings)], undated: false };
}

/** New row and input only: never carry audit fields, exception patches or event IDs.
 * Month/day and relative year offsets are retained literally, including invalid 2/29.
 * Source ID is review provenance only; the row's new UUID is its publication identity.
 */
export function copyEventToAnnualRow(event: CalendarEvent, targetYear: number, organizationId?: OrganizationId): AnnualPlanRow {
  const row = newAnnualRow(organizationId ?? event.organizationId, targetYear);
  const sourceYear = Number(event.startDate.slice(0, 4));
  const shifted = (date: string): string => `${targetYear + Number(date.slice(0, 4)) - sourceYear}${date.slice(4)}`;
  const startDate = shifted(event.startDate);
  const endDate = shifted(event.endDate);
  const recurrence: RecurrenceRule | null = event.recurrence ? {
    frequency: event.recurrence.frequency, interval: event.recurrence.interval,
    until: event.recurrence.until === null ? null : shifted(event.recurrence.until),
    ...(event.recurrence.weekdays ? { weekdays: [...event.recurrence.weekdays] } : {}),
    ...(event.recurrence.monthWeek !== undefined ? { monthWeek: event.recurrence.monthWeek } : {}),
  } : null;
  row.dateText = startDate === endDate ? startDate : `${startDate}~${endDate}`;
  row.input = {
    title: event.title, organizationId: organizationId ?? event.organizationId,
    startDate, endDate, allDay: event.allDay, startTime: event.startTime, endTime: event.endTime,
    audience: event.audience, audienceIds: [...event.audienceIds], visibility: event.visibility,
    locationId: event.locationId, location: event.location, description: event.description,
    internalNote: event.internalNote ?? "", recurrence,
    status: event.status === "tentative" ? "tentative" : "confirmed",
  };
  row.sourceEventId = event.id;
  return row;
}

export function recurrenceLabel(event: Pick<EventInput, "startDate" | "endDate" | "startTime" | "allDay" | "recurrence">): string {
  const rule = event.recurrence;
  if (!rule) return "반복 없음";
  const interval = rule.interval;
  const weekdays = rule.weekdays?.map(day => WEEKDAY_NAMES[day]).join("·");
  const pattern = rule.frequency === "weekly"
    ? `${interval === 1 ? "매주" : `${interval}주마다`}${weekdays ? ` ${weekdays}` : ""}`
    : rule.frequency === "monthly"
      ? `${interval === 1 ? "매월" : `${interval}개월마다`}${rule.monthWeek !== undefined ? ` ${NTH_NAMES[rule.monthWeek]} ${weekdays ?? ""}` : ` ${Number(event.startDate.slice(8, 10))}일`}`
      : `${interval === 1 ? "매년" : `${interval}년마다`} ${Number(event.startDate.slice(5, 7))}월 ${Number(event.startDate.slice(8, 10))}일`;
  const time = event.allDay ? "종일" : event.startTime ?? "시간 미정";
  return `${pattern} · ${event.startDate}부터 ${rule.until === null ? "계속 반복 (종료일 없음)" : `${rule.until}까지 (종료일 포함)`} · ${time}`;
}

/** CSV/TSV is data, never evaluated. Bounded, RFC-style quoted cells may contain
 * delimiters, CRLF and escaped quotes. Malformed quotes throw a Korean error.
 * Delimiter detection ignores quoted cells and uses the first nonempty record.
 */
export function parsePastedTable(text: string): string[][] {
  const maxBytes = 1_000_000;
  const maxRows = 1000;
  const maxColumns = 50;
  const maxCell = 20_000;
  if (typeof text !== "string" || text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) throw new RangeError("붙여넣기는 1MB 이내로 나누어 입력하세요.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new RangeError("허용되지 않는 제어문자가 있습니다.");
  const source = text.replace(/^\uFEFF/, "");
  if (!source.trim()) return [];
  let delimiter = ",";
  let quoted = false;
  let commas = 0;
  let tabs = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (!quoted) {
      if (char === "\t") tabs++;
      if (char === ",") commas++;
      if ((char === "\n" || char === "\r") && (commas || tabs)) break;
    }
  }
  if (tabs) delimiter = "\t";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let state: "plain" | "quoted" | "closed" = "plain";
  const pushCell = () => {
    if (cell.length > maxCell) throw new RangeError("한 칸은 20,000자 이내로 입력하세요.");
    row.push(cell);
    if (row.length > maxColumns) throw new RangeError("붙여넣기는 50열 이내로 입력하세요.");
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    if (rows.length > maxRows) throw new RangeError("붙여넣기는 1,000행 이내로 나누어 입력하세요.");
    row = [];
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (state === "quoted") {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; }
        else state = "closed";
      } else if (char === "\r") {
        if (source[i + 1] === "\n") i++;
        cell += "\n";
      } else cell += char;
    } else if (char === delimiter) {
      pushCell();
      state = "plain";
    } else if (char === "\r" || char === "\n") {
      pushRow();
      state = "plain";
      if (char === "\r" && source[i + 1] === "\n") i++;
    } else if (char === '"') {
      if (state === "plain" && cell && delimiter === "\t") cell += char;
      else {
        if (state !== "plain" || cell) throw new RangeError("따옴표는 칸 시작에 쓰고 내부 따옴표는 두 번 입력하세요.");
        state = "quoted";
      }
    } else {
      if (state === "closed") throw new RangeError("닫는 따옴표 뒤에는 구분자 또는 줄바꿈이 필요합니다.");
      cell += char;
    }
    if (cell.length > maxCell) throw new RangeError("한 칸은 20,000자 이내로 입력하세요.");
  }
  if (state === "quoted") throw new RangeError("닫히지 않은 따옴표가 있습니다.");
  if (cell || row.length || state === "closed" || !/[\r\n]$/.test(source)) pushRow();
  return rows;
}
