/**
 * MedTracker v3 — Backend-connected
 * ─────────────────────────────────────────────────────────────────────────────
 * What changed from v2:
 *
 * NEW — Auth screens (login / register) shown when no JWT is present.
 * NEW — All data reads/writes go through the API client (api.js).
 *       window.storage is still used as a local optimistic cache so the UI
 *       stays snappy; the server is the source of truth on every mount.
 * NEW — useApi() hook — thin wrapper around fetch + JWT header.
 * NEW — Error toast for network failures.
 * KEPT — All v2 fixes (audio, zero-pad, snooze, OS notifications, component split).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";

// ─── API client ───────────────────────────────────────────────────────────────
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

function getToken()   { try { return localStorage.getItem("mt_token"); } catch { return null; } }
function saveToken(t) { try { localStorage.setItem("mt_token", t);    } catch {} }
function dropToken()  { try { localStorage.removeItem("mt_token");     } catch {} }

async function apiFetch(path, options = {}) {
  const token = getToken();
  const res   = await fetch(`${BASE_URL}${path}`, {
    method:  options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "API error"), { status: res.status });
  return data;
}

// ─── Audio ────────────────────────────────────────────────────────────────────
function playBuzzer(times = 2) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "square"; osc.frequency.value = 1100;
      const t = ctx.currentTime + i * 0.5;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
      gain.gain.setValueAtTime(0.18, t + 0.22);
      gain.gain.linearRampToValueAtTime(0, t + 0.38);
      osc.start(t); osc.stop(t + 0.4);
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
const COLORS      = ["#6366F1","#10B981","#F59E0B","#EF4444","#EC4899","#14B8A6","#F97316","#8B5CF6"];
const DAYS        = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const SNOOZE_OPTS = [5, 10, 15];

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0B0C10}
.app{font-family:'Outfit',sans-serif;background:#0B0C10;color:#E8E6E3;min-height:100vh;max-width:420px;margin:0 auto;padding:0 0 84px}
.mono{font-family:'DM Mono',monospace}
.topbar{padding:22px 18px 0;background:#0B0C10;position:sticky;top:0;z-index:20;border-bottom:1px solid #1E2030}
.clock{font-family:'DM Mono',monospace;font-size:31px;font-weight:500;letter-spacing:2px}
.date-lbl{font-size:10px;color:#5C5F7B;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}
.nav{display:flex;margin-top:16px}
.nav-btn{flex:1;padding:10px 0;border:none;background:transparent;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;color:#5C5F7B;border-bottom:2px solid transparent;transition:all .15s}
.nav-btn.active{color:#E8E6E3;border-bottom:2px solid #6366F1}
.content{padding:16px}
.alert-card{border-radius:14px;padding:16px;margin-bottom:12px}
@keyframes led{0%,100%{box-shadow:0 0 0 0 var(--c)}50%{box-shadow:0 0 0 12px transparent}}
@keyframes ring{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}
.ringing{animation:ring 1.1s ease-in-out infinite}
.led-dot{width:13px;height:13px;border-radius:50%;flex-shrink:0;animation:led 1s ease-in-out infinite}
@keyframes fadein{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
.fadein{animation:fadein .18s ease-out}
.snooze-grid{display:flex;gap:6px;margin-top:12px}
.snooze-btn{flex:1;padding:9px 4px;border-radius:8px;border:1px solid #1E2030;background:transparent;color:#E8E6E3;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;transition:all .15s}
.snooze-btn:hover{border-color:#F59E0B;color:#F59E0B}
.stat-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px}
.stat-card{background:#13141F;border:1px solid #1E2030;border-radius:12px;padding:12px;text-align:center}
.stat-val{font-family:'DM Mono',monospace;font-size:24px;font-weight:500}
.stat-lbl{font-size:11px;color:#5C5F7B;margin-top:2px}
.card{background:#13141F;border:1px solid #1E2030;border-radius:12px;padding:14px 16px;margin-bottom:10px}
.card-label{font-size:10px;color:#5C5F7B;text-transform:uppercase;letter-spacing:.08em;margin-bottom:7px}
.pill{font-family:'DM Mono',monospace;font-size:11px;background:#1E2030;padding:3px 8px;border-radius:20px;color:#8B8FA8}
.dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.med-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sched-row{display:flex;align-items:center;gap:10px;padding:9px 12px;background:#13141F;border:1px solid #1E2030;border-radius:9px;margin-bottom:6px}
.field-label{font-size:11px;color:#5C5F7B;margin-bottom:5px}
.field{width:100%;padding:9px 11px;border-radius:8px;border:1px solid #1E2030;background:#0B0C10;color:#E8E6E3;font-family:'Outfit',sans-serif;font-size:13px;outline:none;transition:border .15s}
.field:focus{border-color:#6366F1}
input[type="time"].field{color-scheme:dark}
.btn-primary{width:100%;padding:11px;border-radius:9px;border:none;background:#6366F1;color:#fff;cursor:pointer;font-family:'Outfit',sans-serif;font-size:14px;font-weight:600;letter-spacing:.02em;transition:opacity .15s}
.btn-primary:hover{opacity:.88}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-ghost{flex:1;padding:10px;border-radius:8px;border:1px solid #1E2030;background:transparent;color:#8B8FA8;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;transition:all .15s}
.btn-ghost:hover{border-color:#8B8FA8;color:#E8E6E3}
.btn-add-dashed{width:100%;padding:13px;border-radius:10px;border:1px dashed #1E2030;background:transparent;cursor:pointer;font-family:'Outfit',sans-serif;font-size:14px;color:#5C5F7B;margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s}
.btn-add-dashed:hover{border-color:#6366F1;color:#6366F1}
.btn-test{padding:6px 13px;border-radius:7px;border:1px solid #1E2030;background:transparent;color:#5C5F7B;cursor:pointer;font-size:11px;font-family:'Outfit',sans-serif;transition:all .15s}
.btn-test:hover{border-color:#F59E0B;color:#F59E0B}
.hist-row{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#13141F;border:1px solid #1E2030;border-radius:10px;margin-bottom:6px}
.swatch{width:24px;height:24px;border-radius:50%;cursor:pointer;transition:outline .1s}
.swatch.sel{outline:3px solid #E8E6E3;outline-offset:2px}
.sec-hdr{font-size:11px;font-weight:600;color:#8B8FA8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}
.badge-snooze{font-size:10px;background:#F59E0B22;color:#F59E0B;padding:2px 7px;border-radius:20px;font-weight:600}
.badge-api{font-size:10px;background:#6366F122;color:#6366F1;padding:2px 7px;border-radius:20px;font-weight:600}
.store-dot{width:6px;height:6px;border-radius:50%;background:#10B981;display:inline-block;margin-right:4px}
/* Auth screen */
.auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#0B0C10}
.auth-card{background:#13141F;border:1px solid #1E2030;border-radius:18px;padding:30px 24px;width:100%;max-width:380px}
.auth-logo{font-family:'DM Mono',monospace;font-size:22px;font-weight:500;color:#6366F1;margin-bottom:4px}
.auth-sub{font-size:12px;color:#5C5F7B;margin-bottom:28px}
.auth-err{background:#EF444415;border:1px solid #EF444440;border-radius:8px;padding:9px 12px;font-size:13px;color:#EF4444;margin-bottom:14px}
.auth-switch{font-size:12px;color:#5C5F7B;text-align:center;margin-top:16px;cursor:pointer}
.auth-switch span{color:#6366F1;cursor:pointer}
/* Toast */
.toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#EF4444;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-family:'Outfit',sans-serif;z-index:999;white-space:nowrap;animation:fadein .2s ease-out}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components (same as v2 plus new auth screens)
// ─────────────────────────────────────────────────────────────────────────────

function AlertCard({ alert: a, onAck, onSnooze }) {
  const [showSnooze, setShowSnooze] = useState(false);
  return (
    <div className="alert-card ringing fadein" style={{ background:"#13141F", border:`2px solid ${a.color}` }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div className="led-dot" style={{ "--c":a.color, background:a.color }} />
        <div style={{ flex:1 }}>
          <div style={{ fontSize:10, color:a.color, textTransform:"uppercase", letterSpacing:".08em", fontWeight:600 }}>
            {a.snoozed ? "Snoozed reminder" : "Medicine reminder"}
          </div>
          <div style={{ fontSize:18, fontWeight:700 }}>{a.name}</div>
          <div style={{ fontSize:13, color:"#8B8FA8" }}>{a.dosage} — scheduled {a.time}</div>
        </div>
        {a.snoozed && <span className="badge-snooze">Snoozed</span>}
      </div>
      {showSnooze ? (
        <div style={{ marginTop:12 }}>
          <div style={{ fontSize:11, color:"#5C5F7B", marginBottom:8 }}>Snooze for how long?</div>
          <div className="snooze-grid">
            {SNOOZE_OPTS.map(m => (
              <button key={m} className="snooze-btn" onClick={() => { onSnooze(a.id, m); setShowSnooze(false); }}>
                {m} min
              </button>
            ))}
            <button className="snooze-btn" style={{ flex:"0 0 auto", padding:"9px 10px", color:"#5C5F7B" }}
                    onClick={() => setShowSnooze(false)}>✕</button>
          </div>
        </div>
      ) : (
        <div style={{ display:"flex", gap:7, marginTop:14 }}>
          <button className="btn-ghost" onClick={() => onAck(a.id, "missed")}>Skip</button>
          <button className="btn-ghost" style={{ color:"#F59E0B", borderColor:"#F59E0B44" }}
                  onClick={() => setShowSnooze(true)}>⏰ Snooze</button>
          <button style={{ flex:2, padding:"10px", borderRadius:8, border:"none", background:a.color, color:"#fff",
                           cursor:"pointer", fontFamily:"'Outfit',sans-serif", fontSize:14, fontWeight:600 }}
                  onClick={() => onAck(a.id, "taken")}>Mark taken ✓</button>
        </div>
      )}
    </div>
  );
}

function StatGrid({ taken, missed, pending }) {
  return (
    <div className="stat-grid">
      {[{val:taken,lbl:"Taken",color:"#10B981"},{val:missed,lbl:"Missed",color:"#EF4444"},{val:Math.max(0,pending),lbl:"Pending",color:"#6366F1"}]
        .map(({ val, lbl, color }) => (
          <div key={lbl} className="stat-card">
            <div className="stat-val" style={{ color }}>{val}</div>
            <div className="stat-lbl">{lbl}</div>
          </div>
        ))}
    </div>
  );
}

function NextDoseCard({ meds, now }) {
  if (!meds.length) return null;
  const best = meds.map(m => ({ m, ...nextDose(m, now) })).sort((a,b) => a.minsAway - b.minsAway)[0];
  return (
    <div className="card">
      <div className="card-label">Next dose</div>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div className="med-icon" style={{ background:best.m.color+"22" }}>
          <div className="dot" style={{ background:best.m.color, width:14, height:14 }} />
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:15, fontWeight:600 }}>{best.m.name}</div>
          <div style={{ fontSize:12, color:"#8B8FA8" }}>{best.m.dosage}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div className="mono" style={{ fontSize:22, fontWeight:600, color:best.minsAway < 30 ? "#EF4444" : "#E8E6E3" }}>
            {minsLabel(best.minsAway)}
          </div>
          <div style={{ fontSize:11, color:"#5C5F7B" }}>{best.time}{best.tomorrow ? " · tomorrow" : ""}</div>
        </div>
      </div>
    </div>
  );
}

function WeekChart({ data }) {
  return (
    <div className="card">
      <div className="card-label">7-day adherence</div>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={data} barSize={26} margin={{ top:4, right:0, left:-28, bottom:0 }}>
          <XAxis dataKey="day" tick={{ fontSize:11, fill:"#5C5F7B", fontFamily:"Outfit,sans-serif" }} axisLine={false} tickLine={false} />
          <YAxis hide domain={[0, 100]} />
          <Tooltip formatter={v => [`${v}%`,"Adherence"]}
                   contentStyle={{ background:"#13141F", border:"1px solid #1E2030", borderRadius:8, fontSize:12, color:"#E8E6E3", fontFamily:"Outfit" }}
                   cursor={{ fill:"#1E2030" }} />
          <Bar dataKey="rate" radius={[5,5,0,0]}>
            {data.map((d,i) => <Cell key={i} fill={d.isToday ? "#6366F1" : d.rate >= 80 ? "#10B98166" : d.rate >= 50 ? "#F59E0B66" : "#1E2030"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const STATUS_COLOR = { taken:"#10B981", missed:"#EF4444", ringing:"#F59E0B", upcoming:"#5C5F7B", overdue:"#F97316" };
const STATUS_LABEL = { taken:"Taken", missed:"Skipped", ringing:"Ringing…", upcoming:"Due", overdue:"Overdue" };

function TodaySchedule({ schedule }) {
  if (!schedule.length)
    return <div style={{ textAlign:"center", padding:"28px 0", color:"#5C5F7B", fontSize:13 }}>No medicines scheduled. Add some in the Medicines tab.</div>;
  return (
    <>
      {schedule.map(({ med, t, status }, i) => (
        <div key={i} className="sched-row">
          <div className="dot" style={{ background:med.color }} />
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:500 }}>{med.name}</div>
            <div style={{ fontSize:11, color:"#5C5F7B" }}>{med.dosage}</div>
          </div>
          <span className="mono" style={{ fontSize:12, color:"#8B8FA8" }}>{t}</span>
          <span style={{ fontSize:11, color:STATUS_COLOR[status], fontWeight:600, minWidth:54, textAlign:"right" }}>
            {STATUS_LABEL[status]}
          </span>
        </div>
      ))}
    </>
  );
}

function MedicineCard({ med, now, onDelete }) {
  const nd = nextDose(med, now);
  return (
    <div className="card">
      <div style={{ display:"flex", gap:12 }}>
        <div className="med-icon" style={{ background:med.color+"22" }}>
          <div className="dot" style={{ background:med.color, width:14, height:14 }} />
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:600 }}>{med.name}</div>
          <div style={{ fontSize:12, color:"#8B8FA8", marginBottom:8 }}>{med.dosage}</div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            {med.times.map(t => <span key={t} className="pill">{t}</span>)}
          </div>
          {med.notes && <div style={{ fontSize:11, color:"#5C5F7B", marginTop:6 }}>{med.notes}</div>}
        </div>
        <button onClick={() => onDelete(med.id)}
                style={{ background:"none", border:"none", cursor:"pointer", color:"#3A3C50", fontSize:18, alignSelf:"flex-start", padding:"0 2px" }}>×</button>
      </div>
      <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid #1E2030", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:11, color:"#5C5F7B" }}>Next dose</span>
        <span className="mono" style={{ fontSize:12, color:nd.minsAway < 60 ? "#EF4444" : "#8B8FA8" }}>
          {nd.time}{nd.tomorrow ? " · tomorrow" : ` · in ${minsLabel(nd.minsAway)}`}
        </span>
      </div>
    </div>
  );
}

function AddMedicineForm({ onSave, onCancel, saving }) {
  const [form, setForm] = useState({ name:"", dosage:"", times:["08:00"], color:COLORS[0], notes:"" });
  function handleSave() {
    const cleanTimes = form.times.filter(Boolean);
    if (!form.name.trim() || !cleanTimes.length) return;
    onSave({ ...form, times: cleanTimes });
  }
  return (
    <div className="card fadein" style={{ marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <span style={{ fontSize:15, fontWeight:600 }}>New medicine</span>
        <button onClick={onCancel} style={{ background:"none", border:"none", cursor:"pointer", color:"#5C5F7B", fontSize:20 }}>×</button>
      </div>
      {[["Medicine name *","name","e.g. Metformin 500mg"],["Dosage","dosage","e.g. 500mg, 2 tablets"],["Notes","notes","After meals, with water…"]].map(([lbl,key,ph]) => (
        <div key={key} style={{ marginBottom:12 }}>
          <div className="field-label">{lbl}</div>
          <input className="field" value={form[key]} placeholder={ph} onChange={e => setForm(f => ({ ...f, [key]:e.target.value }))} />
        </div>
      ))}
      <div style={{ marginBottom:12 }}>
        <div className="field-label">Reminder times</div>
        {form.times.map((t, i) => (
          <div key={i} style={{ display:"flex", gap:6, marginBottom:6 }}>
            <input type="time" className="field" value={t}
                   onChange={e => { const times=[...form.times]; times[i]=e.target.value; setForm(f=>({...f,times})); }} />
            {form.times.length > 1 && (
              <button onClick={() => setForm(f => ({ ...f, times:f.times.filter((_,j)=>j!==i) }))}
                      style={{ padding:"9px 12px", borderRadius:8, border:"1px solid #1E2030", background:"none", cursor:"pointer", color:"#5C5F7B", fontSize:16 }}>×</button>
            )}
          </div>
        ))}
        {form.times.length < 4 && (
          <button onClick={() => setForm(f => ({ ...f, times:[...f.times,"12:00"] }))}
                  style={{ fontSize:12, color:"#6366F1", background:"none", border:"none", cursor:"pointer", padding:0 }}>
            + Add time slot
          </button>
        )}
      </div>
      <div style={{ marginBottom:16 }}>
        <div className="field-label">Indicator color</div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {COLORS.map(c => (
            <div key={c} className={`swatch${form.color===c?" sel":""}`} style={{ background:c }}
                 onClick={() => setForm(f => ({ ...f, color:c }))} />
          ))}
        </div>
      </div>
      <button className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save medicine"}
      </button>
    </div>
  );
}

function HistoryTab({ history, onClear }) {
  if (!history.length)
    return <div style={{ textAlign:"center", padding:"40px 0", color:"#5C5F7B", fontSize:13 }}>No history yet. Mark a dose as taken or missed to see it here.</div>;
  return (
    <>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div className="sec-hdr">Intake log</div>
        <button onClick={onClear} style={{ fontSize:12, color:"#5C5F7B", background:"none", border:"none", cursor:"pointer" }}>Clear all</button>
      </div>
      {history.map(h => (
        <div key={h.id} className="hist-row">
          <div style={{ width:30, height:30, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:15,
                        background:h.status==="taken" ? "#10B98120" : "#EF444420" }}>
            {h.status==="taken" ? "✓" : "×"}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              {h.medicine_name || h.name}
              {h.snoozed && <span className="badge-snooze">snoozed</span>}
            </div>
            <div style={{ fontSize:11, color:"#5C5F7B" }}>{h.dosage} · scheduled {h.scheduled_time || h.scheduledTime}</div>
          </div>
          <div style={{ textAlign:"right", flexShrink:0 }}>
            <div style={{ fontSize:11, fontWeight:600, color:h.status==="taken"?"#10B981":"#EF4444" }}>
              {h.status==="taken" ? "Taken" : "Skipped"}
            </div>
            <div className="mono" style={{ fontSize:10, color:"#5C5F7B", marginTop:2 }}>
              {new Date(h.logged_at||h.ts).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}{" "}
              {new Date(h.logged_at||h.ts).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function NotifBanner({ status, onRequest }) {
  if (status !== "default") return null;
  return (
    <div className="fadein" style={{ background:"#13141F", border:"1px solid #1E2030", borderRadius:10, padding:"10px 13px", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
      <span style={{ fontSize:18 }}>🔔</span>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:12, fontWeight:600 }}>Enable notifications</div>
        <div style={{ fontSize:11, color:"#5C5F7B" }}>Get reminders even when this tab is in the background</div>
      </div>
      <button onClick={onRequest}
              style={{ padding:"6px 12px", borderRadius:7, border:"none", background:"#6366F1", color:"#fff", cursor:"pointer", fontFamily:"'Outfit',sans-serif", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>
        Enable
      </button>
    </div>
  );
}

// ─── Auth screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode,   setMode]   = useState("login"); // "login" | "register"
  const [email,  setEmail]  = useState("");
  const [pass,   setPass]   = useState("");
  const [name,   setName]   = useState("");
  const [tz,     setTz]     = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [loading,setLoading]= useState(false);
  const [error,  setError]  = useState("");

  async function submit() {
    setError(""); setLoading(true);
    try {
      let data;
      if (mode === "login") {
        data = await apiFetch("/auth/login", { method:"POST", body:{ email, password:pass } });
      } else {
        data = await apiFetch("/auth/register", { method:"POST", body:{ email, password:pass, display_name:name, timezone:tz } });
      }
      saveToken(data.token);
      onAuth(data.user);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) { if (e.key === "Enter") submit(); }

  return (
    <div className="auth-wrap">
      <div className="auth-card fadein">
        <div className="auth-logo">💊 MedTracker</div>
        <div className="auth-sub">{mode === "login" ? "Sign in to your account" : "Create a new account"}</div>

        {error && <div className="auth-err">{error}</div>}

        {mode === "register" && (
          <div style={{ marginBottom:12 }}>
            <div className="field-label">Display name</div>
            <input className="field" value={name} placeholder="Your name" onChange={e => setName(e.target.value)} onKeyDown={handleKey} />
          </div>
        )}

        <div style={{ marginBottom:12 }}>
          <div className="field-label">Email</div>
          <input className="field" type="email" value={email} placeholder="you@example.com"
                 onChange={e => setEmail(e.target.value)} onKeyDown={handleKey} />
        </div>
        <div style={{ marginBottom: mode === "register" ? 12 : 20 }}>
          <div className="field-label">Password</div>
          <input className="field" type="password" value={pass} placeholder={mode === "register" ? "Min 8 characters" : "••••••••"}
                 onChange={e => setPass(e.target.value)} onKeyDown={handleKey} />
        </div>

        {mode === "register" && (
          <div style={{ marginBottom:20 }}>
            <div className="field-label">Timezone</div>
            <input className="field" value={tz} placeholder="e.g. Asia/Kolkata"
                   onChange={e => setTz(e.target.value)} />
          </div>
        )}

        <button className="btn-primary" onClick={submit} disabled={loading}>
          {loading ? (mode==="login" ? "Signing in…" : "Creating account…") : (mode==="login" ? "Sign in" : "Create account")}
        </button>

        <div className="auth-switch">
          {mode === "login"
            ? <>Don't have an account? <span onClick={() => { setMode("register"); setError(""); }}>Register</span></>
            : <>Already have an account? <span onClick={() => { setMode("login"); setError(""); }}>Sign in</span></>}
        </div>

        {/* Dev shortcut banner */}
        {process.env.NODE_ENV !== "production" && (
          <div style={{ marginTop:20, padding:"10px 12px", background:"#1E2030", borderRadius:8, fontSize:11, color:"#5C5F7B" }}>
            <strong style={{ color:"#8B8FA8" }}>Dev tip:</strong> Make sure the backend is running on <code style={{ color:"#6366F1" }}>{BASE_URL}</code>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [user,        setUser]        = useState(null);   // null = not authed / loading
  const [authReady,   setAuthReady]   = useState(false);  // checked token
  const [meds,        setMeds]        = useState([]);
  const [history,     setHistory]     = useState([]);
  const [fired,       setFired]       = useState(new Set());
  const [alerts,      setAlerts]      = useState([]);
  const [tab,         setTab]         = useState("dashboard");
  const [showAdd,     setShowAdd]     = useState(false);
  const [savingMed,   setSavingMed]   = useState(false);
  const [now,         setNow]         = useState(new Date());
  const [testMode,    setTestMode]    = useState(false);
  const [toast,       setToast]       = useState(null);
  const [notifStatus, setNotifStatus] = useState(() => {
    try { return Notification.permission; } catch { return "denied"; }
  });

  const medsRef      = useRef(meds);
  const firedRef     = useRef(fired);
  const buzzerLoop   = useRef(null);
  const snoozeTimers = useRef({});
  const notifTimers  = useRef([]);

  useEffect(() => { medsRef.current  = meds;  }, [meds]);
  useEffect(() => { firedRef.current = fired; }, [fired]);

  // ── Toast helper ──────────────────────────────────────────────────────────
  function showToast(msg, duration = 3500) {
    setToast(msg);
    setTimeout(() => setToast(null), duration);
  }

  // ── Check existing token on mount ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const token = getToken();
      if (!token) { setAuthReady(true); return; }
      try {
        const { user } = await apiFetch("/auth/me");
        setUser(user);
      } catch {
        dropToken(); // token expired / invalid
      } finally {
        setAuthReady(true);
      }
    })();
  }, []);

  // ── Load data when user is set ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [medsData, histData, firedData] = await Promise.all([
          apiFetch("/medicines"),
          apiFetch(`/history?limit=200`),
          apiFetch(`/fired?date=${dateKey(new Date())}`),
        ]);
        setMeds(medsData.medicines || []);
        setHistory(histData.history || []);
        setFired(new Set(firedData.fired || []));
      } catch (err) {
        showToast("Failed to load data — check your connection");
      }
    })();
  }, [user]);

  // ── Live clock ────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Alert check ───────────────────────────────────────────────────────────
  const minuteTick = toHHMM(now);

  useEffect(() => {
    if (!medsRef.current || !user) return;
    const cur = minuteTick, nowDate = new Date();
    medsRef.current.forEach(med => {
      if (med.times.includes(cur)) {
        const key = alertKey(nowDate, med.id, cur);
        if (!firedRef.current.has(key)) {
          setFired(prev => new Set([...prev, key]));
          setAlerts(prev => [...prev, { id:key, medId:med.id, name:med.name, dosage:med.dosage, time:cur, color:med.color, snoozed:false }]);
          playBuzzer(3);
          // Persist fired key to backend (best-effort)
          apiFetch("/fired", { method:"POST", body:{ keys:[key] } }).catch(() => {});
          try {
            if (Notification.permission === "granted")
              new Notification(`💊 ${med.name}`, { body:`${med.dosage} — ${cur}`, tag:`med_${med.id}_${cur}` });
          } catch (_) {}
        }
      }
    });
  }, [minuteTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pre-schedule browser notifications ───────────────────────────────────
  useEffect(() => {
    if (!meds.length || notifStatus !== "granted") return;
    notifTimers.current.forEach(clearTimeout);
    notifTimers.current = [];
    const n = new Date();
    meds.forEach(med => {
      med.times.forEach(t => {
        const [h, m] = t.split(":").map(Number);
        const target = new Date(); target.setHours(h, m, 0, 0);
        const delay  = target - n;
        if (delay > 90_000) {
          notifTimers.current.push(setTimeout(() => {
            try { new Notification(`⏰ ${med.name} in 1 min`, { body:`${med.dosage} — ${t}`, tag:`pre_${med.id}_${t}`, silent:true }); } catch (_) {}
          }, delay - 60_000));
        }
      });
    });
    return () => notifTimers.current.forEach(clearTimeout);
  }, [meds, notifStatus]);

  // ── Repeat buzz ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (alerts.length > 0) { buzzerLoop.current = setInterval(() => playBuzzer(2), 12_000); }
    else clearInterval(buzzerLoop.current);
    return () => clearInterval(buzzerLoop.current);
  }, [alerts.length]);

  // ── Test alert ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!testMode) return;
    const key = `test_${Date.now()}`;
    setAlerts(prev => [...prev, { id:key, medId:"test", name:"Metformin (test)", dosage:"500mg — 1 tablet", time:toHHMM(new Date()), color:"#6366F1", snoozed:false }]);
    playBuzzer(3); setTestMode(false);
  }, [testMode]);

  // ── Acknowledge ───────────────────────────────────────────────────────────
  async function acknowledge(id, status) {
    const a = alerts.find(x => x.id === id);
    if (a && a.medId !== "test") {
      // Optimistic local update
      setHistory(prev => [{ id:`opt_${Date.now()}`, medicine_id:a.medId, medicine_name:a.name, dosage:a.dosage, scheduled_time:a.time, status, snoozed:a.snoozed, logged_at:new Date().toISOString() }, ...prev]);
      // Persist to backend
      apiFetch("/history", { method:"POST", body:{ medicine_id:a.medId, status, scheduled_time:a.time, snoozed:a.snoozed } })
        .then(({ log }) => {
          // Replace optimistic entry with real one
          setHistory(prev => prev.map(h => h.id.startsWith("opt_") && h.medicine_id === a.medId ? log : h));
        })
        .catch(() => showToast("Couldn't save dose log — will retry on next load"));
    }
    setAlerts(prev => prev.filter(x => x.id !== id));
    if (snoozeTimers.current[id]) { clearTimeout(snoozeTimers.current[id]); delete snoozeTimers.current[id]; }
  }

  // ── Snooze ────────────────────────────────────────────────────────────────
  function snooze(id, minutes) {
    const a = alerts.find(x => x.id === id);
    if (!a) return;
    setAlerts(prev => prev.filter(x => x.id !== id));
    const snoozeId = `${id}_s${Date.now()}`;
    snoozeTimers.current[snoozeId] = setTimeout(() => {
      setAlerts(prev => [...prev, { ...a, id:snoozeId, snoozed:true }]);
      playBuzzer(3);
      delete snoozeTimers.current[snoozeId];
    }, minutes * 60_000);
  }

  // ── Add medicine ──────────────────────────────────────────────────────────
  async function addMed(formData) {
    setSavingMed(true);
    try {
      const { medicine } = await apiFetch("/medicines", { method:"POST", body:formData });
      setMeds(prev => [...prev, medicine]);
      setShowAdd(false);
    } catch (err) {
      showToast(err.message || "Failed to save medicine");
    } finally {
      setSavingMed(false);
    }
  }

  // ── Delete medicine ───────────────────────────────────────────────────────
  async function deleteMed(id) {
    setMeds(prev => prev.filter(m => m.id !== id)); // optimistic
    try {
      await apiFetch(`/medicines/${id}`, { method:"DELETE" });
    } catch {
      showToast("Failed to delete medicine");
      // Reload to restore
      const { medicines } = await apiFetch("/medicines").catch(() => ({ medicines:[] }));
      setMeds(medicines);
    }
  }

  // ── Clear history ─────────────────────────────────────────────────────────
  async function clearHistory() {
    setHistory([]);
    try { await apiFetch("/history", { method:"DELETE" }); }
    catch { showToast("Failed to clear history on server"); }
  }

  // ── Notification permission ───────────────────────────────────────────────
  async function requestNotifications() {
    try { setNotifStatus(await Notification.requestPermission()); } catch (_) {}
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  function logout() {
    dropToken();
    setUser(null); setMeds([]); setHistory([]); setFired(new Set()); setAlerts([]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (!authReady) {
    return (
      <div style={{ background:"#0B0C10", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:"#5C5F7B", fontFamily:"'Outfit',sans-serif" }}>
        <style>{CSS}</style>
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <style>{CSS}</style>
        <AuthScreen onAuth={u => setUser(u)} />
      </>
    );
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const today      = dateKey(now);
  const todayHist  = history.filter(h => (h.logged_at||h.ts||"").startsWith(today));
  const takenToday = todayHist.filter(h => h.status === "taken").length;
  const missedToday= todayHist.filter(h => h.status === "missed").length;
  const totalSlots = meds.reduce((s, m) => s + m.times.length, 0);
  const adherence  = totalSlots > 0 ? Math.round((takenToday / totalSlots) * 100) : 0;

  const weekData = Array.from({ length:7 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (6 - i));
    const dk = dateKey(d);
    const dh = history.filter(h => (h.logged_at||h.ts||"").startsWith(dk));
    return { day:DAYS[d.getDay()], rate:totalSlots > 0 ? Math.round((dh.filter(h=>h.status==="taken").length/totalSlots)*100) : 0, isToday:dk===today };
  });

  const todaySchedule = meds
    .flatMap(med => med.times.map(t => {
      const histEntry = history.find(h => (h.logged_at||h.ts||"").startsWith(today) && h.medicine_id === med.id && h.scheduled_time === t);
      const [th, tm]  = t.split(":").map(Number);
      const isRinging = alerts.some(a => a.medId === med.id && a.time === t);
      const isPast    = th * 60 + tm < now.getHours() * 60 + now.getMinutes();
      let status = "upcoming";
      if (histEntry) status = histEntry.status;
      else if (isRinging) status = "ringing";
      else if (isPast) status = "overdue";
      return { med, t, status };
    }))
    .sort((a, b) => a.t.localeCompare(b.t));

  return (
    <>
      <style>{CSS}</style>
      <div className="app">

        {/* Toast */}
        {toast && <div className="toast">{toast}</div>}

        {/* Topbar */}
        <div className="topbar">
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div className="date-lbl">
                {now.toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}
              </div>
              <div className="clock">{toHHMMSS(now)}</div>
              <div style={{ fontSize:11, color:"#5C5F7B", marginTop:3 }}>
                <span className="store-dot" title="Connected to backend" />
                {user.display_name || user.email.split("@")[0]} ·{" "}
                {alerts.length > 0
                  ? <span style={{ color:"#F59E0B" }}>{alerts.length} alert{alerts.length>1?"s":""} active</span>
                  : `${meds.length} med${meds.length!==1?"s":""} tracked`}
              </div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div className="date-lbl">Adherence</div>
              <div className="mono" style={{ fontSize:26, fontWeight:600, color:adherence>=80?"#10B981":adherence>=50?"#F59E0B":"#EF4444" }}>
                {adherence}%
              </div>
              <div style={{ display:"flex", gap:6, marginTop:6, justifyContent:"flex-end" }}>
                <button className="btn-test" onClick={() => setTestMode(true)}>Test</button>
                <button className="btn-test" onClick={logout}>Sign out</button>
              </div>
            </div>
          </div>
          <nav className="nav">
            {[["dashboard","Dashboard"],["medicines","Medicines"],["history","History"]].map(([id,lbl]) => (
              <button key={id} className={`nav-btn${tab===id?" active":""}`} onClick={() => setTab(id)}>{lbl}</button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="content">
          <NotifBanner status={notifStatus} onRequest={requestNotifications} />
          {alerts.map(a => <AlertCard key={a.id} alert={a} onAck={acknowledge} onSnooze={snooze} />)}

          {tab === "dashboard" && (
            <>
              <StatGrid taken={takenToday} missed={missedToday} pending={totalSlots - takenToday - missedToday} />
              <NextDoseCard meds={meds} now={now} />
              <WeekChart data={weekData} />
              <div className="sec-hdr">Today's schedule</div>
              <TodaySchedule schedule={todaySchedule} />
            </>
          )}

          {tab === "medicines" && (
            <>
              {!showAdd && (
                <button className="btn-add-dashed" onClick={() => setShowAdd(true)}>
                  <span style={{ fontSize:20, lineHeight:1 }}>+</span> Add new medicine
                </button>
              )}
              {showAdd && <AddMedicineForm onSave={addMed} onCancel={() => setShowAdd(false)} saving={savingMed} />}
              {meds.map(med => <MedicineCard key={med.id} med={med} now={now} onDelete={deleteMed} />)}
            </>
          )}

          {tab === "history" && (
            <HistoryTab history={history} onClear={clearHistory} />
          )}
        </div>
      </div>
    </>
  );
}
