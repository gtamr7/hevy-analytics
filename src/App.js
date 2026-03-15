import { useState, useCallback, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts";

// ── helpers ──────────────────────────────────────────────────────────────────

const KG_TO_LBS = 2.20462;

const MUSCLE_MAP = {
  "barbell bench press": "Chest", "dumbbell bench press": "Chest", "incline bench press": "Chest",
  "cable fly": "Chest", "chest fly": "Chest", "push up": "Chest", "pushup": "Chest",
  "bench press": "Chest",
  "squat": "Quads", "leg press": "Quads", "hack squat": "Quads", "leg extension": "Quads",
  "romanian deadlift": "Hamstrings", "leg curl": "Hamstrings", "deadlift": "Hamstrings",
  "barbell row": "Back", "cable row": "Back", "lat pulldown": "Back", "pull up": "Back",
  "pullup": "Back", "chin up": "Back", "t-bar row": "Back", "seated row": "Back",
  "overhead press": "Shoulders", "shoulder press": "Shoulders", "lateral raise": "Shoulders",
  "front raise": "Shoulders", "face pull": "Shoulders",
  "barbell curl": "Biceps", "dumbbell curl": "Biceps", "hammer curl": "Biceps", "cable curl": "Biceps",
  "bicep curl": "Biceps", "biceps curl": "Biceps", "ez bar curl": "Biceps", "ez-bar curl": "Biceps",
  "preacher curl": "Biceps", "concentration curl": "Biceps", "spider curl": "Biceps",
  "incline curl": "Biceps", "curl": "Biceps",
  "tricep": "Triceps", "triceps": "Triceps", "skull crusher": "Triceps", "close grip bench": "Triceps", "dip": "Triceps",
  "pushdown": "Triceps",
  "calf raise": "Calves", "standing calf": "Calves",
  "plank": "Core", "crunch": "Core", "ab": "Core", "sit up": "Core",
  "glute": "Glutes", "hip thrust": "Glutes",
};

function getMuscle(name) {
  const n = name.toLowerCase();
  for (const [key, muscle] of Object.entries(MUSCLE_MAP)) {
    if (n.includes(key)) return muscle;
  }
  return "Other";
}

async function fetchAllWorkouts(apiKey) {
  const all = [];
  let page = 1;
  let pageCount = 1;
  while (page <= pageCount) {
    const res = await fetch(`https://api.hevyapp.com/v1/workouts?page=${page}&pageSize=10`, {
      headers: { "api-key": apiKey }
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
  const sessions = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, sets]) => {
    const best = Math.max(...sets.map(s => e1rm(s.weight, s.reps)));
    const vol = sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
    return { date, best, vol, sets: sets.length };
  });

  const recent = sessions.slice(-6);
  const recentMax = recent.length ? Math.max(...recent.map(s => s.best)) : 0;
  const overallMax = sessions.length ? Math.max(...sessions.map(s => s.best)) : 0;
  const stalled = sessions.length >= 4 && recentMax < overallMax * 1.01;

  const forRegression = sessions.slice(-8);
  let predictedPR = null;
  if (forRegression.length >= 3) {
    const n = forRegression.length;
    const xs = forRegression.map((_, i) => i);
    const ys = forRegression.map(s => s.best);
    const mx = xs.reduce((a, b) => a + b) / n;
    const my = ys.reduce((a, b) => a + b) / n;
    const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    predictedPR = my + slope * (n + 2);
  }

  const last3Vol = sessions.slice(-3).map(s => s.vol);
  const prev3Vol = sessions.slice(-6, -3).map(s => s.vol);
  const avgLast = last3Vol.length ? last3Vol.reduce((a, b) => a + b) / last3Vol.length : 0;
  const avgPrev = prev3Vol.length ? prev3Vol.reduce((a, b) => a + b) / prev3Vol.length : 1;
  const deloadSuggested = stalled && avgLast > avgPrev * 0.85;

  return { sessions, stalled, predictedPR, deloadSuggested, overallMax };
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

// ── components ────────────────────────────────────────────────────────────────

const COLORS = {
  bg: "#0a0a0f", surface: "#12121a", card: "#1a1a26", border: "#2a2a3d",
  accent: "#6ee7b7", accent2: "#818cf8", accent3: "#f472b6",
  warn: "#fb923c", text: "#e2e8f0", muted: "#64748b",
};

const TAG = ({ color, children }) => (
  <span style={{
    background: color + "22", color, border: `1px solid ${color}44`,
    borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, letterSpacing: 1
  }}>{children}</span>
);

const Card = ({ children, style = {} }) => (
  <div style={{
    background: COLORS.card, border: `1px solid ${COLORS.border}`,
    borderRadius: 12, padding: 20, ...style
  }}>{children}</div>
);

function HelpTooltip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <span
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(s => !s)}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 18, height: 18, borderRadius: "50%",
          border: `1px solid ${COLORS.muted}`, color: COLORS.muted,
          fontSize: 11, fontWeight: 700, cursor: "pointer", userSelect: "none", flexShrink: 0,
        }}
      >?</span>
      {show && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
          background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8,
          padding: "10px 14px", fontSize: 12, color: COLORS.text, lineHeight: 1.7,
          width: 280, zIndex: 100, boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          whiteSpace: "normal", pointerEvents: "none",
        }}>
          {typeof text === "string"
            ? text.split("\n\n").map((p, i) => <span key={i} style={{ display: "block", marginBottom: i < text.split("\n\n").length - 1 ? 8 : 0 }}>{p}</span>)
            : text}
        </span>
      )}
    </span>
  );
}

