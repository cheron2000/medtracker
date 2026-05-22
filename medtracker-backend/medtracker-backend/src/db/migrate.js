// src/db/migrate.js
// ─── Run with: npm run migrate  (or  npm run migrate:down) ───────────────────
require("dotenv").config();
const { pool } = require("./pool");

// ─── Migration definitions (ordered) ─────────────────────────────────────────
const UP = `
-- Enable uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  timezone      TEXT        NOT NULL DEFAULT 'UTC',
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- ── medicines ─────────────────────────────────────────────────────────────────
-- times is stored as a JSONB array of "HH:MM" strings, e.g. ["08:00","20:00"]
CREATE TABLE IF NOT EXISTS medicines (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  dosage     TEXT        NOT NULL,
  times      JSONB       NOT NULL DEFAULT '[]',
  color      TEXT        NOT NULL DEFAULT '#6366F1',
  notes      TEXT,
  active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS medicines_user_id_idx  ON medicines (user_id);
CREATE INDEX IF NOT EXISTS medicines_active_idx   ON medicines (user_id, active);

-- ── dose_logs ─────────────────────────────────────────────────────────────────
-- One row per dose event (taken / missed / snoozed)
CREATE TABLE IF NOT EXISTS dose_logs (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  medicine_id    UUID        NOT NULL REFERENCES medicines (id) ON DELETE CASCADE,
  medicine_name  TEXT        NOT NULL,   -- denormalised for easy history display
  dosage         TEXT        NOT NULL,
  scheduled_time TEXT        NOT NULL,   -- "HH:MM"
  status         TEXT        NOT NULL CHECK (status IN ('taken','missed')),
  snoozed        BOOLEAN     NOT NULL DEFAULT FALSE,
  logged_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dose_logs_user_id_idx   ON dose_logs (user_id);
CREATE INDEX IF NOT EXISTS dose_logs_date_idx      ON dose_logs (user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS dose_logs_medicine_idx  ON dose_logs (medicine_id);

-- ── fired_keys ────────────────────────────────────────────────────────────────
-- Deduplication guard — mirrors the in-browser fired Set but server-side.
-- key format: "YYYY-MM-DD_<medicine_id>_HH:MM"
CREATE TABLE IF NOT EXISTS fired_keys (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key        TEXT        NOT NULL,
  date       DATE        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS fired_keys_user_date_idx ON fired_keys (user_id, date);

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS users_updated_at     ON users;
DROP TRIGGER IF EXISTS medicines_updated_at ON medicines;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER medicines_updated_at
  BEFORE UPDATE ON medicines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`;

const DOWN = `
DROP TABLE IF EXISTS fired_keys  CASCADE;
DROP TABLE IF EXISTS dose_logs   CASCADE;
DROP TABLE IF EXISTS medicines   CASCADE;
DROP TABLE IF EXISTS users       CASCADE;
DROP FUNCTION IF EXISTS set_updated_at CASCADE;
`;

async function migrate(direction = "up") {
  const client = await pool.connect();
  try {
    console.log(`[migrate] Running ${direction.toUpperCase()}…`);
    await client.query(direction === "up" ? UP : DOWN);
    console.log("[migrate] ✓ Done.");
  } catch (err) {
    console.error("[migrate] ✗ Error:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate(process.argv[2] === "down" ? "down" : "up");
