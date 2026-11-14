import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { RowDataPacket } from "mysql2/promise";
import { closeDB, getPool, schemaReady } from "../src/db/client";
import { DEFAULT_CHURCH_SETTINGS } from "../src/domain/church-year";

async function migrate() {
  const pool = getPool();
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [inventory] = await connection.query<RowDataPacket[]>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() LIMIT 100");
    if (inventory.some(row => !String(row.name).startsWith("plan_"))) throw new Error("Refusing migration: database contains non-calendar tables. Confirm the project-scoped DATABASE_URL.");
    const [lock] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('yebom_plan_migrate', 15) AS acquired LIMIT 1");
    if (lock[0]?.acquired !== 1) throw new Error("Migration lock unavailable");
    locked = true;
    await connection.execute("CREATE TABLE IF NOT EXISTS plan_migrations (id varchar(100) PRIMARY KEY, checksum varchar(64) NOT NULL, applied_at varchar(24) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    const id = "0001_calendar";
    const content = await readFile(fileURLToPath(new URL("../drizzle/0001_calendar.sql", import.meta.url)), "utf8");
    const checksum = createHash("sha256").update(content).digest("hex");
    const [previous] = await connection.execute<RowDataPacket[]>("SELECT checksum FROM plan_migrations WHERE id = ? LIMIT 1", [id]);
    if (previous.length && previous[0].checksum !== checksum) throw new Error("Applied migration checksum differs; add a new migration instead of changing history");
    if (!previous.length) {
      for (const statement of content.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean)) await connection.execute(statement);
      // Defaults describe unconfirmed church-year preferences, not actual church events or venues.
      await connection.beginTransaction();
      try {
        await connection.execute("INSERT INTO plan_settings (id, version, payload) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id", ["church", 1, JSON.stringify(DEFAULT_CHURCH_SETTINGS)]);
        await connection.execute("INSERT INTO plan_migrations (id, checksum, applied_at) VALUES (?, ?, ?)", [id, checksum, new Date().toISOString()]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      console.log(`Applied ${id}: additive schema and one-time settings only.`);
    } else console.log(`${id} already applied; settings and data preserved.`);
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('yebom_plan_migrate') AS released LIMIT 1");
    connection.release();
  }
  if (!await schemaReady()) throw new Error("Migration readiness check failed");
  console.log("Calendar schema ready. No sample events, users, or venues were written.");
}
migrate().catch(() => { console.error("Migration failed. Check connection, schema inventory, and migration checksum; sensitive driver details are not logged."); process.exitCode = 1; }).finally(closeDB);
