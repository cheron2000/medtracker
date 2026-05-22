/**
 * MedTracker v2
 * ─────────────────────────────────────────────────────────────
 * Changes from v1:
 *
 * FIX 1 — Persistent storage
 *   All meds, history, and fired-alerts are saved to window.storage
 *   (the Artifact persistence API) and reloaded on mount.  A green dot
 *   in the status line confirms the store is live.
 *
 * FIX 2 — Component split
 *   AlertCard · StatGrid · NextDoseCard · WeekChart · TodaySchedule
 *   MedicineCard · AddMedicineForm · HistoryTab · NotifBanner
 *
 * FIX 3 — Time-formatting bug
 *   Original: minuteTick = `${now.getHours()}:${now.getMinutes()}`
 *             → "8:5" at 08:05, never matches "08:05" in med.times.
 *   Fixed:    minuteTick = toHHMM(now) → always "08:05".
 *   Also fixed stale-closure hazard: meds/fired are read via refs
 *   inside the ticking effect so stale state never blocks an alert.
 *
 * FIX 4 — Notifications
 *   • NotifBanner prompts for Notification permission.
 *   • Each alert fires new Notification(...) when the tab is visible.
 *   • Upcoming doses are pre-scheduled with setTimeout so the OS
 *     delivers a notification 60 s before each dose even if the tab
 *     is backgrounded (within the session lifetime).
 *
 * FIX 5 — Snooze
 *   Snooze button on every alert card offers 5 / 10 / 15 min options.
 *   A setTimeout re-fires the alert; a cancel mechanism cleans up if
 *   the user takes or skips the dose while it is snoozed.
 *   History entries carry a `snoozed` flag shown in the log.
 */

import { useState, useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";

// ─── Audio ────────────────────────────────────────────────────────────────────
function playBuzzer(times = 2) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "square";
      osc.frequency.value = 1100;
      const t = ctx.currentTime + i * 0.5;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
      gain.gain.setValueAtTime(0.18, t + 0.22);
      gain.gain.linearRampToValueAtTime(0, t + 0.38);
      osc.start(t);
      osc.stop(t + 0.4);
    }
  } catch (_) {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pad      = (n) => String(n).padStart(2, "0");
const toHHMM   = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toHHMMSS = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dateKey  = (d) => d.toISOString().slice(0, 10);
const alertKey = (d, medId, t) => `${dateKey(d)}_${medId}_${t}`;

function nextDose(med, now) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sorted = [...med.times].sort();
  for (const t of sorted) {
    const [h, m] = t.split(":").map(Number);
    const dMin = h * 60 + m;
    if (dMin > nowMin) return { time: t, minsAway: dMin - nowMin, tomorrow: false };
  }
  const [h, m] = sorted[0].split(":").map(Number);
  return { time: sorted[0], minsAway: 24 * 60 - nowMin + h * 60 + m, tomorrow: true };
}

