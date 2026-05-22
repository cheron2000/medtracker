// src/routes/history.js
const express  = require("express");
const { query }           = require("../db/pool");
const { requireAuth }     = require("../middleware/auth");
const { validateDoseLog } = require("../middleware/validate");

const router = express.Router();
router.use(requireAuth);

// ── GET /history ──────────────────────────────────────────────────────────────
// Optional query params:
//   date=YYYY-MM-DD  → filter to a single day (uses logged_at timezone)
//   limit=N          → max rows (default 100, max 500)
//   offset=N         → pagination offset
router.get("/", async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 100, 500);
    const offset = Number(req.query.offset) || 0;

    let sql, params;
    if (req.query.date) {
      // Filter to a specific date (UTC date comparison)
      sql = `
        SELECT id, medicine_id, medicine_name, dosage,
               scheduled_time, status, snoozed, logged_at
        FROM   dose_logs
        WHERE  user_id = $1
          AND  DATE(logged_at AT TIME ZONE 'UTC') = $2::date
        ORDER  BY logged_at DESC
        LIMIT  $3 OFFSET $4
      `;
      params = [req.user.id, req.query.date, limit, offset];
    } else {
      sql = `
        SELECT id, medicine_id, medicine_name, dosage,
               scheduled_time, status, snoozed, logged_at
        FROM   dose_logs
        WHERE  user_id = $1
        ORDER  BY logged_at DESC
        LIMIT  $2 OFFSET $3
      `;
      params = [req.user.id, limit, offset];
    }

    const result = await query(sql, params);

    // Also return total count for pagination
    const countResult = await query(
      req.query.date
        ? `SELECT COUNT(*) FROM dose_logs WHERE user_id = $1 AND DATE(logged_at AT TIME ZONE 'UTC') = $2::date`
        : `SELECT COUNT(*) FROM dose_logs WHERE user_id = $1`,
      req.query.date ? [req.user.id, req.query.date] : [req.user.id]
    );

    return res.json({
      history: result.rows,
      total:   Number(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    console.error("[GET history]", err.message);
    return res.status(500).json({ error: "could not fetch history" });
  }
});

// ── POST /history ─────────────────────────────────────────────────────────────
// Log a dose event (taken / missed).
// Body: { medicine_id, status, scheduled_time, snoozed? }
router.post("/", async (req, res) => {
  const errors = validateDoseLog(req.body);
  if (errors.length) return res.status(400).json({ errors });

  try {
    const { medicine_id, status, scheduled_time, snoozed = false } = req.body;

    // Verify the medicine belongs to this user & fetch denorm fields
    const medResult = await query(
      "SELECT id, name, dosage FROM medicines WHERE id = $1 AND user_id = $2",
      [medicine_id, req.user.id]
    );
    if (medResult.rowCount === 0)
      return res.status(404).json({ error: "medicine not found" });

    const med    = medResult.rows[0];
    const result = await query(
      `INSERT INTO dose_logs
         (user_id, medicine_id, medicine_name, dosage, scheduled_time, status, snoozed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.user.id, medicine_id, med.name, med.dosage, scheduled_time, status, snoozed]
    );

    return res.status(201).json({ log: result.rows[0] });
  } catch (err) {
    console.error("[POST history]", err.message);
    return res.status(500).json({ error: "could not log dose" });
  }
});

// ── DELETE /history/:id ───────────────────────────────────────────────────────
// Hard delete a single history entry (mistake correction).
router.delete("/:id", async (req, res) => {
  try {
    const result = await query(
      "DELETE FROM dose_logs WHERE id = $1 AND user_id = $2 RETURNING id",
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "log entry not found" });
    return res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error("[DELETE history]", err.message);
    return res.status(500).json({ error: "could not delete log entry" });
  }
});

// ── DELETE /history ───────────────────────────────────────────────────────────
// Clear ALL history for the user (matches the "Clear all" button in the frontend).
router.delete("/", async (req, res) => {
  try {
    const result = await query(
      "DELETE FROM dose_logs WHERE user_id = $1 RETURNING id",
      [req.user.id]
    );
    return res.json({ deleted: result.rowCount });
  } catch (err) {
    console.error("[DELETE all history]", err.message);
    return res.status(500).json({ error: "could not clear history" });
  }
});

module.exports = router;
