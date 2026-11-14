import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDaysISO, dateClickAction, dateLabel, expandEvents, filterOccurrences,
  occurrencesOnDate, timeLabel, todayKST,
} from "../src/domain/calendar";
import { churchYear, DEFAULT_CHURCH_SETTINGS } from "../src/domain/church-year";
import { buildICS } from "../src/domain/ics";
import { canCreate, canEditEvent, canReadEvent, publicEvent } from "../src/domain/permissions";
import type { Actor, CalendarEvent, ChurchSettings, EventException, Occurrence } from "../src/domain/types";

// Synthetic, in-memory unit fixtures only. No session identities or database writes.
function event(patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "unit-event", version: 3, title: "일정 테스트", organizationId: "worship",
    startDate: "2026-04-05", endDate: "2026-04-05", allDay: true,
    startTime: null, endTime: null, audience: "departments", audienceIds: ["worship"],
    visibility: "public", locationId: null, location: "장소 테스트", description: "공개 안내",
    internalNote: "PRIVATE-NOTE", recurrence: null, status: "confirmed", cancelReason: "",
    deleted: false, createdAt: "2026-03-01T01:02:03.000Z", createdBy: { id: "PRIVATE-CREATOR-ID", name: "PRIVATE-CREATOR-NAME" },
    updatedAt: "2026-03-02T02:03:04.000Z", updatedBy: { id: "PRIVATE-UPDATER-ID", name: "PRIVATE-UPDATER-NAME" },
    exceptions: [], ...patch,
  };
}

function weekly(patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return event({ recurrence: { frequency: "weekly", interval: 1, until: "2026-04-26", weekdays: [0] }, ...patch });
}

function exception(date: string, patch: EventException["patch"] = {}, cancelled = false): EventException {
  return {
    date, patch, cancelled, reason: "PRIVATE-CHANGE-REASON", updatedAt: "2026-03-03T03:04:05.000Z",
    updatedBy: { id: "PRIVATE-EXCEPTION-ID", name: "PRIVATE-EXCEPTION-NAME" },
  };
}

function actor(role: Actor["role"], departmentIds: Actor["departmentIds"] = []): Actor {
  return { id: "unit-approved-actor", name: "unit-approved-actor", role, departmentIds };
}

function settings(patch: Partial<ChurchSettings> = {}): ChurchSettings {
  return { ...structuredClone(DEFAULT_CHURCH_SETTINGS), ...patch };
}

function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

function components(ics: string): string[] {
  return unfold(ics).split("BEGIN:VEVENT\r\n").slice(1).map(part => part.split("END:VEVENT")[0]);
}

function onDate(events: CalendarEvent[], date: string): Occurrence[] {
  return expandEvents(events, date, date);
}

afterEach(() => { vi.useRealTimers(); });

