import { useState, useCallback, useMemo, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, CartesianGrid,
} from "recharts";

// ── constants ─────────────────────────────────────────────────────────────────

const KG_TO_LBS = 2.20462;

const COLORS = {
  bg: "#0a0a0f", surface: "#12121a", card: "#1a1a26", border: "#2a2a3d",
  accent: "#6ee7b7", accent2: "#818cf8", accent3: "#f472b6",
  warn: "#fb923c", text: "#e2e8f0", muted: "#64748b",
};

const MUSCLE_MAP = {
  "barbell bench press": "Chest", "dumbbell bench press": "Chest",
  "incline bench press": "Chest", "cable fly": "Chest", "chest fly": "Chest",
  "push up": "Chest", "pushup": "Chest", "bench press": "Chest",
  "squat": "Quads", "leg press": "Quads", "hack squat": "Quads", "leg extension": "Quads",
  "romanian deadlift": "Hamstrings", "leg curl": "Hamstrings", "deadlift": "Hamstrings",
  "barbell row": "Back", "cable row": "Back", "lat pulldown": "Back",
  "pull up": "Back", "pullup": "Back", "chin up": "Back", "t-bar row": "Back", "seated row": "Back",
  "overhead press": "Shoulders", "shoulder press": "Shoulders", "lateral raise": "Shoulders",
  "front raise": "Shoulders", "face pull": "Shoulders",
  "barbell curl": "Biceps", "dumbbell curl": "Biceps", "hammer curl": "Biceps",
  "cable curl": "Biceps", "bicep curl": "Biceps", "biceps curl": "Biceps",
  "ez bar curl": "Biceps", "ez-bar curl": "Biceps", "preacher curl": "Biceps",
  "concentration curl": "Biceps", "spider curl": "Biceps", "incline curl": "Biceps", "curl": "Biceps",
  "tricep": "Triceps", "triceps": "Triceps", "skull crusher": "Triceps",
  "close grip bench": "Triceps", "dip": "Triceps", "pushdown": "Triceps",
  "calf raise": "Calves", "standing calf": "Calves",
  "plank": "Core", "crunch": "Core", "ab": "Core", "sit up": "Core", "side bend": "Core", "oblique": "Core", "russian twist": "Core", "leg raise": "Core",
  "glute": "Glutes", "hip thrust": "Glutes",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function getMuscle(name) {
  const n = name.toLowerCase();
  for (const [key, muscle] of Object.entries(MUSCLE_MAP)) {
    if (n.includes(key)) return muscle;
  }
  return "Other";
}

async function fetchAllWorkouts(apiKey) {
  const all = [];
  let page = 1, pageCount = 1;
  while (page <= pageCount) {
    const res = await fetch(`https://api.hevyapp.com/v1/workouts?page=${page}&pageSize=10`, {
      headers: { "api-key": apiKey },
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key" : "Failed to fetch workouts");
    const data = await res.json();
    pageCount = data.page_count;
    all.push(...data.workouts);
    page++;
  }
  return all;
}

function workoutsToRows(workouts) {
  const rows = [];
  workouts.forEach(workout => {
    workout.exercises.forEach(exercise => {
      exercise.sets.forEach(set => {
        if (set.type === "warmup") return;
        if (!set.reps || !set.weight_kg) return;
        rows.push({
          date: workout.start_time,
          exercise: exercise.title,
          sets: 1,
          reps: set.reps,
          weight: set.weight_kg * KG_TO_LBS,
        });
      });
    });
  });
  return rows;
}

function groupByExercise(rows) {
  const map = {};
  rows.forEach(r => {
    if (!map[r.exercise]) map[r.exercise] = [];
    map[r.exercise].push(r);
  });
  return map;
}

function e1rm(weight, reps) {
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

function analyzeExercise(rows) {
  const byDate = {};
  rows.forEach(r => {
    const d = r.date.split("T")[0].split(" ")[0];
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });

  const sessions = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sets]) => {
      const best = Math.max(...sets.map(s => e1rm(s.weight, s.reps)));
      const vol = sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
      return { date, best, vol, sets: sets.length };
    });

  const recent = sessions.slice(-6);
  const recentMax = recent.length ? Math.max(...recent.map(s => s.best)) : 0;
  const overallMax = sessions.length ? Math.max(...sessions.map(s => s.best)) : 0;
  const stalled = sessions.length >= 4 && recentMax < overallMax * 1.01;

  // date when the all-time PR was achieved
  const prSession = sessions.find(s => s.best === overallMax);
  const prDate = prSession?.date ?? null;

  const forRegression = sessions.slice(-8);
  let predictedPR = null;
  let slope = 0;
  if (forRegression.length >= 3) {
    const n = forRegression.length;
    const xs = forRegression.map((_, i) => i);
    const ys = forRegression.map(s => s.best);
    const mx = xs.reduce((a, b) => a + b) / n;
    const my = ys.reduce((a, b) => a + b) / n;
    slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
           / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    predictedPR = my + slope * (n + 2);
  }

  const last3Vol = sessions.slice(-3).map(s => s.vol);
  const prev3Vol = sessions.slice(-6, -3).map(s => s.vol);
  const avgLast = last3Vol.length ? last3Vol.reduce((a, b) => a + b) / last3Vol.length : 0;
  const avgPrev = prev3Vol.length ? prev3Vol.reduce((a, b) => a + b) / prev3Vol.length : 1;
  const deloadSuggested = stalled && avgLast > avgPrev * 0.85;

  return { sessions, stalled, predictedPR, deloadSuggested, overallMax, prDate, slope };
}

function getMuscleFatigue(rows) {
  const now = new Date();
  const cutoff = new Date(now - 14 * 86400000);
  const recent = rows.filter(r => new Date(r.date) >= cutoff);
  const freq = {};
  recent.forEach(r => {
    const m = getMuscle(r.exercise);
    freq[m] = (freq[m] || 0) + (r.sets || 1);
  });
  return freq;
}

function getWeeklyVolume(rows) {
  const weeks = {};
  rows.forEach(r => {
    const d = new Date(r.date);
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(d.getTime() + diff * 86400000);
    const key = mon.toISOString().slice(0, 10);
    weeks[key] = (weeks[key] || 0) + r.weight * r.reps;
  });
  return Object.entries(weeks)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-16)
    .map(([week, vol]) => ({ week: week.slice(5), vol: Math.round(vol / 1000) }));
}

