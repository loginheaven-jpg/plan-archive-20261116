import { afterEach, describe, expect, it, vi } from "vitest";
import { RRule } from "rrule";
import {
  copyEventToAnnualRow, newAnnualRow, parseAnnualDate, parsePastedTable,
  recurrenceLabel, rowToEventInput,
} from "../src/domain/annual";
import {
  expandEvents, firstRecurrenceDate, floatingDate, floatingRecurrenceRule,
  isOriginalRecurrenceDate,
} from "../src/domain/calendar";
import { buildICS } from "../src/domain/ics";
import { DEFAULT_CHURCH_SETTINGS } from "../src/domain/church-year";
import { eventSchema, recurrenceSchema } from "../src/server/validation";
import type { AnnualPlanRow, CalendarEvent, EventInput, RecurrenceRule } from "../src/domain/types";

// Entirely synthetic in-memory fixtures. No DB, auth, browser, or live data.
function input(patch: Partial<EventInput> = {}): EventInput {
  return { ...newAnnualRow("worship", 2026).input, title: "정기 기도회",
    startDate: "2026-10-10", endDate: "2026-10-10", ...patch };
}
function event(patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return { ...input(), id: "annual-unit-series", version: 2,
    status: "confirmed", visibility: "public", deleted: false, cancelReason: "",
    createdAt: "2026-01-01T00:00:00.000Z", createdBy: { id: "synthetic-person", name: "테스트" },
    updatedAt: null, updatedBy: null, exceptions: [], ...patch };
}
function row(text: string, patch: Partial<EventInput> = {}): AnnualPlanRow {
  return { ...newAnnualRow("worship", 2026), dateText: text, input: input(patch) };
}
function weekly(until: string | null = null, extra: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { frequency: "weekly", interval: 1, until, weekdays: [3], ...extra };
}
function unfolded(events: CalendarEvent[], year?: number): string {
  return buildICS(events, DEFAULT_CHURCH_SETTINGS, { year }).replace(/\r\n[ \t]/g, "");
}
function dates(e: CalendarEvent, from: string, to: string): string[] {
  return expandEvents([e], from, to).map(o => o.startDate);
}

afterEach(() => vi.restoreAllMocks());

describe("annual row defaults and deterministic dates", () => {
  it("creates distinct stable UUIDs with empty dates and public/department defaults", () => {
    const a = newAnnualRow("young", 2027);
    const b = newAnnualRow("young", 2027);
    expect(a.id).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ dateText: "", input: {
      organizationId: "young", startDate: "", endDate: "", allDay: true,
      startTime: null, endTime: null, audience: "departments", audienceIds: ["young"],
      visibility: "public", recurrence: null,
    } });
    expect(() => newAnnualRow("young", 2201)).toThrow();
    const r = row("1/10");
    const id = r.id;
    rowToEventInput(r, 2026);
    expect(r.id).toBe(id);
  });
  it.each(["1/10", "01/10", "2026-01-10", "1월 10일"])("parses %s without title validation", text => {
    expect(parseAnnualDate(text, 2026)).toMatchObject({ kind: "dated", dateKind: "date",
      startDate: "2026-01-10", endDate: "2026-01-10", hasTime: false, errors: [] });
  });
  it("honors explicit ISO years instead of silently replacing the year", () => {
    expect(parseAnnualDate("2027-02-15", 2026).startDate).toBe("2027-02-15");
    expect(parseAnnualDate("2026-12-31~2027-01-02", 2026)).toMatchObject({
      startDate: "2026-12-31", endDate: "2027-01-02", recurrence: null, errors: [],
    });
  });
  it.each(["1/10~1/12", "1/10부터 1/12까지"])("treats ordinary range %s as multi-day, not recurrence", text => {
    expect(rowToEventInput(row(text), 2026).input).toMatchObject({
      startDate: "2026-01-10", endDate: "2026-01-12", recurrence: null,
    });
  });
  it.each(["", "날짜 미정", "날짜미정", "7월 미정", "7월"])("keeps %s undated and unpublished", text => {
    expect(parseAnnualDate(text, 2026)).toMatchObject({ kind: "undated", undated: true, startDate: null, errors: [] });
    expect(rowToEventInput(row(text), 2026)).toMatchObject({ input: null, undated: true, errors: [] });
  });
  it.each(["13월 미정", "0월 미정", "13월", "0월", "2/29", "4/31", "2026-02-29", "2026-1-10", "12/31~1/2", "2201-01-01"])("rejects impossible/ambiguous date %s", text => {
    const parsed = parseAnnualDate(text, 2026);
    expect(parsed.kind).toBe("invalid");
    expect(parsed.startDate).toBeNull();
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(rowToEventInput(row(text), 2026).input).toBeNull();
  });
  it("accepts leap days in valid selected years", () => {
    expect(parseAnnualDate("2/29", 2024)).toMatchObject({ kind: "dated", startDate: "2024-02-29" });
  });
  it.each(["부활주일", "다음 주 수요일", "10월 중순", "매일 8시", "1/10 월수금", "1/10 오후8시~오후9시", "1/10부터 계속", "10/10부터 수요일"])("blocks unsupported grammar %s instead of guessing", text => {
    expect(parseAnnualDate(text, 2026).kind).toBe("invalid");
  });
  it("bounds expression size, controls, and selected year", () => {
    for (const text of ["1".repeat(501), "1/10\n", "1/10\u0000"]) expect(parseAnnualDate(text, 2026).kind).toBe("invalid");
    for (const year of [1899, 2201, 2026.5, NaN]) expect(parseAnnualDate("1/10", year).kind).toBe("invalid");
  });
});

