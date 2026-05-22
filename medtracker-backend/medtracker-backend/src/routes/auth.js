// src/routes/auth.js
const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const { query }       = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, timezone: user.timezone },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

function sanitiseUser(u) {
  return { id: u.id, email: u.email, display_name: u.display_name, timezone: u.timezone, created_at: u.created_at };
}

// ── POST /auth/register ───────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { email, password, display_name, timezone = "UTC" } = req.body;

    // Basic validation
    if (!email || !password)
      return res.status(400).json({ error: "email and password are required" });
    if (password.length < 8)
      return res.status(400).json({ error: "password must be at least 8 characters" });
    if (!/\S+@\S+\.\S+/.test(email))
      return res.status(400).json({ error: "invalid email address" });

    // Check uniqueness
    const existing = await query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rowCount > 0)
      return res.status(409).json({ error: "an account with that email already exists" });

    // Hash & insert
    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (email, password_hash, display_name, timezone)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [email.toLowerCase(), hash, display_name || null, timezone]
    );

    const user  = result.rows[0];
    const token = makeToken(user);
    return res.status(201).json({ token, user: sanitiseUser(user) });

  } catch (err) {
    console.error("[register]", err.message);
    return res.status(500).json({ error: "registration failed" });
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "email and password are required" });

    const result = await query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
    if (result.rowCount === 0)
      return res.status(401).json({ error: "invalid email or password" });

    const user  = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: "invalid email or password" });

    const token = makeToken(user);
    return res.json({ token, user: sanitiseUser(user) });

  } catch (err) {
    console.error("[login]", err.message);
    return res.status(500).json({ error: "login failed" });
  }
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await query(
      "SELECT id, email, display_name, timezone, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "user not found" });
    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("[me]", err.message);
    return res.status(500).json({ error: "could not fetch user" });
  }
});

// ── PATCH /auth/me ────────────────────────────────────────────────────────────
router.patch("/me", requireAuth, async (req, res) => {
  try {
    const { display_name, timezone } = req.body;
    const result = await query(
      `UPDATE users SET
        display_name = COALESCE($1, display_name),
        timezone     = COALESCE($2, timezone)
       WHERE id = $3
       RETURNING id, email, display_name, timezone, created_at`,
      [display_name || null, timezone || null, req.user.id]
    );
    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("[patch me]", err.message);
    return res.status(500).json({ error: "update failed" });
  }
});

module.exports = router;
