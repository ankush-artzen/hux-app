import { readFileSync } from "fs";
import { join } from "path";
import Database from "./pg-database";
import { getPostgresConnectionString } from "./get-database";

export async function initPostgresSchema(connectionString?: string) {
  const db = new Database(connectionString ?? getPostgresConnectionString());
  const schemaPath = join(__dirname, "schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  await db.query(sql, []);
  await db.end();
}
