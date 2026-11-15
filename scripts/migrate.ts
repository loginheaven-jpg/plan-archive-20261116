import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RowDataPacket } from "mysql2/promise";
import { closeDB, getPool, schemaReady } from "../src/db/client";
import { DEFAULT_CHURCH_SETTINGS } from "../src/domain/church-year";

export interface SQLMigration { id: string; content: string; checksum: string }
export async function discoverMigrations(directory = fileURLToPath(new URL("../drizzle/", import.meta.url))): Promise<SQLMigration[]> {
  const names = (await readdir(directory)).filter(name => /^\d{4}_[a-zA-Z0-9_-]+\.sql$/.test(name)).sort();
  if (!names.length || names[0] !== "0001_calendar.sql") throw new Error("Migration history must start with 0001_calendar");
  if (new Set(names.map(name => name.slice(0, 4))).size !== names.length) throw new Error("Migration sequence numbers must be unique");
  return Promise.all(names.map(async name => {
    const content = await readFile(resolve(directory, name), "utf8");
    return { id: name.slice(0, -4), content, checksum: createHash("sha256").update(content).digest("hex") };
  }));
}
export function verifyMigrationHistory(files: SQLMigration[], applied: { id: string; checksum: string }[]): void {
  for (const row of applied) {
    const file = files.find(file => file.id === row.id);
    if (!file || file.checksum !== row.checksum) throw new Error("Applied migration checksum differs or history is missing; add a new migration instead of changing history");
  }
  let missing = false;
  for (const file of files) {
    if (!applied.some(row => row.id === file.id)) missing = true;
    else if (missing) throw new Error("Applied migrations are not an ordered prefix of SQL history");
  }
}
async function migrate() {
  const files = await discoverMigrations();
  const connection = await getPool().getConnection();
  let locked = false;
  try {
    const [inventory] = await connection.query<RowDataPacket[]>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() LIMIT 101");
    if (inventory.length > 100 || inventory.some(row => !String(row.name).startsWith("plan_"))) throw new Error("Refusing migration: confirm the project-scoped calendar DATABASE_URL");
    const [lock] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('yebom_plan_migrate', 15) AS acquired LIMIT 1");
    if (lock[0]?.acquired !== 1) throw new Error("Migration lock unavailable");
    locked = true;
    await connection.execute("CREATE TABLE IF NOT EXISTS plan_migrations (id varchar(100) PRIMARY KEY, checksum varchar(64) NOT NULL, applied_at varchar(24) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    const [previous] = await connection.execute<RowDataPacket[]>("SELECT id, checksum FROM plan_migrations ORDER BY id LIMIT 1001");
    if (previous.length > 1000) throw new Error("Migration history exceeds inspection limit");
    // Verify every applied checksum BEFORE applying any pending DDL.
    verifyMigrationHistory(files, previous.map(row => ({ id: String(row.id), checksum: String(row.checksum) })));
    for (const file of files) {
      if (previous.some(row => row.id === file.id)) { console.log(`${file.id} already applied; settings and data preserved.`); continue; }
      // MySQL DDL auto-commits. Every file is additive/retryable; record success only
      // after all statements succeed. Do not imply that DDL itself rolls back.
      for (const statement of file.content.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean)) await connection.execute(statement);
      await connection.beginTransaction();
      try {
        if (file.id === "0001_calendar") await connection.execute("INSERT INTO plan_settings (id, version, payload) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id", ["church", 1, JSON.stringify(DEFAULT_CHURCH_SETTINGS)]);
        await connection.execute("INSERT INTO plan_migrations (id, checksum, applied_at) VALUES (?, ?, ?)", [file.id, file.checksum, new Date().toISOString()]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      console.log(`Applied ${file.id}: additive schema only; existing settings preserved.`);
    }
  } finally {
    try { if (locked) await connection.query("SELECT RELEASE_LOCK('yebom_plan_migrate') AS released LIMIT 1"); } finally { connection.release(); }
  }
  if (!await schemaReady()) throw new Error("Migration readiness check failed");
  console.log("Calendar and annual schema ready. No sample events, users, or venues were written.");
}
// Importing discovery/checksum helpers in isolated tests must never open a DB.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate().catch(() => { console.error("Migration failed. Check connection, schema inventory, and migration checksum; sensitive driver details are not logged."); process.exitCode = 1; }).finally(closeDB);
}
