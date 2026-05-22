// src/middleware/auth.js
const jwt = require("jsonwebtoken");

/**
 * Verifies the Authorization: Bearer <token> header.
 * On success attaches req.user = { id, email, timezone }.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing authorization token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, timezone: payload.timezone };
    next();
  } catch (err) {
    const msg =
      err.name === "TokenExpiredError" ? "Token expired" :
      err.name === "JsonWebTokenError" ? "Invalid token"  : "Auth error";
    return res.status(401).json({ error: msg });
  }
}

module.exports = { requireAuth };
