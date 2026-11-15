import {
  addDaysISO,
  expandEvents,
  floatingRecurrenceRule,
  timeLabel,
} from "@/domain/calendar";
import { rowToEventInput } from "@/domain/annual";
import { canEditEvent, canReadEvent } from "@/domain/permissions";
import type {
  Actor,
  AnnualPlanRow,
  CalendarEvent,
  ChurchDay,
  EventInput,
  Occurrence,
} from "@/domain/types";

export interface RowReview {
  row: AnnualPlanRow;
  input: EventInput | null;
  errors: string[];
  warnings: string[];
  undated: boolean;
  firstDate: string | null;
  occurrenceCount: number;
  references: string[];
}

const normalized = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .replace(/[\s·.,()/\\_-]+/g, "");
function sameVenue(
  a: Pick<EventInput, "locationId" | "location">,
  b: Pick<EventInput, "locationId" | "location">,
): boolean {
  if (a.locationId && b.locationId) return a.locationId === b.locationId;
  const first = normalized(a.location);
  return !!first && first === normalized(b.location);
}
type OccupancyInput = Pick<
  EventInput,
  "allDay" | "startDate" | "endDate" | "startTime" | "endTime"
>;
function occupied(event: OccupancyInput): [string, string] {
  return event.allDay
    ? [`${event.startDate}T00:00`, `${addDaysISO(event.endDate, 1)}T00:00`]
    : [
        `${event.startDate}T${event.startTime ?? "00:00"}`,
        `${event.endDate}T${event.endTime ?? event.startTime ?? "23:59"}`,
      ];
}
function overlaps(a: OccupancyInput, b: OccupancyInput): boolean {
  const [startA, endA] = occupied(a);
  const [startB, endB] = occupied(b);
  return startA < endB && startB < endA;
}
function virtualEvent(input: EventInput, id: string): CalendarEvent {
  // Pure in-memory recurrence projection, never a persisted event or a claimed actor.
  return {
    ...input,
    id,
    version: 0,
    deleted: false,
    cancelReason: "",
    createdAt: "",
    createdBy: null,
    updatedAt: null,
    updatedBy: null,
    exceptions: [],
  };
}

export function reviewRows(
  rows: AnnualPlanRow[],
  year: number,
  events: CalendarEvent[],
  actor: Actor | null,
  days: ChurchDay[],
): RowReview[] {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const readable = events.filter(
    (event) =>
      canReadEvent(event, actor) &&
      !event.deleted &&
      event.status !== "cancelled",
  );
  const existing = expandEvents(readable, from, to).filter((event) =>
    canReadEvent(event, actor),
  );
  const existingKeys = new Set(existing.map((event) => event.key));
  const planned = new Map<string, Occurrence[]>();
  const result = rows.map((row): RowReview => {
    const parsed = rowToEventInput(row, year);
    const errors = [...parsed.errors];
    const warnings = [...parsed.warnings];
    let firstDate: string | null = null;
    let occurrences: Occurrence[] = [];
    if (parsed.input) {
      if (!canEditEvent(parsed.input, actor))
        errors.push("이 행의 주관부서에 등록 권한이 없어요.");
      try {
        const rule = floatingRecurrenceRule(parsed.input);
        firstDate = rule
          ? (rule
              .after(new Date(`${parsed.input.startDate}T00:00:00.000Z`), true)
              ?.toISOString()
              .slice(0, 10) ?? null)
          : parsed.input.startDate;
        occurrences = expandEvents(
          [virtualEvent(parsed.input, row.id)],
          from,
          to,
        );
        if (!firstDate) errors.push("지정한 반복 범위에 실제 회차가 없어요.");
        if (firstDate && (firstDate < from || firstDate > to))
          warnings.push(
            `첫 회차 ${firstDate}는 선택 연도 밖이에요. 등록 연도를 다시 확인해 주세요.`,
          );
        if (parsed.input.recurrence?.until === null)
          warnings.push(
            `계속 반복입니다. 겹침 검토는 ${from} ~ ${to} 한 해만 확인하며 이후 모든 충돌을 보장하지 않아요.`,
          );
      } catch (e) {
        errors.push(
          e instanceof Error
            ? `반복 검토: ${e.message}`
            : "반복 범위를 확인해 주세요.",
        );
      }
    }
    planned.set(row.id, occurrences);
    return {
      row,
      input: parsed.input,
      errors,
      warnings,
      undated: parsed.undated,
      firstDate,
      occurrenceCount: occurrences.length,
      references: [],
    };
  });
  for (const review of result) {
    const own = planned.get(review.row.id) ?? [];
    const references = new Set<string>();
    const warnings = new Set(review.warnings);
    const others = [
      ...existing,
      ...result
        .filter((r) => r.row.id !== review.row.id)
        .flatMap((r) => planned.get(r.row.id) ?? []),
    ];
    for (const occurrence of own) {
      for (const day of days) {
        if (day.date >= occurrence.startDate && day.date <= occurrence.endDate)
          references.add(`${day.date} ${day.name} · ${day.note}`);
      }
      for (const other of others) {
        if (
          occurrence.startDate > other.endDate ||
          occurrence.endDate < other.startDate
        )
          continue;
        const isExisting = existingKeys.has(other.key);
        if (isExisting && other.audience === "all")
          references.add(
            `${other.startDate} ${other.title} · ${timeLabel(other)} · 열람 가능한 전교회 대상 행사`,
          );
        if (
          normalized(occurrence.title) === normalized(other.title) &&
          occurrence.organizationId === other.organizationId &&
          occurrence.startDate === other.startDate
        ) {
          warnings.add(
            `${other.startDate} ‘${other.title}’와 중복 의심 (${isExisting ? "기존 일정" : "이번 초안"})`,
          );
        }
        if (sameVenue(occurrence, other) && overlaps(occurrence, other))
          warnings.add(
            `${other.startDate} ${other.location || "동일 등록 장소"} · ‘${other.title}’ (${timeLabel(other)})와 장소 겹침 의심 (${isExisting ? "기존 일정" : "이번 초안"})`,
          );
      }
    }
    review.warnings = [...warnings];
    review.references = [...references];
  }
  return result;
}
