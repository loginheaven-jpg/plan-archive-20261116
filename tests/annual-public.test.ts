import { describe, expect, it } from "vitest";
import { newAnnualRow } from "../src/domain/annual";
import { expandEvents } from "../src/domain/calendar";
import { DEFAULT_CHURCH_SETTINGS } from "../src/domain/church-year";
import { buildICS } from "../src/domain/ics";
import { publicEvent } from "../src/domain/permissions";
import type { CalendarEvent } from "../src/domain/types";

// Synthetic in-memory public projection tests; no DB, SSO or actual event data.
const event: CalendarEvent = {
  ...newAnnualRow("worship", 2026).input,
  id: "96dd03d0-258b-4900-94b0-f78311b6fba1",
  title: "격리 검사 순번 모임",
  startDate: "2026-01-01",
  endDate: "2026-01-01",
  visibility: "public",
  recurrence: {
    frequency: "monthly",
    interval: 1,
    until: null,
    weekdays: [0],
    monthWeek: 2,
  },
  version: 1,
  cancelReason: "",
  deleted: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: { id: "synthetic", name: "격리 검사" },
  updatedAt: null,
  updatedBy: null,
  exceptions: [],
  internalNote: "비공개 격리 메모",
};

describe("annual recurrence survives public projection", () => {
  it("retains open-end and monthly nth weekday while excluding personal fields", () => {
    const safe = publicEvent(event);
    expect(safe.recurrence).toEqual(event.recurrence);
    expect(safe.recurrence?.until).toBeNull();
    expect(safe).not.toHaveProperty("createdBy");
    expect(safe).not.toHaveProperty("internalNote");
    const occurrences = expandEvents(
      [safe as CalendarEvent],
      "2026-01-01",
      "2026-12-31",
    );
    expect(occurrences).toHaveLength(12);
    for (const occurrence of occurrences) {
      const date = new Date(`${occurrence.startDate}T00:00:00Z`);
      expect(date.getUTCDay()).toBe(0);
      expect(date.getUTCDate()).toBeGreaterThanOrEqual(8);
      expect(date.getUTCDate()).toBeLessThanOrEqual(14);
    }
    const ics = buildICS([safe as CalendarEvent], DEFAULT_CHURCH_SETTINGS, {
      year: 2026,
    }).replace(/\r\n[ \t]/g, "");
    expect(ics).toMatch(/BYDAY=\+?2SU/);
    expect(ics).not.toContain("UNTIL=");
    expect(ics).not.toContain("비공개 격리 메모");
  });
});