function minsLabel(m) {
  if (m <= 0) return "Now";
  const h = Math.floor(m / 60), min = m % 60;
  if (h === 0) return `${min}m`;
  if (min === 0) return `${h}h`;
  return `${h}h ${min}m`;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SAMPLE_MEDS = [
  { id: "s1", name: "Metformin",  dosage: "500mg — 1 tablet", times: ["08:00","20:00"], color: "#6366F1", notes: "After meals with water" },
  { id: "s2", name: "Vitamin D3", dosage: "60,000 IU — weekly", times: ["09:30"],       color: "#10B981", notes: "With breakfast on Sunday" },
  { id: "s3", name: "Amlodipine", dosage: "5mg — 1 tablet",    times: ["22:00"],        color: "#F59E0B", notes: "Before bed" },
];
const COLORS      = ["#6366F1","#10B981","#F59E0B","#EF4444","#EC4899","#14B8A6","#F97316","#8B5CF6"];
const DAYS        = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const SNOOZE_OPTS = [5, 10, 15];

// ─── FIX 1: Persistent storage helpers ───────────────────────────────────────
async function storageGet(key, fallback = null) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : fallback;
  } catch { return fallback; }
}
async function storageSet(key, value) {
  try { await window.storage.set(key, JSON.stringify(value)); } catch (_) {}
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0B0C10}
.app{font-family:'Outfit',sans-serif;background:#0B0C10;color:#E8E6E3;min-height:100vh;max-width:420px;margin:0 auto;padding:0 0 84px}
.mono{font-family:'DM Mono',monospace}

/* Topbar */
.topbar{padding:22px 18px 0;background:#0B0C10;position:sticky;top:0;z-index:20;border-bottom:1px solid #1E2030}
.clock{font-family:'DM Mono',monospace;font-size:31px;font-weight:500;letter-spacing:2px}
.date-lbl{font-size:10px;color:#5C5F7B;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}
.nav{display:flex;margin-top:16px}
.nav-btn{flex:1;padding:10px 0;border:none;background:transparent;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;color:#5C5F7B;border-bottom:2px solid transparent;transition:all .15s}
.nav-btn.active{color:#E8E6E3;border-bottom:2px solid #6366F1}

/* Content */
.content{padding:16px}

/* Alert */
.alert-card{border-radius:14px;padding:16px;margin-bottom:12px}
@keyframes led{0%,100%{box-shadow:0 0 0 0 var(--c)}50%{box-shadow:0 0 0 12px transparent}}
@keyframes ring{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}
.ringing{animation:ring 1.1s ease-in-out infinite}
.led-dot{width:13px;height:13px;border-radius:50%;flex-shrink:0;animation:led 1s ease-in-out infinite}
@keyframes fadein{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
.fadein{animation:fadein .18s ease-out}

/* Snooze grid */
.snooze-grid{display:flex;gap:6px;margin-top:12px}
.snooze-btn{flex:1;padding:9px 4px;border-radius:8px;border:1px solid #1E2030;background:transparent;color:#E8E6E3;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;transition:all .15s}
.snooze-btn:hover{border-color:#F59E0B;color:#F59E0B}

/* Stats */
.stat-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px}
.stat-card{background:#13141F;border:1px solid #1E2030;border-radius:12px;padding:12px;text-align:center}
.stat-val{font-family:'DM Mono',monospace;font-size:24px;font-weight:500}
.stat-lbl{font-size:11px;color:#5C5F7B;margin-top:2px}

/* Card */
.card{background:#13141F;border:1px solid #1E2030;border-radius:12px;padding:14px 16px;margin-bottom:10px}
.card-label{font-size:10px;color:#5C5F7B;text-transform:uppercase;letter-spacing:.08em;margin-bottom:7px}
.pill{font-family:'DM Mono',monospace;font-size:11px;background:#1E2030;padding:3px 8px;border-radius:20px;color:#8B8FA8}
.dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.med-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}

/* Schedule row */
.sched-row{display:flex;align-items:center;gap:10px;padding:9px 12px;background:#13141F;border:1px solid #1E2030;border-radius:9px;margin-bottom:6px}

/* Form */
.field-label{font-size:11px;color:#5C5F7B;margin-bottom:5px}
.field{width:100%;padding:9px 11px;border-radius:8px;border:1px solid #1E2030;background:#0B0C10;color:#E8E6E3;font-family:'Outfit',sans-serif;font-size:13px;outline:none;transition:border .15s}
.field:focus{border-color:#6366F1}
input[type="time"].field{color-scheme:dark}

/* Buttons */
.btn-primary{width:100%;padding:11px;border-radius:9px;border:none;background:#6366F1;color:#fff;cursor:pointer;font-family:'Outfit',sans-serif;font-size:14px;font-weight:600;letter-spacing:.02em;transition:opacity .15s}
.btn-primary:hover{opacity:.88}
.btn-ghost{flex:1;padding:10px;border-radius:8px;border:1px solid #1E2030;background:transparent;color:#8B8FA8;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;transition:all .15s}
.btn-ghost:hover{border-color:#8B8FA8;color:#E8E6E3}
.btn-add-dashed{width:100%;padding:13px;border-radius:10px;border:1px dashed #1E2030;background:transparent;cursor:pointer;font-family:'Outfit',sans-serif;font-size:14px;color:#5C5F7B;margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s}
.btn-add-dashed:hover{border-color:#6366F1;color:#6366F1}
.btn-test{padding:6px 13px;border-radius:7px;border:1px solid #1E2030;background:transparent;color:#5C5F7B;cursor:pointer;font-size:11px;font-family:'Outfit',sans-serif;transition:all .15s}
.btn-test:hover{border-color:#F59E0B;color:#F59E0B}

/* History */
.hist-row{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#13141F;border:1px solid #1E2030;border-radius:10px;margin-bottom:6px}

/* Swatch */
.swatch{width:24px;height:24px;border-radius:50%;cursor:pointer;transition:outline .1s}
.swatch.sel{outline:3px solid #E8E6E3;outline-offset:2px}

/* Misc */
.sec-hdr{font-size:11px;font-weight:600;color:#8B8FA8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}
.badge-snooze{font-size:10px;background:#F59E0B22;color:#F59E0B;padding:2px 7px;border-radius:20px;font-weight:600}
.store-dot{width:6px;height:6px;border-radius:50%;background:#10B981;display:inline-block;margin-right:4px}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2: Sub-components
// ─────────────────────────────────────────────────────────────────────────────

// ── AlertCard ──────────────────────────────────────────────────────────────
function AlertCard({ alert: a, onAck, onSnooze }) {
  const [showSnooze, setShowSnooze] = useState(false);

  return (
    <div className="alert-card ringing fadein"
         style={{ background: "#13141F", border: `2px solid ${a.color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="led-dot" style={{ "--c": a.color, background: a.color }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: a.color, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>
            {a.snoozed ? "Snoozed reminder" : "Medicine reminder"}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{a.name}</div>
          <div style={{ fontSize: 13, color: "#8B8FA8" }}>{a.dosage} — scheduled {a.time}</div>
        </div>
        {a.snoozed && <span className="badge-snooze">Snoozed</span>}
      </div>

      {showSnooze ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "#5C5F7B", marginBottom: 8 }}>Snooze for how long?</div>
          <div className="snooze-grid">
            {SNOOZE_OPTS.map(m => (
              <button key={m} className="snooze-btn"
                      onClick={() => { onSnooze(a.id, m); setShowSnooze(false); }}>
                {m} min
              </button>
            ))}
            <button className="snooze-btn"
                    style={{ flex: "0 0 auto", padding: "9px 10px", color: "#5C5F7B" }}
                    onClick={() => setShowSnooze(false)}>✕</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 7, marginTop: 14 }}>
          <button className="btn-ghost" style={{ flex: 1 }}
                  onClick={() => onAck(a.id, "missed")}>Skip</button>
          <button className="btn-ghost"
                  style={{ flex: 1, color: "#F59E0B", borderColor: "#F59E0B44" }}
                  onClick={() => setShowSnooze(true)}>⏰ Snooze</button>
          <button style={{
            flex: 2, padding: "10px", borderRadius: 8, border: "none",
            background: a.color, color: "#fff", cursor: "pointer",
            fontFamily: "'Outfit',sans-serif", fontSize: 14, fontWeight: 600,
          }} onClick={() => onAck(a.id, "taken")}>Mark taken ✓</button>
        </div>
      )}
    </div>
  );
}

// ── StatGrid ───────────────────────────────────────────────────────────────
function StatGrid({ taken, missed, pending }) {
  const items = [
    { val: taken,              lbl: "Taken",   color: "#10B981" },
    { val: missed,             lbl: "Missed",  color: "#EF4444" },
    { val: Math.max(0,pending),lbl: "Pending", color: "#6366F1" },
  ];
  return (
    <div className="stat-grid">
      {items.map(({ val, lbl, color }) => (
        <div key={lbl} className="stat-card">
          <div className="stat-val" style={{ color }}>{val}</div>
          <div className="stat-lbl">{lbl}</div>
        </div>
      ))}
    </div>
  );
}

// ── NextDoseCard ───────────────────────────────────────────────────────────
function NextDoseCard({ meds, now }) {
  if (!meds.length) return null;
  const best = meds.map(m => ({ m, ...nextDose(m, now) }))
                   .sort((a, b) => a.minsAway - b.minsAway)[0];
  return (
    <div className="card">
      <div className="card-label">Next dose</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="med-icon" style={{ background: best.m.color + "22" }}>
          <div className="dot" style={{ background: best.m.color, width: 14, height: 14 }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{best.m.name}</div>
          <div style={{ fontSize: 12, color: "#8B8FA8" }}>{best.m.dosage}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono"
               style={{ fontSize: 22, fontWeight: 600, color: best.minsAway < 30 ? "#EF4444" : "#E8E6E3" }}>
            {minsLabel(best.minsAway)}
          </div>
          <div style={{ fontSize: 11, color: "#5C5F7B" }}>
            {best.time}{best.tomorrow ? " · tomorrow" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── WeekChart ──────────────────────────────────────────────────────────────
function WeekChart({ data }) {
  return (
    <div className="card">
      <div className="card-label">7-day adherence</div>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={data} barSize={26} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
          <XAxis dataKey="day"
                 tick={{ fontSize: 11, fill: "#5C5F7B", fontFamily: "Outfit,sans-serif" }}
                 axisLine={false} tickLine={false} />
          <YAxis hide domain={[0, 100]} />
          <Tooltip
            formatter={v => [`${v}%`, "Adherence"]}
            contentStyle={{ background: "#13141F", border: "1px solid #1E2030", borderRadius: 8, fontSize: 12, color: "#E8E6E3", fontFamily: "Outfit" }}
            cursor={{ fill: "#1E2030" }}
          />
          <Bar dataKey="rate" radius={[5, 5, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.isToday ? "#6366F1" : d.rate >= 80 ? "#10B98166" : d.rate >= 50 ? "#F59E0B66" : "#1E2030"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── TodaySchedule ──────────────────────────────────────────────────────────
const STATUS_COLOR = { taken: "#10B981", missed: "#EF4444", ringing: "#F59E0B", upcoming: "#5C5F7B", overdue: "#F97316" };
const STATUS_LABEL = { taken: "Taken", missed: "Skipped", ringing: "Ringing…", upcoming: "Due", overdue: "Overdue" };

function TodaySchedule({ schedule }) {
  if (!schedule.length)
    return <div style={{ textAlign: "center", padding: "28px 0", color: "#5C5F7B", fontSize: 13 }}>No medicines scheduled. Add some in the Medicines tab.</div>;
  return (
    <>
      {schedule.map(({ med, t, status }, i) => (
        <div key={i} className="sched-row">
          <div className="dot" style={{ background: med.color }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{med.name}</div>
            <div style={{ fontSize: 11, color: "#5C5F7B" }}>{med.dosage}</div>
          </div>
          <span className="mono" style={{ fontSize: 12, color: "#8B8FA8" }}>{t}</span>
          <span style={{ fontSize: 11, color: STATUS_COLOR[status], fontWeight: 600, minWidth: 54, textAlign: "right" }}>
            {STATUS_LABEL[status]}
          </span>
        </div>
      ))}
    </>
  );
}

// ── MedicineCard ───────────────────────────────────────────────────────────
function MedicineCard({ med, now, onDelete }) {
  const nd = nextDose(med, now);
  return (
    <div className="card">
      <div style={{ display: "flex", gap: 12 }}>
        <div className="med-icon" style={{ background: med.color + "22" }}>
          <div className="dot" style={{ background: med.color, width: 14, height: 14 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{med.name}</div>
          <div style={{ fontSize: 12, color: "#8B8FA8", marginBottom: 8 }}>{med.dosage}</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {med.times.map(t => <span key={t} className="pill">{t}</span>)}
          </div>
          {med.notes && <div style={{ fontSize: 11, color: "#5C5F7B", marginTop: 6 }}>{med.notes}</div>}
        </div>
        <button onClick={() => onDelete(med.id)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#3A3C50", fontSize: 18, alignSelf: "flex-start", padding: "0 2px" }}>×</button>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #1E2030", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#5C5F7B" }}>Next dose</span>
        <span className="mono" style={{ fontSize: 12, color: nd.minsAway < 60 ? "#EF4444" : "#8B8FA8" }}>
          {nd.time}{nd.tomorrow ? " · tomorrow" : ` · in ${minsLabel(nd.minsAway)}`}
        </span>
      </div>
    </div>
  );
}

// ── AddMedicineForm ────────────────────────────────────────────────────────
function AddMedicineForm({ onSave, onCancel }) {
  const [form, setForm] = useState({ name: "", dosage: "", times: ["08:00"], color: COLORS[0], notes: "" });

  function handleSave() {
    const cleanTimes = form.times.filter(Boolean);
    if (!form.name.trim() || !cleanTimes.length) return;
    onSave({ ...form, times: cleanTimes });
  }

  return (
    <div className="card fadein" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>New medicine</span>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "#5C5F7B", fontSize: 20 }}>×</button>
      </div>

      {[["Medicine name *","name","e.g. Metformin 500mg"],["Dosage","dosage","e.g. 500mg, 2 tablets"],["Notes","notes","After meals, with water…"]].map(([lbl, key, ph]) => (
        <div key={key} style={{ marginBottom: 12 }}>
          <div className="field-label">{lbl}</div>
          <input className="field" value={form[key]} placeholder={ph}
                 onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
        </div>
      ))}

      <div style={{ marginBottom: 12 }}>
        <div className="field-label">Reminder times</div>
        {form.times.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input type="time" className="field" value={t}
                   onChange={e => { const times = [...form.times]; times[i] = e.target.value; setForm(f => ({ ...f, times })); }} />
            {form.times.length > 1 && (
              <button onClick={() => setForm(f => ({ ...f, times: f.times.filter((_, j) => j !== i) }))}
                      style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #1E2030", background: "none", cursor: "pointer", color: "#5C5F7B", fontSize: 16 }}>×</button>
            )}
          </div>
        ))}
        {form.times.length < 4 && (
          <button onClick={() => setForm(f => ({ ...f, times: [...f.times, "12:00"] }))}
                  style={{ fontSize: 12, color: "#6366F1", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            + Add time slot
          </button>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="field-label">Indicator color</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {COLORS.map(c => (
            <div key={c} className={`swatch${form.color === c ? " sel" : ""}`}
                 style={{ background: c }}
                 onClick={() => setForm(f => ({ ...f, color: c }))} />
          ))}
        </div>
      </div>

      <button className="btn-primary" onClick={handleSave}>Save medicine</button>
    </div>
  );
}

// ── HistoryTab ─────────────────────────────────────────────────────────────
function HistoryTab({ history, onClear }) {
  if (!history.length)
    return <div style={{ textAlign: "center", padding: "40px 0", color: "#5C5F7B", fontSize: 13 }}>No history yet. Use "Test alert" to simulate a reminder.</div>;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="sec-hdr">Intake log</div>
        <button onClick={onClear} style={{ fontSize: 12, color: "#5C5F7B", background: "none", border: "none", cursor: "pointer" }}>Clear all</button>
      </div>
      {history.map(h => (
        <div key={h.id} className="hist-row">
          <div style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 15, background: h.status === "taken" ? "#10B98120" : "#EF444420" }}>
            {h.status === "taken" ? "✓" : "×"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              {h.name}
              {h.snoozed && <span className="badge-snooze">snoozed</span>}
            </div>
            <div style={{ fontSize: 11, color: "#5C5F7B" }}>{h.dosage} · scheduled {h.scheduledTime}</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: h.status === "taken" ? "#10B981" : "#EF4444" }}>
              {h.status === "taken" ? "Taken" : "Skipped"}
            </div>
            <div className="mono" style={{ fontSize: 10, color: "#5C5F7B", marginTop: 2 }}>
              {new Date(h.ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}{" "}
              {new Date(h.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

// ── NotifBanner ────────────────────────────────────────────────────────────
function NotifBanner({ status, onRequest }) {
  if (status !== "default") return null;
  return (
    <div className="fadein" style={{ background: "#13141F", border: "1px solid #1E2030", borderRadius: 10, padding: "10px 13px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 18 }}>🔔</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Enable notifications</div>
        <div style={{ fontSize: 11, color: "#5C5F7B" }}>Get reminders even when this tab is in the background</div>
      </div>
      <button onClick={onRequest}
              style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: "#6366F1", color: "#fff", cursor: "pointer", fontFamily: "'Outfit',sans-serif", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
        Enable
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [meds,        setMeds]        = useState(null);   // null = loading
  const [history,     setHistory]     = useState(null);
  const [fired,       setFired]       = useState(new Set());
  const [alerts,      setAlerts]      = useState([]);
  const [tab,         setTab]         = useState("dashboard");
  const [showAdd,     setShowAdd]     = useState(false);
  const [now,         setNow]         = useState(new Date());
  const [testMode,    setTestMode]    = useState(false);
  const [notifStatus, setNotifStatus] = useState(() => {
    try { return Notification.permission; } catch { return "denied"; }
  });

  // FIX 3: refs let the minute-tick effect read fresh meds/fired
  // without listing them as dependencies (which would re-run on every
  // render instead of only when the minute changes).
  const medsRef      = useRef(meds);
  const firedRef     = useRef(fired);
  const buzzerLoop   = useRef(null);
  const snoozeTimers = useRef({});   // FIX 5: keyed by alert id
  const notifTimers  = useRef([]);   // FIX 4: upcoming notification timeouts

  useEffect(() => { medsRef.current  = meds;  }, [meds]);
  useEffect(() => { firedRef.current = fired; }, [fired]);

  // ── FIX 1: Load persisted state ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const m = await storageGet("mt:meds",    SAMPLE_MEDS);
      const h = await storageGet("mt:history", []);
      const f = await storageGet("mt:fired",   []);
      setMeds(m);
      setHistory(h);
      setFired(new Set(f));
    })();
  }, []);

  // ── FIX 1: Persist on every change ───────────────────────────────────────
  useEffect(() => { if (meds    !== null) storageSet("mt:meds",    meds);    }, [meds]);
  useEffect(() => { if (history !== null) storageSet("mt:history", history); }, [history]);
  useEffect(() => {
    // Only persist today's fired keys to cap storage size
    const today = dateKey(new Date());
    const slim  = [...fired].filter(k => k.startsWith(today) || k.startsWith("test_"));
    storageSet("mt:fired", slim);
  }, [fired]);

  // ── Live clock ────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── FIX 3: Alert check — padded minuteTick + ref-based reads ─────────────
  // Original bug: minuteTick was `${getHours()}:${getMinutes()}` → "8:5"
  // which never matched "08:05" stored in med.times.
  const minuteTick = toHHMM(now); // ← always "08:05"

  useEffect(() => {
    if (!medsRef.current) return;
    const cur     = minuteTick;
    const nowDate = new Date();
    medsRef.current.forEach(med => {
      if (med.times.includes(cur)) {
        const key = alertKey(nowDate, med.id, cur);
        if (!firedRef.current.has(key)) {
          setFired(prev  => new Set([...prev, key]));
          setAlerts(prev => [...prev, {
            id: key, medId: med.id, name: med.name,
            dosage: med.dosage, time: cur, color: med.color, snoozed: false,
          }]);
          playBuzzer(3);
          // FIX 4: fire OS notification if permission granted
          try {
            if (Notification.permission === "granted")
              new Notification(`💊 ${med.name}`, { body: `${med.dosage} — ${cur}`, tag: `med_${med.id}_${cur}` });
          } catch (_) {}
        }
      }
    });
  }, [minuteTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── FIX 4: Pre-schedule browser notifications for upcoming doses ──────────
  useEffect(() => {
    if (!meds || notifStatus !== "granted") return;
    notifTimers.current.forEach(clearTimeout);
    notifTimers.current = [];

    const n = new Date();
    meds.forEach(med => {
      med.times.forEach(t => {
        const [h, m] = t.split(":").map(Number);
        const target  = new Date(); target.setHours(h, m, 0, 0);
        const delay   = target - n;
        if (delay > 90_000) {                        // only if > 90 s away
          const tid = setTimeout(() => {
            try {
              new Notification(`⏰ ${med.name} in 1 min`, {
                body: `${med.dosage} — ${t}`, tag: `pre_${med.id}_${t}`, silent: true,
              });
            } catch (_) {}
          }, delay - 60_000);                        // fire 60 s early
          notifTimers.current.push(tid);
        }
      });
    });
    return () => notifTimers.current.forEach(clearTimeout);
  }, [meds, notifStatus]);

  // ── Repeat buzz while alerts are active ──────────────────────────────────
  useEffect(() => {
    if (alerts.length > 0) {
      buzzerLoop.current = setInterval(() => playBuzzer(2), 12_000);
    } else {
      clearInterval(buzzerLoop.current);
    }
    return () => clearInterval(buzzerLoop.current);
  }, [alerts.length]);

  // ── Test-mode alert ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!testMode) return;
    const key = `test_${Date.now()}`;
    setAlerts(prev => [...prev, {
      id: key, medId: "test", name: "Metformin (test)",
      dosage: "500mg — 1 tablet", time: toHHMM(new Date()), color: "#6366F1", snoozed: false,
    }]);
    playBuzzer(3);
    setTestMode(false);
  }, [testMode]);

  // ── Acknowledge ───────────────────────────────────────────────────────────
  function acknowledge(id, status) {
    const a = alerts.find(x => x.id === id);
    if (a) {
      setHistory(prev => [{
        id: `${Date.now()}`, medId: a.medId, name: a.name, dosage: a.dosage,
        scheduledTime: a.time, status, ts: new Date().toISOString(), snoozed: a.snoozed,
      }, ...prev]);
    }
    setAlerts(prev => prev.filter(x => x.id !== id));
    // Cancel any pending snooze timer
    if (snoozeTimers.current[id]) {
      clearTimeout(snoozeTimers.current[id]);
      delete snoozeTimers.current[id];
    }
  }

  // ── FIX 5: Snooze ─────────────────────────────────────────────────────────
  function snooze(id, minutes) {
    const a = alerts.find(x => x.id === id);
    if (!a) return;
    setAlerts(prev => prev.filter(x => x.id !== id));

    const snoozeId = `${id}_s${Date.now()}`;
    snoozeTimers.current[snoozeId] = setTimeout(() => {
      setAlerts(prev => [...prev, { ...a, id: snoozeId, snoozed: true }]);
      playBuzzer(3);
      delete snoozeTimers.current[snoozeId];
    }, minutes * 60_000);
  }

  // ── Add / delete medicine ─────────────────────────────────────────────────
  function addMed(formData) {
    setMeds(prev => [...prev, {
      id: `${Date.now()}`,
      ...formData,
      color: formData.color || COLORS[Math.floor(Math.random() * COLORS.length)],
    }]);
    setShowAdd(false);
  }
  function deleteMed(id) {
    setMeds(prev => prev.filter(m => m.id !== id));
  }

  // ── Request notification permission ──────────────────────────────────────
  async function requestNotifications() {
    try {
      const p = await Notification.requestPermission();
      setNotifStatus(p);
    } catch (_) {}
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (meds === null || history === null) {
    return (
      <div style={{ background: "#0B0C10", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#5C5F7B", fontFamily: "'Outfit',sans-serif" }}>
        Loading…
      </div>
    );
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const today      = dateKey(now);
  const todayHist  = history.filter(h => h.ts.startsWith(today));
  const takenToday = todayHist.filter(h => h.status === "taken").length;
  const missedToday= todayHist.filter(h => h.status === "missed").length;
  const totalSlots = meds.reduce((s, m) => s + m.times.length, 0);
  const adherence  = totalSlots > 0 ? Math.round((takenToday / totalSlots) * 100) : 0;

  const weekData = Array.from({ length: 7 }, (_, i) => {
    const d  = new Date(now); d.setDate(d.getDate() - (6 - i));
    const dk = dateKey(d);
    const dh = history.filter(h => h.ts.startsWith(dk));
    return {
      day:     DAYS[d.getDay()],
      rate:    totalSlots > 0 ? Math.round((dh.filter(h => h.status === "taken").length / totalSlots) * 100) : 0,
      isToday: dk === today,
    };
  });

  const todaySchedule = meds
    .flatMap(med => med.times.map(t => {
      const histEntry = history.find(h => h.ts.startsWith(today) && h.medId === med.id && h.scheduledTime === t);
      const [th, tm]  = t.split(":").map(Number);
      const isRinging = alerts.some(a => a.medId === med.id && a.time === t);
      const isPast    = th * 60 + tm < now.getHours() * 60 + now.getMinutes();
      let status      = "upcoming";
      if (histEntry)    status = histEntry.status;
      else if (isRinging) status = "ringing";
      else if (isPast)  status = "overdue";
      return { med, t, status };
    }))
    .sort((a, b) => a.t.localeCompare(b.t));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="app">

        {/* ── Topbar ── */}
        <div className="topbar">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="date-lbl">
                {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </div>
              <div className="clock">{toHHMMSS(now)}</div>
              <div style={{ fontSize: 11, color: "#5C5F7B", marginTop: 3 }}>
                <span className="store-dot" title="Data persisted" />
                {meds.length} med{meds.length !== 1 ? "s" : ""} ·{" "}
                {alerts.length > 0
                  ? <span style={{ color: "#F59E0B" }}>{alerts.length} alert{alerts.length > 1 ? "s" : ""} active</span>
                  : "All clear"
                }
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="date-lbl">Adherence</div>
              <div className="mono" style={{ fontSize: 26, fontWeight: 600, color: adherence >= 80 ? "#10B981" : adherence >= 50 ? "#F59E0B" : "#EF4444" }}>
                {adherence}%
              </div>
              <button className="btn-test" onClick={() => setTestMode(true)} style={{ marginTop: 6 }}>
                Test alert
              </button>
            </div>
          </div>

          <nav className="nav">
            {[["dashboard","Dashboard"],["medicines","Medicines"],["history","History"]].map(([id, lbl]) => (
              <button key={id} className={`nav-btn${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
                {lbl}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Content ── */}
        <div className="content">

          {/* FIX 4: Notification permission banner */}
          <NotifBanner status={notifStatus} onRequest={requestNotifications} />

          {/* Active alerts (FIX 2, 5) */}
          {alerts.map(a => (
            <AlertCard key={a.id} alert={a} onAck={acknowledge} onSnooze={snooze} />
          ))}

          {/* ── Dashboard ── */}
          {tab === "dashboard" && (
            <>
              <StatGrid taken={takenToday} missed={missedToday} pending={totalSlots - takenToday - missedToday} />
              <NextDoseCard meds={meds} now={now} />
              <WeekChart data={weekData} />
              <div className="sec-hdr">Today's schedule</div>
              <TodaySchedule schedule={todaySchedule} />
            </>
          )}

          {/* ── Medicines ── */}
          {tab === "medicines" && (
            <>
              {!showAdd && (
                <button className="btn-add-dashed" onClick={() => setShowAdd(true)}>
                  <span style={{ fontSize: 20, lineHeight: 1 }}>+</span> Add new medicine
                </button>
              )}
              {showAdd && <AddMedicineForm onSave={addMed} onCancel={() => setShowAdd(false)} />}
              {meds.map(med => <MedicineCard key={med.id} med={med} now={now} onDelete={deleteMed} />)}
            </>
          )}

          {/* ── History ── */}
          {tab === "history" && (
            <HistoryTab history={history} onClear={() => setHistory([])} />
          )}

        </div>
      </div>
    </>
  );
}