function getRecentSessions(rows, n = 6) {
  const byDate = {};
  rows.forEach(r => {
    const d = r.date.split("T")[0];
    if (!byDate[d]) byDate[d] = [];
    if (!byDate[d].includes(r.exercise)) byDate[d].push(r.exercise);
  });
  return Object.entries(byDate)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, n)
    .map(([date, exercises]) => ({ date, exercises }));
}

function fmtVol(lbs) {
  if (lbs >= 1_000_000) return (lbs / 1_000_000).toFixed(1) + "M";
  if (lbs >= 1_000) return Math.round(lbs / 1_000) + "K";
  return Math.round(lbs).toString();
}

function daysAgoLabel(dateStr) {
  if (!dateStr) return "—";
  const now = new Date();
  const localToday = now.toLocaleDateString("en-CA");       // "YYYY-MM-DD" in local time
  const localYest  = new Date(now - 86400000).toLocaleDateString("en-CA");
  if (dateStr === localToday) return "Today";
  if (dateStr === localYest)  return "Yesterday";
  const diff = Math.round((new Date(localToday) - new Date(dateStr)) / 86400000);
  return `${diff}d ago`;
}

// ── ui components ─────────────────────────────────────────────────────────────

const TAG = ({ color, children }) => (
  <span style={{
    background: color + "22", color, border: `1px solid ${color}44`,
    borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, letterSpacing: 1,
  }}>{children}</span>
);

const Card = ({ children, style = {} }) => (
  <div style={{
    background: COLORS.card, border: `1px solid ${COLORS.border}`,
    borderRadius: 12, padding: 20, ...style,
  }}>{children}</div>
);

const SectionLabel = ({ children }) => (
  <div style={{
    fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13,
    color: COLORS.muted, letterSpacing: 2, textTransform: "uppercase",
    marginBottom: 12,
  }}>{children}</div>
);

function Spinner() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" style={{ animation: "spin 0.8s linear infinite", display: "block" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4" strokeDashoffset="10" />
    </svg>
  );
}

function StatCard({ label, value, color, sub }) {
  return (
    <Card style={{ textAlign: "center", padding: "18px 12px" }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || COLORS.text, lineHeight: 1, letterSpacing: "-0.5px" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 3, fontWeight: 500 }}>{sub}</div>}
      <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 6 }}>{label}</div>
    </Card>
  );
}

