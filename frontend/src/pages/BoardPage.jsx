import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { generateBoardGoals, satisfactionToModifier } from "../lib/boardUtils";

function SatisfactionMeter({ value }) {
  const color = value >= 70 ? "#4ade80" : value >= 40 ? "#e8c547" : "#f87171";
  const label = value >= 80 ? "Meget tilfreds" : value >= 60 ? "Tilfreds" :
    value >= 40 ? "Neutral" : value >= 20 ? "Utilfreds" : "Meget utilfreds";

  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-white/30 text-xs uppercase tracking-widest">Bestyrelsens tilfredshed</p>
          <p className="text-white font-bold text-2xl mt-1" style={{ color }}>
            {value}%
            <span className="text-white/30 text-sm font-normal ml-2">{label}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-white/30 text-xs uppercase tracking-widest">Sponsor modifier</p>
          <p className={`font-mono font-bold text-lg mt-1 ${
            satisfactionToModifier(value) >= 1 ? "text-green-400" : "text-red-400"
          }`}>
            ×{satisfactionToModifier(value).toFixed(2)}
          </p>
        </div>
      </div>
      {/* Bar */}
      <div className="bg-white/5 rounded-full h-3 overflow-hidden">
        <div
          className="h-3 rounded-full transition-all duration-700"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
      {/* Scale markers */}
      <div className="flex justify-between mt-1.5">
        {["0", "25", "50", "75", "100"].map(v => (
          <span key={v} className="text-white/20 text-[10px]">{v}</span>
        ))}
      </div>
    </div>
  );
}

