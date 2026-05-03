import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { satisfactionToModifier, getPlanDuration } from "../lib/boardUtils";
import { getCountryDisplay } from "../lib/countryUtils";
import { Link } from "react-router-dom";

const API = import.meta.env.VITE_API_URL;
const PLAN_LABELS = { "1yr": "1-årsplan", "3yr": "3-årsplan", "5yr": "5-årsplan" };
const PLAN_SEQUENCE = ["5yr", "3yr", "1yr"];
const FOCUS_LABELS = {
  balanced: "Balanceret",
  youth_development: "Ungdomsudvikling",
  star_signing: "Stjernesignering",
};
const GOAL_CHANGE_META = {
  relaxed: { label: "Lempet", accent: "text-green-300", box: "border-cz-success/30 bg-cz-success-bg0/8" },
  tightened: { label: "Skærpet", accent: "text-red-300", box: "border-cz-danger/30 bg-cz-danger-bg0/8" },
  replaced: { label: "Omlagt", accent: "text-blue-300", box: "border-blue-500/20 bg-cz-info-bg0/8" },
};

const GOAL_STATUS_META = {
  behind:        { label: "I fare",     color: "text-red-400",   icon: "!" },
  near_miss:     { label: "Tæt på",    color: "text-cz-accent-t", icon: "~" },
  on_track:      { label: "På sporet", color: "text-cz-3", icon: null },
  watch:         { label: "Hold øje",  color: "text-cz-accent-t", icon: "~" },
  awaiting_data: { label: null, color: null, icon: null },
  neutral:       { label: null, color: null, icon: null },
};

const PERSONALITY_LABELS = {
  sports_ambition:   { low: "Lav ambition", medium: "Moderat ambition", high: "Høj ambition" },
  financial_risk:    { cautious: "Forsigtig økonomi", balanced: "Balanceret økonomi", aggressive: "Aggressiv økonomi" },
  identity_strength: { low: "Svag identitet", medium: "Moderat identitet", high: "Stærk identitet" },
};

function getBoardGoalLabel(goal) {
  if (!goal) return "";
  if (goal.type === "min_national_riders" && goal.nationality_code) {
    const country = getCountryDisplay(goal.nationality_code);
    return `Min. ${goal.target} ryttere fra ${country.label}`;
  }
  return goal.label || "";
}

function formatSignalDelta(delta) {
  const points = Math.round(Number(delta || 0) * 100);
  return `${points > 0 ? "+" : ""}${points}`;
}

function formatBoardCopy(text) {
  if (!text) return "";
  return text
    .replace(/\bfra ([A-Z]{2})\b/g, (_match, code) => `fra ${getCountryDisplay(code).label}`)
    .replace(/\b([A-Z]{2})-kerne\b/g, (_match, code) => `${getCountryDisplay(code).name}-kerne`)
    .replace(/\b([A-Z]{2})-praegede\b/g, (_match, code) => `${getCountryDisplay(code).name}-praegede`);
}

// ── Delte komponenter ─────────────────────────────────────────────────────────

function SatisfactionMeter({ value }) {
  const color = value >= 70 ? "#4ade80" : value >= 40 ? "#e8c547" : "#f87171";
  const label = value >= 80 ? "Meget tilfreds" : value >= 60 ? "Tilfreds" :
    value >= 40 ? "Neutral" : value >= 20 ? "Utilfreds" : "Meget utilfreds";
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-cz-3 text-xs uppercase tracking-wider">Bestyrelsestilfredshed</p>
        <span className="font-mono font-bold text-lg" style={{ color }}>{value}%</span>
      </div>
      <div className="bg-cz-subtle rounded-full h-3 mb-2">
        <div className="h-3 rounded-full transition-all duration-500"
          style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-cz-2 text-sm font-medium">{label}</p>
        <p className="text-cz-3 text-xs">Sponsor ×{satisfactionToModifier(value).toFixed(2)}</p>
      </div>
    </div>
  );
}

