import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { generateBoardGoals, satisfactionToModifier } from "../lib/boardUtils";

function SatisfactionMeter({ value }) {
  const color = value >= 70 ? "#4ade80" : value >= 40 ? "#e8c547" : "#f87171";
  const label = value >= 80 ? "Meget tilfreds" : value >= 60 ? "Tilfreds" :
    value >= 40 ? "Neutral" : value >= 20 ? "Utilfreds" : "Meget utilfreds";
  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-white/30 text-xs uppercase tracking-wider">Bestyrelsestilfredshed</p>
        <span className="font-mono font-bold text-lg" style={{ color }}>{value}%</span>
      </div>
      <div className="bg-white/5 rounded-full h-3 mb-2">
        <div className="h-3 rounded-full transition-all duration-500" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-sm font-medium">{label}</p>
        <p className="text-white/30 text-xs">
          Sponsor ×{satisfactionToModifier(value).toFixed(2)}
          <span className={satisfactionToModifier(value) >= 1 ? "text-green-400" : "text-red-400"} />
        </p>
      </div>
    </div>
  );
}

function GoalCard({ goal, achieved }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all
      ${achieved ? "bg-green-500/8 border-green-500/20" : "bg-white/3 border-white/5"}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5
        ${achieved ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/20"}`}>
        {achieved ? "✓" : "○"}
      </div>
      <div className="flex-1">
        <p className={`text-sm font-medium ${achieved ? "text-green-300" : "text-white/70"}`}>
          {goal.label}
        </p>
        <div className="flex gap-3 mt-1">
          {goal.satisfaction_bonus > 0 && (
            <span className="text-xs text-green-400/70">+{goal.satisfaction_bonus} tilfredshed</span>
          )}
          {goal.satisfaction_penalty > 0 && (
            <span className="text-xs text-red-400/70">-{goal.satisfaction_penalty} hvis ikke opfyldt</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BoardPage() {
  const [board, setBoard] = useState(null);
  const [riders, setRiders] = useState([]);
  const [standing, setStanding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ focus: "balanced", plan_type: "3yr" });
  const [saving, setSaving] = useState(false);
  const [previewGoals, setPreviewGoals] = useState([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: team } = await supabase.from("teams").select("id, division").eq("user_id", user.id).single();
    if (!team) { setLoading(false); return; }

    const [boardRes, ridersRes, standingRes] = await Promise.all([
      supabase.from("board_profiles").select("*").eq("team_id", team.id).single(),
      supabase.from("riders").select("id, is_u25").eq("team_id", team.id),
      supabase.from("season_standings").select("*").eq("team_id", team.id)
        .order("created_at", { ascending: false }).limit(1).single(),
    ]);

    setBoard(boardRes.data);
    setRiders(ridersRes.data || []);
    setStanding(standingRes.data);
    if (boardRes.data) {
      setEditForm({ focus: boardRes.data.focus || "balanced", plan_type: boardRes.data.plan_type || "3yr" });
    }
    setLoading(false);
  }

  async function saveBoard() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: team } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    const newGoals = generateBoardGoals(editForm.focus, editForm.plan_type);
    await supabase.from("board_profiles").upsert({
      team_id: team.id,
      focus: editForm.focus,
      plan_type: editForm.plan_type,
      current_goals: JSON.stringify(newGoals),
      satisfaction: board?.satisfaction ?? 50,
      budget_multiplier: board?.budget_multiplier ?? 1.0,
    }, { onConflict: "team_id" });
    setEditing(false);
    setSaving(false);
    loadAll();
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!board) return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-white mb-2">Bestyrelse</h1>
      <p className="text-white/30 text-sm mb-6">Mål, tilfredshed og sæsonplan</p>
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-8 text-center">
        <p className="text-white/40 mb-4">Ingen bestyrelse opsat endnu</p>
        <button onClick={() => setEditing(true)}
          className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060]">
          Opret bestyrelse
        </button>
      </div>
    </div>
  );

  const goals = typeof board.current_goals === "string"
    ? JSON.parse(board.current_goals)
    : board.current_goals || [];

  const u25Count = riders.filter(r => r.is_u25).length;
  const riderCount = riders.length;

  function isGoalAchieved(goal) {
    switch (goal.type) {
      case "min_u25_riders": return u25Count >= goal.target;
      case "min_riders": return riderCount >= goal.target;
      case "top_n_finish": return standing ? (standing.rank_in_division || 99) <= goal.target : false;
      case "stage_wins": return standing ? (standing.stage_wins || 0) >= goal.target : false;
      case "gc_wins": return standing ? (standing.gc_wins || 0) >= goal.target : false;
      default: return false;
    }
  }

  const modifier = satisfactionToModifier(board.satisfaction);
  const goalsAchieved = goals.filter(g => isGoalAchieved(g)).length;

  const FOCUS_LABELS = {
    attacking: "Offensiv", balanced: "Balanceret", defensive: "Defensiv",
    youth: "Ungdomsudvikling", budget: "Budgetstyring",
  };

  const PLAN_LABELS = { "1yr": "1-årsplan", "3yr": "3-årsplan", "5yr": "5-årsplan" };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Bestyrelse</h1>
          <p className="text-white/30 text-sm">Mål, tilfredshed og sæsonplan</p>
        </div>
        <button onClick={() => { setEditing(!editing); setPreviewGoals([]); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border
            ${editing ? "bg-white/5 text-white/50 border-white/10" : "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20 hover:bg-[#e8c547]/20"}`}>
          {editing ? "Annuller" : "Rediger"}
        </button>
      </div>

      {/* Satisfaction meter */}
      <SatisfactionMeter value={board.satisfaction} />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 text-center">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Fokus</p>
          <p className="text-white font-semibold text-sm">{FOCUS_LABELS[board.focus] || board.focus}</p>
        </div>
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 text-center">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Plan</p>
          <p className="text-white font-semibold text-sm">{PLAN_LABELS[board.plan_type] || board.plan_type}</p>
        </div>
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 text-center">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Sponsor ×</p>
          <p className={`font-mono font-bold text-sm ${modifier >= 1 ? "text-green-400" : "text-red-400"}`}>
            ×{modifier.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="bg-[#0f0f18] border border-[#e8c547]/20 rounded-xl p-5 mt-4">
          <h2 className="text-white font-semibold text-sm mb-4">Rediger bestyrelsesplan</h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-white/30 text-xs mb-1">Fokus</label>
              <select value={editForm.focus}
                onChange={e => { setEditForm(f => ({ ...f, focus: e.target.value })); setPreviewGoals(generateBoardGoals(e.target.value, editForm.plan_type)); }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
                {Object.entries(FOCUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-white/30 text-xs mb-1">Tidshorisont</label>
              <select value={editForm.plan_type}
                onChange={e => { setEditForm(f => ({ ...f, plan_type: e.target.value })); setPreviewGoals(generateBoardGoals(editForm.focus, e.target.value)); }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none">
                <option value="1yr">1-årsplan (strenge mål)</option>
                <option value="3yr">3-årsplan (moderate mål)</option>
                <option value="5yr">5-årsplan (langsigtede mål)</option>
              </select>
            </div>
          </div>

          {previewGoals.length > 0 && (
            <div className="mb-4">
              <p className="text-white/30 text-xs uppercase tracking-wider mb-2">Forhåndsvisning af mål</p>
              <div className="flex flex-col gap-2">
                {previewGoals.map((g, i) => <GoalCard key={i} goal={g} achieved={false} />)}
              </div>
            </div>
          )}

          <button onClick={saveBoard} disabled={saving}
            className="w-full py-2.5 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg text-sm hover:bg-[#f0d060] disabled:opacity-50">
            {saving ? "Gemmer..." : "Gem bestyrelsesplan"}
          </button>
        </div>
      )}

      {/* Current goals */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mt-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-sm">Sæsonmål</h2>
          <span className="text-white/40 text-xs font-mono">{goalsAchieved}/{goals.length} opfyldt</span>
        </div>

        {goals.length === 0 ? (
          <p className="text-white/30 text-sm">Ingen mål sat endnu</p>
        ) : (
          <div>
            {/* Progress bar */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 bg-white/5 rounded-full h-2">
                <div className="h-2 rounded-full bg-[#e8c547] transition-all"
                  style={{ width: `${Math.round((goalsAchieved / goals.length) * 100)}%` }} />
              </div>
              <span className="text-white/40 text-xs font-mono">
                {Math.round((goalsAchieved / goals.length) * 100)}%
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {goals.map((g, i) => <GoalCard key={i} goal={g} achieved={isGoalAchieved(g)} />)}
            </div>
          </div>
        )}
      </div>

      {/* Squad stats */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Ryttere på holdet</p>
          <p className="text-white font-bold text-2xl font-mono">{riderCount}</p>
        </div>
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-1">U25 ryttere</p>
          <p className="text-blue-400 font-bold text-2xl font-mono">{u25Count}</p>
        </div>
      </div>

      {/* Satisfaction info */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mt-4">
        <h2 className="text-white font-semibold text-sm mb-4">Hvad betyder tilfredshed?</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { range: "70–100%", label: "Høj tilfredshed", effect: "Sponsor × > 1.0 — ekstra indtægt", color: "text-green-400" },
            { range: "40–69%", label: "Moderat tilfredshed", effect: "Sponsor × 1.0 — normal indtægt", color: "text-[#e8c547]" },
            { range: "0–39%", label: "Lav tilfredshed", effect: "Sponsor × < 1.0 — reduceret indtægt", color: "text-red-400" },
          ].map(item => (
            <div key={item.range} className="bg-white/3 rounded-lg p-3 border border-white/5">
              <p className={`font-mono font-bold text-sm ${item.color}`}>{item.range}</p>
              <p className="text-white/60 text-xs font-medium mt-1">{item.label}</p>
              <p className="text-white/30 text-xs mt-1">{item.effect}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
