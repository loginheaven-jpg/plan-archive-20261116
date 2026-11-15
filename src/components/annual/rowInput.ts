import { parseAnnualDate, rowToEventInput } from "@/domain/annual";
import { firstRecurrenceDate } from "@/domain/calendar";
import type { AnnualPlanRow, EventInput } from "@/domain/types";

/** UI proposal only. Validation and publication always use rowToEventInput. */
export function proposedInput(row: AnnualPlanRow, year: number): EventInput {
  const reviewed = rowToEventInput(row, year);
  if (reviewed.input) return reviewed.input;
  const parsed = parseAnnualDate(row.dateText, year);
  const input = { ...row.input };
  if (parsed.startDate) input.startDate = parsed.startDate;
  if (parsed.endDate) input.endDate = parsed.endDate;
  if (parsed.dateKind === "recurrence") input.recurrence = parsed.recurrence;
  if (parsed.hasTime) {
    input.allDay = parsed.allDay ?? input.allDay;
    if (!(parsed.timeAmbiguous && row.input.startTime)) {
      input.startTime = parsed.startTime;
      input.endTime = parsed.endTime;
    }
  }
  return input;
}

export function proposedFirstDate(
  row: AnnualPlanRow,
  year: number,
): string | null {
  if (parseAnnualDate(row.dateText, year).kind !== "dated") return null;
  try {
    return firstRecurrenceDate(proposedInput(row, year));
  } catch {
    return null;
  }
}