describe("annual time confirmation and row validation", () => {
  it.each([["오전8시", "08:00"], ["오후8시", "20:00"], ["오전12시", "00:00"], ["오후12시", "12:00"], ["20:30", "20:30"], ["오후8시30분", "20:30"], ["08:00", "08:00"], ["12:00", "12:00"], ["12:30", "12:30"], ["00:00", "00:00"]])("parses explicit %s as %s", (text, expected) => {
    const parsed = parseAnnualDate(`1/10 ${text}`, 2026);
    expect(parsed).toMatchObject({ kind: "dated", allDay: false, startTime: expected, timeAmbiguous: false });
    expect(rowToEventInput(row(`1/10 ${text}`), 2026).errors).toEqual([]);
  });
  it.each(["8시", "12시", "8시30분", "12시30분"])("blocks unconfirmed %s", time => {
    const r = row(`10/10부터 계속 수요일${time}`);
    expect(parseAnnualDate(r.dateText, 2026).timeAmbiguous).toBe(true);
    expect(rowToEventInput(r, 2026)).toMatchObject({ input: null, undated: false });
    expect(rowToEventInput(r, 2026).errors.join(" ")).toContain("오전·오후");
  });
  it("lets confirmed row times select PM with a supplied end", () => {
    const r = row("10/10부터 계속 수요일8시", { startTime: "20:00", endTime: "21:30" });
    r.timeConfirmed = true;
    expect(rowToEventInput(r, 2026).input).toMatchObject({ startTime: "20:00", endTime: "21:30", allDay: false });
  });
  it("lets confirmed start-only selection default end to one hour later", () => {
    const r = row("1/10 8시", { startTime: "20:00", endTime: null });
    r.timeConfirmed = true;
    expect(rowToEventInput(r, 2026).input).toMatchObject({ startTime: "20:00", endTime: "21:00" });
  });
  it("does not let the UI override an explicit PM expression", () => {
    const r = row("1/10 오후8시", { startTime: "08:00", endTime: "09:00" });
    r.timeConfirmed = true;
    expect(rowToEventInput(r, 2026).input?.startTime).toBe("20:00");
  });
  it("rolls explicit and confirmed starts crossing midnight into the next date", () => {
    expect(parseAnnualDate("12/31 오후11시30분", 2026)).toMatchObject({
      startDate: "2026-12-31", endDate: "2027-01-01", startTime: "23:30", endTime: "00:30", endDayOffset: 1,
    });
    const r = row("12/31 11시30분", { startTime: "23:30", endTime: null });
    r.timeConfirmed = true;
    expect(rowToEventInput(r, 2026).input).toMatchObject({ endDate: "2027-01-01", endTime: "00:30" });
  });
  it.each(["24시", "오후13시", "오전0시", "20:99", "8시60분"])("rejects invalid time %s", time => {
    expect(parseAnnualDate(`1/10 ${time}`, 2026).kind).toBe("invalid");
  });
  it("retains configured times and recurrence for a plain date", () => {
    const r = row("10/10", { allDay: false, startTime: "20:00", endTime: "22:00", recurrence: weekly() });
    const before = structuredClone(r);
    expect(rowToEventInput(r, 2026).input).toMatchObject({ startTime: "20:00", endTime: "22:00", recurrence: weekly() });
    expect(r).toEqual(before);
  });
  it("defaults a missing configured timed end and retains an overnight end", () => {
    expect(rowToEventInput(row("12/31", { allDay: false, startTime: "23:30" }), 2026).input)
      .toMatchObject({ endDate: "2027-01-01", endTime: "00:30" });
    expect(rowToEventInput(row("1/10", { allDay: false, startTime: "23:00", endTime: "01:00" }), 2026).input?.endDate).toBe("2026-01-11");
  });
  it("allows an explicit 종일 override and clears configured times", () => {
    expect(rowToEventInput(row("1/10 종일", { allDay: false, startTime: "20:00", endTime: "21:00" }), 2026).input)
      .toMatchObject({ allDay: true, startTime: null, endTime: null });
  });
  it("validates title, audience, times, and duration before publication", () => {
    for (const patch of [{ title: " " }, { audienceIds: [] }, { allDay: false }, { endTime: "24:00", allDay: false, startTime: "20:00" }]) {
      expect(rowToEventInput(row("1/10", patch), 2026).input).toBeNull();
    }
    expect(rowToEventInput(row("1/1~2027-01-03"), 2026).input).toBeNull();
    expect(rowToEventInput(row("1/10", { title: "" }), 2026).errors).toContain("일정 이름을 입력하세요.");
  });
});

