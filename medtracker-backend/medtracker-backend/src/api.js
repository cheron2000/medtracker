// src/api.js  (drop this next to MedTrackerV2.jsx)
// ─── MedTracker API client ────────────────────────────────────────────────────
// Swap the BASE_URL to wherever you deploy the backend.
// During local dev: http://localhost:3001

const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:3001";

// ─── Token storage ────────────────────────────────────────────────────────────
// Using localStorage here is fine — we're NOT inside a Claude Artifact.
// If you do put this in an Artifact, switch to an in-memory variable.
function getToken()        { return localStorage.getItem("mt_token"); }
function setToken(t)       { localStorage.setItem("mt_token", t); }
function clearToken()      { localStorage.removeItem("mt_token"); }

// ─── Core fetch wrapper ───────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "API error"), { status: res.status, data });
  return data;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const auth = {
  async register(email, password, display_name, timezone) {
    const data = await apiFetch("/auth/register", {
      method: "POST", body: { email, password, display_name, timezone },
    });
    setToken(data.token);
    return data;
  },

  async login(email, password) {
    const data = await apiFetch("/auth/login", {
      method: "POST", body: { email, password },
    });
    setToken(data.token);
    return data;
  },

  async me() {
    return apiFetch("/auth/me");
  },

  logout() {
    clearToken();
  },

  isLoggedIn() {
    return Boolean(getToken());
  },
};

// ─── Medicines ────────────────────────────────────────────────────────────────
export const medicines = {
  list()              { return apiFetch("/medicines"); },
  get(id)             { return apiFetch(`/medicines/${id}`); },
  create(payload)     { return apiFetch("/medicines",    { method: "POST",   body: payload }); },
  update(id, payload) { return apiFetch(`/medicines/${id}`, { method: "PATCH", body: payload }); },
  remove(id)          { return apiFetch(`/medicines/${id}`, { method: "DELETE" }); },
};

// ─── History (dose_logs) ──────────────────────────────────────────────────────
export const history = {
  list({ date, limit = 100, offset = 0 } = {}) {
    const qs = new URLSearchParams({ limit, offset, ...(date ? { date } : {}) });
    return apiFetch(`/history?${qs}`);
  },

  log({ medicine_id, status, scheduled_time, snoozed = false }) {
    return apiFetch("/history", { method: "POST", body: { medicine_id, status, scheduled_time, snoozed } });
  },

  remove(id)   { return apiFetch(`/history/${id}`, { method: "DELETE" }); },
  clearAll()   { return apiFetch("/history",        { method: "DELETE" }); },
};

// ─── Fired keys ───────────────────────────────────────────────────────────────
export const fired = {
  get(date)      { return apiFetch(`/fired?date=${date}`); },
  add(keys)      { return apiFetch("/fired", { method: "POST", body: { keys } }); },
  purge(before)  { return apiFetch(`/fired?before=${before}`, { method: "DELETE" }); },
};
