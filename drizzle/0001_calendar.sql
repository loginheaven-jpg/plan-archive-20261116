CREATE TABLE IF NOT EXISTS plan_events (
  id varchar(36) PRIMARY KEY,
  operation_id varchar(36) NOT NULL,
  creator_id varchar(128) NOT NULL,
  initial_payload json NOT NULL,
  organization_id varchar(32) NOT NULL,
  visibility varchar(16) NOT NULL,
  start_date varchar(10) NOT NULL,
  end_date varchar(10) NOT NULL,
  recurrence_until varchar(10) NULL,
  location_id varchar(64) NULL,
  version int NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  payload json NOT NULL,
  UNIQUE KEY plan_events_operation_idx (operation_id),
  KEY plan_events_range_idx (start_date, end_date),
  KEY plan_events_org_visibility_idx (organization_id, visibility),
  KEY plan_events_recurring_idx (recurrence_until),
  KEY plan_events_location_idx (location_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plan_audit (
  id varchar(36) PRIMARY KEY,
  event_id varchar(128) NOT NULL,
  at varchar(24) NOT NULL,
  payload json NOT NULL,
  KEY plan_audit_event_time_idx (event_id, at),
  KEY plan_audit_time_idx (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plan_users (
  id varchar(128) PRIMARY KEY,
  name varchar(100) NOT NULL,
  role varchar(16) NOT NULL DEFAULT 'viewer',
  department_ids json NOT NULL,
  last_seen_at varchar(24) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plan_settings (
  id varchar(32) PRIMARY KEY,
  version int NOT NULL,
  payload json NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plan_venues (
  id varchar(64) PRIMARY KEY,
  name varchar(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