function GoalCard({ goal, achieved, cumulativeProgress, evaluation }) {
  const status = evaluation?.status;
  const statusMeta = !achieved && status ? GOAL_STATUS_META[status] : null;
  const isRequired = goal.importance === "required";
  const isBehind = status === "behind";
  const isNearMiss = status === "near_miss" || status === "watch";

  const containerClass = achieved
    ? "bg-cz-success-bg0/8 border-cz-success/30"
    : isBehind && isRequired ? "bg-cz-danger-bg0/5 border-cz-danger/30"
    : isBehind ? "bg-cz-subtle border-cz-danger/30/50"
    : "bg-cz-subtle border-cz-border";

  const iconContent = achieved ? "✓" : isBehind ? "!" : isNearMiss ? "~" : "○";
  const iconClass = achieved ? "bg-cz-success-bg text-cz-success"
    : isBehind && isRequired ? "bg-cz-danger-bg text-red-600"
    : isBehind ? "bg-cz-danger-bg text-red-400"
    : isNearMiss ? "bg-cz-accent/10 text-cz-accent-t"
    : "bg-cz-subtle text-cz-3";

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${containerClass}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold ${iconClass}`}>
        {iconContent}
      </div>
      <div className="flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-medium ${achieved ? "text-green-300" : "text-cz-2"}`}>{getBoardGoalLabel(goal)}</p>
          {!achieved && evaluation?.actual != null && (
            <span className="text-xs font-mono text-cz-3 flex-shrink-0">
              {goal.type === "top_n_finish" ? `#${evaluation.actual}` : evaluation.actual}/{goal.type === "top_n_finish" ? `top ${evaluation.target}` : evaluation.target}
            </span>
          )}
        </div>
        {goal.cumulative && cumulativeProgress !== undefined && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 bg-cz-subtle rounded-full h-1">
              <div className={`h-1 rounded-full transition-all ${achieved ? "bg-cz-success-bg0" : "bg-cz-accent"}`}
                style={{ width: `${Math.min(100, Math.round((cumulativeProgress / goal.target) * 100))}%` }} />
            </div>
            <span className="text-cz-3 text-xs font-mono">{cumulativeProgress}/{goal.target}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-3 mt-1">
          {!achieved && isRequired && (
            <span className="text-[10px] text-cz-3 uppercase tracking-wider">Krav</span>
          )}
          {statusMeta?.label && (
            <span className={`text-xs font-medium ${statusMeta.color}`}>{statusMeta.label}</span>
          )}
          {goal.negotiated && <span className="text-xs text-cz-info/70">Forhandlet</span>}
          {goal.satisfaction_bonus > 0 && (
            <span className="text-xs text-cz-success/70">+{goal.satisfaction_bonus} tilfredshed</span>
          )}
          {goal.satisfaction_penalty > 0 && (
            <span className="text-xs text-cz-danger/70">-{goal.satisfaction_penalty} hvis ikke opfyldt</span>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanTimelineBar({ planDuration, seasonsCompleted, snapshots }) {
  if (planDuration <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-1 py-2">
      {Array.from({ length: planDuration }, (_, i) => {
        const seasonNum = i + 1;
        const isCurrent = seasonNum === seasonsCompleted + 1;
        const isCompleted = seasonNum <= seasonsCompleted;
        const snapshot = snapshots.find(s => s.season_within_plan === seasonNum);
        const metPct = snapshot ? Math.round((snapshot.goals_met / Math.max(1, snapshot.goals_total)) * 100) : 0;
        return (
          <div key={i} className="flex items-center gap-1">
            <div className={`relative w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
              ${isCompleted
                ? metPct >= 75 ? "bg-cz-success-bg border-green-500/50 text-cz-success"
                  : metPct >= 50 ? "bg-cz-accent/10 border-[#e8c547]/50 text-cz-accent-t"
                  : "bg-cz-danger-bg border-red-500/30 text-cz-danger"
                : isCurrent
                ? "bg-cz-accent/10 border-[#e8c547] text-cz-accent-t"
                : "bg-cz-subtle border-cz-border text-cz-3"}`}>
              {isCompleted ? (metPct >= 50 ? "✓" : "✗") : seasonNum}
            </div>
            {i < planDuration - 1 && (
              <div className={`w-6 h-0.5 ${isCompleted ? "bg-cz-subtle0" : "bg-cz-subtle"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CumulativeStatsRow({ goals, cumStats }) {
  const cumulativeGoals = (goals || []).filter(g => g.cumulative);
  if (!cumulativeGoals.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {cumulativeGoals.map((goal, i) => {
        const current = goal.type === "stage_wins" ? (cumStats?.stage_wins || 0) : (cumStats?.gc_wins || 0);
        const pct = Math.min(100, Math.round((current / goal.target) * 100));
        const achieved = current >= goal.target;
        return (
          <div key={i} className="bg-cz-card border border-cz-border rounded-xl p-4">
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">
              {goal.type === "stage_wins" ? "Etapesejre" : "Samlede sejre"}
            </p>
            <div className="flex items-end gap-2 mb-2">
              <span className={`font-mono font-bold text-2xl ${achieved ? "text-cz-success" : "text-cz-1"}`}>
                {current}
              </span>
              <span className="text-cz-3 text-sm mb-1">/ {goal.target}</span>
            </div>
            <div className="bg-cz-subtle rounded-full h-1.5">
              <div className={`h-1.5 rounded-full transition-all ${achieved ? "bg-cz-success-bg0" : "bg-cz-accent"}`}
                style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SeasonSnapshotGrid({ snapshots }) {
  if (!snapshots?.length) return null;
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5">
      <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">Sæsonhistorik</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-cz-3 border-b border-cz-border">
            <th className="text-left pb-2">Sæson</th>
            <th className="text-center pb-2">Rang</th>
            <th className="text-center pb-2">Etaper</th>
            <th className="text-center pb-2">Saml.</th>
            <th className="text-center pb-2">Mål</th>
            <th className="text-right pb-2">Tilfredshed</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map(s => (
            <tr key={s.id} className="border-t border-cz-border">
              <td className="py-2 text-cz-2">Sæson {s.season_number}</td>
              <td className="py-2 text-center text-cz-2">{s.division_rank ? `#${s.division_rank}` : "—"}</td>
              <td className="py-2 text-center text-cz-2">{s.stage_wins}</td>
              <td className="py-2 text-center text-cz-2">{s.gc_wins}</td>
              <td className="py-2 text-center">
                <span className={s.goals_met >= s.goals_total * 0.7
                  ? "text-cz-success" : s.goals_met >= s.goals_total * 0.4
                  ? "text-cz-accent-t" : "text-cz-danger"}>
                  {s.goals_met}/{s.goals_total}
                </span>
              </td>
              <td className="py-2 text-right">
                <span className={s.satisfaction_delta > 0
                  ? "text-cz-success" : s.satisfaction_delta < 0
                  ? "text-cz-danger" : "text-cz-2"}>
                  {s.satisfaction_delta > 0 ? "+" : ""}{s.satisfaction_delta}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoardIdentityCard({ identityProfile, title = "Holdidentitet" }) {
  if (!identityProfile) return null;
  const nationalCore = identityProfile.national_core;
  const starProfile = identityProfile.star_profile;
  const nationalCoreCountry = getCountryDisplay(nationalCore?.code);
  const nationalCoreValue = nationalCore?.established && nationalCore?.code ? nationalCoreCountry.label : "Blandet";
  const nationalCoreSub = nationalCore?.established
    ? `${nationalCore.count} ryttere · ${nationalCore.share_pct}% af truppen`
    : "Ingen tydelig kerne endnu";
  const starProfileValue = starProfile?.label || "Ukendt";
  const starProfileSub = starProfile?.star_rider_count
    ? `${starProfile.star_rider_count} profilryttere`
    : "Ingen klare profiler endnu";

  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5 mt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{title}</p>
          <p className="text-cz-1 font-semibold text-sm">{identityProfile.primary_specialization_label}</p>
          <p className="text-cz-2 text-sm mt-1">{formatBoardCopy(identityProfile.summary)}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">U25</p>
          <p className="font-mono font-bold text-sm text-[#7dd3fc]">{identityProfile.u25_share_pct ?? 0}%</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-3 xl:grid-cols-6 gap-3 mt-4">
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">Primær</p>
          <p className="text-cz-1 text-sm font-medium mt-1">{identityProfile.primary_specialization_label}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">Sekundær</p>
          <p className="text-cz-1 text-sm font-medium mt-1">{identityProfile.secondary_specialization_label}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">Sportsligt spor</p>
          <p className="text-cz-1 text-sm font-medium mt-1">{identityProfile.competitive_tier_label}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">Trup</p>
          <p className="text-cz-1 text-sm font-medium mt-1">
            {identityProfile.rider_count}/{identityProfile?.squad_limits?.max}
          </p>
          <p className="text-cz-3 text-xs mt-1">{identityProfile.squad_status_label}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">National kerne</p>
          <p className="text-cz-1 text-sm font-medium mt-1">{nationalCoreValue}</p>
          <p className="text-cz-3 text-xs mt-1">{nationalCoreSub}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">Stjerneprofil</p>
          <p className="text-cz-1 text-sm font-medium mt-1">{starProfileValue}</p>
          <p className="text-cz-3 text-xs mt-1">{starProfileSub}</p>
        </div>
      </div>
    </div>
  );
}

function BoardRequestPanel({ requestOptions, requestStatus, requestError, requestingType, onRequest }) {
  const latestRequest = requestStatus?.latest_request;
  const usedThisSeason = Boolean(requestStatus?.used_this_season);
  const supported = requestStatus?.supported !== false;
  const goalChanges = latestRequest?.board_changes?.goal_changes || [];
  const focusBefore = latestRequest?.board_changes?.focus_before;
  const focusAfter = latestRequest?.board_changes?.focus_after;
  const focusChanged = Boolean(focusBefore && focusAfter && focusBefore !== focusAfter);
  const outcomeMeta = {
    approved: { label: "Godkendt", accent: "text-green-300", box: "border-cz-success/30 bg-cz-success-bg0/8" },
    partial: { label: "Delvist", accent: "text-cz-accent-t", box: "border-cz-accent/30 bg-cz-accent/10" },
    tradeoff: { label: "Tradeoff", accent: "text-blue-300", box: "border-blue-500/20 bg-cz-info-bg0/8" },
    rejected: { label: "Afvist", accent: "text-red-300", box: "border-cz-danger/30 bg-cz-danger-bg0/8" },
  };
  const latestMeta = outcomeMeta[latestRequest?.outcome] || outcomeMeta.partial;

  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">Board Request</p>
          <p className="text-cz-1 font-semibold text-sm">Én strategisk forespørgsel pr. sæson</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`text-sm font-semibold ${usedThisSeason ? "text-cz-accent-t" : "text-green-300"}`}>
            {usedThisSeason ? "Brugt" : "Klar"}
          </p>
        </div>
      </div>

      {!supported && (
        <div className="rounded-xl border border-cz-accent/30 bg-cz-accent/10 p-4 mt-4">
          <p className="text-cz-accent-t text-sm font-semibold">Board requests venter på database-migration</p>
        </div>
      )}

      {latestRequest && (
        <div className={`rounded-xl border p-4 mt-4 ${latestMeta.box}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-cz-1 text-sm font-semibold">{latestRequest.title}</p>
              <p className="text-cz-2 text-xs mt-1">{latestRequest.request_label}</p>
            </div>
            <span className={`text-xs font-semibold uppercase tracking-wider ${latestMeta.accent}`}>
              {latestMeta.label}
            </span>
          </div>
          <p className="text-cz-2 text-sm mt-2">{formatBoardCopy(latestRequest.summary)}</p>
          {latestRequest.tradeoff_summary && (
            <p className="text-cz-2 text-sm mt-2">{formatBoardCopy(latestRequest.tradeoff_summary)}</p>
          )}
          {(focusChanged || goalChanges.length > 0) && (
            <div className="mt-4 pt-4 border-t border-cz-border">
              <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-3">Det reagerede boardet på</p>
              <div className="flex flex-col gap-2">
                {focusChanged && (
                  <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
                    <p className="text-cz-3 text-[10px] uppercase tracking-wider">Fokus</p>
                    <p className="text-cz-2 text-sm mt-1">
                      {FOCUS_LABELS[focusBefore] || focusBefore} → {FOCUS_LABELS[focusAfter] || focusAfter}
                    </p>
                  </div>
                )}
                {goalChanges.map((change, index) => {
                  const meta = GOAL_CHANGE_META[change.kind] || GOAL_CHANGE_META.replaced;
                  return (
                    <div key={`${change.kind}-${index}`} className={`border rounded-lg p-3 ${meta.box}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-cz-2 text-sm">{formatBoardCopy(change.before_label)}</p>
                          <p className="text-cz-3 text-xs mt-1">→ {formatBoardCopy(change.after_label)}</p>
                        </div>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${meta.accent}`}>
                          {meta.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {requestError && (
        <div className="rounded-xl border border-cz-danger/30 bg-cz-danger-bg0/8 p-4 mt-4">
          <p className="text-red-300 text-sm">{requestError}</p>
        </div>
      )}

      {supported && (
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          {(requestOptions || []).map((option) => {
            const disabled = Boolean(option.disabled);
            const isBusy = requestingType === option.type;
            return (
              <div key={option.type} className="bg-cz-subtle border border-cz-border rounded-xl p-4">
                <p className="text-cz-1 font-semibold text-sm">{option.label}</p>
                <p className="text-cz-2 text-sm mt-1">{option.description}</p>
                <p className="text-cz-3 text-xs mt-3">{option.tradeoff_preview}</p>
                <button
                  onClick={() => onRequest(option.type)}
                  disabled={disabled || Boolean(requestingType)}
                  className="w-full mt-4 py-2.5 rounded-lg text-sm font-semibold border transition-all
                    bg-cz-accent text-cz-on-accent border-[#e8c547]/40 hover:brightness-110
                    disabled:bg-cz-subtle disabled:text-cz-3 disabled:border-cz-border disabled:cursor-not-allowed"
                >
                  {isBusy ? "Sender..." : "Send request"}
                </button>
                {disabled && option.disabled_reason && (
                  <p className="text-cz-3 text-xs mt-2">{option.disabled_reason}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Plan-kort ─────────────────────────────────────────────────────────────────

function PlanCard({ planType, planData, riders, standing, activeLoanCount, team, requestError, requestingType, onRequest, onRenew, onNegotiate }) {
  const [expanded, setExpanded] = useState(true);

  if (!planData) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-xl p-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-cz-subtle flex items-center justify-center text-cz-3 text-sm font-bold">
            {planType === "5yr" ? "5" : planType === "3yr" ? "3" : "1"}
          </div>
          <div>
            <p className="text-cz-3 text-sm font-medium">{PLAN_LABELS[planType]}</p>
            <p className="text-cz-3 text-xs">Konfigureres automatisk ved næste sæsonstart</p>
          </div>
        </div>
      </div>
    );
  }

  const { board, plan_duration, seasons_remaining, seasons_completed, plan_progress_pct,
    cumulative_stats, snapshots, is_expired, outlook, request_status, request_options } = planData;

  const goals = typeof board.current_goals === "string"
    ? JSON.parse(board.current_goals)
    : (board.current_goals || []);
  const modifier = satisfactionToModifier(board.satisfaction);
  const nonCumGoals = goals.filter(g => !g.cumulative);
  const cumGoals = goals.filter(g => g.cumulative);

  function goalAchieved(goal) {
    if (goal.cumulative) {
      if (goal.type === "stage_wins") return (cumulative_stats?.stage_wins || 0) >= goal.target;
      if (goal.type === "gc_wins") return (cumulative_stats?.gc_wins || 0) >= goal.target;
    }
    const sponsorIncome = team?.sponsor_income ?? 0;
    const planStartSponsorIncome = board?.plan_start_sponsor_income ?? sponsorIncome;
    switch (goal.type) {
      case "min_u25_riders": return (riders || []).filter(r => r.is_u25).length >= goal.target;
      case "min_national_riders":
        return (riders || []).filter(r => (r.nationality_code || "").toUpperCase() === goal.nationality_code).length >= goal.target;
      case "min_riders": return (riders || []).length >= goal.target;
      case "top_n_finish": return standing ? (standing.rank_in_division || 99) <= goal.target : false;
      case "stage_wins": return standing ? (standing.stage_wins || 0) >= goal.target : false;
      case "gc_wins": return standing ? (standing.gc_wins || 0) >= goal.target : false;
      case "no_outstanding_debt": return activeLoanCount === 0;
      case "sponsor_growth": {
        if (!planStartSponsorIncome) return false;
        return ((sponsorIncome - planStartSponsorIncome) / planStartSponsorIncome * 100) >= goal.target;
      }
      default: return false;
    }
  }

  const goalsAchieved = nonCumGoals.filter(g => goalAchieved(g)).length;
  const midpoint = Math.floor(plan_duration / 2);
  const lastSnapshot = snapshots[snapshots.length - 1];
  const showMidReviewBanner = plan_duration > 1
    && lastSnapshot?.season_within_plan === midpoint
    && seasons_completed === midpoint;

  const satColor = board.satisfaction >= 70 ? "text-cz-success" : board.satisfaction >= 40 ? "text-cz-accent-t" : "text-cz-danger";

  return (
    <div className={`bg-cz-card border rounded-xl overflow-hidden ${is_expired ? "border-cz-accent/40" : "border-cz-border"}`}>
      {/* Header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold
              ${is_expired
                ? "bg-cz-accent/10 border border-cz-accent/30 text-cz-accent-t"
                : "bg-cz-subtle border border-cz-border text-cz-2"}`}>
              {planType === "5yr" ? "5" : planType === "3yr" ? "3" : "1"}
            </div>
            <div>
              <p className="text-cz-1 font-semibold text-sm">{PLAN_LABELS[planType]}</p>
              <p className="text-cz-3 text-xs">{FOCUS_LABELS[board.focus] || board.focus}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {is_expired ? (
              <button onClick={onNegotiate}
                className="px-3 py-1.5 text-xs font-semibold bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 rounded-lg hover:bg-cz-accent/20 transition-all">
                Forhandl ny plan
              </button>
            ) : (
              <button onClick={onRenew}
                className="px-3 py-1.5 text-xs border border-cz-border text-cz-3 rounded-lg hover:border-cz-border hover:text-cz-2 transition-all">
                Forny
              </button>
            )}
            <button onClick={() => setExpanded(e => !e)}
              className="px-2 py-1.5 text-xs border border-cz-border text-cz-3 rounded-lg hover:text-cz-2 transition-all">
              {expanded ? "↑" : "↓"}
            </button>
          </div>
        </div>

        {/* Kompakt stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-cz-subtle rounded-lg p-3 text-center">
            <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-1">Tilfredshed</p>
            <p className={`font-mono font-bold text-sm ${satColor}`}>{board.satisfaction}%</p>
          </div>
          <div className="bg-cz-subtle rounded-lg p-3 text-center">
            <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-1">Mål</p>
            <p className="font-mono font-bold text-sm text-cz-1">{goalsAchieved}/{nonCumGoals.length}</p>
          </div>
          <div className="bg-cz-subtle rounded-lg p-3 text-center">
            <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-1">Sponsor ×</p>
            <p className={`font-mono font-bold text-sm ${modifier >= 1 ? "text-cz-success" : "text-cz-danger"}`}>
              ×{modifier.toFixed(2)}
            </p>
          </div>
        </div>

        {is_expired && (
          <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-lg p-3 mt-4">
            <p className="text-cz-accent-t text-xs font-semibold">Plan udløbet — forhandl en ny plan med bestyrelsen</p>
          </div>
        )}
        {!is_expired && board.satisfaction < 25 && (
          <div className="bg-cz-danger-bg0/8 border border-cz-danger/30 rounded-lg p-3 mt-4">
            <p className="text-red-300 text-xs font-semibold">Bestyrelsen er dybt utilfreds</p>
            <p className="text-red-300/70 text-xs mt-0.5">Fortsat underpræstation skærper kravene ved næste planforhandling.</p>
          </div>
        )}
      </div>

      {/* Udvidet indhold */}
      {expanded && !is_expired && (
        <div className="border-t border-cz-border p-5 flex flex-col gap-4">
          {/* Timeline for 3yr/5yr */}
          {plan_duration > 1 && (
            <div>
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">Planforløb</p>
              <PlanTimelineBar planDuration={plan_duration} seasonsCompleted={seasons_completed} snapshots={snapshots} />
              <div className="mt-2">
                <div className="bg-cz-subtle rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-cz-accent transition-all"
                    style={{ width: `${plan_progress_pct || 0}%` }} />
                </div>
                <p className="text-cz-3 text-xs text-center mt-1">
                  {seasons_remaining} sæson{seasons_remaining !== 1 ? "er" : ""} tilbage
                </p>
              </div>
            </div>
          )}

          {showMidReviewBanner && (
            <div className="bg-cz-info-bg0/10 border border-blue-500/20 rounded-xl p-4">
              <p className="text-blue-300 text-sm font-semibold">Halvvejsevaluering afsluttet</p>
              <p className="text-blue-300/60 text-xs mt-1">Sæson {midpoint} af {plan_duration} evalueret.</p>
            </div>
          )}

          {/* Kumulative stats */}
          {plan_duration > 1 && cumGoals.length > 0 && (
            <CumulativeStatsRow goals={cumGoals} cumStats={cumulative_stats} />
          )}

          {/* Mål */}
          <div>
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">
              {plan_duration > 1 ? "Planmål" : "Sæsonmål"}
            </p>
            <div className="flex flex-col gap-2">
              {goals.map((g, i) => (
                <GoalCard
                  key={i}
                  goal={g}
                  achieved={goalAchieved(g)}
                  evaluation={outlook?.goal_evaluations?.[i]}
                  cumulativeProgress={
                    g.cumulative && g.type === "stage_wins" ? (cumulative_stats?.stage_wins ?? 0)
                    : g.cumulative && g.type === "gc_wins" ? (cumulative_stats?.gc_wins ?? 0)
                    : undefined
                  }
                />
              ))}
            </div>
          </div>

          {/* Sæsonhistorik */}
          {plan_duration > 1 && snapshots.length > 0 && (
            <SeasonSnapshotGrid snapshots={snapshots} />
          )}

          {/* Outlook (kompakt) */}
          {outlook?.feedback && (
            <div className="bg-cz-subtle border border-cz-border rounded-xl p-4">
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">Bestyrelsens vurdering</p>
              <p className="text-cz-1 text-sm font-semibold">{outlook.feedback.headline}</p>
              <p className="text-cz-2 text-sm mt-1">{formatBoardCopy(outlook.feedback.summary)}</p>
              {outlook.personality && (
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-cz-border">
                  {[
                    PERSONALITY_LABELS.sports_ambition[outlook.personality.sports_ambition],
                    PERSONALITY_LABELS.financial_risk[outlook.personality.financial_risk],
                    PERSONALITY_LABELS.identity_strength[outlook.personality.identity_strength],
                  ].filter(Boolean).map(label => (
                    <span key={label} className="text-[10px] bg-cz-subtle text-cz-2 px-2 py-0.5 rounded-full border border-cz-border">
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Request panel */}
          <BoardRequestPanel
            requestOptions={request_options || []}
            requestStatus={request_status}
            requestError={requestError}
            requestingType={requestingType}
            onRequest={onRequest}
          />
        </div>
      )}
    </div>
  );
}

// ── Wizard trin ───────────────────────────────────────────────────────────────

const FOCUS_OPTIONS = [
  { key: "balanced",          label: "Balanceret" },
  { key: "youth_development", label: "Ungdomsudvikling" },
  { key: "star_signing",      label: "Stjernesignering" },
];

const PLAN_DESCS = {
  "1yr": "Strenge mål, hurtige resultater — fuld straf ved manglende opfyldelse",
  "3yr": "Moderate mål, plads til vækst — 20% reduceret straf",
  "5yr": "Langsigtede ambitioner — 40% reduceret straf",
};

function WizardStep1({ identityProfile, focus, setFocus, planType, previewGoals, previewLoading, previewError, onStart }) {
  const duration = getPlanDuration(planType);
  const preview = previewGoals || [];
  return (
    <div>
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-full bg-cz-accent/10 border border-cz-accent/30
          flex items-center justify-center text-2xl mx-auto mb-4">◧</div>
        <h2 className="text-cz-1 font-bold text-xl">Bestyrelsens forslag</h2>
        <p className="text-cz-2 text-sm mt-1">Vælg strategi — bestyrelsen genererer krav</p>
      </div>

      <BoardIdentityCard identityProfile={identityProfile} title="Bestyrelsens læsning af holdet" />

      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-cz-3 text-xs uppercase tracking-wider mb-2">Holdfokus</label>
            {FOCUS_OPTIONS.map(o => (
              <button key={o.key} onClick={() => setFocus(o.key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 border transition-all
                  ${focus === o.key
                    ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                    : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle hover:text-cz-2"}`}>
                {o.label}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-cz-3 text-xs uppercase tracking-wider mb-2">Tidshorisont</label>
            <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-lg px-3 py-3">
              <p className="text-cz-accent-t font-semibold text-sm">{PLAN_LABELS[planType]}</p>
              <p className="text-cz-accent-t/60 text-xs mt-0.5">{PLAN_DESCS[planType]}</p>
            </div>
          </div>
        </div>
        {duration > 1 && (
          <p className="text-cz-3 text-xs mt-3 text-center">
            Planen løber over {duration} sæsoner — mål evalueres løbende
          </p>
        )}
      </div>

      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-6">
        <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">Bestyrelsens krav</p>
        {previewLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
          </div>
        ) : previewError ? (
          <p className="text-red-300 text-sm">{previewError}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {preview.map((g, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-cz-subtle border border-cz-border">
                <div className="w-5 h-5 rounded-full bg-cz-subtle text-cz-3 flex items-center justify-center
                  flex-shrink-0 mt-0.5 text-xs">○</div>
                <div className="flex-1">
                  <p className="text-cz-2 text-sm">{getBoardGoalLabel(g)}</p>
                  <div className="flex gap-3 mt-1">
                    {g.cumulative && <span className="text-xs text-cz-info/50">Kumulativt</span>}
                    {g.satisfaction_bonus > 0 && <span className="text-xs text-cz-success/60">+{g.satisfaction_bonus}</span>}
                    {g.satisfaction_penalty > 0 && <span className="text-xs text-cz-danger/60">-{g.satisfaction_penalty} straf</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onStart}
        disabled={previewLoading || preview.length === 0}
        className="w-full py-3 bg-cz-accent text-cz-on-accent font-bold rounded-xl text-sm hover:brightness-110
          disabled:opacity-50 transition-all"
      >
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
      <div className="flex items-center gap-3 mb-6">
        <span className="text-cz-3 text-xs flex-shrink-0">Mål {goalIdx + 1}/{total}</span>
        <div className="flex-1 bg-cz-subtle rounded-full h-1.5">
          <div className="h-1.5 rounded-full bg-cz-accent transition-all"
            style={{ width: `${((goalIdx) / total) * 100}%` }} />
        </div>
      </div>

      <div className="text-center mb-8">
        <h2 className="text-cz-1 font-bold text-xl">Forhandling</h2>
        <p className="text-cz-2 text-sm mt-1">Gennemgå bestyrelsens krav ét ad gangen</p>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
        <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">Bestyrelsens krav</p>
        <div className={`flex items-start gap-3 p-4 rounded-lg border
          ${current?.negotiated ? "bg-cz-info-bg0/5 border-blue-500/20" : "bg-cz-subtle border-cz-border"}`}>
          <div className="w-6 h-6 rounded-full bg-cz-accent/10 border border-cz-accent/30
            flex items-center justify-center flex-shrink-0 text-xs text-cz-accent-t">◎</div>
          <div className="flex-1">
            <p className="text-cz-1 font-semibold">{getBoardGoalLabel(current)}</p>
            <div className="flex flex-wrap gap-3 mt-2">
              {current?.importance === "required" && (
                <span className="text-[10px] text-cz-3 uppercase tracking-wider">Obligatorisk krav</span>
              )}
              {current?.cumulative && <span className="text-xs text-cz-info/70 bg-cz-info-bg0/10 px-2 py-0.5 rounded">Kumulativt</span>}
              {current?.satisfaction_bonus > 0 && (
                <span className="text-xs text-cz-success/70">+{current?.satisfaction_bonus} tilfredshed</span>
              )}
              {current?.satisfaction_penalty > 0 && (
                <span className="text-xs text-cz-danger/70">-{current?.satisfaction_penalty} straf</span>
              )}
              {current?.negotiated && <span className="text-xs text-cz-info/70">Forhandlet ✓</span>}
            </div>
          </div>
        </div>
      </div>

      {!pendingNegotiate ? (
        <div className="flex gap-3">
          <button onClick={onNegotiate} disabled={negotiated[goalIdx]}
            className={`flex-1 py-3 rounded-xl text-sm font-medium border transition-all
              ${negotiated[goalIdx]
                ? "bg-cz-subtle text-cz-3 border-cz-border cursor-not-allowed"
                : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle hover:text-cz-2"}`}>
            {negotiated[goalIdx] ? "Allerede forhandlet" : "Forhandl ned ↓"}
          </button>
          <button onClick={onAccept}
            className="flex-1 py-3 bg-cz-accent text-cz-on-accent font-bold rounded-xl text-sm hover:brightness-110 transition-all">
            Accepter →
          </button>
        </div>
      ) : (
        <div>
          <div className="bg-cz-info-bg0/10 border border-blue-500/20 rounded-xl p-4 mb-4">
            <p className="text-blue-300 text-sm font-medium">Bestyrelsen har accepteret kompromis</p>
            <p className="text-blue-300/60 text-xs mt-1">Straf halveret. Accepter det forhandlede mål?</p>
          </div>
          <button onClick={onAcceptNegotiated}
            className="w-full py-3 bg-cz-accent text-cz-on-accent font-bold rounded-xl text-sm hover:brightness-110 transition-all">
            Accepter forhandlet mål →
          </button>
        </div>
      )}

      {negotiationsUsed > 0 && (
        <p className="text-cz-3 text-xs text-center mt-4">{negotiationsUsed} forhandling(er) brugt</p>
      )}
    </div>
  );
}

function WizardStep3({ finalGoals, planType, onSign, saving }) {
  const duration = getPlanDuration(planType);
  return (
    <div>
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-full bg-cz-success-bg border border-cz-success/30
          flex items-center justify-center text-2xl mx-auto mb-4">✍</div>
        <h2 className="text-cz-1 font-bold text-xl">Underskrift</h2>
        <p className="text-cz-2 text-sm mt-1">
          {PLAN_LABELS[planType]} — løber over {duration} sæson{duration > 1 ? "er" : ""}
        </p>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-6">
        <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">Aftalte mål</p>
        <div className="flex flex-col gap-2">
          {finalGoals.map((g, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border
              ${g.negotiated ? "bg-cz-info-bg0/5 border-blue-500/20" : "bg-cz-subtle border-cz-border"}`}>
              <div className="w-5 h-5 rounded-full bg-cz-subtle text-cz-3 flex items-center
                justify-center flex-shrink-0 mt-0.5 text-xs">○</div>
              <div className="flex-1">
                <p className="text-cz-2 text-sm font-medium">{getBoardGoalLabel(g)}</p>
                <div className="flex gap-3 mt-1">
                  {g.cumulative && <span className="text-xs text-cz-info/50">Kumulativt</span>}
                  {g.negotiated && <span className="text-xs text-cz-info/70">Forhandlet</span>}
                  {g.satisfaction_bonus > 0 && <span className="text-xs text-cz-success/60">+{g.satisfaction_bonus}</span>}
                  {g.satisfaction_penalty > 0 && <span className="text-xs text-cz-danger/60">-{g.satisfaction_penalty} straf</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onSign} disabled={saving}
        className="w-full py-3 bg-cz-accent text-cz-on-accent font-bold rounded-xl
          hover:brightness-110 disabled:opacity-50 transition-all">
        {saving ? "Gemmer..." : "Underskriv kontrakt ✍"}
      </button>
    </div>
  );
}

// ── Hoved-komponent ───────────────────────────────────────────────────────────

export default function BoardPage() {
  // Plandata
  const [plans, setPlans] = useState({ "5yr": null, "3yr": null, "1yr": null });
  const [setupNextPlanType, setSetupNextPlanType] = useState(null);
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [standing, setStanding] = useState(null);
  const [identityProfile, setIdentityProfile] = useState(null);
  const [activeLoanCount, setActiveLoanCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Wizard state
  const [wizardPlanType, setWizardPlanType] = useState(null);
  const [wizardIsSetup, setWizardIsSetup] = useState(false);
  const [wizardFocus, setWizardFocus] = useState("balanced");
  const [wizardStep, setWizardStep] = useState(1);
  const [previewGoals, setPreviewGoals] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [proposedGoals, setProposedGoals] = useState([]);
  const [negotiationOptions, setNegotiationOptions] = useState([]);
  const [finalGoals, setFinalGoals] = useState([]);
  const [goalIdx, setGoalIdx] = useState(0);
  const [negotiated, setNegotiated] = useState({});
  const [pendingNegotiate, setPendingNegotiate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requestingType, setRequestingType] = useState("");
  const [requestErrors, setRequestErrors] = useState({ "5yr": "", "3yr": "", "1yr": "" });

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (!wizardPlanType) return;
    let ignore = false;

    async function loadPreview() {
      if (loading) return;
      setPreviewLoading(true);
      setPreviewError("");
      const proposal = await fetchBoardProposal(wizardFocus, wizardPlanType);
      if (ignore) return;
      if (!proposal) {
        setPreviewGoals([]);
        setNegotiationOptions([]);
        setPreviewError("Kunne ikke hente bestyrelsens forslag.");
        setPreviewLoading(false);
        return;
      }
      setPreviewGoals(proposal.goals || []);
      setNegotiationOptions(proposal.negotiation_options || []);
      setPreviewLoading(false);
    }

    loadPreview();
    return () => { ignore = true; };
  }, [wizardPlanType, wizardFocus, loading]);

  async function loadAll() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setLoading(false); return; }

    const res = await fetch(`${API}/api/board/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();

    const newPlans = data.plans || { "5yr": null, "3yr": null, "1yr": null };
    setPlans(newPlans);
    setSetupNextPlanType(data.setup_next_plan_type || null);
    setTeam(data.team || null);
    setRiders(data.riders || []);
    setStanding(data.standing || null);
    setIdentityProfile(data.identity_profile || null);
    setActiveLoanCount(data.active_loans_count || 0);

    // Auto-åbn wizard ved initial opsætning
    if (data.setup_next_plan_type) {
      const existingFocus = newPlans[data.setup_next_plan_type]?.board?.focus || "balanced";
      setWizardPlanType(data.setup_next_plan_type);
      setWizardIsSetup(true);
      setWizardFocus(existingFocus);
      setWizardStep(1);
      setPreviewGoals([]);
      setPreviewError("");
      setNegotiated({});
      setPendingNegotiate(false);
    }

    setLoading(false);
  }

  async function fetchBoardProposal(focus, planType) {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return null;
    const res = await fetch(`${API}/api/board/proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ focus, plan_type: planType }),
    });
    if (!res.ok) return null;
    return res.json();
  }

  function openWizard(planType, isSetup = false) {
    const existingFocus = plans[planType]?.board?.focus || "balanced";
    setWizardPlanType(planType);
    setWizardIsSetup(isSetup);
    setWizardFocus(existingFocus);
    setWizardStep(1);
    setPreviewGoals([]);
    setPreviewError("");
    setNegotiated({});
    setPendingNegotiate(false);
  }

  function closeWizard() {
    setWizardPlanType(null);
    setWizardIsSetup(false);
    setWizardStep(1);
  }

  // ── Wizard handlers ─────────────────────────────────────────────────────────

  async function startNegotiation() {
    let goals = previewGoals;
    let nextNegotiationOptions = negotiationOptions;
    if (!goals.length) {
      const proposal = await fetchBoardProposal(wizardFocus, wizardPlanType);
      if (!proposal) {
        setPreviewError("Kunne ikke hente bestyrelsens forslag.");
        return;
      }
      goals = proposal.goals || [];
      nextNegotiationOptions = proposal.negotiation_options || [];
      setPreviewGoals(goals);
      setNegotiationOptions(nextNegotiationOptions);
    }
    setProposedGoals(goals);
    setFinalGoals(goals.map(goal => ({ ...goal })));
    setGoalIdx(0);
    setNegotiated({});
    setPendingNegotiate(false);
    setWizardStep(2);
  }

  function acceptCurrentGoal() {
    const next = goalIdx + 1;
    if (next >= proposedGoals.length) { setWizardStep(3); return; }
    setGoalIdx(next);
    setPendingNegotiate(false);
  }

  function negotiateCurrentGoal() {
    if (negotiated[goalIdx]) return;
    const neg = negotiationOptions[goalIdx];
    if (!neg) return;
    const updated = [...finalGoals];
    updated[goalIdx] = neg;
    setFinalGoals(updated);
    setNegotiated(n => ({ ...n, [goalIdx]: true }));
    setPendingNegotiate(true);
  }

  function acceptNegotiatedGoal() {
    const next = goalIdx + 1;
    if (next >= proposedGoals.length) { setWizardStep(3); return; }
    setGoalIdx(next);
    setPendingNegotiate(false);
  }

  async function signContract() {
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setSaving(false); return; }

    const negotiationIndexes = Object.entries(negotiated)
      .filter(([, v]) => v)
      .map(([i]) => Number(i));

    const res = await fetch(`${API}/api/board/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        focus: wizardFocus,
        plan_type: wizardPlanType,
        negotiations: negotiationIndexes,
        goals: finalGoals,
      }),
    });

    setSaving(false);
    if (res.ok) {
      closeWizard();
      loadAll();
    }
  }

  async function sendBoardRequest(planType, requestType) {
    const key = `${planType}:${requestType}`;
    setRequestingType(key);
    setRequestErrors(e => ({ ...e, [planType]: "" }));

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setRequestErrors(e => ({ ...e, [planType]: "Du skal være logget ind." }));
      setRequestingType("");
      return;
    }

    const res = await fetch(`${API}/api/board/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan_type: planType, request_type: requestType }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setRequestErrors(e => ({ ...e, [planType]: data.error || "Kunne ikke sende bestyrelsesforespørgslen." }));
      setRequestingType("");
      return;
    }

    await loadAll();
    setRequestingType("");
  }

  async function renewContract(planType) {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    await fetch(`${API}/api/board/renew`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan_type: planType }),
    });

    loadAll();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  // ── Wizard visning ──────────────────────────────────────────────────────────
  if (wizardPlanType) {
    const setupStep = wizardIsSetup ? PLAN_SEQUENCE.indexOf(wizardPlanType) + 1 : null;
    const existingPlanData = plans[wizardPlanType];

    return (
      <div className="max-w-2xl mx-auto py-2">
        {wizardIsSetup && (
          <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-xl p-4 mb-6">
            <p className="text-cz-accent-t text-sm font-semibold">
              Opsætning af bestyrelsesplaner ({setupStep}/3)
            </p>
            <p className="text-cz-accent-t/60 text-xs mt-1">
              Forhandl din {PLAN_LABELS[wizardPlanType]} med bestyrelsen. Derefter fortsættes med næste plan.
            </p>
          </div>
        )}
        {!wizardIsSetup && existingPlanData?.is_expired && (
          <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-xl p-4 mb-6">
            <p className="text-cz-accent-t text-sm font-semibold">{PLAN_LABELS[wizardPlanType]} udløbet</p>
            <p className="text-cz-accent-t/60 text-xs mt-1">
              Forhandl en ny {PLAN_LABELS[wizardPlanType]} med bestyrelsen.
            </p>
          </div>
        )}

        {/* Trin-indikator */}
        <div className="flex items-center mb-8">
          {[
            { n: 1, label: "Strategi" },
            { n: 2, label: "Forhandling" },
            { n: 3, label: "Underskrift" },
          ].map(({ n, label }, i) => (
            <div key={n} className={`flex items-center ${i < 2 ? "flex-1" : ""}`}>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                  ${wizardStep === n ? "bg-cz-accent text-cz-on-accent"
                    : wizardStep > n ? "bg-cz-success-bg text-cz-success"
                    : "bg-cz-subtle text-cz-3"}`}>
                  {wizardStep > n ? "✓" : n}
                </div>
                <span className={`text-xs ${wizardStep === n ? "text-cz-2" : "text-cz-3"}`}>{label}</span>
              </div>
              {i < 2 && (
                <div className={`flex-1 h-px mx-3 ${wizardStep > n ? "bg-cz-success-bg0/30" : "bg-cz-subtle"}`} />
              )}
            </div>
          ))}
        </div>

        {existingPlanData?.board && (
          <div className="mb-6">
            <SatisfactionMeter value={existingPlanData.board.satisfaction} />
          </div>
        )}

        {wizardStep === 1 && (
          <WizardStep1
            identityProfile={identityProfile}
            focus={wizardFocus} setFocus={setWizardFocus}
            planType={wizardPlanType}
            previewGoals={previewGoals}
            previewLoading={previewLoading}
            previewError={previewError}
            onStart={startNegotiation}
          />
        )}
        {wizardStep === 2 && (
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
        {wizardStep === 3 && (
          <WizardStep3
            finalGoals={finalGoals}
            planType={wizardPlanType}
            onSign={signContract}
            saving={saving}
          />
        )}

        {!wizardIsSetup && (
          <button onClick={closeWizard}
            className="mt-6 w-full py-2 text-sm text-cz-3 hover:text-cz-2 transition-colors">
            ← Tilbage til oversigt
          </button>
        )}
      </div>
    );
  }

  // ── Hoved-visning: tre plan-kort ────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">Bestyrelse</h1>
          <p className="text-cz-3 text-sm">Tre parallelle planer — egne mål og tilfredshed</p>
        </div>
        <Link to="/finance"
          className="px-3 py-2 rounded-lg text-sm border bg-cz-subtle text-cz-2 border-cz-border
            hover:text-cz-1 hover:bg-cz-subtle transition-all">
          💰 Finanser
        </Link>
      </div>

      <BoardIdentityCard identityProfile={identityProfile} />

      <div className="mt-5 flex flex-col gap-4">
        {PLAN_SEQUENCE.map(planType => (
          <PlanCard
            key={planType}
            planType={planType}
            planData={plans[planType]}
            team={team}
            riders={riders}
            standing={standing}
            activeLoanCount={activeLoanCount}
            requestError={requestErrors[planType] || ""}
            requestingType={
              requestingType.startsWith(`${planType}:`)
                ? requestingType.split(":").slice(1).join(":")
                : ""
            }
            onRequest={(requestType) => sendBoardRequest(planType, requestType)}
            onRenew={() => renewContract(planType)}
            onNegotiate={() => openWizard(planType, false)}
          />
        ))}
      </div>

      {/* Tilfredshedsforklaring */}
      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mt-5">
        <h2 className="text-cz-1 font-semibold text-sm mb-4">Hvad betyder tilfredshed?</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { range: "70–100%", label: "Høj tilfredshed",    effect: "Sponsor × > 1.0 — ekstra indtægt", color: "text-cz-success" },
            { range: "40–69%", label: "Moderat tilfredshed", effect: "Sponsor × 1.0 — normal indtægt",   color: "text-cz-accent-t" },
            { range: "0–39%",  label: "Lav tilfredshed",     effect: "Sponsor × < 1.0 — reduceret",      color: "text-cz-danger" },
          ].map(item => (
            <div key={item.range} className="bg-cz-subtle rounded-lg p-3 border border-cz-border">
              <p className={`font-mono font-bold text-sm ${item.color}`}>{item.range}</p>
              <p className="text-cz-2 text-xs font-medium mt-1">{item.label}</p>
              <p className="text-cz-3 text-xs mt-1">{item.effect}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