function Spinner() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" style={{ animation: "spin 0.8s linear infinite", display: "block" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4" strokeDashoffset="10" />
    </svg>
  );
}

function ExerciseCard({ name, data }) {
  const { sessions, stalled, predictedPR, deloadSuggested, overallMax } = data;
  const chartData = sessions.slice(-12).map(s => ({ ...s, date: s.date.slice(5) }));

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, color: COLORS.text, flex: 1 }}>{name}</span>
        {stalled && <TAG color={COLORS.warn}>STALLED</TAG>}
        {deloadSuggested && <TAG color={COLORS.accent3}>DELOAD</TAG>}
        <TAG color={COLORS.accent}>{overallMax.toFixed(1)} lb PR</TAG>
      </div>

      {predictedPR && (
        <div style={{ marginBottom: 12, padding: "8px 12px", background: COLORS.accent2 + "18", borderRadius: 8, borderLeft: `3px solid ${COLORS.accent2}` }}>
          <span style={{ color: COLORS.muted, fontSize: 12 }}>Predicted next PR: </span>
          <span style={{ color: COLORS.accent2, fontWeight: 700 }}>{predictedPR.toFixed(1)} lbs e1RM</span>
          {stalled && <span style={{ color: COLORS.muted, fontSize: 12 }}> — but you're stalled. Consider a deload first.</span>}
        </div>
      )}

      {deloadSuggested && (
        <div style={{ marginBottom: 12, padding: "8px 12px", background: COLORS.accent3 + "18", borderRadius: 8, borderLeft: `3px solid ${COLORS.accent3}` }}>
          <span style={{ color: COLORS.accent3, fontSize: 12 }}>Deload suggestion: reduce weight 10–15% for 1 week, then reset progression.</span>
        </div>
      )}

      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData}>
          <XAxis dataKey="date" tick={{ fill: COLORS.muted, fontSize: 10 }} />
          <YAxis tick={{ fill: COLORS.muted, fontSize: 10 }} width={45} />
          <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text }} />
          <Line type="monotone" dataKey="best" stroke={COLORS.accent} strokeWidth={2} dot={false} name="e1RM (lbs)" />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

