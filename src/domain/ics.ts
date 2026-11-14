import {
  addDaysISO, expandEvents, floatingDate, floatingRecurrenceRule,
  isOriginalRecurrenceDate, occurrenceForDate, todayKST,
} from "./calendar";
import { churchYear } from "./church-year";
import type { CalendarEvent, ChurchDay, ChurchSettings, EventInput, OrganizationId } from "./types";

export interface ICSOptions {
  organizationIds?: OrganizationId[];
  includeAllAudience?: boolean;
  includeChurchYear?: boolean;
  /** Select series that overlap this year; keep their stable DTSTART and bounded RRULE. */
  year?: number;
}

const TZID = "Asia/Seoul";
const encoder = new TextEncoder();

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

/** RFC5545's limit is 75 UTF-8 octets, including the continuation's leading space. */
function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const length = encoder.encode(character).length;
    if (octets + length > 75) {
      parts.push(current);
      current = " ";
      octets = 1;
    }
    current += character;
    octets += length;
  }
  parts.push(current);
  return parts.join("\r\n");
}

function compactDate(date: string): string {
  floatingDate(date);
  return date.replace(/-/g, "");
}

function localDateTime(date: string, time: string | null): string {
  if (!time || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) {
    throw new RangeError("Timed events require an HH:mm start and end time");
  }
  const [hour, minute, second = 0] = time.split(":").map(Number);
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError(`Invalid event time: ${time}`);
  return `${compactDate(date)}T${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}${String(second).padStart(2, "0")}`;
}

function timestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid audit timestamp: ${value}`);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function matchesOrganization(event: Pick<EventInput, "organizationId" | "audience">, options: ICSOptions): boolean {
  if (options.organizationIds === undefined) return true;
  if (!options.organizationIds.length) return false;
  return options.organizationIds.includes(event.organizationId)
    || Boolean(options.includeAllAudience && event.audience === "all");
}

function eventDates(event: Pick<EventInput, "startDate" | "endDate" | "allDay" | "startTime" | "endTime">): string[] {
  if (event.allDay) {
    return [`DTSTART;VALUE=DATE:${compactDate(event.startDate)}`, `DTEND;VALUE=DATE:${compactDate(addDaysISO(event.endDate, 1))}`];
  }
  return [
    `DTSTART;TZID=${TZID}:${localDateTime(event.startDate, event.startTime)}`,
    `DTEND;TZID=${TZID}:${localDateTime(event.endDate, event.endTime)}`,
  ];
}

function recurrenceValue(event: CalendarEvent, originalDate: string): string {
  return event.allDay ? compactDate(originalDate) : localDateTime(originalDate, event.startTime);
}

function recurrenceProperty(name: "RECURRENCE-ID" | "EXDATE", event: CalendarEvent, dates: string[]): string {
  const parameters = event.allDay ? ";VALUE=DATE" : `;TZID=${TZID}`;
  return `${name}${parameters}:${dates.map(date => recurrenceValue(event, date)).join(",")}`;
}

function rruleLine(event: CalendarEvent): string | null {
  const rule = floatingRecurrenceRule(event);
  if (!rule || !event.recurrence) return null;
  const line = rule.toString().split(/\r?\n/).find(item => item.startsWith("RRULE:"));
  if (!line) throw new Error("RRule failed to serialize a recurrence");
  // DATE DTSTART needs DATE UNTIL; TZID DTSTART needs a UTC UNTIL.
  // End-of-day Korean time makes the user's inclusive final date unambiguous.
  const until = event.allDay ? compactDate(event.recurrence.until)
    : timestamp(`${event.recurrence.until}T23:59:59+09:00`);
  return line.replace(/UNTIL=[^;]+/, `UNTIL=${until}`);
}

function eventProperties(event: CalendarEvent, uid: string, stamp: string): string[] {
  const properties = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `CREATED:${timestamp(event.createdAt)}`,
    `LAST-MODIFIED:${timestamp(event.updatedAt ?? event.createdAt)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(event.version))}`,
    ...eventDates(event),
    `SUMMARY:${escapeText(event.title)}`,
    `STATUS:${event.deleted || event.status === "cancelled" ? "CANCELLED" : event.status.toUpperCase()}`,
    `TRANSP:${event.deleted || event.status === "cancelled" ? "TRANSPARENT" : "OPAQUE"}`,
  ];
  if (event.location) properties.push(`LOCATION:${escapeText(event.location)}`);
  if (event.description) properties.push(`DESCRIPTION:${escapeText(event.description)}`);
  // Never serialize actors, authors, IDs other than the series UID, internal notes,
  // or free-form audit/change reasons into an unauthenticated subscription.
  return properties;
}

function markerProperties(day: ChurchDay, stamp: string): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:church-${day.date}-${encodeURIComponent(day.name)}@plan.yebom.org`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(day.date)}`,
    `DTEND;VALUE=DATE:${compactDate(addDaysISO(day.date, 1))}`,
    `SUMMARY:${escapeText(day.name)}`,
    `DESCRIPTION:${escapeText(day.note)}`,
    "CATEGORIES:교회력 참고",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
}

export function buildICS(events: CalendarEvent[], settings: ChurchSettings, options: ICSOptions = {}): string {
  const year = options.year ?? Number(todayKST().slice(0, 4));
  if (!Number.isInteger(year) || year < 1583 || year > 9998) throw new RangeError("Invalid feed year");
  const stamp = timestamp(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Yebom//Church Calendar//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:예봄일정 · 공개 일정",
    `X-WR-TIMEZONE:${TZID}`,
    "BEGIN:VTIMEZONE",
    `TZID:${TZID}`,
    `X-LIC-LOCATION:${TZID}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0900",
    "TZOFFSETTO:+0900",
    "TZNAME:KST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  const seenIds = new Set<string>();
  for (const event of events) {
    if (seenIds.has(event.id) || event.visibility !== "public" || !matchesOrganization(event, options)) continue;
    seenIds.add(event.id);
    if (options.year !== undefined) {
      // Cancellations and tombstones still need to reach subscribers. A moved
      // exception entering the selected year must also keep its original UID.
      const visible = expandEvents([{ ...event, deleted: false }], `${year}-01-01`, `${year}-12-31`, true)
        .some(occurrence => occurrence.visibility === "public" && matchesOrganization(occurrence, options));
      if (!visible) continue;
    }
    const uid = `${encodeURIComponent(event.id)}@plan.yebom.org`;
    const rule = floatingRecurrenceRule(event);
    const exceptions = [...new Map(event.exceptions.map(item => [item.date, item])).keys()]
      .filter(date => isOriginalRecurrenceDate(event, date, rule))
      .sort();
    const excluded: string[] = [];
    const overrides: string[][] = [];
    let latestChange = event.updatedAt ?? event.createdAt;
    for (const date of exceptions) {
      const occurrence = occurrenceForDate(event, date);
      if (new Date(occurrence.updatedAt ?? latestChange) > new Date(latestChange)) {
        latestChange = occurrence.updatedAt ?? latestChange;
      }
      if (occurrence.visibility !== "public" || !matchesOrganization(occurrence, options)) {
        // Private replacements must hide the original too, without revealing details.
        excluded.push(date);
        continue;
      }
      if (occurrence.status === "cancelled" || occurrence.deleted) excluded.push(date);
      const properties = eventProperties(occurrence, uid, stamp);
      properties.push(recurrenceProperty("RECURRENCE-ID", event, [date]), "END:VEVENT");
      overrides.push(properties);
    }
    const master = eventProperties({ ...event, updatedAt: latestChange }, uid, stamp);
    const recurrence = rruleLine(event);
    if (recurrence) master.push(recurrence);
    if (excluded.length) master.push(recurrenceProperty("EXDATE", event, excluded));
    master.push("END:VEVENT");
    lines.push(...master, ...overrides.flat());
  }
  if (options.includeChurchYear) {
    for (const day of churchYear(year, settings)) lines.push(...markerProperties(day, stamp));
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