function WeeklyVolumeChart({ data }) {
  return (
    <Card style={{ padding: "20px 16px 12px" }}>
      <SectionLabel>Weekly Volume (K lbs)</SectionLabel>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} barSize={14}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
          <XAxis dataKey="week" tick={{ fill: COLORS.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: COLORS.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
          <Tooltip
            contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text }}
            formatter={v => [`${v}K lbs`, "Volume"]}
          />
          <Bar dataKey="vol" fill={COLORS.accent2} radius={[4, 4, 0, 0]} opacity={0.85} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function RecentSessions({ sessions }) {
  return (
    <Card style={{ padding: 20 }}>
      <SectionLabel>Recent Sessions</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sessions.map(({ date, exercises }) => (
          <div key={date} style={{ borderBottom: `1px solid ${COLORS.border}`, paddingBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>{date}</span>
              <span style={{ fontSize: 11, color: COLORS.muted }}>{daysAgoLabel(date)}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {exercises.map(ex => (
                <span key={ex} style={{
                  fontSize: 11, background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                  borderRadius: 4, padding: "2px 7px", color: COLORS.muted,
                }}>{ex}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MuscleSection({ fatigue }) {
  const muscles = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core"];
  const max = Math.max(...muscles.map(m => fatigue[m] || 0), 1);
  const data = muscles.map(m => ({ muscle: m, sets: fatigue[m] || 0, pct: Math.round(((fatigue[m] || 0) / max) * 100) }));
  const sorted = [...data].sort((a, b) => b.sets - a.sets);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <Card>
        <SectionLabel>14-Day Muscle Frequency</SectionLabel>
        <ResponsiveContainer width="100%" height={220}>
          <RadarChart data={data}>
            <PolarGrid stroke={COLORS.border} />
            <PolarAngleAxis dataKey="muscle" tick={{ fill: COLORS.muted, fontSize: 11 }} />
            <Radar dataKey="sets" stroke={COLORS.accent2} fill={COLORS.accent2} fillOpacity={0.25} />
          </RadarChart>
        </ResponsiveContainer>
      </Card>
      <Card>
        <SectionLabel>Sets per Muscle</SectionLabel>
        {sorted.map(({ muscle, sets }) => (
          <div key={muscle} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: COLORS.text, fontSize: 13 }}>{muscle}</span>
              <span style={{ color: COLORS.muted, fontSize: 13 }}>{sets} sets</span>
            </div>
            <div style={{ height: 6, background: COLORS.border, borderRadius: 3 }}>
              <div style={{
                height: 6, borderRadius: 3,
                width: `${(sets / (sorted[0]?.sets || 1)) * 100}%`,
                background: sets === 0 ? COLORS.warn : `linear-gradient(90deg, ${COLORS.accent2}, ${COLORS.accent})`,
                transition: "width 0.6s ease",
              }} />
            </div>
            {sets === 0 && <span style={{ color: COLORS.warn, fontSize: 11 }}>⚠ Not trained in 14 days</span>}
          </div>
        ))}
      </Card>
    </div>
  );
}

function ExerciseCard({ name, data }) {
  const { sessions, stalled, predictedPR, deloadSuggested, overallMax } = data;
  const chartData = sessions.slice(-12).map(s => ({ ...s, date: s.date.slice(5) }));

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: COLORS.text, flex: 1 }}>{name}</span>
        {stalled && <TAG color={COLORS.warn}>STALLED</TAG>}
        {deloadSuggested && <TAG color={COLORS.accent3}>DELOAD</TAG>}
        <TAG color={COLORS.accent}>{overallMax.toFixed(1)} lb PR</TAG>
        <span style={{ fontSize: 12, color: COLORS.muted }}>{sessions.length} sessions</span>
      </div>

      {predictedPR && (
        <div style={{ marginBottom: 12, padding: "8px 12px", background: COLORS.accent2 + "18", borderRadius: 8, borderLeft: `3px solid ${COLORS.accent2}` }}>
          <span style={{ color: COLORS.muted, fontSize: 12 }}>Predicted next PR: </span>
          <span style={{ color: COLORS.accent2, fontWeight: 700 }}>{predictedPR.toFixed(1)} lbs e1RM</span>
          {stalled && <span style={{ color: COLORS.muted, fontSize: 12 }}> — stalled, consider deloading first.</span>}
        </div>
      )}

      {deloadSuggested && (
        <div style={{ marginBottom: 12, padding: "8px 12px", background: COLORS.accent3 + "18", borderRadius: 8, borderLeft: `3px solid ${COLORS.accent3}` }}>
          <span style={{ color: COLORS.accent3, fontSize: 12 }}>Deload: reduce weight 10–15% for 1 week, then reset.</span>
        </div>
      )}

      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={chartData}>
          <XAxis dataKey="date" tick={{ fill: COLORS.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: COLORS.muted, fontSize: 10 }} width={42} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text }} />
          <Line type="monotone" dataKey="best" stroke={stalled ? COLORS.warn : COLORS.accent} strokeWidth={2} dot={false} name="e1RM (lbs)" />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ── main app ──────────────────────────────────────────────────────────────────

export default function App() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("hevy_api_key") || "");
  const [keyInput, setKeyInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState(() => localStorage.getItem("hevy_last_sync") || "");

  const loadData = useCallback(async (key) => {
    setLoading(true);
    setError("");
    try {
      const workouts = await fetchAllWorkouts(key);
      setRows(workoutsToRows(workouts));
      const now = new Date().toLocaleString();
      setLastSync(now);
      localStorage.setItem("hevy_last_sync", now);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (apiKey) loadData(apiKey);
  }, []); // eslint-disable-line

  const handleConnect = async () => {
    const key = keyInput.trim();
    if (!key) return;
    setApiKey(key);
    localStorage.setItem("hevy_api_key", key);
    setKeyInput("");
    await loadData(key);
  };

  const handleDisconnect = () => {
    localStorage.removeItem("hevy_api_key");
    localStorage.removeItem("hevy_last_sync");
    setApiKey(""); setRows(null); setLastSync("");
  };

  const exerciseData = useMemo(() => {
    if (!rows) return {};
    const grouped = groupByExercise(rows);
    const result = {};
    Object.entries(grouped).forEach(([name, r]) => {
      if (r.length >= 3) result[name] = analyzeExercise(r);
    });
    return result;
  }, [rows]);

  const fatigue     = useMemo(() => rows ? getMuscleFatigue(rows) : {}, [rows]);
  const weeklyVol   = useMemo(() => rows ? getWeeklyVolume(rows) : [], [rows]);
  const recentSess  = useMemo(() => rows ? getRecentSessions(rows) : [], [rows]);

  const stats = useMemo(() => {
    if (!rows) return null;
    const dates = [...new Set(rows.map(r => r.date.split("T")[0]))].sort();
    const totalSessions = dates.length;
    const totalVol = rows.reduce((s, r) => s + r.weight * r.reps, 0);
    const lastDate = dates[dates.length - 1] ?? null;

    let avgPerWeek = "—";
    if (dates.length >= 2) {
      const weeks = Math.max(1, (new Date(dates[dates.length - 1]) - new Date(dates[0])) / (7 * 86400000));
      avgPerWeek = (totalSessions / weeks).toFixed(1);
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const prsThisMonth = Object.values(exerciseData).filter(d => d.prDate && new Date(d.prDate) >= thirtyDaysAgo).length;

    const stalledCount = Object.values(exerciseData).filter(d => d.stalled).length;
    const deloadCount  = Object.values(exerciseData).filter(d => d.deloadSuggested).length;

    return { totalSessions, totalVol, avgPerWeek, lastDate, prsThisMonth, stalledCount, deloadCount };
  }, [rows, exerciseData]);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    return Object.entries(exerciseData)
      .filter(([name]) => name.toLowerCase().includes(f))
      .sort(([, a], [, b]) => (b.stalled ? 1 : 0) - (a.stalled ? 1 : 0));
  }, [exerciseData, filter]);

  return (
    <div style={{
      minHeight: "100vh", background: COLORS.bg, color: COLORS.text,
      fontFamily: "'DM Sans', sans-serif",
      backgroundImage: "radial-gradient(ellipse at 20% 20%, #1a1a3a 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, #0f1a2a 0%, transparent 60%)",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #12121a; }
        ::-webkit-scrollbar-thumb { background: #2a2a3d; border-radius: 3px; }
        button:hover { opacity: 0.85; }
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>

        {/* ── header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{
              fontFamily: "'Syne', sans-serif", fontSize: 30, fontWeight: 800,
              background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accent2})`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>HEVY ANALYTICS</div>
            <div style={{ color: COLORS.muted, marginTop: 4, fontSize: 13 }}>Progression · Fatigue · Deload detection</div>
          </div>
          {apiKey && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {lastSync && <span style={{ color: COLORS.muted, fontSize: 12 }}>Synced {lastSync}</span>}
              <button onClick={() => loadData(apiKey)} disabled={loading} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 8, border: `1px solid ${COLORS.accent}44`,
                background: COLORS.accent + "18", color: COLORS.accent, cursor: "pointer", fontSize: 13, fontWeight: 600,
              }}>
                {loading ? <Spinner /> : "↻"} Refresh
              </button>
              <button onClick={handleDisconnect} style={{
                padding: "8px 14px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
                background: "transparent", color: COLORS.muted, cursor: "pointer", fontSize: 13,
              }}>Disconnect</button>
            </div>
          )}
        </div>

        {/* ── connect screen ── */}
        {!apiKey && (
          <Card style={{ maxWidth: 480, margin: "0 auto", padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>🏋️</div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 20, color: COLORS.text, marginBottom: 8 }}>Connect your Hevy account</div>
            <div style={{ color: COLORS.muted, fontSize: 14, marginBottom: 24, lineHeight: 1.8 }}>
              <span style={{ color: COLORS.text, fontWeight: 600 }}>How to get your API key:</span><br />
              1. Go to <a href="https://hevy.com/settings?developer" target="_blank" rel="noreferrer" style={{ color: COLORS.accent }}>hevy.com/settings?developer</a><br />
              2. Copy your API key and paste it below<br />
              <span style={{ fontSize: 12 }}>Requires a Hevy Pro subscription.</span>
            </div>
            <input
              type="text" placeholder="Paste your API key..."
              value={keyInput} onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleConnect()}
              style={{
                width: "100%", padding: "11px 14px", marginBottom: 12,
                background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8,
                color: COLORS.text, fontSize: 14, outline: "none", fontFamily: "'DM Sans', sans-serif",
              }}
            />
            {error && <div style={{ color: COLORS.warn, fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <button onClick={handleConnect} disabled={loading || !keyInput.trim()} style={{
              width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
              background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accent2})`,
              color: COLORS.bg, fontWeight: 700, fontSize: 15, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: loading || !keyInput.trim() ? 0.6 : 1,
            }}>
              {loading ? <><Spinner /> Loading...</> : "Connect & Sync"}
            </button>
          </Card>
        )}

        {/* ── loading ── */}
        {apiKey && loading && !rows && (
          <div style={{ textAlign: "center", padding: 80, color: COLORS.muted }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><Spinner /></div>
            Fetching your workouts...
          </div>
        )}

        {/* ── error ── */}
        {apiKey && error && !rows && (
          <Card style={{ textAlign: "center", padding: 40 }}>
            <div style={{ color: COLORS.warn, marginBottom: 12 }}>{error}</div>
            <button onClick={handleDisconnect} style={{
              padding: "8px 20px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
              background: "transparent", color: COLORS.muted, cursor: "pointer",
            }}>Try a different key</button>
          </Card>
        )}

        {/* ── dashboard ── */}
        {rows && stats && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
              <StatCard label="Total Workouts"   value={stats.totalSessions}          color={COLORS.accent2} />
              <StatCard label="Total Volume"     value={fmtVol(stats.totalVol) + " lbs"} color={COLORS.accent} />
              <StatCard label="Avg / Week"       value={stats.avgPerWeek}             color={COLORS.accent} sub="sessions" />
              <StatCard label="PRs This Month"   value={stats.prsThisMonth}           color={COLORS.accent2} />
              <StatCard label="Stalled Lifts"    value={stats.stalledCount}           color={stats.stalledCount > 0 ? COLORS.warn : COLORS.muted} />
              <StatCard label="Last Workout"     value={daysAgoLabel(stats.lastDate)} color={COLORS.muted} sub={stats.lastDate} />
            </div>

            {/* volume chart + recent sessions */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
              <WeeklyVolumeChart data={weeklyVol} />
              <RecentSessions sessions={recentSess} />
            </div>

            {/* muscle balance */}
            <div>
              <MuscleSection fatigue={fatigue} />
            </div>

            {/* exercise progression */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <SectionLabel>Lift Progression</SectionLabel>
                <input
                  placeholder="Filter exercises..."
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  style={{
                    flex: 1, padding: "9px 14px", marginBottom: 0,
                    background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8,
                    color: COLORS.text, fontSize: 13, outline: "none", fontFamily: "'DM Sans', sans-serif",
                  }}
                />
                <span style={{ color: COLORS.muted, fontSize: 12, whiteSpace: "nowrap" }}>{filtered.length} exercises</span>
              </div>
              {filtered.length === 0 && (
                <div style={{ color: COLORS.muted, textAlign: "center", padding: 40 }}>
                  {Object.keys(exerciseData).length === 0
                    ? "Exercises need 3+ sessions to show progression."
                    : "No exercises match your filter."}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {filtered.map(([name, data]) => <ExerciseCard key={name} name={name} data={data} />)}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
