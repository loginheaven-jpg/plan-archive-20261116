import { mysqlTable, varchar, int, boolean, json, index, uniqueIndex } from "drizzle-orm/mysql-core";
import type { CalendarEvent, ChangeRecord, ChurchSettings, OrganizationId } from "../domain/types";

export const events = mysqlTable("plan_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  operationId: varchar("operation_id", { length: 36 }).notNull(),
  creatorId: varchar("creator_id", { length: 128 }).notNull(),
  initialPayload: json("initial_payload").$type<Record<string, unknown>>().notNull(),
  organizationId: varchar("organization_id", { length: 32 }).notNull(),
  visibility: varchar("visibility", { length: 16 }).notNull(),
  startDate: varchar("start_date", { length: 10 }).notNull(),
  endDate: varchar("end_date", { length: 10 }).notNull(),
  recurrenceUntil: varchar("recurrence_until", { length: 10 }),
  locationId: varchar("location_id", { length: 64 }),
  version: int("version").notNull(),
  deleted: boolean("deleted").notNull().default(false),
  payload: json("payload").$type<CalendarEvent>().notNull(),
}, t => [uniqueIndex("plan_events_operation_idx").on(t.operationId), index("plan_events_range_idx").on(t.startDate, t.endDate), index("plan_events_org_visibility_idx").on(t.organizationId, t.visibility), index("plan_events_recurring_idx").on(t.recurrenceUntil), index("plan_events_location_idx").on(t.locationId)]);

export const audit = mysqlTable("plan_audit", {
  id: varchar("id", { length: 36 }).primaryKey(),
  eventId: varchar("event_id", { length: 128 }).notNull(),
  at: varchar("at", { length: 24 }).notNull(),
  payload: json("payload").$type<ChangeRecord>().notNull(),
}, t => [index("plan_audit_event_time_idx").on(t.eventId, t.at), index("plan_audit_time_idx").on(t.at)]);

export const users = mysqlTable("plan_users", {
  id: varchar("id", { length: 128 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  role: varchar("role", { length: 16 }).$type<"viewer" | "editor" | "admin">().notNull().default("viewer"),
  departmentIds: json("department_ids").$type<OrganizationId[]>().notNull(),
  lastSeenAt: varchar("last_seen_at", { length: 24 }).notNull(),
});

export const settings = mysqlTable("plan_settings", {
  id: varchar("id", { length: 32 }).primaryKey(),
  version: int("version").notNull(),
  payload: json("payload").$type<ChurchSettings>().notNull(),
});
export const venues = mysqlTable("plan_venues", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
});
export const migrations = mysqlTable("plan_migrations", {
  id: varchar("id", { length: 100 }).primaryKey(),
  checksum: varchar("checksum", { length: 64 }).notNull(),
  appliedAt: varchar("applied_at", { length: 24 }).notNull(),
});
