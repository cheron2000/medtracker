// src/routes/medicines.js
const express  = require("express");
const { query }             = require("../db/pool");
const { requireAuth }       = require("../middleware/auth");
const { validateMedicine }  = require("../middleware/validate");

const router = express.Router();

// All routes in this file require a valid JWT.
router.use(requireAuth);

// ── GET /medicines ────────────────────────────────────────────────────────────
// Returns all active medicines for the authenticated user.
router.get("/", async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, dosage, times, color, notes, active, created_at, updated_at
       FROM medicines
       WHERE user_id = $1 AND active = TRUE
       ORDER BY created_at ASC`,
      [req.user.id]
    );
    return res.json({ medicines: result.rows });
  } catch (err) {
    console.error("[GET medicines]", err.message);
    return res.status(500).json({ error: "could not fetch medicines" });
  }
});

// ── POST /medicines ───────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const errors = validateMedicine(req.body);
  if (errors.length) return res.status(400).json({ errors });

  try {
    const { name, dosage, times, color = "#6366F1", notes = null } = req.body;

    // Deduplicate & sort times
    const cleanTimes = [...new Set(times)].sort();

    const result = await query(
      `INSERT INTO medicines (user_id, name, dosage, times, color, notes)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id, name, dosage, times, color, notes, active, created_at, updated_at`,
      [req.user.id, name.trim(), dosage.trim(), JSON.stringify(cleanTimes), color, notes]
    );
    return res.status(201).json({ medicine: result.rows[0] });
  } catch (err) {
    console.error("[POST medicine]", err.message);
    return res.status(500).json({ error: "could not create medicine" });
  }
});

// ── GET /medicines/:id ────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, dosage, times, color, notes, active, created_at, updated_at
       FROM medicines
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "medicine not found" });
    return res.json({ medicine: result.rows[0] });
  } catch (err) {
    console.error("[GET medicine/:id]", err.message);
    return res.status(500).json({ error: "could not fetch medicine" });
  }
});

// ── PATCH /medicines/:id ──────────────────────────────────────────────────────
// Partial update — any subset of fields.
router.patch("/:id", async (req, res) => {
  // If times are supplied, validate them
  if (req.body.times !== undefined) {
    const errors = validateMedicine({ ...req.body, name: req.body.name || "x", dosage: req.body.dosage || "x" });
    if (errors.length) return res.status(400).json({ errors });
  }

  try {
    // Fetch existing to ensure ownership
    const existing = await query(
      "SELECT * FROM medicines WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "medicine not found" });

    const med = existing.rows[0];
    const updatedTimes = req.body.times
      ? [...new Set(req.body.times)].sort()
      : med.times;

    const result = await query(
      `UPDATE medicines SET
        name   = $1,
        dosage = $2,
        times  = $3::jsonb,
        color  = $4,
        notes  = $5
       WHERE id = $6 AND user_id = $7
       RETURNING id, name, dosage, times, color, notes, active, created_at, updated_at`,
      [
        (req.body.name   || med.name).trim(),
        (req.body.dosage || med.dosage).trim(),
        JSON.stringify(updatedTimes),
        req.body.color || med.color,
        req.body.notes !== undefined ? req.body.notes : med.notes,
        req.params.id,
        req.user.id,
      ]
    );
    return res.json({ medicine: result.rows[0] });
  } catch (err) {
    console.error("[PATCH medicine]", err.message);
    return res.status(500).json({ error: "could not update medicine" });
  }
});

// ── DELETE /medicines/:id ─────────────────────────────────────────────────────
// Soft-delete (sets active = false) so history stays intact.
router.delete("/:id", async (req, res) => {
  try {
    const result = await query(
      `UPDATE medicines SET active = FALSE
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "medicine not found" });
    return res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error("[DELETE medicine]", err.message);
    return res.status(500).json({ error: "could not delete medicine" });
  }
});

module.exports = router;