describe("annual repeat grammar and review", () => {
  it("parses a bounded weekly expression with inclusive until and PM time", () => {
    const parsed = parseAnnualDate("1/10부터 3/31까지 매주 수요일 오후8시", 2026);
    expect(parsed).toMatchObject({ kind: "dated", dateKind: "recurrence", startDate: "2026-01-10", endDate: "2026-01-10",
      recurrence: weekly("2026-03-31"), startTime: "20:00", endTime: "21:00", errors: [] });
    expect(parsed.warnings.join(" ")).toContain("2026-01-14");
  });
  it("does not invent a cutoff for explicit or bare open repeats", () => {
    for (const text of ["10/10부터 계속 수요일8시", "10/10부터 계속 매주 수요일", "매월 둘째 주일", "매주 수요일"]) {
      expect(parseAnnualDate(text, 2026).recurrence?.until).toBeNull();
      expect(parseAnnualDate(text, 2026).errors).toEqual([]);
    }
    expect(parseAnnualDate("매월 둘째 주일", 2026).warnings.join(" ")).toContain("1월 1일부터 계속");
  });
  it.each([["첫째", 1], ["둘째", 2], ["셋째", 3], ["넷째", 4], ["다섯째", 5], ["마지막", -1]])("parses monthly %s weekday", (name, nth) => {
    const parsed = parseAnnualDate(`1/1~12/31 매월 ${name} 주일`, 2026);
    expect(parsed.recurrence).toEqual({ frequency: "monthly", interval: 1, until: "2026-12-31", weekdays: [0], monthWeek: nth });
  });
  it("accepts monthly 주 weekday notation and bounded from/until", () => {
    expect(parseAnnualDate("1/1부터 3/31까지 매월 둘째 주 수요일", 2026).recurrence)
      .toEqual({ frequency: "monthly", interval: 1, until: "2026-03-31", weekdays: [3], monthWeek: 2 });
  });
  it("overrides configured recurrence when dateText contains a repeat", () => {
    const r = row("10/10부터 계속 수요일 오후8시", { recurrence: { frequency: "yearly", interval: 2, until: "2029-01-01" } });
    expect(rowToEventInput(r, 2026).input?.recurrence).toEqual(weekly());
  });
  it.each(["1/10부터 1/11까지 매주 수요일", "2/1~2/28 매월 다섯째 주일", "1/10~1/1 매주 수요일", "2026-01-01~2031-01-02 매주 수요일"])("rejects empty/reversed/over-five-year bounded repeats %s", text => {
    expect(parseAnnualDate(text, 2026).kind).toBe("invalid");
    expect(rowToEventInput(row(text), 2026).input).toBeNull();
  });
  it("labels open, bounded and nth patterns in Korean", () => {
    expect(recurrenceLabel(input({ recurrence: weekly() }))).toContain("계속 반복 (종료일 없음)");
    expect(recurrenceLabel(input({ recurrence: weekly("2026-12-31") }))).toContain("2026-12-31까지 (종료일 포함)");
    expect(recurrenceLabel(input({ recurrence: { frequency: "monthly", interval: 2, until: null, weekdays: [0], monthWeek: 2 } }))).toContain("2개월마다 둘째 주일");
    expect(recurrenceLabel(input({ recurrence: { frequency: "monthly", interval: 1, until: null, weekdays: [3], monthWeek: -1 } }))).toContain("매월 마지막 수요일");
    expect(recurrenceLabel(input())).toBe("반복 없음");
  });
});