function GoalCard({ goal, achieved }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all
      ${achieved
        ? "bg-green-500/8 border-green-500/20"
        : "bg-white/3 border-white/5"}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5
        ${achieved ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/20"}`}>
        {achieved ? "✓" : "○"}
      </div>
      <div className="flex-1">
        <p className={`text-sm font-medium ${achieved ? "text-green-300" : "text-white/70"}`}>
          {goal.label}
        </p>
        <div className="flex gap-3 mt-1">
          <span className="text-[10px] text-green-400/60">
            +{goal.satisfaction_bonus} tilfredshed ved opfyldelse
          </span>
          {goal.satisfaction_penalty > 0 && (
            <span className="text-[10px] text-red-400/60">
              -{goal.satisfaction_penalty} hvis ikke opfyldt
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BoardPage() {
  const [board, setBoard] = useState(null);
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [standing, setStanding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: t } = await supabase.from("teams")
      .select("*").eq("user_id", user.id).single();
    if (!t) { setLoading(false); return; }
    setTeam(t);

    const [boardRes, ridersRes, activeSeasonRes] = await Promise.all([
      supabase.from("board_profiles").select("*").eq("team_id", t.id).single(),
      supabase.from("riders").select("id, is_u25").eq("team_id", t.id),
      supabase.from("seasons").select("id").eq("status", "active").single(),
    ]);

    setBoard(boardRes.data);
    setRiders(ridersRes.data || []);
    setEditForm({
      plan_type: boardRes.data?.plan_type || "1yr",
      focus: boardRes.data?.focus || "balanced",
    });

    if (activeSeasonRes.data) {
      const { data: s } = await supabase.from("season_standings")
        .select("*").eq("team_id", t.id)
        .eq("season_id", activeSeasonRes.data.id).single();
      setStanding(s);
    }

    setLoading(false);
  }

  async function saveBoard() {
    setSaving(true);
    const newGoals = generateBoardGoals(editForm.focus, editForm.plan_type);
    await supabase.from("board_profiles").update({
      plan_type: editForm.plan_type,
      focus: editForm.focus,
      current_goals: JSON.stringify(newGoals),
    }).eq("team_id", team.id);
    await loadAll();
    setEditing(false);
    setSaving(false);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!board) return (
    <div className="text-center py-16 text-white/30">
      <p>Ingen bestyrelse oprettet endnu — starter ved sæsonstart</p>
    </div>
  );

  const goals = typeof board.current_goals === "string"
    ? JSON.parse(board.current_goals)
    : board.current_goals || [];

  // Evaluate current goal status
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

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Bestyrelse</h1>
          <p className="text-white/30 text-sm">Mål, tilfredshed og sæsonplan</p>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg
              text-white/50 text-sm hover:text-white hover:bg-white/10 transition-all">
            Rediger plan
          </button>
        )}
      </div>

      {/* Satisfaction meter */}
      <div className="mb-4">
        <SatisfactionMeter value={board.satisfaction} />
      </div>

      {/* Plan info */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Plan type</p>
          <p className="text-white font-semibold capitalize">
            {{ "1yr": "1-årsplan", "3yr": "3-årsplan", "5yr": "5-årsplan" }[board.plan_type]}
          </p>
        </div>
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Fokus</p>
          <p className="text-white font-semibold capitalize">
            {{ youth_development: "Ungdomsudvikling", star_signing: "Stjernesignering", balanced: "Balanceret" }[board.focus]}
          </p>
        </div>
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Næste sponsor</p>
          <p className={`font-mono font-bold ${modifier >= 1 ? "text-green-400" : "text-red-400"}`}>
            {Math.round((team?.sponsor_income || 100) * modifier).toLocaleString()} CZ$
          </p>
        </div>
      </div>

      {/* Edit mode */}
      {editing && (
        <div className="bg-[#0f0f18] border border-[#e8c547]/20 rounded-xl p-5 mb-4">
          <p className="text-white font-semibold text-sm mb-4">Rediger bestyrelsesplan</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-white/30 text-xs uppercase tracking-wider mb-2">
                Plan type
              </label>
              <select value={editForm.plan_type}
                onChange={e => setEditForm(f => ({ ...f, plan_type: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2
                  text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
                <option value="1yr">1-årsplan (strenge mål)</option>
                <option value="3yr">3-årsplan (moderate mål)</option>
                <option value="5yr">5-årsplan (langsigtede mål)</option>
              </select>
            </div>
            <div>
              <label className="block text-white/30 text-xs uppercase tracking-wider mb-2">
                Fokus
              </label>
              <select value={editForm.focus}
                onChange={e => setEditForm(f => ({ ...f, focus: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2
                  text-white text-sm focus:outline-none focus:border-[#e8c547]/50">
                <option value="balanced">Balanceret</option>
                <option value="youth_development">Ungdomsudvikling</option>
                <option value="star_signing">Stjernesignering</option>
              </select>
            </div>
          </div>
          {/* Preview goals */}
          <div className="mb-4">
            <p className="text-white/30 text-xs uppercase tracking-wider mb-2">
              Forhåndsvisning af mål
            </p>
            <div className="flex flex-col gap-2">
              {generateBoardGoals(editForm.focus, editForm.plan_type).map((g, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-white/50">
                  <span className="text-[#e8c547]">◈</span> {g.label}
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveBoard} disabled={saving}
              className="px-4 py-2 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-lg
                text-sm hover:bg-[#f0d060] transition-all disabled:opacity-50">
              {saving ? "Gemmer..." : "Gem plan"}
            </button>
            <button onClick={() => setEditing(false)}
              className="px-4 py-2 bg-white/5 text-white/50 rounded-lg text-sm
                hover:bg-white/10 transition-all">
              Annuller
            </button>
          </div>
        </div>
      )}

      {/* Current goals */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
        <p className="text-white font-semibold text-sm mb-4">
          Sæsonmål
          <span className="text-white/30 font-normal ml-2 text-xs">
            {goals.filter(g => isGoalAchieved(g)).length}/{goals.length} opfyldt
          </span>
        </p>
        <div className="flex flex-col gap-2">
          {goals.length === 0 ? (
            <p className="text-white/30 text-sm">Ingen mål sat endnu</p>
          ) : (
            goals.map((g, i) => (
              <GoalCard key={i} goal={g} achieved={isGoalAchieved(g)} />
            ))
          )}
        </div>
      </div>

      {/* Current squad stats */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4">
          <p className="text-white/30 text-xs uppercase tracking-widest">Ryttere på holdet</p>
          <p className="text-white font-bold text-2xl font-mono mt-1">{riderCount}</p>
        </div>
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4">
          <p className="text-white/30 text-xs uppercase tracking-widest">U25 ryttere</p>
          <p className="text-blue-400 font-bold text-2xl font-mono mt-1">{u25Count}</p>
        </div>
      </div>
    </div>
  );
}
