// src/middleware/validate.js
// Tiny validation helpers — no external library needed.

const HH_MM = /^\d{2}:\d{2}$/;
const HEX   = /^#[0-9A-Fa-f]{6}$/;

function isValidTimeStr(t) {
  if (!HH_MM.test(t)) return false;
  const [h, m] = t.split(":").map(Number);
  return h >= 0 && h < 24 && m >= 0 && m < 60;
}

/**
 * Validate a medicine payload.
 * Returns an array of error strings (empty = valid).
 */
function validateMedicine(body) {
  const errors = [];
  if (!body.name || typeof body.name !== "string" || !body.name.trim())
    errors.push("name is required");
  if (!body.dosage || typeof body.dosage !== "string" || !body.dosage.trim())
    errors.push("dosage is required");
  if (!Array.isArray(body.times) || body.times.length === 0)
    errors.push("times must be a non-empty array");
  else if (!body.times.every(isValidTimeStr))
    errors.push("all times must be in HH:MM format (e.g. '08:00')");
  if (body.color && !HEX.test(body.color))
    errors.push("color must be a 6-digit hex color (e.g. '#6366F1')");
  return errors;
}

/**
 * Validate a dose-log payload (POST /history).
 */
function validateDoseLog(body) {
  const errors = [];
  if (!body.medicine_id) errors.push("medicine_id is required");
  if (!["taken","missed"].includes(body.status))
    errors.push("status must be 'taken' or 'missed'");
  if (body.scheduled_time && !isValidTimeStr(body.scheduled_time))
    errors.push("scheduled_time must be HH:MM");
  return errors;
}

module.exports = { validateMedicine, validateDoseLog };