describe("window-bounded open/nth recurrence and validation", () => {
  it("expands future windows without a fake year-end or five-year limit", () => {
    const e = event({ recurrence: weekly() });
    const matches = dates(e, "2037-01-01", "2037-01-31");
    expect(matches.length).toBeGreaterThan(0);
    for (const date of matches) {
      expect(date >= "2037-01-01" && date <= "2037-01-31").toBe(true);
      expect(floatingDate(date).getUTCDay()).toBe(3);
    }
    expect(eventSchema.safeParse(input({ recurrence: weekly() })).success).toBe(true);
  });
  it("starts at the first real matching day, even for interval greater than one", () => {
    const e = event({ recurrence: weekly(null, { interval: 2 }) });
    expect(firstRecurrenceDate(e)).toBe("2026-10-14");
    expect(dates(e, "2026-10-10", "2026-11-01")).toEqual(["2026-10-14", "2026-10-28"]);
    expect(isOriginalRecurrenceDate(e, "2026-10-10")).toBe(false);
    expect(isOriginalRecurrenceDate(e, "2026-10-14")).toBe(true);
  });
  it("includes the last repeating day and overlapping overnight end day", () => {
    const e = event({ recurrence: weekly("2026-10-28"), allDay: false, startTime: "23:00", endTime: "00:30", endDate: "2026-10-11" });
    expect(dates(e, "2026-10-28", "2026-10-29")).toEqual(["2026-10-28"]);
    expect(dates(e, "2026-10-29", "2026-10-29")).toEqual(["2026-10-28"]);
    expect(dates(e, "2026-10-30", "2026-11-01")).toEqual([]);
  });
  it("never calls unbounded all() for expansion, first-date checks, or ICS", () => {
    const all = vi.spyOn(RRule.prototype, "all");
    const e = event({ recurrence: weekly() });
    expandEvents([e], "2040-01-01", "2040-01-31");
    firstRecurrenceDate(e);
    buildICS([e], DEFAULT_CHURCH_SETTINGS, { year: 2040 });
    expect(all).not.toHaveBeenCalled();
  });
  it("handles nth Sundays and skips months with no fifth Sunday", () => {
    const e = event({ startDate: "2026-01-01", endDate: "2026-01-01",
      recurrence: { frequency: "monthly", interval: 1, until: "2026-05-31", weekdays: [0], monthWeek: 5 } });
    expect(dates(e, "2026-01-01", "2026-06-01")).toEqual(["2026-03-29", "2026-05-31"]);
    expect(firstRecurrenceDate(e)).toBe("2026-03-29");
  });
  it("handles last weekdays, without spilling into next month", () => {
    const e = event({ startDate: "2026-01-01", endDate: "2026-01-01",
      recurrence: { frequency: "monthly", interval: 1, until: "2026-03-31", weekdays: [3], monthWeek: -1 } });
    expect(dates(e, "2026-01-01", "2026-04-01")).toEqual(["2026-01-28", "2026-02-25", "2026-03-25"]);
  });
  it("aligns monthly nth first occurrence on/after range start", () => {
    const e = event({ startDate: "2026-01-20", endDate: "2026-01-20",
      recurrence: { frequency: "monthly", interval: 2, until: null, weekdays: [0], monthWeek: 2 } });
    expect(dates(e, "2026-01-01", "2026-05-31")).toEqual(["2026-02-08", "2026-04-12"]);
  });
  it("supports multiple selected nth weekdays and Sunday=0", () => {
    const e = event({ startDate: "2026-01-01", endDate: "2026-01-01",
      recurrence: { frequency: "monthly", interval: 1, until: "2026-01-31", weekdays: [0, 3], monthWeek: 2 } });
    expect(dates(e, "2026-01-01", "2026-01-31")).toEqual(["2026-01-11", "2026-01-14"]);
  });
  it("keeps finite five-year guard but requires no artificial horizon for open rules", () => {
    expect(eventSchema.safeParse(input({ recurrence: weekly("2031-10-10") })).success).toBe(true);
    expect(eventSchema.safeParse(input({ recurrence: weekly("2031-10-11") })).success).toBe(false);
    expect(eventSchema.safeParse(input({ recurrence: weekly() })).success).toBe(true);
    expect(eventSchema.safeParse(input({ recurrence: weekly("2026-10-11") })).success).toBe(false);
  });
  it("rejects invalid nth/weekday combinations while preserving legacy month-date rules", () => {
    const good = { frequency: "monthly", interval: 1, until: null, weekdays: [0], monthWeek: 2 };
    expect(recurrenceSchema.safeParse(good).success).toBe(true);
    for (const bad of [{ ...good, monthWeek: 0 }, { ...good, monthWeek: 6 }, { ...good, monthWeek: -2 },
      { ...good, monthWeek: 1.5 }, { ...good, weekdays: [] }, { ...good, weekdays: undefined },
      { ...good, frequency: "weekly" }, { ...good, frequency: "yearly" }, { ...good, monthWeek: undefined },
      { ...good, weekdays: [0, 0] }, { ...good, weekdays: [7] }, { ...good, weekdays: [0.5] }]) {
      expect(recurrenceSchema.safeParse(bad).success).toBe(false);
      expect(() => floatingRecurrenceRule({ startDate: "2026-01-01", recurrence: bad as RecurrenceRule })).toThrow();
    }
    expect(recurrenceSchema.safeParse({ frequency: "monthly", interval: 1, until: "2026-12-31" }).success).toBe(true);
    expect(recurrenceSchema.safeParse({ frequency: "yearly", interval: 1, until: null }).success).toBe(true);
  });
});

