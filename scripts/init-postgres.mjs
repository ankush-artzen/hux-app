import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pkg from "pg";

const { Pool } = pkg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.POSTGRES_DATABASE_URL?.trim();
if (!connectionString) {
  console.error("Set POSTGRES_DATABASE_URL in .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: connectionString.replace(/[?&]sslmode=[^&]+/g, "").replace(/\?$/, ""),
  ssl: { rejectUnauthorized: false },
});

const schemaPath = join(__dirname, "../lib/db/schema.sql");
const sql = readFileSync(schemaPath, "utf8");

try {
  await pool.query(sql);
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
  );
  console.log("Postgres schema ready:", tables.rows.map((r) => r.table_name).join(", "));
} catch (err) {
  console.error("Schema init failed:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
