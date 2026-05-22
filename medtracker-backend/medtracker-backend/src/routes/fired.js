// src/routes/fired.js
// ─── Fired-keys deduplication guard ──────────────────────────────────────────
// Replaces the in-browser Set so the dedup state is shared across
// devices / tabs and survives full page reloads.
//
// Key format (mirrors frontend): "YYYY-MM-DD_<medicine_id>_HH:MM"
// Old keys are auto-purged after 2 days via DELETE /fired (or the cron job
// described in the backend plan).

const express = require("express");
const { query }       = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// ── GET /fired?date=YYYY-MM-DD ────────────────────────────────────────────────
// Returns the set of fired keys for a given date (default: today UTC).
router.get("/", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const result = await query(
      "SELECT key FROM fired_keys WHERE user_id = $1 AND date = $2::date",
      [req.user.id, date]
    );
    return res.json({ fired: result.rows.map(r => r.key), date });
  } catch (err) {
    console.error("[GET fired]", err.message);
    return res.status(500).json({ error: "could not fetch fired keys" });
  }
});

// ── POST /fired ───────────────────────────────────────────────────────────────
// Body: { key: "2025-01-22_<uuid>_08:00" }
// Or bulk: { keys: [...] }
// Silently ignores duplicates (ON CONFLICT DO NOTHING).
router.post("/", async (req, res) => {
  try {
    const keys = req.body.keys
      ? req.body.keys
      : req.body.key
        ? [req.body.key]
        : null;

    if (!keys || !keys.length)
      return res.status(400).json({ error: "key or keys array is required" });

    // Extract date from key prefix (YYYY-MM-DD_...)
    const inserted = [];
    for (const key of keys) {
      const datePart = key.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) continue; // skip malformed

      await query(
        `INSERT INTO fired_keys (user_id, key, date)
         VALUES ($1, $2, $3::date)
         ON CONFLICT (user_id, key) DO NOTHING`,
        [req.user.id, key, datePart]
      );
      inserted.push(key);
    }

    return res.status(201).json({ inserted });
  } catch (err) {
    console.error("[POST fired]", err.message);
    return res.status(500).json({ error: "could not save fired key" });
  }
});

// ── DELETE /fired?before=YYYY-MM-DD ──────────────────────────────────────────
// Purge old keys. Called automatically by the server on a schedule,
// but also exposed here so clients can trigger it.
// Defaults to purging everything older than 2 days.
router.delete("/", async (req, res) => {
  try {
    const before = req.query.before
      || new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

    const result = await query(
      "DELETE FROM fired_keys WHERE user_id = $1 AND date < $2::date RETURNING id",
      [req.user.id, before]
    );
    return res.json({ purged: result.rowCount, before });
  } catch (err) {
    console.error("[DELETE fired]", err.message);
    return res.status(500).json({ error: "could not purge fired keys" });
  }
});

module.exports = router;
