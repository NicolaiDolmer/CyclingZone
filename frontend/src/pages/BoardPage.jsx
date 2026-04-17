import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { generateBoardGoals, satisfactionToModifier } from "../lib/boardUtils";
import { Link } from "react-router-dom";

// ── Forhandlings-hjælper ──────────────────────────────────────────────────────

function getNegotiatedGoal(goal) {
  switch (goal.type) {
    case "top_n_finish": {
      const t = goal.target + 2;
      return { ...goal, target: t, label: `Top ${t} i divisionen`,
        satisfaction_penalty: Math.round(goal.satisfaction_penalty * 0.5), negotiated: true };
    }
    case "stage_wins": {
      const t = Math.max(1, goal.target - 1);
      return { ...goal, target: t, label: `Mindst ${t} etapesejr${t !== 1 ? "er" : ""}`,
        satisfaction_penalty: Math.round(goal.satisfaction_penalty * 0.5), negotiated: true };
    }
    case "gc_wins": {
      const t = Math.max(1, goal.target - 1);
      return { ...goal, target: t, label: `Mindst ${t} samlet sejr`,
        satisfaction_penalty: Math.round(goal.satisfaction_penalty * 0.5), negotiated: true };
    }
    case "min_u25_riders": {
      const t = Math.max(1, goal.target - 1);
      return { ...goal, target: t, label: `Min. ${t} U25-ryttere på holdet`,
        satisfaction_penalty: Math.round(goal.satisfaction_penalty * 0.5), negotiated: true };
    }
    case "min_riders": {
      const t = Math.max(5, goal.target - 3);
      return { ...goal, target: t, label: `Hold på min. ${t} ryttere`,
        satisfaction_penalty: Math.round(goal.satisfaction_penalty * 0.5), negotiated: true };
    }
    default:
      return { ...goal, satisfaction_penalty: Math.round(goal.satisfaction_penalty * 0.5), negotiated: true };
  }
}

// ── Delte komponenter ─────────────────────────────────────────────────────────

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
        <div className="h-3 rounded-full transition-all duration-500"
          style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-sm font-medium">{label}</p>
        <p className="text-white/30 text-xs">Sponsor ×{satisfactionToModifier(value).toFixed(2)}</p>
      </div>
    </div>
  );
}

