// src/db/pool.js
// ─── PostgreSQL connection pool ───────────────────────────────────────────────
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false,
      }
    : {
        host:     process.env.DB_HOST     || "localhost",
        port:     Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || "medtracker",
        user:     process.env.DB_USER     || "postgres",
        password: process.env.DB_PASSWORD || "",
        ssl: false,
      }
);

pool.on("error", (err) => {
  console.error("[pool] unexpected idle client error:", err.message);
});

// Convenience wrapper — automatically releases the client
async function query(sql, params) {
  const start  = Date.now();
  const result = await pool.query(sql, params);
  if (process.env.NODE_ENV !== "production") {
    console.log(`[db] ${Date.now() - start}ms  ${sql.slice(0, 80)}`);
  }
  return result;
}

module.exports = { pool, query };