function FatigueRadar({ fatigue }) {
  const muscles = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core"];
  const max = Math.max(...muscles.map(m => fatigue[m] || 0), 1);
  const data = muscles.map(m => ({ muscle: m, sets: fatigue[m] || 0, pct: Math.round(((fatigue[m] || 0) / max) * 100) }));
  const sorted = [...data].sort((a, b) => b.sets - a.sets);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <Card>
        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, marginBottom: 16, color: COLORS.text }}>14-Day Muscle Frequency</div>
        <ResponsiveContainer width="100%" height={220}>
          <RadarChart data={data}>
            <PolarGrid stroke={COLORS.border} />
            <PolarAngleAxis dataKey="muscle" tick={{ fill: COLORS.muted, fontSize: 11 }} />
            <Radar dataKey="sets" stroke={COLORS.accent2} fill={COLORS.accent2} fillOpacity={0.25} />
          </RadarChart>
        </ResponsiveContainer>
      </Card>
      <Card>
        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, marginBottom: 16, color: COLORS.text }}>Sets per Muscle</div>
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
                transition: "width 0.6s ease"
              }} />
            </div>
            {sets === 0 && <span style={{ color: COLORS.warn, fontSize: 11 }}>⚠ Not trained in 14 days</span>}
          </div>
        ))}
      </Card>
    </div>
  );
}

// ── main app ──────────────────────────────────────────────────────────────────

