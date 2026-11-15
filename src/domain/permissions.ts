import type { Actor, CalendarEvent, EventException, EventInput } from "./types";

export function canReadEvent(event: CalendarEvent | EventInput, actor: Actor | null): boolean {
  if (event.visibility === "public") return true;
  // Actor is the server's approved SSO identity, not a browser-supplied login claim.
  if (!actor) return false;
  if (event.visibility === "members") return true;
  return actor.role === "admin" || actor.departmentIds.includes(event.organizationId);
}

export function canEditEvent(event: CalendarEvent | EventInput, actor: Actor | null): boolean {
  return Boolean(actor && (actor.role === "admin"
    || (actor.role === "editor" && actor.departmentIds.includes(event.organizationId))));
}

export function canCreate(actor: Actor | null): boolean {
  return Boolean(actor && (actor.role === "admin"
    || (actor.role === "editor" && actor.departmentIds.length > 0)));
}

export type PublicEventInput = Omit<EventInput, "internalNote">;
export type PublicEventException = Omit<EventException, "updatedBy" | "patch"> & {
  patch: Partial<PublicEventInput>;
};
export type PublicCalendarEvent = Omit<CalendarEvent, "internalNote" | "createdBy" | "updatedBy" | "exceptions"> & {
  exceptions: PublicEventException[];
};

// An allowlist also excludes accidental extra database/private fields at runtime.
const PUBLIC_INPUT_FIELDS = [
  "title", "organizationId", "startDate", "endDate", "allDay", "startTime", "endTime",
  "audience", "audienceIds", "visibility", "locationId", "location", "description", "recurrence", "status",
] as const;

function publicInput(input: Partial<EventInput> | CalendarEvent): Partial<PublicEventInput> {
  const output: Record<string, unknown> = {};
  for (const field of PUBLIC_INPUT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      if (field === "recurrence" && input.recurrence) {
        const rule = input.recurrence;
        output.recurrence = {
          frequency: rule.frequency,
          interval: rule.interval,
          until: rule.until,
          ...(rule.weekdays ? { weekdays: [...rule.weekdays] } : {}),
          ...(rule.monthWeek !== undefined ? { monthWeek: rule.monthWeek } : {}),
        };
      } else {
        // Clone nested arrays so edits to the projection cannot mutate the source.
        output[field] = structuredClone(input[field]);
      }
    }
  }
  return output as Partial<PublicEventInput>;
}

export function publicEvent(event: CalendarEvent): PublicCalendarEvent;
export function publicEvent(event: EventInput): PublicEventInput;
export function publicEvent(event: CalendarEvent | EventInput): PublicCalendarEvent | PublicEventInput {
  const input = publicInput(event) as PublicEventInput;
  if (!("id" in event)) return input;
  return {
    ...input,
    status: event.status,
    id: event.id,
    version: event.version,
    cancelReason: event.cancelReason,
    deleted: event.deleted,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    exceptions: event.exceptions.map(exception => {
      const visibility = exception.patch.visibility ?? event.visibility;
      if (event.visibility === "public" && visibility !== "public") {
        // A now-private replacement must not leak its title, location or moved
        // dates, and its formerly public original must disappear from the UI.
        return {
          date: exception.date,
          patch: { visibility },
          cancelled: true,
          reason: "",
          updatedAt: exception.updatedAt,
        };
      }
      return {
        date: exception.date,
        patch: publicInput(exception.patch),
        cancelled: exception.cancelled,
        reason: exception.reason,
        updatedAt: exception.updatedAt,
      };
    }),
  };
}
