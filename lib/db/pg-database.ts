import pkg from "pg";
const { Pool } = pkg;

function normalizeConnectionString(connectionString: string): string {
  return connectionString
    .replace(/[?&]sslmode=[^&]+/g, "")
    .replace(/\?&/, "?")
    .replace(/\?$/, "");
}

function poolSsl(connectionString: string) {
  if (
    connectionString.includes("sslmode=disable") ||
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1")
  ) {
    return undefined;
  }
  return { rejectUnauthorized: false };
}

class Database {
  pool: InstanceType<typeof Pool>;

  constructor(connectionString: string) {
    const normalized = normalizeConnectionString(connectionString);
    this.pool = new Pool({
      connectionString: normalized,
      ssl: poolSsl(connectionString),
    });
  }

  async query(query: string, values: unknown[] = []) {
    try {
      const result = await this.pool.query(query, values);
      return result.rows;
    } catch (error) {
      console.error("Database query failed:", error);
      return null;
    }
  }

  async end() {
    await this.pool.end();
  }

  async insertData(
    tableName: string,
    data: { [s: string]: unknown } | ArrayLike<unknown>,
  ) {
    const keys = Object.keys(data);
    const values = Object.values(data);

    const query = `
            INSERT INTO ${tableName} (${keys.join(", ")})
            VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
            RETURNING *;
        `;

    return await this.query(query, values);
  }

  async updateData(
    tableName: string,
    data: ArrayLike<unknown> | { [s: string]: unknown },
    condition: ArrayLike<unknown> | { [s: string]: unknown },
  ) {
    const keys = Object.keys(data);
    const values = Object.values(data);

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(", ");
    const whereClause = Object.entries(condition)
      .map(([key], i) => `${key} = $${keys.length + i + 1}`)
      .join(" AND ");

    const query = `
            UPDATE ${tableName}
            SET ${setClause}
            WHERE ${whereClause}
            RETURNING *;
        `;

    return await this.query(query, [...values, ...Object.values(condition)]);
  }

  async selectData(
    tableName: string,
    condition: ArrayLike<unknown> | { [s: string]: unknown },
  ) {
    const whereClause = Object.entries(condition)
      .map(([key], i) => `${key} = $${i + 1}`)
      .join(" AND ");

    const query = `
            SELECT * FROM ${tableName}
            WHERE ${whereClause};
        `;

    const rows = await this.query(query, Object.values(condition));
    return rows ?? [];
  }
}

export default Database;
