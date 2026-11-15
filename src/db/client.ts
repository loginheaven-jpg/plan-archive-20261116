import mysql, { type Pool, type PoolOptions } from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

let pool: Pool | undefined;
let db: MySql2Database<typeof schema> | undefined;
export function poolOptions(dsn: string): PoolOptions {
  const url = new URL(dsn);
  if (!["mysql:", "mysql2:"].includes(url.protocol)) throw new Error("DATABASE_URL must be MySQL");
  const options: PoolOptions = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectionLimit: 6, waitForConnections: true, queueLimit: 40,
    connectTimeout: 10000, charset: "utf8mb4", timezone: "Z",
    multipleStatements: false,
  };
  const ssl = url.searchParams.get("ssl");
  const mode = url.searchParams.get("ssl-mode") ?? url.searchParams.get("sslmode");
  if (ssl && !["false", "0"].includes(ssl)) {
    if (ssl.startsWith("{")) options.ssl = JSON.parse(ssl) as NonNullable<PoolOptions["ssl"]>;
    else options.ssl = { rejectUnauthorized: true };
  } else if (mode && mode.toLowerCase() !== "disabled") options.ssl = { rejectUnauthorized: true };
  return options;
}
export function getPool(): Pool {
  if (!pool) {
    const dsn = process.env.DATABASE_URL;
    if (!dsn) throw new Error("DATABASE_NOT_CONFIGURED");
    pool = mysql.createPool(poolOptions(dsn));
  }
  return pool;
}
export function getDB(): MySql2Database<typeof schema> {
  if (!db) db = drizzle(getPool(), { schema, mode: "default" });
  return db;
}
export async function closeDB() { const current = pool; pool = undefined; db = undefined; if (current) await current.end(); }
export async function schemaReady(): Promise<boolean> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>("SELECT id FROM plan_migrations WHERE id IN (?, ?) LIMIT 2", ["0001_calendar", "0002_annual"]);
  if (rows.length !== 2) return false;
  // Also detect a partial/removed schema instead of trusting only the migration marker.
  await getDB().select().from(schema.events).limit(1);
  await getDB().select().from(schema.audit).limit(1);
  await getDB().select().from(schema.users).limit(1);
  const config = await getDB().select().from(schema.settings).where(eq(schema.settings.id, "church")).limit(1);
  await getDB().select().from(schema.venues).limit(1);
  await getDB().select().from(schema.annualDrafts).limit(1);
  return config.length > 0;
}
