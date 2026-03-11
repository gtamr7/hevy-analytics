import { useState, useCallback, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts";

// ── helpers ──────────────────────────────────────────────────────────────────

const MUSCLE_MAP = {
  "barbell bench press": "Chest", "dumbbell bench press": "Chest", "incline bench press": "Chest",
  "cable fly": "Chest", "chest fly": "Chest", "push up": "Chest", "pushup": "Chest",
  "squat": "Quads", "leg press": "Quads", "hack squat": "Quads", "leg extension": "Quads",
  "romanian deadlift": "Hamstrings", "leg curl": "Hamstrings", "deadlift": "Hamstrings",
  "barbell row": "Back", "cable row": "Back", "lat pulldown": "Back", "pull up": "Back",
  "pullup": "Back", "chin up": "Back", "t-bar row": "Back", "seated row": "Back",
  "overhead press": "Shoulders", "shoulder press": "Shoulders", "lateral raise": "Shoulders",
  "front raise": "Shoulders", "face pull": "Shoulders",
  "barbell curl": "Biceps", "dumbbell curl": "Biceps", "hammer curl": "Biceps", "cable curl": "Biceps",
  "tricep": "Triceps", "skull crusher": "Triceps", "close grip bench": "Triceps", "dip": "Triceps",
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

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  return lines.slice(1).map(line => {
    const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || [];
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").replace(/"/g, "").trim(); });
    return obj;
  }).filter(r => r["Exercise Name"] || r["exercise_title"] || r["title"]);
}

function normalizeRows(rows) {
  return rows.map(r => ({
    date: r["Start Time"] || r["start_time"] || r["date"] || "",
    exercise: r["Exercise Name"] || r["exercise_title"] || r["title"] || "",
    sets: parseInt(r["Sets"] || r["sets"] || "1"),
    reps: parseInt(r["Reps"] || r["reps"] || "0"),
    weight: parseFloat(r["Weight"] || r["weight_lbs"] || r["weight"] || "0"),
  })).filter(r => r.exercise && r.date);
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
  bg: "#0a0a0f",
  surface: "#12121a",
  card: "#1a1a26",
  border: "#2a2a3d",
  accent: "#6ee7b7",
  accent2: "#818cf8",
  accent3: "#f472b6",
  warn: "#fb923c",
  text: "#e2e8f0",
  muted: "#64748b",
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
  const [dragging, setDragging] = useState(false);
  const [activeTab, setTab] = useState("progression");

  const handleFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseCSV(e.target.result);
      setRows(normalizeRows(parsed));
    };
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

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
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>

        {/* header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 800, background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accent2})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            HEVY ANALYTICS
          </div>
          <div style={{ color: COLORS.muted, marginTop: 4, fontSize: 14 }}>Progression intelligence · Fatigue tracking · Deload detection</div>
        </div>

        {/* upload */}
        {!rows ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            style={{
              border: `2px dashed ${dragging ? COLORS.accent : COLORS.border}`,
              borderRadius: 16, padding: 60, textAlign: "center",
              background: dragging ? COLORS.accent + "08" : COLORS.surface,
              transition: "all 0.2s", cursor: "pointer"
            }}
            onClick={() => document.getElementById("csv-input").click()}
          >
            <div style={{ fontSize: 40, marginBottom: 16 }}>📂</div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 8, color: COLORS.text }}>Drop your Hevy CSV export</div>
            <div style={{ color: COLORS.muted, fontSize: 14 }}>or click to browse · Export from Hevy → Profile → Settings → Export</div>
            <input id="csv-input" type="file" accept=".csv" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
          </div>
        ) : (
          <>
            {/* stats bar */}
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

            {/* tabs */}
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              {[["progression", "Progression"], ["fatigue", "Body Part Fatigue"]].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} style={{
                  padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14,
                  background: activeTab === id ? COLORS.accent : COLORS.card,
                  color: activeTab === id ? COLORS.bg : COLORS.muted,
                  transition: "all 0.15s"
                }}>{label}</button>
              ))}
              <button onClick={() => setRows(null)} style={{
                marginLeft: "auto", padding: "8px 16px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
                background: "transparent", color: COLORS.muted, cursor: "pointer", fontSize: 13
              }}>← New file</button>
            </div>

            {activeTab === "progression" && (
              <>
                <input
                  placeholder="Filter exercises..."
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  style={{
                    width: "100%", padding: "10px 16px", marginBottom: 20,
                    background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8,
                    color: COLORS.text, fontSize: 14, outline: "none", fontFamily: "'DM Sans', sans-serif"
                  }}
                />
                {filtered.length === 0 && <div style={{ color: COLORS.muted, textAlign: "center", padding: 40 }}>No exercises found</div>}
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