describe("ICS actual DTSTART, open RRULE and stable exceptions", () => {
  it("uses first matching timed DTSTART and no UNTIL for an open series", () => {
    const e = event({ recurrence: weekly(), allDay: false, startTime: "20:00", endTime: "21:00" });
    const text = unfolded([e], 2037);
    expect(text).toContain("DTSTART;TZID=Asia/Seoul:20261014T200000");
    expect(text).toContain("DTEND;TZID=Asia/Seoul:20261014T210000");
    expect(text).not.toContain("20261010T200000");
    expect(text).toContain("UID:annual-unit-series@plan.yebom.org");
    expect(text).toContain("RRULE:FREQ=WEEKLY");
    expect(text).not.toContain("UNTIL=");
    expect(text.split("BEGIN:VEVENT")).toHaveLength(2);
  });
  it("uses ordinal BYDAY and actual all-day master start/end", () => {
    const e = event({ startDate: "2026-01-01", endDate: "2026-01-02",
      recurrence: { frequency: "monthly", interval: 1, until: null, weekdays: [0], monthWeek: 2 } });
    const text = unfolded([e]);
    expect(text).toContain("BYDAY=+2SU");
    expect(text).toContain("DTSTART;VALUE=DATE:20260111");
    expect(text).toContain("DTEND;VALUE=DATE:20260113");
    expect(text).not.toContain("UNTIL=");
  });
  it("does not serialize a phantom master for legacy empty finite rules", () => {
    const text = unfolded([event({ recurrence: weekly("2026-10-11") })]);
    expect(text).not.toContain("BEGIN:VEVENT");
  });
  it("keeps finite inclusive UNTIL types and ordinal last-weekday BYDAY", () => {
    const e = event({ startDate: "2026-01-01", endDate: "2026-01-01", allDay: false, startTime: "20:00", endTime: "21:00",
      recurrence: { frequency: "monthly", interval: 1, until: "2026-03-25", weekdays: [3], monthWeek: -1 } });
    const text = unfolded([e]);
    expect(text).toContain("BYDAY=-1WE");
    expect(text).toContain("UNTIL=20260325T145959Z");
  });
  it("preserves moved/cancelled/private exceptions and ignores a phantom original date", () => {
    const e = event({ recurrence: weekly(), allDay: false, startTime: "20:00", endTime: "21:00", exceptions: [
      { date: "2026-10-10", patch: { title: "PHANTOM" }, cancelled: false, reason: "", updatedAt: "2026-10-01T00:00:00Z", updatedBy: null },
      { date: "2026-10-14", patch: { startDate: "2037-01-01", endDate: "2037-01-01", startTime: "21:00", endTime: "22:00" }, cancelled: false, reason: "", updatedAt: "2026-10-02T00:00:00Z", updatedBy: null },
      { date: "2026-10-21", patch: {}, cancelled: true, reason: "PRIVATE", updatedAt: "2026-10-03T00:00:00Z", updatedBy: null },
      { date: "2026-10-28", patch: { visibility: "department", title: "PRIVATE" }, cancelled: false, reason: "", updatedAt: "2026-10-04T00:00:00Z", updatedBy: null },
    ] });
    const moved = expandEvents([e], "2037-01-01", "2037-01-01");
    expect(moved.find(o => o.isException)).toMatchObject({ key: "annual-unit-series:2026-10-14", recurrenceDate: "2026-10-14" });
    const text = unfolded([e]);
    expect(text).toContain("RECURRENCE-ID;TZID=Asia/Seoul:20261014T200000");
    expect(text).toContain("RECURRENCE-ID;TZID=Asia/Seoul:20261021T200000");
    expect(text).toContain("EXDATE;TZID=Asia/Seoul:20261021T200000,20261028T200000");
    expect(text).toContain("STATUS:CANCELLED");
    expect(text).not.toContain("PHANTOM");
    expect(text).not.toContain("PRIVATE");
    expect(text).not.toContain("UNTIL=");
  });
});

