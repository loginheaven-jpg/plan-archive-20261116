CREATE TABLE IF NOT EXISTS plan_annual_drafts (
  id varchar(36) PRIMARY KEY,
  owner_id varchar(128) NOT NULL,
  year int NOT NULL,
  organization_id varchar(32) NOT NULL,
  version int NOT NULL,
  created_at varchar(24) NOT NULL,
  updated_at varchar(24) NOT NULL,
  initial_payload json NOT NULL,
  payload json NOT NULL,
  KEY plan_annual_owner_year_idx (owner_id, year),
  KEY plan_annual_year_idx (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
