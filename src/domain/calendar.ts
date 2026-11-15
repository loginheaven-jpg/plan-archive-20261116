import { RRule } from "rrule";
import type { CalendarEvent, EventInput, Occurrence, OrganizationId } from "./types";

const DAY_MS = 86_400_000;
const WEEKDAYS = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA];

/** A floating Korean calendar date, represented at UTC midnight for arithmetic only. */
export function floatingDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`Invalid ISO date: ${date}`);
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(0, 0, 0, 0);
  if (year < 1 || result.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Invalid ISO date: ${date}`);
  }
  return result;
}

export function todayKST(): string {
  // Seoul is UTC+09:00, without daylight saving time for the dates managed here.
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDaysISO(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError("Day offset must be an integer");
  const shifted = new Date(floatingDate(date).getTime() + days * DAY_MS);
  const result = shifted.toISOString().slice(0, 10);
  floatingDate(result); // Reject overflow beyond the four-digit ISO year contract.
  return result;
}

/** RRule dates are floating midnight values, never actual UTC event instants. */
export function floatingRecurrenceRule(event: Pick<EventInput, "startDate" | "recurrence">): RRule | null {
  if (!event.recurrence) return null;
  const { frequency, interval, until, weekdays, monthWeek } = event.recurrence;
  if (!["weekly", "monthly", "yearly"].includes(frequency)) throw new RangeError("Invalid recurrence frequency");
  if (!Number.isInteger(interval) || interval < 1) throw new RangeError("Invalid recurrence interval");
  if (weekdays && (!weekdays.length || new Set(weekdays).size !== weekdays.length
    || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6))) {
    throw new RangeError("Recurrence weekdays must use Sunday=0 through Saturday=6");
  }
  if (monthWeek !== undefined && (frequency !== "monthly" || !weekdays?.length
    || !Number.isInteger(monthWeek) || ![-1, 1, 2, 3, 4, 5].includes(monthWeek))) {
    throw new RangeError("Monthly nth weekdays require monthWeek=1..5 or -1 and weekdays");
  }
  if (weekdays && frequency !== "weekly" && !(frequency === "monthly" && monthWeek !== undefined)) {
    throw new RangeError("Weekdays require weekly or monthly nth-weekday recurrence");
  }
  const start = floatingDate(event.startDate);
  const end = until === null ? null : floatingDate(until);
  end?.setUTCHours(23, 59, 59, 999);
  const byweekday = weekdays?.map(day => monthWeek === undefined ? WEEKDAYS[day] : WEEKDAYS[day].nth(monthWeek));
  const freq = { weekly: RRule.WEEKLY, monthly: RRule.MONTHLY, yearly: RRule.YEARLY }[frequency];
  // An input range starts on or after this date, not necessarily on a meeting day.
  // Align the series anchor before applying interval, so its first DTSTART is real.
  const first = byweekday ? new RRule({ freq, interval: 1, dtstart: start, byweekday, wkst: RRule.MO })
    .after(start, true) : start;
  if (!first) throw new RangeError("No representable recurrence start date");
  return new RRule({
    freq,
    interval,
    dtstart: first,
    ...(end ? { until: end } : {}),
    wkst: RRule.MO,
    ...(byweekday ? { byweekday } : {}),
  });
}

/** Returns the first real original occurrence without expanding an open series. */
export function firstRecurrenceDate(event: Pick<EventInput, "startDate" | "recurrence">): string | null {
  const rule = floatingRecurrenceRule(event);
  if (!rule) return event.startDate;
  return rule.after(floatingDate(event.startDate), true)?.toISOString().slice(0, 10) ?? null;
}

export function isOriginalRecurrenceDate(event: CalendarEvent, date: string, rule = floatingRecurrenceRule(event)): boolean {
  try {
    const candidate = floatingDate(date);
    if (!rule) return date === event.startDate;
    return rule.between(candidate, candidate, true).length > 0;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

/** Apply an exception only after its original date has been checked against the series. */
export function occurrenceForDate(event: CalendarEvent, originalDate: string): Occurrence {
  const duration = (floatingDate(event.endDate).getTime() - floatingDate(event.startDate).getTime()) / DAY_MS;
  const exception = event.exceptions.find(item => item.date === originalDate);
  const patch = exception?.patch ?? {};
  const startDate = patch.startDate ?? originalDate;
  const endDate = patch.endDate ?? addDaysISO(startDate, duration);
  return {
    ...event,
    ...patch,
    // A patch cannot change the identity or audit metadata of the underlying series.
    id: event.id,
    version: event.version,
    exceptions: event.exceptions,
    startDate,
    endDate,
    status: exception?.cancelled || event.status === "cancelled" ? "cancelled" : (patch.status ?? event.status),
    cancelReason: exception?.cancelled ? exception.reason : event.cancelReason,
    updatedAt: exception?.updatedAt ?? event.updatedAt,
    updatedBy: exception ? exception.updatedBy : event.updatedBy,
    key: `${event.id}:${originalDate}`,
    eventId: event.id,
    recurrenceDate: originalDate,
    isException: Boolean(exception),
  };
}

function overlaps(startDate: string, endDate: string, from: string, to: string): boolean {
  return startDate <= to && endDate >= from && startDate <= endDate;
}

function compareOccurrences(a: Occurrence, b: Occurrence): number {
  return a.startDate.localeCompare(b.startDate)
    || (a.startTime ?? "").localeCompare(b.startTime ?? "")
    || a.title.localeCompare(b.title, "ko")
    || a.key.localeCompare(b.key);
}

export function expandEvents(events: CalendarEvent[], from: string, to: string, includeCancelled = false): Occurrence[] {
  floatingDate(from);
  floatingDate(to);
  if (from > to) return [];
  const result = new Map<string, Occurrence>();
  for (const event of events) {
    // Trash is not part of a calendar, even when the user displays cancellations.
    if (event.deleted || (!includeCancelled && event.status === "cancelled")) continue;
    const duration = (floatingDate(event.endDate).getTime() - floatingDate(event.startDate).getTime()) / DAY_MS;
    if (duration < 0) continue;
    const rule = floatingRecurrenceRule(event);
    const originalDates = new Set<string>();
    if (rule) {
      const lower = new Date(floatingDate(from).getTime() - duration * DAY_MS);
      for (const date of rule.between(lower, floatingDate(to), true)) {
        originalDates.add(date.toISOString().slice(0, 10));
      }
    } else {
      originalDates.add(event.startDate);
    }
    // A move can enter this window from any original date, even in an open series.
    // Looking only at originals within the window would silently lose those moves.
    for (const exception of event.exceptions) {
      if (isOriginalRecurrenceDate(event, exception.date, rule)) originalDates.add(exception.date);
    }
    for (const originalDate of originalDates) {
      const occurrence = occurrenceForDate(event, originalDate);
      if ((!includeCancelled && occurrence.status === "cancelled")
        || !overlaps(occurrence.startDate, occurrence.endDate, from, to)) continue;
      result.set(occurrence.key, occurrence);
    }
  }
  return [...result.values()].sort(compareOccurrences);
}

export function occurrencesOnDate(occurrences: Occurrence[], date: string): Occurrence[] {
  floatingDate(date);
  const distinct = new Map<string, Occurrence>();
  for (const occurrence of occurrences) {
    // ChurchDay markers intentionally have no eventId or occurrence identity.
    if (!occurrence.eventId || !occurrence.key || occurrence.deleted) continue;
    if (overlaps(occurrence.startDate, occurrence.endDate, date, date)) {
      distinct.set(occurrence.key, occurrence);
    }
  }
  return [...distinct.values()].sort(compareOccurrences);
}

export type DateClickAction =
  | { type: "create" | "empty" }
  | { type: "detail"; occurrence: Occurrence }
  | { type: "list"; occurrences: Occurrence[] };

export function dateClickAction(occurrences: Occurrence[], date: string, canCreate: boolean): DateClickAction {
  const visible = occurrencesOnDate(occurrences, date);
  if (visible.length === 0) return { type: canCreate ? "create" : "empty" };
  if (visible.length === 1) return { type: "detail", occurrence: visible[0] };
  return { type: "list", occurrences: visible };
}

export interface OccurrenceFilter {
  selectedIds: OrganizationId[];
  query: string;
  includeAllAudience: boolean;
}

export function filterOccurrences(occurrences: Occurrence[], filter: OccurrenceFilter): Occurrence[] {
  if (!filter.selectedIds.length) return [];
  const selected = new Set(filter.selectedIds);
  const query = filter.query.trim().normalize("NFKC").toLocaleLowerCase("ko");
  return occurrences.filter(occurrence => {
    if (!selected.has(occurrence.organizationId) && !(filter.includeAllAudience && occurrence.audience === "all")) return false;
    return !query || [occurrence.title, occurrence.location, occurrence.description].some(value =>
      value.normalize("NFKC").toLocaleLowerCase("ko").includes(query));
  });
}

export function timeLabel(event: Pick<EventInput, "allDay" | "startTime" | "endTime">): string {
  if (event.allDay) return "종일";
  if (!event.startTime) return "시간 미정";
  return event.endTime && event.endTime !== event.startTime
    ? `${event.startTime}–${event.endTime}` : event.startTime;
}

export function dateLabel(date: string): string {
  const value = floatingDate(date);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][value.getUTCDay()];
  return `${value.getUTCFullYear()}년 ${value.getUTCMonth() + 1}월 ${value.getUTCDate()}일 (${weekday})`;
}