describe("prior-year copy review without automatic creation or correction", () => {
  it("copies only input fields into a new UUID and deep-clones recurrence/audience", () => {
    const e = event({ recurrence: weekly("2026-12-31"), exceptions: [
      { date: "2026-10-14", patch: { title: "old override" }, cancelled: false, reason: "", updatedAt: "2026-10-01T00:00:00Z", updatedBy: null },
    ] });
    const before = structuredClone(e);
    const r = copyEventToAnnualRow(e, 2027);
    expect(r.id).not.toBe(e.id);
    expect(r.sourceEventId).toBe(e.id);
    expect(r.input).toMatchObject({ startDate: "2027-10-10", recurrence: { until: "2027-12-31", weekdays: [3] } });
    for (const field of ["id", "version", "createdAt", "createdBy", "updatedAt", "updatedBy", "exceptions", "deleted", "cancelReason"]) expect(r.input).not.toHaveProperty(field);
    expect(rowToEventInput(r, 2027).warnings.join(" ")).toContain("교회력");
    r.input.audienceIds.push("young");
    r.input.recurrence!.weekdays!.push(0);
    expect(e).toEqual(before);
  });
  it("preserves an invalid copied leap day and blocks publication without rolling", () => {
    const r = copyEventToAnnualRow(event({ startDate: "2024-02-29", endDate: "2024-02-29" }), 2025);
    expect(r.dateText).toBe("2025-02-29");
    expect(r.input.startDate).toBe("2025-02-29");
    expect(rowToEventInput(r, 2025)).toMatchObject({ input: null, undated: false });
    expect(rowToEventInput(r, 2025).errors.join(" ")).toContain("보정하지");
  });
  it("retains cross-year span and recurrence year offsets", () => {
    const r = copyEventToAnnualRow(event({ startDate: "2025-12-31", endDate: "2026-01-02",
      recurrence: { frequency: "yearly", interval: 1, until: "2027-12-31" } }), 2027);
    expect(r.dateText).toBe("2027-12-31~2028-01-02");
    expect(r.input.recurrence?.until).toBe("2029-12-31");
  });
  it("retains open/nth rules and uses an optional organization override", () => {
    const e = event({ recurrence: { frequency: "monthly", interval: 1, until: null, weekdays: [0], monthWeek: 2 } });
    const r = copyEventToAnnualRow(e, 2027, "young");
    expect(r.input.organizationId).toBe("young");
    expect(r.input.recurrence).toEqual(e.recurrence);
    expect(r.input.recurrence?.until).toBeNull();
  });
});

