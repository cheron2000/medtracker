// src/index.js
// ─── MedTracker API — Layer 1 ─────────────────────────────────────────────────
require("dotenv").config();

const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");

const authRoutes      = require("./routes/auth");
const medicineRoutes  = require("./routes/medicines");
const historyRoutes   = require("./routes/history");
const firedRoutes     = require("./routes/fired");

const app  = express();
const PORT = Number(process.env.PORT) || 3001;

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map(o => o.trim());

app.use(cors({
  origin(origin, cb) {
    // allow Postman / curl (no origin header) in dev
    if (!origin || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "100kb" }));

// ─── Global rate limiter (auth routes get their own tighter limit below) ──────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,   // 15 minutes
  max:      300,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: "Too many requests — please try again later." },
});
app.use(globalLimiter);

// Auth endpoints get a stricter limit to slow brute-force attempts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  max:      20,
  message:  { error: "Too many login attempts — please try again in 15 minutes." },
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.use("/auth",      authLimiter, authRoutes);
app.use("/medicines", medicineRoutes);
app.use("/history",   historyRoutes);
app.use("/fired",     firedRoutes);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "route not found" }));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[unhandled]", err.message);
  res.status(500).json({ error: "internal server error" });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   MedTracker API  •  Layer 1         ║
  ║   http://localhost:${PORT}              ║
  ║   NODE_ENV = ${process.env.NODE_ENV || "development"}            ║
  ╚══════════════════════════════════════╝
  `);
});

// ─── Nightly fired-key purge (every 24 h) ────────────────────────────────────
// Keeps the fired_keys table lean without needing a separate cron daemon.
const { pool } = require("./db/pool");
const TWO_DAYS_AGO = () => new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

setInterval(async () => {
  try {
    const before = TWO_DAYS_AGO();
    const result = await pool.query(
      "DELETE FROM fired_keys WHERE date < $1::date", [before]
    );
    if (result.rowCount) console.log(`[purge] removed ${result.rowCount} stale fired keys`);
  } catch (e) {
    console.error("[purge] fired_keys error:", e.message);
  }
}, 24 * 60 * 60 * 1_000);

module.exports = app; // for testing
