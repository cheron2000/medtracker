# MedTracker Backend — Layer 1

Real REST API for MedTracker. Replaces `window.storage` with PostgreSQL + JWT auth, giving you multi-device sync, persistent history, and a real deduplication guard.

## Stack

| Piece | Tech |
|---|---|
| Runtime | Node.js ≥ 18 |
| Framework | Express 4 |
| Database | PostgreSQL 14+ |
| Auth | JWT (jsonwebtoken) + bcrypt |
| Security | helmet · cors · express-rate-limit |

---

## Quick start

### 1 — Prerequisites

- Node.js ≥ 18
- PostgreSQL 14+ running locally (or a managed instance)

### 2 — Create the database

```sql
-- in psql:
CREATE DATABASE medtracker;
```

### 3 — Configure environment

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET at minimum
```

Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4 — Install & migrate

```bash
npm install
npm run migrate       # creates all tables + indexes
```

### 5 — Run

```bash
npm run dev           # nodemon (auto-restart on save)
# or
npm start             # plain node
```

Server starts on `http://localhost:3001`.

---

## API Reference

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Uptime check |

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | None | Create account |
| POST | `/auth/login` | None | Get JWT token |
| GET | `/auth/me` | Bearer | Current user |
| PATCH | `/auth/me` | Bearer | Update display_name / timezone |

**Register / login body:**
```json
{ "email": "user@example.com", "password": "atleast8chars" }
```
**Register extras:** `display_name`, `timezone` (IANA string, e.g. `"Asia/Kolkata"`)

**Response:**
```json
{
  "token": "<jwt>",
  "user": { "id": "...", "email": "...", "display_name": "...", "timezone": "...", "created_at": "..." }
}
```

All subsequent requests need:
```
Authorization: Bearer <token>
```

---

### Medicines

| Method | Path | Description |
|---|---|---|
| GET | `/medicines` | List all active medicines |
| POST | `/medicines` | Create a medicine |
| GET | `/medicines/:id` | Single medicine |
| PATCH | `/medicines/:id` | Partial update |
| DELETE | `/medicines/:id` | Soft-delete (keeps history) |

**POST / PATCH body:**
```json
{
  "name":   "Metformin",
  "dosage": "500mg — 1 tablet",
  "times":  ["08:00", "20:00"],
  "color":  "#6366F1",
  "notes":  "After meals with water"
}
```

**Medicine object:**
```json
{
  "id": "uuid",
  "name": "Metformin",
  "dosage": "500mg — 1 tablet",
  "times": ["08:00", "20:00"],
  "color": "#6366F1",
  "notes": "After meals with water",
  "active": true,
  "created_at": "2025-01-22T08:00:00Z",
  "updated_at": "2025-01-22T08:00:00Z"
}
```

---

### History (dose logs)

| Method | Path | Description |
|---|---|---|
| GET | `/history` | Paginated log |
| GET | `/history?date=YYYY-MM-DD` | Single-day filter |
| GET | `/history?limit=50&offset=0` | Pagination |
| POST | `/history` | Log a dose event |
| DELETE | `/history/:id` | Delete single entry |
| DELETE | `/history` | Clear all history |

**POST body:**
```json
{
  "medicine_id":    "uuid",
  "status":         "taken",
  "scheduled_time": "08:00",
  "snoozed":        false
}
```

**History entry:**
```json
{
  "id": "uuid",
  "medicine_id": "uuid",
  "medicine_name": "Metformin",
  "dosage": "500mg — 1 tablet",
  "scheduled_time": "08:00",
  "status": "taken",
  "snoozed": false,
  "logged_at": "2025-01-22T08:03:00Z"
}
```

---

### Fired keys

| Method | Path | Description |
|---|---|---|
| GET | `/fired?date=YYYY-MM-DD` | Keys for a date (default: today) |
| POST | `/fired` | Add key(s) |
| DELETE | `/fired?before=YYYY-MM-DD` | Purge old keys |

**POST body (single):** `{ "key": "2025-01-22_<medicine_id>_08:00" }`
**POST body (bulk):**   `{ "keys": ["...", "..."] }`

---

## Schema

```
users       (id, email, password_hash, timezone, display_name, created_at, updated_at)
medicines   (id, user_id, name, dosage, times jsonb, color, notes, active, created_at, updated_at)
dose_logs   (id, user_id, medicine_id, medicine_name, dosage, scheduled_time, status, snoozed, logged_at)
fired_keys  (id, user_id, key, date, created_at)   ← unique(user_id, key), auto-purged after 2 days
```

---

## Frontend integration

Drop `src/MedTrackerV3.jsx` into your React project (replaces v2).

The app now shows **login / register screens** when no JWT is stored. After auth, all reads and writes go through the real API — `window.storage` is no longer used.

Set the API URL:
```bash
REACT_APP_API_URL=http://localhost:3001   # default
```

---

## Rate limits

| Scope | Window | Max requests |
|---|---|---|
| Global | 15 min | 300 |
| Auth endpoints | 15 min | 20 |

---

## What's next (Layer 2 — Push notifications)

1. Add a `ServiceWorker` to the React app
2. `POST /push/subscribe` — store `{ endpoint, keys }` per user
3. BullMQ job queue + `node-cron` every minute → `web-push.sendNotification()`
4. Deliver alerts even when the tab is fully closed

See the backend plan document for the full roadmap.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with nodemon (dev) |
| `npm start` | Start without nodemon (prod) |
| `npm run migrate` | Run UP migration |
| `npm run migrate:down` | Drop all tables (⚠️ destructive) |