function GoalCard({ goal, achieved }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all
      ${achieved ? "bg-green-500/8 border-green-500/20" : "bg-white/3 border-white/5"}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs
        ${achieved ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/20"}`}>
        {achieved ? "✓" : "○"}
      </div>
      <div className="flex-1">
        <p className={`text-sm font-medium ${achieved ? "text-green-300" : "text-white/70"}`}>{goal.label}</p>
        <div className="flex gap-3 mt-1">
          {goal.negotiated && <span className="text-xs text-blue-400/70">Forhandlet</span>}
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

// ── Wizard trin ───────────────────────────────────────────────────────────────

const FOCUS_OPTIONS = [
  { key: "balanced",         label: "Balanceret" },
  { key: "youth_development", label: "Ungdomsudvikling" },
  { key: "star_signing",     label: "Stjernesignering" },
];

const PLAN_OPTIONS = [
  { key: "1yr", label: "1-årsplan — strenge mål" },
  { key: "3yr", label: "3-årsplan — moderate mål" },
  { key: "5yr", label: "5-årsplan — langsigtede mål" },
];

function WizardStep1({ focus, setFocus, planType, setPlanType, onStart }) {
  const preview = generateBoardGoals(focus, planType);
  return (
    <div>
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-full bg-[#e8c547]/10 border border-[#e8c547]/20
          flex items-center justify-center text-2xl mx-auto mb-4">◧</div>
        <h2 className="text-white font-bold text-xl">Bestyrelsens forslag</h2>
        <p className="text-white/40 text-sm mt-1">Vælg strategi og tidslinje — bestyrelsen genererer krav</p>
      </div>

      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-white/30 text-xs uppercase tracking-wider mb-2">Holdfokus</label>
            {FOCUS_OPTIONS.map(o => (
              <button key={o.key} onClick={() => setFocus(o.key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 border transition-all
                  ${focus === o.key
                    ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20"
                    : "bg-white/3 text-white/50 border-white/5 hover:bg-white/8 hover:text-white/80"}`}>
                {o.label}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-white/30 text-xs uppercase tracking-wider mb-2">Tidshorisont</label>
            {PLAN_OPTIONS.map(o => (
              <button key={o.key} onClick={() => setPlanType(o.key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 border transition-all
                  ${planType === o.key
                    ? "bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20"
                    : "bg-white/3 text-white/50 border-white/5 hover:bg-white/8 hover:text-white/80"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-6">
        <p className="text-white/30 text-xs uppercase tracking-wider mb-3">Bestyrelsens krav</p>
        <div className="flex flex-col gap-2">
          {preview.map((g, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/3 border border-white/5">
              <div className="w-5 h-5 rounded-full bg-white/10 text-white/20 flex items-center justify-center
                flex-shrink-0 mt-0.5 text-xs">○</div>
              <div className="flex-1">
                <p className="text-white/70 text-sm">{g.label}</p>
                <div className="flex gap-3 mt-1">
                  {g.satisfaction_bonus > 0 && <span className="text-xs text-green-400/60">+{g.satisfaction_bonus}</span>}
                  {g.satisfaction_penalty > 0 && <span className="text-xs text-red-400/60">-{g.satisfaction_penalty} straf</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onStart}
        className="w-full py-3 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-xl text-sm hover:bg-[#f0d060] transition-all">
        Start forhandling →
      </button>
    </div>
  );
}

function WizardStep2({ goals, goalIdx, negotiated, pendingNegotiate, onAccept, onNegotiate, onAcceptNegotiated }) {
  const current = goals[goalIdx];
  const total = goals.length;
  const negotiationsUsed = Object.values(negotiated).filter(Boolean).length;

  return (
    <div>
      {/* Progress */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-white/30 text-xs flex-shrink-0">Mål {goalIdx + 1}/{total}</span>
        <div className="flex-1 bg-white/5 rounded-full h-1.5">
          <div className="h-1.5 rounded-full bg-[#e8c547] transition-all"
            style={{ width: `${(goalIdx / total) * 100}%` }} />
        </div>
        <span className="text-white/25 text-xs flex-shrink-0">{negotiationsUsed} forhandlet</span>
      </div>

      {/* Current goal card */}
      <div className={`rounded-xl p-6 mb-4 border ${pendingNegotiate
        ? "bg-blue-500/5 border-blue-500/20"
        : "bg-[#0f0f18] border-[#e8c547]/20"}`}>
        <p className={`text-xs uppercase tracking-wider mb-2 ${pendingNegotiate ? "text-blue-400/60" : "text-white/30"}`}>
          {pendingNegotiate ? "Forhandlet alternativ" : "Bestyrelsens krav"}
        </p>
        <p className="text-white font-bold text-lg mb-4">{current.label}</p>
        <div className="flex gap-6">
          <div>
            <p className="text-green-400 font-mono font-bold text-sm">+{current.satisfaction_bonus}</p>
            <p className="text-white/30 text-xs mt-0.5">tilfredshed ved opfyldelse</p>
          </div>
          <div>
            <p className="text-red-400 font-mono font-bold text-sm">
              {current.satisfaction_penalty > 0 ? `-${current.satisfaction_penalty}` : "0"}
            </p>
            <p className="text-white/30 text-xs mt-0.5">straf hvis ikke opfyldt</p>
          </div>
        </div>
        {pendingNegotiate && (
          <div className="mt-4 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <p className="text-blue-400 text-xs">Krav sænket, straf halveret — acceptér for at fortsætte</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {pendingNegotiate ? (
        <button onClick={onAcceptNegotiated}
          className="w-full py-3 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-xl hover:bg-[#f0d060] transition-all">
          Acceptér forhandlet mål ✓
        </button>
      ) : (
        <div className="flex gap-3">
          <button onClick={onAccept}
            className="flex-1 py-3 bg-green-500/10 text-green-400 border border-green-500/20
              font-bold rounded-xl hover:bg-green-500/20 transition-all">
            Acceptér ✓
          </button>
          <button onClick={onNegotiate} disabled={negotiated[goalIdx]}
            className="flex-1 py-3 bg-white/5 text-white/50 border border-white/10
              font-bold rounded-xl hover:bg-white/10 hover:text-white transition-all
              disabled:opacity-30 disabled:cursor-not-allowed">
            {negotiated[goalIdx] ? "Allerede forhandlet" : "Forhandl ↔"}
          </button>
        </div>
      )}
    </div>
  );
}

function WizardStep3({ finalGoals, onSign, saving }) {
  const negotiatedCount = finalGoals.filter(g => g.negotiated).length;
  return (
    <div>
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/20
          flex items-center justify-center text-2xl mx-auto mb-4">📋</div>
        <h2 className="text-white font-bold text-xl">Kontraktbekræftelse</h2>
        <p className="text-white/40 text-sm mt-1">
          {negotiatedCount > 0
            ? `${negotiatedCount} mål forhandlet — klar til underskrift`
            : "Alle mål accepteret — klar til underskrift"}
        </p>
      </div>

      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-6">
        <p className="text-white/30 text-xs uppercase tracking-wider mb-3">Aftalte sæsonmål</p>
        <div className="flex flex-col gap-2">
          {finalGoals.map((g, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border
              ${g.negotiated ? "bg-blue-500/5 border-blue-500/20" : "bg-white/3 border-white/5"}`}>
              <div className="w-5 h-5 rounded-full bg-white/10 text-white/20 flex items-center
                justify-center flex-shrink-0 mt-0.5 text-xs">○</div>
              <div className="flex-1">
                <p className="text-white/80 text-sm font-medium">{g.label}</p>
                <div className="flex gap-3 mt-1">
                  {g.negotiated && <span className="text-xs text-blue-400/70">Forhandlet</span>}
                  {g.satisfaction_bonus > 0 && <span className="text-xs text-green-400/60">+{g.satisfaction_bonus}</span>}
                  {g.satisfaction_penalty > 0 && <span className="text-xs text-red-400/60">-{g.satisfaction_penalty} straf</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onSign} disabled={saving}
        className="w-full py-3 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-xl
          hover:bg-[#f0d060] disabled:opacity-50 transition-all">
        {saving ? "Gemmer..." : "Underskriv kontrakt ✍"}
      </button>
    </div>
  );
}

// ── Hoved-komponent ───────────────────────────────────────────────────────────

export default function BoardPage() {
  const [board, setBoard] = useState(null);
  const [riders, setRiders] = useState([]);
  const [standing, setStanding] = useState(null);
  const [loading, setLoading] = useState(true);

  // Wizard state
  const [focus, setFocus] = useState("balanced");
  const [planType, setPlanType] = useState("3yr");
  const [step, setStep] = useState(1);
  const [proposedGoals, setProposedGoals] = useState([]);
  const [finalGoals, setFinalGoals] = useState([]);
  const [goalIdx, setGoalIdx] = useState(0);
  const [negotiated, setNegotiated] = useState({});
  const [pendingNegotiate, setPendingNegotiate] = useState(false);
  const [saving, setSaving] = useState(false);

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
      setFocus(boardRes.data.focus || "balanced");
      setPlanType(boardRes.data.plan_type || "3yr");
    }
    setLoading(false);
  }

  // ── Wizard handlers ─────────────────────────────────────────────────────────

  function startNegotiation() {
    const goals = generateBoardGoals(focus, planType);
    setProposedGoals(goals);
    setFinalGoals([...goals]);
    setGoalIdx(0);
    setNegotiated({});
    setPendingNegotiate(false);
    setStep(2);
  }

  function acceptCurrentGoal() {
    const next = goalIdx + 1;
    if (next >= proposedGoals.length) { setStep(3); return; }
    setGoalIdx(next);
    setPendingNegotiate(false);
  }

  function negotiateCurrentGoal() {
    if (negotiated[goalIdx]) return;
    const neg = getNegotiatedGoal(proposedGoals[goalIdx]);
    const updated = [...finalGoals];
    updated[goalIdx] = neg;
    setFinalGoals(updated);
    setNegotiated(n => ({ ...n, [goalIdx]: true }));
    setPendingNegotiate(true);
  }

  function acceptNegotiatedGoal() {
    const next = goalIdx + 1;
    if (next >= proposedGoals.length) { setStep(3); return; }
    setGoalIdx(next);
    setPendingNegotiate(false);
  }

  async function signContract() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: team } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    await supabase.from("board_profiles").upsert({
      team_id: team.id,
      focus,
      plan_type: planType,
      current_goals: JSON.stringify(finalGoals),
      satisfaction: board?.satisfaction ?? 50,
      budget_multiplier: board?.budget_multiplier ?? 1.0,
      negotiation_status: "completed",
    }, { onConflict: "team_id" });
    setSaving(false);
    setStep(1);
    loadAll();
  }

  async function renewContract() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: team } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    await supabase.from("board_profiles").update({ negotiation_status: "pending" }).eq("team_id", team.id);
    loadAll();
  }

  // ── Completed-view helpers ──────────────────────────────────────────────────

  function isGoalAchieved(goal) {
    const u25Count = riders.filter(r => r.is_u25).length;
    const riderCount = riders.length;
    switch (goal.type) {
      case "min_u25_riders": return u25Count >= goal.target;
      case "min_riders":     return riderCount >= goal.target;
      case "top_n_finish":   return standing ? (standing.rank_in_division || 99) <= goal.target : false;
      case "stage_wins":     return standing ? (standing.stage_wins || 0) >= goal.target : false;
      case "gc_wins":        return standing ? (standing.gc_wins || 0) >= goal.target : false;
      default:               return false;
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const showWizard = !board || board.negotiation_status === "pending";

  // ── Wizard view ─────────────────────────────────────────────────────────────
  if (showWizard) {
    return (
      <div className="max-w-2xl mx-auto py-2">
        {/* Step indicator */}
        <div className="flex items-center mb-8">
          {[
            { n: 1, label: "Strategi" },
            { n: 2, label: "Forhandling" },
            { n: 3, label: "Underskrift" },
          ].map(({ n, label }, i) => (
            <div key={n} className={`flex items-center ${i < 2 ? "flex-1" : ""}`}>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                  ${step === n ? "bg-[#e8c547] text-[#0a0a0f]"
                    : step > n ? "bg-green-500/20 text-green-400"
                    : "bg-white/5 text-white/20"}`}>
                  {step > n ? "✓" : n}
                </div>
                <span className={`text-xs ${step === n ? "text-white/70" : "text-white/25"}`}>{label}</span>
              </div>
              {i < 2 && (
                <div className={`flex-1 h-px mx-3 ${step > n ? "bg-green-500/30" : "bg-white/5"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Satisfaction meter if board exists */}
        {board && <div className="mb-6"><SatisfactionMeter value={board.satisfaction} /></div>}

        {step === 1 && (
          <WizardStep1
            focus={focus} setFocus={setFocus}
            planType={planType} setPlanType={setPlanType}
            onStart={startNegotiation}
          />
        )}
        {step === 2 && (
          <WizardStep2
            goals={finalGoals}
            goalIdx={goalIdx}
            negotiated={negotiated}
            pendingNegotiate={pendingNegotiate}
            onAccept={acceptCurrentGoal}
            onNegotiate={negotiateCurrentGoal}
            onAcceptNegotiated={acceptNegotiatedGoal}
          />
        )}
        {step === 3 && (
          <WizardStep3
            finalGoals={finalGoals}
            onSign={signContract}
            saving={saving}
          />
        )}
      </div>
    );
  }

  // ── Completed view ──────────────────────────────────────────────────────────
  const goals = typeof board.current_goals === "string"
    ? JSON.parse(board.current_goals)
    : board.current_goals || [];

  const u25Count = riders.filter(r => r.is_u25).length;
  const riderCount = riders.length;
  const modifier = satisfactionToModifier(board.satisfaction);
  const goalsAchieved = goals.filter(g => isGoalAchieved(g)).length;

  const FOCUS_LABELS = {
    balanced: "Balanceret", youth_development: "Ungdomsudvikling", star_signing: "Stjernesignering",
    attacking: "Offensiv", defensive: "Defensiv", youth: "Ungdomsudvikling", budget: "Budgetstyring",
  };
  const PLAN_LABELS = { "1yr": "1-årsplan", "3yr": "3-årsplan", "5yr": "5-årsplan" };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Bestyrelse</h1>
          <p className="text-white/30 text-sm">Mål, tilfredshed og sæsonplan</p>
        </div>
        <div className="flex gap-2">
          <Link to="/finance"
            className="px-3 py-2 rounded-lg text-sm border bg-white/5 text-white/40 border-white/10
              hover:text-white hover:bg-white/10 transition-all">
            💰 Finanser
          </Link>
          <button onClick={renewContract}
            className="px-4 py-2 rounded-lg text-sm font-medium border
              bg-[#e8c547]/10 text-[#e8c547] border-[#e8c547]/20 hover:bg-[#e8c547]/20 transition-all">
            Forny kontrakt
          </button>
        </div>
      </div>

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

      {/* Current goals */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mt-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-sm">Sæsonmål</h2>
          <span className="text-white/40 text-xs font-mono">{goalsAchieved}/{goals.length} opfyldt</span>
        </div>
        {goals.length === 0 ? (
          <p className="text-white/30 text-sm">Ingen mål sat endnu</p>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* Squad counts */}
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

      {/* Satisfaction explanation */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mt-4">
        <h2 className="text-white font-semibold text-sm mb-4">Hvad betyder tilfredshed?</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { range: "70–100%", label: "Høj tilfredshed",      effect: "Sponsor × > 1.0 — ekstra indtægt", color: "text-green-400" },
            { range: "40–69%", label: "Moderat tilfredshed",   effect: "Sponsor × 1.0 — normal indtægt",   color: "text-[#e8c547]" },
            { range: "0–39%",  label: "Lav tilfredshed",       effect: "Sponsor × < 1.0 — reduceret",      color: "text-red-400" },
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