export default function App() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("");
  const [activeTab, setTab] = useState("progression");
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

  // Auto-load on startup if key is saved
  useEffect(() => {
    if (apiKey) loadData(apiKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setApiKey("");
    setRows(null);
    setLastSync("");
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

  const fatigue = useMemo(() => rows ? getMuscleFatigue(rows) : {}, [rows]);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    return Object.entries(exerciseData).filter(([name]) => name.toLowerCase().includes(f));
  }, [exerciseData, filter]);

  const stalledCount = filtered.filter(([, d]) => d.stalled).length;
  const deloadCount = filtered.filter(([, d]) => d.deloadSuggested).length;

  return (
    <div style={{
      minHeight: "100vh", background: COLORS.bg, color: COLORS.text,
      fontFamily: "'DM Sans', sans-serif",
      backgroundImage: "radial-gradient(ellipse at 20% 20%, #1a1a3a 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, #0f1a2a 0%, transparent 60%)"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #12121a; } ::-webkit-scrollbar-thumb { background: #2a2a3d; border-radius: 3px; }
        button:hover { opacity: 0.85; }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>

        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 800, background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accent2})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              HEVY ANALYTICS
            </div>
            <div style={{ color: COLORS.muted, marginTop: 4, fontSize: 14 }}>Progression intelligence · Fatigue tracking · Deload detection</div>
          </div>
          {apiKey && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {lastSync && <span style={{ color: COLORS.muted, fontSize: 12 }}>Synced {lastSync}</span>}
              <button onClick={() => loadData(apiKey)} disabled={loading} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 8, border: `1px solid ${COLORS.accent}44`,
                background: COLORS.accent + "18", color: COLORS.accent, cursor: "pointer", fontSize: 13, fontWeight: 600
              }}>
                {loading ? <Spinner /> : "↻"} Refresh
              </button>
              <button onClick={handleDisconnect} style={{
                padding: "8px 14px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
                background: "transparent", color: COLORS.muted, cursor: "pointer", fontSize: 13
              }}>Disconnect</button>
            </div>
          )}
        </div>

        {/* connect screen */}
        {!apiKey && (
          <Card style={{ maxWidth: 480, margin: "0 auto", padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>🏋️</div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 20, color: COLORS.text, marginBottom: 8 }}>Connect your Hevy account</div>
            <div style={{ color: COLORS.muted, fontSize: 14, marginBottom: 24, lineHeight: 1.8 }}>
              <span style={{ color: COLORS.text, fontWeight: 600 }}>How to get your API key:</span><br />
              1. Open the <span style={{ color: COLORS.accent }}>Hevy app</span> on your phone<br />
              2. Go to <span style={{ color: COLORS.accent }}>Profile → Settings → Developer</span><br />
              3. Copy your API key and paste it below<br />
              <span style={{ fontSize: 12 }}>Requires a Hevy Pro subscription.</span>
            </div>
            <input
              type="text"
              placeholder="Paste your API key..."
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleConnect()}
              style={{
                width: "100%", padding: "11px 14px", marginBottom: 12,
                background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8,
                color: COLORS.text, fontSize: 14, outline: "none", fontFamily: "'DM Sans', sans-serif"
              }}
            />
            {error && <div style={{ color: COLORS.warn, fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <button onClick={handleConnect} disabled={loading || !keyInput.trim()} style={{
              width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
              background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accent2})`,
              color: COLORS.bg, fontWeight: 700, fontSize: 15, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: loading || !keyInput.trim() ? 0.6 : 1
            }}>
              {loading ? <><Spinner /> Loading...</> : "Connect & Sync"}
            </button>
          </Card>
        )}

        {/* loading state (auto-load) */}
        {apiKey && loading && !rows && (
          <div style={{ textAlign: "center", padding: 80, color: COLORS.muted }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><Spinner /></div>
            Fetching your workouts...
          </div>
        )}

        {/* error state */}
        {apiKey && error && !rows && (
          <Card style={{ textAlign: "center", padding: 40 }}>
            <div style={{ color: COLORS.warn, marginBottom: 12 }}>{error}</div>
            <button onClick={handleDisconnect} style={{
              padding: "8px 20px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
              background: "transparent", color: COLORS.muted, cursor: "pointer"
            }}>Try a different key</button>
          </Card>
        )}

        {/* dashboard */}
        {rows && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
              {[
                { label: "Exercises tracked", value: Object.keys(exerciseData).length, color: COLORS.accent },
                { label: "Total sessions", value: rows.map(r => r.date.split("T")[0]).filter((v, i, a) => a.indexOf(v) === i).length, color: COLORS.accent2 },
                { label: "Stalled lifts", value: stalledCount, color: COLORS.warn },
                { label: "Deload candidates", value: deloadCount, color: COLORS.accent3 },
              ].map(({ label, value, color }) => (
                <Card key={label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontFamily: "'Syne', sans-serif", fontWeight: 800, color }}>{value}</div>
                  <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>{label}</div>
                </Card>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              {[["progression", "Progression"], ["fatigue", "Body Part Fatigue"]].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} style={{
                  padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14,
                  background: activeTab === id ? COLORS.accent : COLORS.card,
                  color: activeTab === id ? COLORS.bg : COLORS.muted,
                  transition: "all 0.15s"
                }}>{label}</button>
              ))}
            </div>

            {activeTab === "progression" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <input
                    placeholder="Filter exercises..."
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    style={{
                      flex: 1, padding: "10px 16px",
                      background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8,
                      color: COLORS.text, fontSize: 14, outline: "none", fontFamily: "'DM Sans', sans-serif"
                    }}
                  />
                  <HelpTooltip text={
                    "📈 e1RM (Estimated 1-Rep Max): how much you could theoretically lift for 1 rep, calculated from your working sets using weight × (1 + reps ÷ 30). It's the standard way to compare strength across different rep ranges.\n\n🟠 STALLED: your recent best e1RM hasn't beaten your all-time PR.\n\n🩷 DELOAD: you're stalled and volume has been high — try reducing weight 10–15% for a week to recover and break through.\n\nCharts show your last 12 sessions per exercise. Only exercises with 3+ sessions are shown."
                  } />
                </div>
                {filtered.length === 0 && (
                  <div style={{ color: COLORS.muted, textAlign: "center", padding: 40 }}>
                    {Object.keys(exerciseData).length === 0
                      ? "Not enough data yet — exercises need 3+ sessions to show progression charts."
                      : "No exercises found"}
                  </div>
                )}
                {filtered.sort(([, a], [, b]) => (b.stalled ? 1 : 0) - (a.stalled ? 1 : 0))
                  .map(([name, data]) => <ExerciseCard key={name} name={name} data={data} />)}
              </>
            )}

            {activeTab === "fatigue" && <FatigueRadar fatigue={fatigue} />}
          </>
        )}
      </div>
    </div>
  );
}