describe("Korean floating dates", () => {
  it("uses the real Korean date on both sides of UTC 15:00", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T14:59:59.000Z"));
    expect(todayKST()).toBe("2026-04-05");
    vi.setSystemTime(new Date("2026-04-05T15:00:00.000Z"));
    expect(todayKST()).toBe("2026-04-06");
  });

  it("adds across leap days and year boundaries without local timezone drift", () => {
    expect(addDaysISO("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysISO("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("rejects invalid ISO dates and fractional offsets", () => {
    expect(() => addDaysISO("2026-02-29", 1)).toThrow(RangeError);
    expect(() => addDaysISO("2026-4-5", 1)).toThrow(RangeError);
    expect(() => addDaysISO("2026-04-05", 0.5)).toThrow(RangeError);
  });

  it("provides convenient Korean date and time labels", () => {
    expect(dateLabel("2026-04-05")).toBe("2026년 4월 5일 (일)");
    expect(timeLabel(event())).toBe("종일");
    expect(timeLabel(event({ allDay: false, startTime: "09:00", endTime: "10:30" }))).toBe("09:00–10:30");
    expect(timeLabel(event({ allDay: false }))).toBe("시간 미정");
  });
});

describe("inclusive overlap and shared calendar click rules", () => {
  it("includes both ends of a multi-day event and all intermediate dates", () => {
    const span = event({ startDate: "2026-04-03", endDate: "2026-04-07" });
    for (const date of ["2026-04-03", "2026-04-05", "2026-04-07"]) {
      expect(onDate([span], date)).toHaveLength(1);
    }
    expect(onDate([span], "2026-04-08")).toHaveLength(0);
  });

  it("includes timed events crossing midnight on both dates", () => {
    const span = event({ allDay: false, startDate: "2026-04-05", endDate: "2026-04-06", startTime: "23:00", endTime: "01:00" });
    expect(onDate([span], "2026-04-05")).toHaveLength(1);
    expect(onDate([span], "2026-04-06")).toHaveLength(1);
  });

  it("returns create or empty for zero visible actual events", () => {
    expect(dateClickAction([], "2026-04-05", true)).toEqual({ type: "create" });
    expect(dateClickAction([], "2026-04-05", false)).toEqual({ type: "empty" });
  });

  it("goes directly to detail for one event even with duplicate input", () => {
    const occurrences = onDate([event()], "2026-04-05");
    expect(dateClickAction([...occurrences, ...occurrences], "2026-04-05", false))
      .toEqual({ type: "detail", occurrence: occurrences[0] });
  });

  it("returns only the clicked day's events when there are multiple", () => {
    const occurrences = expandEvents([
      event(), event({ id: "second", startDate: "2026-04-04", endDate: "2026-04-06" }),
      event({ id: "different-day", startDate: "2026-04-08", endDate: "2026-04-08" }),
    ], "2026-04-01", "2026-04-30");
    const action = dateClickAction(occurrences, "2026-04-05", true);
    expect(action.type).toBe("list");
    if (action.type === "list") expect(action.occurrences.map(item => item.id).sort()).toEqual(["second", "unit-event"]);
  });

  it("never counts church-year markers as actual events", () => {
    const markers = churchYear(2026) as unknown as Occurrence[];
    expect(occurrencesOnDate(markers, "2026-04-05")).toEqual([]);
    expect(dateClickAction(markers, "2026-04-05", true)).toEqual({ type: "create" });
  });

  it("deduplicates expanded occurrence identities", () => {
    expect(onDate([event(), event()], "2026-04-05")).toHaveLength(1);
    expect(onDate([event()], "2026-04-05")[0].key).toBe("unit-event:2026-04-05");
  });

  it("returns no occurrences for an inverted range or invalid duration", () => {
    expect(expandEvents([event()], "2026-04-10", "2026-04-01")).toEqual([]);
    expect(onDate([event({ endDate: "2026-04-04" })], "2026-04-05")).toEqual([]);
  });
});

describe("bounded recurrence and validated exceptions", () => {
  it("uses JavaScript Sunday=0 and includes the final until date", () => {
    const input = weekly({ recurrence: { frequency: "weekly", interval: 1, until: "2026-04-19", weekdays: [0] } });
    expect(expandEvents([input], "2026-04-01", "2026-05-01").map(item => item.startDate))
      .toEqual(["2026-04-05", "2026-04-12", "2026-04-19"]);
  });

  it("honors multiple weekdays and two-week intervals", () => {
    const multiple = weekly({ recurrence: { frequency: "weekly", interval: 1, until: "2026-04-15", weekdays: [0, 3] } });
    expect(expandEvents([multiple], "2026-04-01", "2026-05-01").map(item => item.startDate))
      .toEqual(["2026-04-05", "2026-04-08", "2026-04-12", "2026-04-15"]);
    const alternate = weekly({ recurrence: { frequency: "weekly", interval: 2, until: "2026-04-26", weekdays: [0] } });
    expect(expandEvents([alternate], "2026-04-01", "2026-05-01").map(item => item.startDate))
      .toEqual(["2026-04-05", "2026-04-19"]);
  });

  it("skips nonexistent monthly dates instead of drifting into the next month", () => {
    const monthly = event({ startDate: "2026-01-31", endDate: "2026-01-31", recurrence: { frequency: "monthly", interval: 1, until: "2026-05-31" } });
    expect(expandEvents([monthly], "2026-01-01", "2026-06-30").map(item => item.startDate))
      .toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("preserves leap-day yearly recurrences", () => {
    const leap = event({ startDate: "2024-02-29", endDate: "2024-02-29", recurrence: { frequency: "yearly", interval: 1, until: "2032-02-29" } });
    expect(expandEvents([leap], "2024-01-01", "2032-12-31").map(item => item.startDate))
      .toEqual(["2024-02-29", "2028-02-29", "2032-02-29"]);
  });

  it("finds recurring multi-day spans beginning before the requested window", () => {
    const spans = weekly({ endDate: "2026-04-07" });
    const occurrences = onDate([spans], "2026-04-14");
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].startDate).toBe("2026-04-12");
    expect(occurrences[0].endDate).toBe("2026-04-14");
  });

  it("finds a moved exception whose original date is outside the query", () => {
    const moved = weekly({ endDate: "2026-04-07", exceptions: [exception("2026-04-05", { startDate: "2026-05-01", title: "변경 회차" })] });
    const result = onDate([moved], "2026-05-02");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startDate: "2026-05-01", endDate: "2026-05-03", recurrenceDate: "2026-04-05", key: "unit-event:2026-04-05", isException: true, title: "변경 회차" });
    expect(onDate([moved], "2026-04-05")).toHaveLength(0);
  });

  it("supports a move backwards before DTSTART and keeps the original identity", () => {
    const moved = weekly({ exceptions: [exception("2026-04-19", { startDate: "2026-03-01", endDate: "2026-03-01" })] });
    expect(onDate([moved], "2026-03-01")[0].recurrenceDate).toBe("2026-04-19");
  });

  it("uses an explicit exception end date instead of the inherited duration", () => {
    const moved = weekly({ endDate: "2026-04-07", exceptions: [exception("2026-04-12", { startDate: "2026-05-01", endDate: "2026-05-01" })] });
    expect(onDate([moved], "2026-05-01")[0].endDate).toBe("2026-05-01");
    expect(onDate([moved], "2026-05-02")).toHaveLength(0);
  });

  it("ignores exception dates outside the original recurrence, including malformed dates", () => {
    const invalid = weekly({ exceptions: [
      exception("2026-04-06", { startDate: "2026-05-01", endDate: "2026-05-01" }),
      exception("2026-03-29", { startDate: "2026-05-01", endDate: "2026-05-01" }),
      exception("2026-05-03", { startDate: "2026-05-01", endDate: "2026-05-01" }),
      exception("2026-02-30", { startDate: "2026-05-01", endDate: "2026-05-01" }),
    ] });
    expect(onDate([invalid], "2026-05-01")).toHaveLength(0);
    expect(onDate([invalid], "2026-04-05")).toHaveLength(1);
  });

  it("hides cancelled exceptions by default and preserves their status when requested", () => {
    const cancelled = weekly({ exceptions: [exception("2026-04-12", {}, true)] });
    expect(onDate([cancelled], "2026-04-12")).toHaveLength(0);
    expect(expandEvents([cancelled], "2026-04-12", "2026-04-12", true)[0])
      .toMatchObject({ status: "cancelled", isException: true });
  });

  it("includes cancelled moved occurrences only when requested", () => {
    const cancelled = weekly({ exceptions: [exception("2026-04-12", { startDate: "2026-05-01" }, true)] });
    expect(onDate([cancelled], "2026-05-01")).toEqual([]);
    expect(expandEvents([cancelled], "2026-05-01", "2026-05-01", true)).toHaveLength(1);
  });

  it("does not let an exception reactivate a cancelled series", () => {
    const cancelled = weekly({ status: "cancelled", exceptions: [exception("2026-04-12", { status: "confirmed" })] });
    expect(onDate([cancelled], "2026-04-12")).toEqual([]);
    expect(expandEvents([cancelled], "2026-04-12", "2026-04-12", true)[0].status).toBe("cancelled");
  });

  it("keeps deleted events out of the calendar even when showing cancellations", () => {
    expect(expandEvents([event({ deleted: true })], "2026-04-05", "2026-04-05", true)).toEqual([]);
  });

  it("does not mutate the original event or exception when expanding", () => {
    const input = weekly({ exceptions: [exception("2026-04-12", { startDate: "2026-05-01" })] });
    const copy = structuredClone(input);
    expandEvents([input], "2026-01-01", "2026-12-31");
    expect(input).toEqual(copy);
  });
});

describe("organization and search filters", () => {
  const fixtures = () => onDate([
    event({ id: "own", organizationId: "young", status: "tentative" }),
    event({ id: "all", audience: "all", title: "ALL Worship" }),
    event({ id: "admin-only", organizationId: "admin", audience: "departments" }),
  ], "2026-04-05");

  it("returns empty when no organizations are selected, even for all audience", () => {
    expect(filterOccurrences(fixtures(), { selectedIds: [], query: "", includeAllAudience: true })).toEqual([]);
  });

  it("uses owner OR all audience, not an admin organization shortcut", () => {
    const filtered = filterOccurrences(fixtures(), { selectedIds: ["young"], query: "", includeAllAudience: true });
    expect(filtered.map(item => item.id).sort()).toEqual(["all", "own"]);
    expect(filtered.find(item => item.id === "own")?.status).toBe("tentative");
  });

  it("requires the selected owner when all-audience inclusion is off", () => {
    expect(filterOccurrences(fixtures(), { selectedIds: ["young"], query: "", includeAllAudience: false }).map(item => item.id)).toEqual(["own"]);
  });

  it("searches public title, location and description case-insensitively, never internal notes", () => {
    const all = fixtures();
    for (const query of ["all worship", "장소 테스트", "공개 안내"]) {
      expect(filterOccurrences(all, { selectedIds: ["worship", "young", "admin"], query, includeAllAudience: false }).length).toBeGreaterThan(0);
    }
    expect(filterOccurrences(all, { selectedIds: ["worship", "young", "admin"], query: "PRIVATE-NOTE", includeAllAudience: true })).toEqual([]);
  });
});

describe("approved-actor authorization and public projections", () => {
  it("allows public events to everyone but members events only to approved actors", () => {
    expect(canReadEvent(event(), null)).toBe(true);
    expect(canReadEvent(event({ visibility: "members" }), null)).toBe(false);
    expect(canReadEvent(event({ visibility: "members" }), actor("viewer"))).toBe(true);
  });

  it("allows department reads to its assigned actor or an admin", () => {
    const input = event({ visibility: "department" });
    expect(canReadEvent(input, actor("viewer", ["worship"]))).toBe(true);
    expect(canReadEvent(input, actor("editor", ["young"]))).toBe(false);
    expect(canReadEvent(input, actor("admin"))).toBe(true);
    expect(canReadEvent(input, null)).toBe(false);
  });

  it("allows editing only to admins or editors granted the owner department", () => {
    expect(canEditEvent(event(), actor("admin"))).toBe(true);
    expect(canEditEvent(event(), actor("editor", ["worship"]))).toBe(true);
    expect(canEditEvent(event(), actor("editor", ["young"]))).toBe(false);
    expect(canEditEvent(event(), actor("viewer", ["worship"]))).toBe(false);
    expect(canEditEvent(event(), null)).toBe(false);
  });

  it("requires actual creation grants and never gives a viewer write access", () => {
    expect(canCreate(actor("admin"))).toBe(true);
    expect(canCreate(actor("editor", ["worship"]))).toBe(true);
    expect(canCreate(actor("editor"))).toBe(false);
    expect(canCreate(actor("viewer", ["worship"]))).toBe(false);
    expect(canCreate(null)).toBe(false);
  });

  it("removes internal notes, authors and exception actor snapshots without changing the source", () => {
    const input = weekly({ exceptions: [exception("2026-04-12", { internalNote: "PRIVATE-PATCH-NOTE", title: "공개 변경" })] });
    const copy = structuredClone(input);
    const projected = publicEvent(input);
    const text = JSON.stringify(projected);
    for (const secret of ["PRIVATE-NOTE", "PRIVATE-PATCH-NOTE", "PRIVATE-CREATOR", "PRIVATE-UPDATER", "PRIVATE-EXCEPTION", "internalNote", "createdBy", "updatedBy"]) {
      expect(text).not.toContain(secret);
    }
    expect(projected.exceptions[0].patch.title).toBe("공개 변경");
    expect(input).toEqual(copy);
    projected.audienceIds.push("young");
    projected.recurrence?.weekdays?.push(3);
    expect(input).toEqual(copy);
  });

  it("redacts a now-private replacement and hides the formerly public original", () => {
    const input = weekly({ exceptions: [exception("2026-04-12", {
      visibility: "department", title: "PRIVATE-TITLE", location: "PRIVATE-LOCATION",
      description: "PRIVATE-DESCRIPTION", startDate: "2027-06-01", endDate: "2027-06-02",
    })] });
    const projected = publicEvent(input);
    expect(projected.exceptions[0]).toMatchObject({ cancelled: true, reason: "", patch: { visibility: "department" } });
    const text = JSON.stringify(projected);
    for (const secret of ["PRIVATE-TITLE", "PRIVATE-LOCATION", "PRIVATE-DESCRIPTION", "2027-06-01", "2027-06-02", "PRIVATE-CHANGE-REASON"]) {
      expect(text).not.toContain(secret);
    }
    expect(input.exceptions[0].cancelled).toBe(false);
    expect(expandEvents([projected as unknown as CalendarEvent], "2026-04-12", "2026-04-12")).toEqual([]);
  });

  it("allowlists accidental private runtime fields at every structured layer", () => {
    const input = weekly();
    Object.assign(input, { privateToken: "PRIVATE-RUNTIME-TOKEN" });
    Object.assign(input.recurrence!, { privateToken: "PRIVATE-RECURRENCE-TOKEN" });
    input.exceptions = [exception("2026-04-12")];
    Object.assign(input.exceptions[0], { privateToken: "PRIVATE-EXCEPTION-TOKEN" });
    Object.assign(input.exceptions[0].patch, { privateToken: "PRIVATE-PATCH-TOKEN" });
    expect(JSON.stringify(publicEvent(input))).not.toContain("TOKEN");
  });
});

describe("Western Gregorian church-year references", () => {
  const dateFor = (year: number, name: string, options = settings({ ashWednesday: true, ascension: true })) =>
    churchYear(year, options).find(day => day.name === name)?.date;

  it.each([
    [2026, "2026-04-05", "2026-02-18", "2026-05-14", "2026-05-24"],
    [2027, "2027-03-28", "2027-02-10", "2027-05-06", "2027-05-16"],
  ])("matches independently researched Easter and relative dates for %s", (year, easter, ash, ascension, pentecost) => {
    expect(dateFor(Number(year), "부활주일")).toBe(easter);
    expect(dateFor(Number(year), "사순절 시작·재의 수요일")).toBe(ash);
    expect(dateFor(Number(year), "승천일")).toBe(ascension);
    expect(dateFor(Number(year), "성령강림주일")).toBe(pentecost);
  });

  it("labels the Monday-start Holy Week convention and Good Friday", () => {
    expect(dateFor(2026, "종려주일·고난주일")).toBe("2026-03-29");
    expect(dateFor(2026, "성금요일")).toBe("2026-04-03");
    const week = churchYear(2026).find(day => day.name === "고난주간");
    expect(week).toMatchObject({ date: "2026-03-30", kind: "season" });
    expect(week?.note).toContain("월요일부터 토요일(2026-04-04)까지");
  });

  it("has four Advent Sundays, strictly before Christmas even when it is Sunday", () => {
    expect(churchYear(2026).filter(day => day.name.startsWith("대림절")).map(day => day.date))
      .toEqual(["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"]);
    expect(churchYear(2027).filter(day => day.name.startsWith("대림절")).map(day => day.date))
      .toEqual(["2027-11-28", "2027-12-05", "2027-12-12", "2027-12-19"]);
    expect(churchYear(2022).filter(day => day.name.startsWith("대림절")).map(day => day.date))
      .toEqual(["2022-11-27", "2022-12-04", "2022-12-11", "2022-12-18"]);
  });

  it("does not assert unconfirmed thanksgiving or optional observances by default", () => {
    const days = churchYear(2026);
    expect(DEFAULT_CHURCH_SETTINGS.thanksgiving.enabled).toBe(false);
    for (const name of ["추수감사주일", "종교개혁주일", "신년주일", "송구영신", "승천일", "사순절 시작·재의 수요일"]) {
      expect(days.some(day => day.name === name)).toBe(false);
    }
    expect(days.every(day => day.note.includes("교회력 참고 · 실제 행사/휴무 아님"))).toBe(true);
  });

  it("supports an explicitly configured nth Sunday or fixed thanksgiving date", () => {
    const nth = settings({ thanksgiving: { enabled: true, rule: "nthSunday", month: 11, nth: 3, day: 15 } });
    expect(dateFor(2026, "추수감사주일", nth)).toBe("2026-11-15");
    expect(dateFor(2027, "추수감사주일", nth)).toBe("2027-11-21");
    const fixed = settings({ thanksgiving: { enabled: true, rule: "fixedDate", month: 10, nth: 1, day: 9 } });
    expect(dateFor(2026, "추수감사주일", fixed)).toBe("2026-10-09");
    expect(churchYear(2026, fixed).find(day => day.name === "추수감사주일")?.note).toContain("주일과 다를 수 있음");
  });

  it("does not roll nonexistent fifth Sundays or invalid fixed dates into another month", () => {
    const impossible = settings({ thanksgiving: { enabled: true, rule: "nthSunday", month: 2, nth: 5, day: 1 } });
    expect(dateFor(2026, "추수감사주일", impossible)).toBeUndefined();
    const invalid = settings({ thanksgiving: { enabled: true, rule: "fixedDate", month: 2, nth: 1, day: 30 } });
    expect(dateFor(2026, "추수감사주일", invalid)).toBeUndefined();
  });

  it("distinguishes optional Sunday conventions from their fixed commemorative dates", () => {
    const options = settings({ reformationSunday: true, newYear: true, yearEnd: true });
    expect(dateFor(2026, "종교개혁주일", options)).toBe("2026-10-25");
    expect(dateFor(2027, "종교개혁주일", options)).toBe("2027-10-31");
    expect(dateFor(2026, "신년주일", options)).toBe("2026-01-04");
    expect(dateFor(2026, "송구영신", options)).toBe("2026-12-31");
    for (const name of ["종교개혁주일", "신년주일", "송구영신"]) {
      expect(churchYear(2026, options).find(day => day.name === name)?.note).toContain("선택 관행(교회설정 기준)");
    }
  });
});

describe("public RFC5545 subscription serialization", () => {
  it("exports only public events and supports owner/all-audience selection", () => {
    const inputs = [
      event({ id: "public-own", organizationId: "young" }),
      event({ id: "public-all", audience: "all" }),
      event({ id: "public-other" }),
      event({ id: "PRIVATE-MEMBER", visibility: "members" }),
      event({ id: "PRIVATE-DEPARTMENT", visibility: "department" }),
    ];
    const text = unfold(buildICS(inputs, settings(), { organizationIds: ["young"], includeAllAudience: true }));
    expect(text).toContain("UID:public-own@plan.yebom.org");
    expect(text).toContain("UID:public-all@plan.yebom.org");
    expect(text).not.toContain("public-other");
    expect(text).not.toContain("PRIVATE-MEMBER");
    expect(text).not.toContain("PRIVATE-DEPARTMENT");
    expect(components(buildICS(inputs, settings(), { organizationIds: [], includeAllAudience: true }))).toHaveLength(0);
  });

  it("uses exclusive all-day end dates and stable UIDs with audit timestamps and sequence", () => {
    const text = unfold(buildICS([event({ endDate: "2026-04-07" })], settings()));
    expect(text).toContain("UID:unit-event@plan.yebom.org\r\n");
    expect(text).toContain("DTSTART;VALUE=DATE:20260405");
    expect(text).toContain("DTEND;VALUE=DATE:20260408");
    expect(text).toContain("CREATED:20260301T010203Z");
    expect(text).toContain("LAST-MODIFIED:20260302T020304Z");
    expect(text).toContain("SEQUENCE:3");
    expect(text).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    expect(unfold(buildICS([event({ title: "Changed", version: 4 })], settings()))).toContain("UID:unit-event@plan.yebom.org");
  });

  it("keeps Korean timed events and overnight ends in a declared fixed-offset timezone", () => {
    const input = event({ allDay: false, startTime: "23:30", endTime: "01:00", endDate: "2026-04-06" });
    const text = unfold(buildICS([input], settings()));
    expect(text).toContain("BEGIN:VTIMEZONE");
    expect(text).toContain("TZOFFSETTO:+0900");
    expect(text).toContain("DTSTART;TZID=Asia/Seoul:20260405T233000");
    expect(text).toContain("DTEND;TZID=Asia/Seoul:20260406T010000");
  });

  it("serializes bounded DATE RRULEs, not expanded thousands of events", () => {
    const recurring = weekly({ recurrence: { frequency: "weekly", interval: 1, until: "2031-04-05", weekdays: [0] } });
    const feed = buildICS([recurring], settings());
    expect(components(feed)).toHaveLength(1);
    expect(unfold(feed)).toContain("RRULE:FREQ=WEEKLY");
    expect(unfold(feed)).toContain("UNTIL=20310405");
    expect(unfold(feed)).toContain("BYDAY=SU");
    expect(feed.length).toBeLessThan(2000);
  });

  it("uses a UTC UNTIL containing the final Korean date for timed recurrences", () => {
    const recurring = weekly({ allDay: false, startTime: "22:00", endTime: "23:00" });
    const text = unfold(buildICS([recurring], settings()));
    expect(text).toContain("UNTIL=20260426T145959Z");
  });

  it("emits moved overrides with the same series UID and original RECURRENCE-ID", () => {
    const moved = weekly({ exceptions: [exception("2026-04-12", { startDate: "2026-05-01", endDate: "2026-05-02", title: "변경 일정" })] });
    const parts = components(buildICS([moved], settings()));
    expect(parts).toHaveLength(2);
    expect(parts.every(part => part.includes("UID:unit-event@plan.yebom.org"))).toBe(true);
    expect(parts[1]).toContain("RECURRENCE-ID;VALUE=DATE:20260412");
    expect(parts[1]).toContain("DTSTART;VALUE=DATE:20260501");
    expect(parts[1]).toContain("DTEND;VALUE=DATE:20260503");
    expect(parts[0]).toContain("LAST-MODIFIED:20260303T030405Z");
  });

  it("uses original timed recurrence values even when the replacement time changes", () => {
    const moved = weekly({ allDay: false, startTime: "09:00", endTime: "10:00", exceptions: [exception("2026-04-12", { startTime: "11:00", endTime: "12:00" })] });
    const parts = components(buildICS([moved], settings()));
    expect(parts[1]).toContain("RECURRENCE-ID;TZID=Asia/Seoul:20260412T090000");
    expect(parts[1]).toContain("DTSTART;TZID=Asia/Seoul:20260412T110000");
  });

  it("exports cancelled and deleted public series as cancellations", () => {
    const parts = components(buildICS([event({ id: "cancelled", status: "cancelled" }), event({ id: "deleted", deleted: true })], settings()));
    expect(parts).toHaveLength(2);
    expect(parts.every(part => part.includes("STATUS:CANCELLED"))).toBe(true);
  });

  it("exports cancelled exceptions as EXDATE plus a cancelled override", () => {
    const cancelled = weekly({ exceptions: [exception("2026-04-12", {}, true)] });
    const parts = components(buildICS([cancelled], settings()));
    expect(parts[0]).toContain("EXDATE;VALUE=DATE:20260412");
    expect(parts[1]).toContain("RECURRENCE-ID;VALUE=DATE:20260412");
    expect(parts[1]).toContain("STATUS:CANCELLED");
  });

  it("does not export an invalid exception date", () => {
    const input = weekly({ exceptions: [exception("2026-04-06", { title: "INVALID-EXCEPTION-TITLE" })] });
    const feed = buildICS([input], settings());
    expect(components(feed)).toHaveLength(1);
    expect(feed).not.toContain("INVALID-EXCEPTION-TITLE");
  });

  it("hides private exception data and excludes the now-private original occurrence", () => {
    const input = weekly({ exceptions: [exception("2026-04-12", { visibility: "members", title: "PRIVATE-EXCEPTION-TITLE", description: "PRIVATE-DESCRIPTION", location: "PRIVATE-LOCATION" })] });
    const text = unfold(buildICS([input], settings()));
    expect(text).toContain("EXDATE;VALUE=DATE:20260412");
    expect(text).not.toContain("PRIVATE-EXCEPTION-TITLE");
    expect(text).not.toContain("PRIVATE-DESCRIPTION");
    expect(text).not.toContain("PRIVATE-LOCATION");
    expect(components(text)).toHaveLength(1);
  });

  it("never includes internal notes, authors, actor IDs or change reasons in feeds", () => {
    const input = weekly({ exceptions: [exception("2026-04-12", { internalNote: "PRIVATE-PATCH-NOTE" }, true)] });
    const text = unfold(buildICS([input], settings()));
    expect(text).not.toContain("PRIVATE-");
    expect(text).not.toContain("ORGANIZER:");
    expect(text).not.toContain("ATTENDEE:");
  });

  it("escapes text delimiters, backslashes, newlines and CRLF injection", () => {
    const input = event({ title: "제목,부제;안내\\경로", description: "첫 줄\r\n둘째 줄\rBEGIN:VEVENT\n끝" });
    const text = unfold(buildICS([input], settings()));
    expect(text).toContain("SUMMARY:제목\\,부제\\;안내\\\\경로");
    expect(text).toContain("DESCRIPTION:첫 줄\\n둘째 줄\\nBEGIN:VEVENT\\n끝");
    expect(components(text)).toHaveLength(1);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("folds Unicode lines at 75 UTF-8 bytes without splitting code points", () => {
    const title = "한글 일정😀".repeat(30);
    const feed = buildICS([event({ title })], settings());
    for (const line of feed.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      expect(line).not.toContain("\uFFFD");
    }
    expect(unfold(feed)).toContain(`SUMMARY:${title}`);
    expect(feed).toContain("\r\n ");
  });

  it("selects series overlapping the requested year, including moved exceptions and tombstones", () => {
    const moved = weekly({ exceptions: [exception("2026-04-12", { startDate: "2027-05-01", endDate: "2027-05-01" })] });
    const input = [moved, event({ id: "outside" }), event({ id: "tombstone", deleted: true, startDate: "2027-06-01", endDate: "2027-06-01" })];
    const text = unfold(buildICS(input, settings(), { year: 2027 }));
    expect(text).toContain("UID:unit-event@plan.yebom.org");
    expect(text).toContain("RECURRENCE-ID;VALUE=DATE:20260412");
    expect(text).toContain("UID:tombstone@plan.yebom.org");
    expect(text).not.toContain("UID:outside@plan.yebom.org");
  });

  it("keeps optional church markers separate, transparent, and explicitly not actual events", () => {
    expect(components(buildICS([], settings()))).toHaveLength(0);
    const feed = buildICS([], settings(), { includeChurchYear: true, year: 2026 });
    const parts = components(feed);
    expect(parts).toHaveLength(churchYear(2026).length);
    expect(parts.every(part => part.includes("UID:church-") && part.includes("TRANSP:TRANSPARENT"))).toBe(true);
    expect(unfold(feed)).toContain("교회력 참고 · 실제 행사/휴무 아님");
    expect(dateClickAction([], "2026-04-05", true)).toEqual({ type: "create" });
  });
});
