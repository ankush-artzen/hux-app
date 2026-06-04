import Database from "./pg-database";

let cached: Database | null = null;

export function getPostgresConnectionString(): string {
  const url = process.env.POSTGRES_DATABASE_URL?.trim();
  if (!url) {
    throw new Error("POSTGRES_DATABASE_URL is not set in .env");
  }
  return url;
}

export function getDatabase(): Database {
  if (!cached) {
    cached = new Database(getPostgresConnectionString());
  }
  return cached;
}
