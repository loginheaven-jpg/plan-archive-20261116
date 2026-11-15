export const ORGANIZATION_IDS = [
  "worship",
  "mission",
  "house",
  "children",
  "youth",
  "young",
  "care",
  "events",
  "facility",
  "admin",
] as const;
export type OrganizationId = (typeof ORGANIZATION_IDS)[number];
export type Visibility = "public" | "members" | "department";
export type EventStatus = "confirmed" | "tentative" | "cancelled";
export interface Person {
  id: string;
  name: string;
}
export interface Actor extends Person {
  role: "viewer" | "editor" | "admin";
  departmentIds: OrganizationId[];
}
export interface RecurrenceRule {
  frequency: "weekly" | "monthly" | "yearly";
  interval: number;
  until: string | null;
  weekdays?: number[];
  monthWeek?: number;
}
export interface EventInput {
  title: string;
  organizationId: OrganizationId;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  audience: "all" | "departments";
  audienceIds: OrganizationId[];
  visibility: Visibility;
  locationId: string | null;
  location: string;
  description: string;
  internalNote: string;
  recurrence: RecurrenceRule | null;
  status: "confirmed" | "tentative";
}
export interface EventException {
  date: string;
  patch: Partial<EventInput>;
  cancelled: boolean;
  reason: string;
  updatedAt: string;
  updatedBy: Person | null;
}
export interface CalendarEvent extends Omit<EventInput, "status"> {
  id: string;
  version: number;
  status: EventStatus;
  cancelReason: string;
  deleted: boolean;
  createdAt: string;
  createdBy: Person | null;
  updatedAt: string | null;
  updatedBy: Person | null;
  exceptions: EventException[];
}
export interface Occurrence extends CalendarEvent {
  key: string;
  eventId: string;
  recurrenceDate: string;
  isException: boolean;
}
export interface ChurchSettings {
  denomination: string;
  ashWednesday: boolean;
  ascension: boolean;
  thanksgiving: {
    enabled: boolean;
    rule: "nthSunday" | "fixedDate";
    month: number;
    nth: number;
    day: number;
  };
  reformationSunday: boolean;
  newYear: boolean;
  yearEnd: boolean;
}
export interface ChurchDay {
  date: string;
  name: string;
  note: string;
  kind: "season" | "observance";
}
export interface Venue {
  id: string;
  name: string;
}
export interface ChangeRecord {
  occurrenceDate?: string;
  id: string;
  eventId: string;
  title: string;
  organizationId: OrganizationId;
  kind: string;
  at: string;
  by: Person | null;
  reason: string;
  changedFields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
export interface AuthStatus {
  configured: boolean;
  onSharedDomain: boolean;
  loginUrl: string | null;
  message: string;
}
export interface Bootstrap {
  events: CalendarEvent[];
  upcoming: Occurrence[];
  actor: Actor | null;
  venues: Venue[];
  settings: ChurchSettings;
  auth: AuthStatus;
}
export interface EventMutation {
  version: number;
  action: "update" | "cancel" | "delete" | "restore";
  input?: EventInput;
  reason?: string;
  occurrenceDate?: string;
}

export interface AnnualPlanRow {
  id: string;
  dateText: string;
  input: EventInput;
  timeConfirmed?: boolean;
  sourceEventId?: string;
}
export interface AnnualDraftInput {
  year: number;
  organizationId: OrganizationId;
  rows: AnnualPlanRow[];
}
export interface AnnualDraft extends AnnualDraftInput {
  id: string;
  version: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  publishedRowIds: string[];
}
export interface AnnualDraftSummary {
  id: string;
  version: number;
  ownerId: string;
  year: number;
  organizationId: OrganizationId;
  createdAt: string;
  updatedAt: string;
  rowCount: number;
  publishedCount: number;
}
export interface AnnualPublishResult {
  draft: AnnualDraft;
  events: CalendarEvent[];
  warnings: string[];
}