describe("bounded CSV/TSV parsing as literal data", () => {
  it("parses ordinary TSV with CRLF and trailing empty cells", () => {
    expect(parsePastedTable("날짜\t제목\t장소\r\n1/10\t기도회\t\r\n"))
      .toEqual([["날짜", "제목", "장소"], ["1/10", "기도회", ""]]);
  });
  it("parses CSV quotes, commas, doubled quotes and multiline CRLF", () => {
    expect(parsePastedTable('날짜,제목,안내\r\n1/10,"모임, 식사","첫 줄\r\n둘째 ""안내"""\r\n'))
      .toEqual([["날짜", "제목", "안내"], ["1/10", "모임, 식사", '첫 줄\n둘째 "안내"']]);
  });
  it("does not mis-detect quoted commas or tabs as separators", () => {
    expect(parsePastedTable('"제목,부제"\t날짜\n"모임, 식사"\t1/10')).toEqual([["제목,부제", "날짜"], ["모임, 식사", "1/10"]]);
    expect(parsePastedTable('제목,"메모\t탭"\n모임,"내용\t안내"')).toEqual([["제목", "메모\t탭"], ["모임", "내용\t안내"]]);
  });
  it("preserves formulas, code-like strings, and quotes in unquoted TSV formulas without evaluation", () => {
    expect(parsePastedTable('1/10\t=SUM(1,2)\t=HYPERLINK("https://example.test","제목")\n1/11\t+123\t@value'))
      .toEqual([["1/10", "=SUM(1,2)", '=HYPERLINK("https://example.test","제목")'], ["1/11", "+123", "@value"]]);
    expect(parsePastedTable('"=SUM(1,2)","<script>alert(1)</script>"')).toEqual([["=SUM(1,2)", "<script>alert(1)</script>"]]);
  });
  it("preserves cells and blank interior rows while accepting BOM and empty input", () => {
    expect(parsePastedTable("\uFEFF1/10\t  모임  \n\n1/11\t끝")).toEqual([["1/10", "  모임  "], [""], ["1/11", "끝"]]);
    expect(parsePastedTable(" \r\n")).toEqual([]);
    expect(parsePastedTable('""')).toEqual([[""]]);
    expect(parsePastedTable("1/10," )).toEqual([["1/10", ""]]);
  });
  it.each(['"unfinished', 'a,"closed"extra', 'a,unquoted"quote', '"closed""'])("rejects malformed CSV %s", text => {
    expect(() => parsePastedTable(text)).toThrow();
  });
  it("bounds bytes, rows, columns, cells, and controls", () => {
    for (const text of ["가".repeat(340_000), "a".repeat(20_001), "a\n".repeat(1001), Array(51).fill("a").join("\t"), "a\u0000"]) {
      expect(() => parsePastedTable(text)).toThrow(RangeError);
    }
    expect(parsePastedTable("a\n".repeat(1000))).toHaveLength(1000);
    expect(parsePastedTable(Array(50).fill("a").join("\t"))[0]).toHaveLength(50);
  });
});
