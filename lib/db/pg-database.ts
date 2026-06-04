import pkg from "pg";
const { Pool } = pkg;

class Database {
  pool: InstanceType<typeof Pool>;

  constructor(connectionString: string) {
    this.pool = new Pool({
      ssl: {
        rejectUnauthorized: false,
      },
      connectionString,
    });
  }

  async connect() {
    try {
      await this.pool.connect();
      console.log("Database connected successfully");
    } catch (error) {
      console.error("Database connection failed:", error);
    }
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

    return await this.query(query, Object.values(condition));
  }
}

export default Database;
