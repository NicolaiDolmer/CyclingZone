import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { satisfactionToModifier, getPlanDuration } from "../lib/boardUtils";
import { getCountryDisplay } from "../lib/countryUtils";
import { Link } from "react-router-dom";

const API = import.meta.env.VITE_API_URL;
const FOCUS_LABELS = {
  balanced: "Balanceret",
  youth_development: "Ungdomsudvikling",
  star_signing: "Stjernesignering",
};
const GOAL_CHANGE_META = {
  relaxed: { label: "Lempet", accent: "text-green-300", box: "border-green-500/20 bg-green-500/8" },
  tightened: { label: "Skærpet", accent: "text-red-300", box: "border-red-500/20 bg-red-500/8" },
  replaced: { label: "Omlagt", accent: "text-blue-300", box: "border-blue-500/20 bg-blue-500/8" },
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

function GoalCard({ goal, achieved, cumulativeProgress }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all
      ${achieved ? "bg-green-500/8 border-green-500/20" : "bg-white/3 border-white/5"}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs
        ${achieved ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white/20"}`}>
        {achieved ? "✓" : "○"}
      </div>
      <div className="flex-1">
        <p className={`text-sm font-medium ${achieved ? "text-green-300" : "text-white/70"}`}>{getBoardGoalLabel(goal)}</p>
        {goal.cumulative && cumulativeProgress !== undefined && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 bg-white/5 rounded-full h-1">
              <div className={`h-1 rounded-full transition-all ${achieved ? "bg-green-500" : "bg-[#e8c547]"}`}
                style={{ width: `${Math.min(100, Math.round((cumulativeProgress / goal.target) * 100))}%` }} />
            </div>
            <span className="text-white/30 text-xs font-mono">{cumulativeProgress}/{goal.target}</span>
          </div>
        )}
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

// ── Plan progress komponenter ─────────────────────────────────────────────────

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
                ? metPct >= 75 ? "bg-green-500/20 border-green-500/50 text-green-400"
                  : metPct >= 50 ? "bg-[#e8c547]/20 border-[#e8c547]/50 text-[#e8c547]"
                  : "bg-red-500/10 border-red-500/30 text-red-400"
                : isCurrent
                ? "bg-[#e8c547]/15 border-[#e8c547] text-[#e8c547]"
                : "bg-white/3 border-white/10 text-white/20"}`}>
              {isCompleted ? (metPct >= 50 ? "✓" : "✗") : seasonNum}
            </div>
            {i < planDuration - 1 && (
              <div className={`w-6 h-0.5 ${isCompleted ? "bg-white/20" : "bg-white/5"}`} />
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
        const current = goal.type === "stage_wins"
          ? (cumStats?.stage_wins || 0) : (cumStats?.gc_wins || 0);
        const pct = Math.min(100, Math.round((current / goal.target) * 100));
        const achieved = current >= goal.target;
        return (
          <div key={i} className="bg-[#0f0f18] border border-white/5 rounded-xl p-4">
            <p className="text-white/30 text-xs uppercase tracking-wider mb-2">
              {goal.type === "stage_wins" ? "Etapesejre" : "Samlede sejre"}
            </p>
            <div className="flex items-end gap-2 mb-2">
              <span className={`font-mono font-bold text-2xl ${achieved ? "text-green-400" : "text-white"}`}>
                {current}
              </span>
              <span className="text-white/30 text-sm mb-1">/ {goal.target}</span>
            </div>
            <div className="bg-white/5 rounded-full h-1.5">
              <div className={`h-1.5 rounded-full transition-all ${achieved ? "bg-green-500" : "bg-[#e8c547]"}`}
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
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5">
      <p className="text-white/30 text-xs uppercase tracking-wider mb-3">Sæsonhistorik</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-white/20 border-b border-white/5">
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
            <tr key={s.id} className="border-t border-white/5">
              <td className="py-2 text-white/50">Sæson {s.season_number}</td>
              <td className="py-2 text-center text-white/70">{s.division_rank ? `#${s.division_rank}` : "—"}</td>
              <td className="py-2 text-center text-white/70">{s.stage_wins}</td>
              <td className="py-2 text-center text-white/70">{s.gc_wins}</td>
              <td className="py-2 text-center">
                <span className={s.goals_met >= s.goals_total * 0.7
                  ? "text-green-400" : s.goals_met >= s.goals_total * 0.4
                  ? "text-[#e8c547]" : "text-red-400"}>
                  {s.goals_met}/{s.goals_total}
                </span>
              </td>
              <td className="py-2 text-right">
                <span className={s.satisfaction_delta > 0
                  ? "text-green-400" : s.satisfaction_delta < 0
                  ? "text-red-400" : "text-white/40"}>
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

function BoardOutlookCard({ outlook }) {
  const categories = Object.values(outlook?.score_breakdown?.categories || {});
  if (!outlook?.feedback) return null;
  const strongestCategory = outlook?.feedback?.strongest_category
    ? outlook?.score_breakdown?.categories?.[outlook.feedback.strongest_category]
    : null;
  const weakestCategory = outlook?.feedback?.weakest_category
    ? outlook?.score_breakdown?.categories?.[outlook.feedback.weakest_category]
    : null;
  const signalAdjustments = outlook?.score_breakdown?.signal_adjustments || {};
  const nationalCore = outlook?.identity_profile?.national_core;
  const starProfile = outlook?.identity_profile?.star_profile;
  const nationalCoreCountry = getCountryDisplay(nationalCore?.code);
  const reactionNotes = [];

  if (strongestCategory) {
    reactionNotes.push({
      key: "strongest",
      label: "Driver vurderingen",
      text: `${strongestCategory.label} er boardets stærkeste spor lige nu med ${strongestCategory.score_pct}%.`,
    });
  }

  if (weakestCategory && weakestCategory.key !== strongestCategory?.key) {
    reactionNotes.push({
      key: "weakest",
      label: "Skaber pres",
      text: `${weakestCategory.label} holder boardet tilbage med ${weakestCategory.score_pct}% og forklarer en stor del af presset.`,
    });
  }

  if (signalAdjustments.identity > 0 && nationalCore?.established) {
    reactionNotes.push({
      key: "identity_signal",
      label: "National kerne",
      text: `${nationalCoreCountry.label} giver ${formatSignalDelta(signalAdjustments.identity)} point i identitetsscoren som en del af holdets DNA.`,
    });
  }

  if (signalAdjustments.economy > 0 && starProfile?.label) {
    reactionNotes.push({
      key: "star_signal",
      label: "Stjerneprofil",
      text: `${starProfile.label} giver ${formatSignalDelta(signalAdjustments.economy)} point i sponsor/prestige, men holder samtidig forventningerne oppe.`,
    });
  }

  if (outlook?.score_breakdown?.recent_history_score != null) {
    const momentum = outlook?.score_breakdown?.momentum_modifier ?? 0;
    reactionNotes.push({
      key: "history",
      label: "Historik tæller med",
      text: momentum > 0.005
        ? "De seneste sæsoner trækker vurderingen lidt op, fordi boardet læser en positiv retning i udviklingen."
        : momentum < -0.005
          ? "De seneste sæsoner trækker vurderingen lidt ned, fordi boardet stadig husker en ustabil periode."
          : "Boardet læser også de seneste sæsoner ind, men historikken er lige nu ret neutral.",
    });
  }

  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Bestyrelsens Outlook</p>
          <p className="text-white font-semibold text-sm">{outlook.feedback.headline}</p>
          <p className="text-white/45 text-sm mt-1">{formatBoardCopy(outlook.feedback.summary)}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Status</p>
          <p className="font-mono font-bold text-sm text-[#e8c547]">
            {Math.round((outlook.overall_score || 0) * 100)}%
          </p>
        </div>
      </div>
      {categories.length > 0 && (
        <div className="grid sm:grid-cols-4 gap-3 mt-4">
          {categories.map((category) => (
            <div key={category.key} className="bg-white/3 border border-white/5 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-white/35 text-[10px] uppercase tracking-wider">{category.label}</p>
                <span className="text-white/45 text-[10px] font-mono">{category.score_pct}%</span>
              </div>
              <div className="bg-white/5 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full ${category.score_pct >= 75 ? "bg-green-400" : category.score_pct >= 55 ? "bg-[#e8c547]" : "bg-red-400"}`}
                  style={{ width: `${Math.min(100, category.score_pct)}%` }}
                />
              </div>
              <p className="text-white/30 text-[11px] mt-2">
                {category.key === strongestCategory?.key
                  ? "Driver boardets reaktion lige nu"
                  : category.key === weakestCategory?.key
                    ? "Holder boardet tilbage lige nu"
                    : category.signal_bonus > 0
                      ? `Signalbonus ${formatSignalDelta(category.signal_bonus)}`
                      : "Stabil del af vurderingen"}
              </p>
            </div>
          ))}
        </div>
      )}
      {reactionNotes.length > 0 && (
        <div className="mt-4">
          <p className="text-white/30 text-xs uppercase tracking-wider mb-3">Hvorfor reagerer boardet sådan?</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {reactionNotes.map((note) => (
              <div key={note.key} className="bg-white/3 border border-white/5 rounded-lg p-3">
                <p className="text-white/35 text-[10px] uppercase tracking-wider">{note.label}</p>
                <p className="text-white/70 text-sm mt-1">{note.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BoardIdentityCard({ identityProfile, title = "Holdidentitet" }) {
  if (!identityProfile) return null;

  const nationalCore = identityProfile.national_core;
  const starProfile = identityProfile.star_profile;
  const nationalCoreCountry = getCountryDisplay(nationalCore?.code);
  const nationalCoreValue = nationalCore?.established && nationalCore?.code
    ? nationalCoreCountry.label
    : "Blandet";
  const nationalCoreSub = nationalCore?.established
    ? `${nationalCore.count} ryttere · ${nationalCore.share_pct}% af truppen`
    : "Ingen tydelig kerne endnu";
  const starProfileValue = starProfile?.label || "Ukendt";
  const starProfileSub = starProfile?.star_rider_count
    ? `${starProfile.star_rider_count} profilryttere`
    : "Ingen klare profiler endnu";

  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-white/30 text-xs uppercase tracking-wider mb-1">{title}</p>
          <p className="text-white font-semibold text-sm">{identityProfile.primary_specialization_label}</p>
          <p className="text-white/45 text-sm mt-1">{formatBoardCopy(identityProfile.summary)}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-white/30 text-xs uppercase tracking-wider mb-1">U25</p>
          <p className="font-mono font-bold text-sm text-[#7dd3fc]">
            {identityProfile.u25_share_pct ?? 0}%
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 xl:grid-cols-6 gap-3 mt-4">
        <div className="bg-white/3 border border-white/5 rounded-lg p-3">
          <p className="text-white/35 text-[10px] uppercase tracking-wider">Primær</p>
          <p className="text-white text-sm font-medium mt-1">{identityProfile.primary_specialization_label}</p>
        </div>
        <div className="bg-white/3 border border-white/5 rounded-lg p-3">
          <p className="text-white/35 text-[10px] uppercase tracking-wider">Sekundær</p>
          <p className="text-white text-sm font-medium mt-1">{identityProfile.secondary_specialization_label}</p>
        </div>
        <div className="bg-white/3 border border-white/5 rounded-lg p-3">
          <p className="text-white/35 text-[10px] uppercase tracking-wider">Sportsligt spor</p>
          <p className="text-white text-sm font-medium mt-1">{identityProfile.competitive_tier_label}</p>
        </div>
        <div className="bg-white/3 border border-white/5 rounded-lg p-3">
          <p className="text-white/35 text-[10px] uppercase tracking-wider">Trup</p>
          <p className="text-white text-sm font-medium mt-1">
            {identityProfile.rider_count}/{identityProfile?.squad_limits?.max}
          </p>
          <p className="text-white/30 text-xs mt-1">{identityProfile.squad_status_label}</p>
        </div>
        <div className="bg-white/3 border border-white/5 rounded-lg p-3">
          <p className="text-white/35 text-[10px] uppercase tracking-wider">National kerne</p>
          <p className="text-white text-sm font-medium mt-1">{nationalCoreValue}</p>
          <p className="text-white/30 text-xs mt-1">{nationalCoreSub}</p>
        </div>
        <div className="bg-white/3 border border-white/5 rounded-lg p-3">
          <p className="text-white/35 text-[10px] uppercase tracking-wider">Stjerneprofil</p>
          <p className="text-white text-sm font-medium mt-1">{starProfileValue}</p>
          <p className="text-white/30 text-xs mt-1">{starProfileSub}</p>
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
    approved: { label: "Godkendt", accent: "text-green-300", box: "border-green-500/20 bg-green-500/8" },
    partial: { label: "Delvist", accent: "text-[#e8c547]", box: "border-[#e8c547]/20 bg-[#e8c547]/8" },
    tradeoff: { label: "Tradeoff", accent: "text-blue-300", box: "border-blue-500/20 bg-blue-500/8" },
    rejected: { label: "Afvist", accent: "text-red-300", box: "border-red-500/20 bg-red-500/8" },
  };
  const latestMeta = outcomeMeta[latestRequest?.outcome] || outcomeMeta.partial;

  return (
    <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Board Requests</p>
          <p className="text-white font-semibold text-sm">Én strategisk forespørgsel pr. sæson</p>
          <p className="text-white/45 text-sm mt-1">
            Bed bestyrelsen om en justering i den aktive plan. Svaret kan være godkendt, delvist,
            afvist eller godkendt med et tradeoff.
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Status</p>
          <p className={`text-sm font-semibold ${usedThisSeason ? "text-[#e8c547]" : "text-green-300"}`}>
            {usedThisSeason ? "Brugt i denne sæson" : "Klar til brug"}
          </p>
        </div>
      </div>

      {!supported && (
        <div className="rounded-xl border border-[#e8c547]/20 bg-[#e8c547]/8 p-4 mt-4">
          <p className="text-[#e8c547] text-sm font-semibold">Board requests venter på database-migration</p>
          <p className="text-[#e8c547]/70 text-sm mt-1">
            Resten af board-systemet virker stadig, men request-delen bliver først aktiveret når den nye SQL-tabel er lagt på live-databasen.
          </p>
        </div>
      )}

      {latestRequest && (
        <div className={`rounded-xl border p-4 mt-4 ${latestMeta.box}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-white text-sm font-semibold">{latestRequest.title}</p>
              <p className="text-white/60 text-xs mt-1">{latestRequest.request_label}</p>
            </div>
            <span className={`text-xs font-semibold uppercase tracking-wider ${latestMeta.accent}`}>
              {latestMeta.label}
            </span>
          </div>
          <p className="text-white/60 text-sm mt-2">{formatBoardCopy(latestRequest.summary)}</p>
          {latestRequest.tradeoff_summary && (
            <p className="text-white/45 text-sm mt-2">{formatBoardCopy(latestRequest.tradeoff_summary)}</p>
          )}
          {(focusChanged || goalChanges.length > 0) && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-white/35 text-[10px] uppercase tracking-wider mb-3">Det reagerede boardet på</p>
              <div className="flex flex-col gap-2">
                {focusChanged && (
                  <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <p className="text-white/35 text-[10px] uppercase tracking-wider">Fokus</p>
                    <p className="text-white/75 text-sm mt-1">
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
                          <p className="text-white/80 text-sm">{formatBoardCopy(change.before_label)}</p>
                          <p className="text-white/35 text-xs mt-1">→ {formatBoardCopy(change.after_label)}</p>
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
        <div className="rounded-xl border border-red-500/20 bg-red-500/8 p-4 mt-4">
          <p className="text-red-300 text-sm">{requestError}</p>
        </div>
      )}

      {supported && (
      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        {(requestOptions || []).map((option) => {
          const disabled = Boolean(option.disabled);
          const isBusy = requestingType === option.type;

          return (
            <div key={option.type} className="bg-white/3 border border-white/5 rounded-xl p-4">
              <p className="text-white font-semibold text-sm">{option.label}</p>
              <p className="text-white/45 text-sm mt-1">{option.description}</p>
              <p className="text-white/30 text-xs mt-3">{option.tradeoff_preview}</p>
              <button
                onClick={() => onRequest(option.type)}
                disabled={disabled || Boolean(requestingType)}
                className="w-full mt-4 py-2.5 rounded-lg text-sm font-semibold border transition-all
                  bg-[#e8c547] text-[#0a0a0f] border-[#e8c547]/40 hover:bg-[#f0d060]
                  disabled:bg-white/5 disabled:text-white/25 disabled:border-white/10 disabled:cursor-not-allowed"
              >
                {isBusy ? "Sender..." : "Send request"}
              </button>
              {disabled && option.disabled_reason && (
                <p className="text-white/25 text-xs mt-2">{option.disabled_reason}</p>
              )}
            </div>
          );
        })}
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

const PLAN_OPTIONS = [
  { key: "1yr", label: "1-årsplan", desc: "Strenge mål, hurtige resultater" },
  { key: "3yr", label: "3-årsplan", desc: "Moderate mål, plads til vækst" },
  { key: "5yr", label: "5-årsplan", desc: "Langsigtede ambitioner" },
];

function WizardStep1({
  identityProfile,
  focus,
  setFocus,
  planType,
  setPlanType,
  previewGoals,
  previewLoading,
  previewError,
  onStart,
}) {
  const preview = previewGoals || [];
  const duration = getPlanDuration(planType);
  return (
    <div>
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-full bg-[#e8c547]/10 border border-[#e8c547]/20
          flex items-center justify-center text-2xl mx-auto mb-4">◧</div>
        <h2 className="text-white font-bold text-xl">Bestyrelsens forslag</h2>
        <p className="text-white/40 text-sm mt-1">Vælg strategi og tidslinje — bestyrelsen genererer krav</p>
      </div>

      <BoardIdentityCard
        identityProfile={identityProfile}
        title="Bestyrelsens læsning af holdet"
      />

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
                <span>{o.label}</span>
                <span className={`block text-xs mt-0.5 ${planType === o.key ? "text-[#e8c547]/60" : "text-white/25"}`}>
                  {o.desc}
                </span>
              </button>
            ))}
          </div>
        </div>
        {duration > 1 && (
          <p className="text-white/25 text-xs mt-3 text-center">
            Planen løber over {duration} sæsoner — mål evalueres løbende
          </p>
        )}
      </div>

      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-6">
        <p className="text-white/30 text-xs uppercase tracking-wider mb-3">Bestyrelsens krav</p>
        {previewLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : previewError ? (
          <p className="text-red-300 text-sm">{previewError}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {preview.map((g, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white/3 border border-white/5">
                <div className="w-5 h-5 rounded-full bg-white/10 text-white/20 flex items-center justify-center
                  flex-shrink-0 mt-0.5 text-xs">○</div>
                <div className="flex-1">
                  <p className="text-white/70 text-sm">{getBoardGoalLabel(g)}</p>
                  <div className="flex gap-3 mt-1">
                    {g.cumulative && <span className="text-xs text-blue-400/50">Kumulativt</span>}
                    {g.satisfaction_bonus > 0 && <span className="text-xs text-green-400/60">+{g.satisfaction_bonus}</span>}
                    {g.satisfaction_penalty > 0 && <span className="text-xs text-red-400/60">-{g.satisfaction_penalty} straf</span>}
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
        className="w-full py-3 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-xl text-sm hover:bg-[#f0d060]
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
      {/* Progress */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-white/30 text-xs flex-shrink-0">Mål {goalIdx + 1}/{total}</span>
        <div className="flex-1 bg-white/5 rounded-full h-1.5">
          <div className="h-1.5 rounded-full bg-[#e8c547] transition-all"
            style={{ width: `${((goalIdx) / total) * 100}%` }} />
        </div>
      </div>

      <div className="text-center mb-8">
        <h2 className="text-white font-bold text-xl">Forhandling</h2>
        <p className="text-white/40 text-sm mt-1">Gennemgå bestyrelsens krav ét ad gangen</p>
      </div>

      {/* Current goal */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-4">
        <p className="text-white/30 text-xs uppercase tracking-wider mb-3">Bestyrelsens krav</p>
        <div className={`flex items-start gap-3 p-4 rounded-lg border
          ${current?.negotiated ? "bg-blue-500/5 border-blue-500/20" : "bg-white/3 border-white/8"}`}>
          <div className="w-6 h-6 rounded-full bg-[#e8c547]/10 border border-[#e8c547]/20
            flex items-center justify-center flex-shrink-0 text-xs text-[#e8c547]">◎</div>
          <div className="flex-1">
            <p className="text-white font-semibold">{getBoardGoalLabel(current)}</p>
            <div className="flex gap-3 mt-2">
              {current?.cumulative && <span className="text-xs text-blue-400/70 bg-blue-500/10 px-2 py-0.5 rounded">Kumulativt</span>}
              {current?.satisfaction_bonus > 0 && (
                <span className="text-xs text-green-400/70">+{current?.satisfaction_bonus} tilfredshed</span>
              )}
              {current?.satisfaction_penalty > 0 && (
                <span className="text-xs text-red-400/70">-{current?.satisfaction_penalty} straf</span>
              )}
              {current?.negotiated && <span className="text-xs text-blue-400/70">Forhandlet ✓</span>}
            </div>
          </div>
        </div>
      </div>

      {!pendingNegotiate ? (
        <div className="flex gap-3">
          <button onClick={onNegotiate} disabled={negotiated[goalIdx]}
            className={`flex-1 py-3 rounded-xl text-sm font-medium border transition-all
              ${negotiated[goalIdx]
                ? "bg-white/3 text-white/20 border-white/5 cursor-not-allowed"
                : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white/80"}`}>
            {negotiated[goalIdx] ? "Allerede forhandlet" : "Forhandl ned ↓"}
          </button>
          <button onClick={onAccept}
            className="flex-1 py-3 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-xl text-sm hover:bg-[#f0d060] transition-all">
            Accepter →
          </button>
        </div>
      ) : (
        <div>
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-4">
            <p className="text-blue-300 text-sm font-medium">Bestyrelsen har accepteret kompromis</p>
            <p className="text-blue-300/60 text-xs mt-1">Straf halveret. Accepter det forhandlede mål?</p>
          </div>
          <button onClick={onAcceptNegotiated}
            className="w-full py-3 bg-[#e8c547] text-[#0a0a0f] font-bold rounded-xl text-sm hover:bg-[#f0d060] transition-all">
            Accepter forhandlet mål →
          </button>
        </div>
      )}

      {negotiationsUsed > 0 && (
        <p className="text-white/20 text-xs text-center mt-4">{negotiationsUsed} forhandling(er) brugt</p>
      )}
    </div>
  );
}

function WizardStep3({ finalGoals, planType, onSign, saving }) {
  const duration = getPlanDuration(planType);
  const PLAN_LABELS = { "1yr": "1-årsplan", "3yr": "3-årsplan", "5yr": "5-årsplan" };
  return (
    <div>
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/20
          flex items-center justify-center text-2xl mx-auto mb-4">✍</div>
        <h2 className="text-white font-bold text-xl">Underskrift</h2>
        <p className="text-white/40 text-sm mt-1">
          {PLAN_LABELS[planType]} — løber over {duration} sæson{duration > 1 ? "er" : ""}
        </p>
      </div>

      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mb-6">
        <p className="text-white/30 text-xs uppercase tracking-wider mb-3">Aftalte mål</p>
        <div className="flex flex-col gap-2">
          {finalGoals.map((g, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border
              ${g.negotiated ? "bg-blue-500/5 border-blue-500/20" : "bg-white/3 border-white/5"}`}>
              <div className="w-5 h-5 rounded-full bg-white/10 text-white/20 flex items-center
                justify-center flex-shrink-0 mt-0.5 text-xs">○</div>
              <div className="flex-1">
                <p className="text-white/80 text-sm font-medium">{getBoardGoalLabel(g)}</p>
                <div className="flex gap-3 mt-1">
                  {g.cumulative && <span className="text-xs text-blue-400/50">Kumulativt</span>}
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
  const [boardOutlook, setBoardOutlook] = useState(null);
  const [identityProfile, setIdentityProfile] = useState(null);
  const [boardRequestOptions, setBoardRequestOptions] = useState([]);
  const [boardRequestStatus, setBoardRequestStatus] = useState(null);
  const [riders, setRiders] = useState([]);
  const [standing, setStanding] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [planStatus, setPlanStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // Wizard state
  const [focus, setFocus] = useState("balanced");
  const [planType, setPlanType] = useState("3yr");
  const [step, setStep] = useState(1);
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
  const [requestError, setRequestError] = useState("");

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    let ignore = false;

    async function loadProposalPreview() {
      if (loading) return;
      if (board && board.negotiation_status !== "pending") {
        setPreviewGoals([]);
        setPreviewError("");
        setPreviewLoading(false);
        return;
      }

      setPreviewLoading(true);
      setPreviewError("");

      const proposal = await fetchBoardProposal(focus, planType);
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

    loadProposalPreview();

    return () => {
      ignore = true;
    };
  }, [board?.id, board?.negotiation_status, focus, planType, loading]);

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

    setBoard(data.board);
    setBoardOutlook(data.outlook || null);
    setIdentityProfile(data.identity_profile || data.outlook?.identity_profile || null);
    setBoardRequestOptions(data.request_options || []);
    setBoardRequestStatus(data.request_status || null);
    setRiders(data.riders || []);
    setStanding(data.standing);
    setSnapshots(data.snapshots || []);
    setPlanStatus({
      plan_duration: data.plan_duration,
      seasons_remaining: data.seasons_remaining,
      seasons_completed: data.seasons_completed,
      plan_progress_pct: data.plan_progress_pct,
      cumulative_stats: data.cumulative_stats,
      is_expired: data.is_expired,
      active_loans_count: data.active_loans_count,
      team: data.team,
    });

    if (data.board) {
      setFocus(data.board.focus || "balanced");
      setPlanType(data.board.plan_type || "3yr");
    }
    setLoading(false);
  }

  async function fetchBoardProposal(nextFocus = focus, nextPlanType = planType) {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return null;

    const res = await fetch(`${API}/api/board/proposal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ focus: nextFocus, plan_type: nextPlanType }),
    });

    if (!res.ok) return null;
    return res.json();
  }

  // ── Wizard handlers ─────────────────────────────────────────────────────────

  async function startNegotiation() {
    let goals = previewGoals;
    let nextNegotiationOptions = negotiationOptions;

    if (!goals.length) {
      const proposal = await fetchBoardProposal(focus, planType);
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
    if (next >= proposedGoals.length) { setStep(3); return; }
    setGoalIdx(next);
    setPendingNegotiate(false);
  }

  async function signContract() {
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setSaving(false); return; }

    const negotiationIndexes = Object.entries(negotiated)
      .filter(([, value]) => value)
      .map(([index]) => Number(index));

    const res = await fetch(`${API}/api/board/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        focus,
        plan_type: planType,
        negotiations: negotiationIndexes,
        goals: finalGoals,
      }),
    });

    setSaving(false);
    if (res.ok) {
      setStep(1);
      loadAll();
    }
  }

  async function sendBoardRequest(requestType) {
    setRequestingType(requestType);
    setRequestError("");

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setRequestError("Du skal være logget ind for at sende en bestyrelsesforespørgsel.");
      setRequestingType("");
      return;
    }

    const res = await fetch(`${API}/api/board/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_type: requestType }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setRequestError(data.error || "Kunne ikke sende bestyrelsesforespørgslen.");
      setRequestingType("");
      return;
    }

    await loadAll();
    setRequestingType("");
  }

  async function renewContract() {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    const res = await fetch(`${API}/api/board/renew`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      setStep(1);
      loadAll();
    }
  }

  // ── Completed-view helpers ──────────────────────────────────────────────────

  function isGoalAchieved(goal) {
    const cumStats = planStatus?.cumulative_stats || {};
    if (goal.cumulative) {
      if (goal.type === "stage_wins") return (cumStats.stage_wins || 0) >= goal.target;
      if (goal.type === "gc_wins") return (cumStats.gc_wins || 0) >= goal.target;
    }
    const activeLoanCount = planStatus?.active_loans_count ?? 0;
    const sponsorIncome = planStatus?.team?.sponsor_income ?? 0;
    const planStartSponsorIncome = board?.plan_start_sponsor_income ?? sponsorIncome;

    switch (goal.type) {
      case "min_u25_riders": return riders.filter(r => r.is_u25).length >= goal.target;
      case "min_national_riders":
        return riders.filter(r => (r.nationality_code || "").toUpperCase() === goal.nationality_code).length >= goal.target;
      case "min_riders":     return riders.length >= goal.target;
      case "top_n_finish":   return standing ? (standing.rank_in_division || 99) <= goal.target : false;
      case "stage_wins":     return standing ? (standing.stage_wins || 0) >= goal.target : false;
      case "gc_wins":        return standing ? (standing.gc_wins || 0) >= goal.target : false;
      case "no_outstanding_debt": return activeLoanCount === 0;
      case "sponsor_growth": {
        if (!planStartSponsorIncome) return false;
        return ((sponsorIncome - planStartSponsorIncome) / planStartSponsorIncome * 100) >= goal.target;
      }
      default: return false;
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
    const isExpiredRenegotiation = board && board.negotiation_status === "pending";
    const PLAN_LABELS = { "1yr": "1-årsplan", "3yr": "3-årsplan", "5yr": "5-årsplan" };

    return (
      <div className="max-w-2xl mx-auto py-2">
        {isExpiredRenegotiation && (
          <div className="bg-[#e8c547]/10 border border-[#e8c547]/20 rounded-xl p-4 mb-6">
            <p className="text-[#e8c547] text-sm font-semibold">Bestyrelsesplan udløbet</p>
            <p className="text-[#e8c547]/60 text-xs mt-1">
              Din {PLAN_LABELS[board.plan_type] || "plan"} er afsluttet. Forhandl en ny plan for de kommende sæsoner.
            </p>
          </div>
        )}

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
            identityProfile={identityProfile}
            focus={focus} setFocus={setFocus}
            planType={planType} setPlanType={setPlanType}
            previewGoals={previewGoals}
            previewLoading={previewLoading}
            previewError={previewError}
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
            planType={planType}
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
  const nonCumulativeGoals = goals.filter(g => !g.cumulative);
  const goalsAchieved = nonCumulativeGoals.filter(g => isGoalAchieved(g)).length;

  const PLAN_LABELS = { "1yr": "1-årsplan", "3yr": "3-årsplan", "5yr": "5-årsplan" };

  const planDuration = planStatus?.plan_duration || 1;
  const seasonsCompleted = planStatus?.seasons_completed || 0;

  // Mid-plan review banner: show only if the last snapshot is at the midpoint
  const midpoint = Math.floor(planDuration / 2);
  const lastSnapshot = snapshots[snapshots.length - 1];
  const showMidReviewBanner = planDuration > 1
    && lastSnapshot?.season_within_plan === midpoint
    && seasonsCompleted === midpoint;

  return (
      <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Bestyrelse</h1>
          <p className="text-white/30 text-sm">Mål, tilfredshed og bestyrelsesplan</p>
        </div>
        <div className="flex gap-2">
          <Link to="/finance"
            className="px-3 py-2 rounded-lg text-sm border bg-white/5 text-white/40 border-white/10
              hover:text-white hover:bg-white/10 transition-all">
            💰 Finanser
          </Link>
          <button onClick={renewContract}
            className="px-4 py-2 rounded-lg text-sm font-medium border
              bg-white/5 text-white/50 border-white/10 hover:bg-white/10 hover:text-white transition-all">
            Forny kontrakt
          </button>
        </div>
      </div>

        <SatisfactionMeter value={board.satisfaction} />
        <BoardOutlookCard outlook={boardOutlook} />
        <BoardIdentityCard identityProfile={identityProfile} />
        <BoardRequestPanel
          requestOptions={boardRequestOptions}
          requestStatus={boardRequestStatus}
          requestError={requestError}
          requestingType={requestingType}
          onRequest={sendBoardRequest}
        />

        {/* Plan stats row */}
        <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 text-center">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Fokus</p>
          <p className="text-white font-semibold text-sm">{FOCUS_LABELS[board.focus] || board.focus}</p>
        </div>
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 text-center">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Plan</p>
          <p className="text-white font-semibold text-sm">{PLAN_LABELS[board.plan_type] || board.plan_type}</p>
          {planDuration > 1 && (
            <p className="text-white/30 text-xs mt-0.5">Sæson {seasonsCompleted}/{planDuration}</p>
          )}
        </div>
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-4 text-center">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Sponsor ×</p>
          <p className={`font-mono font-bold text-sm ${modifier >= 1 ? "text-green-400" : "text-red-400"}`}>
            ×{modifier.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Plan timeline (3yr/5yr only) */}
      {planDuration > 1 && (
        <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mt-4">
          <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Planforløb</p>
          <PlanTimelineBar
            planDuration={planDuration}
            seasonsCompleted={seasonsCompleted}
            snapshots={snapshots}
          />
          <div className="mt-2">
            <div className="bg-white/5 rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-[#e8c547] transition-all"
                style={{ width: `${planStatus?.plan_progress_pct || 0}%` }} />
            </div>
            <p className="text-white/20 text-xs text-center mt-1">
              {planStatus?.seasons_remaining} sæson{planStatus?.seasons_remaining !== 1 ? "er" : ""} tilbage af planen
            </p>
          </div>
        </div>
      )}

      {/* Mid-plan review banner */}
      {showMidReviewBanner && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mt-4">
          <p className="text-blue-300 text-sm font-semibold">Halvvejsevaluering afsluttet</p>
          <p className="text-blue-300/60 text-xs mt-1">
            Bestyrelsen har vurderet din fremgang efter sæson {midpoint} af {planDuration}. Fortsæt mod planens mål.
          </p>
        </div>
      )}

      {/* Cumulative stats (for multi-year plans with cumulative goals) */}
      {planDuration > 1 && goals.some(g => g.cumulative) && (
        <div className="mt-4">
          <CumulativeStatsRow goals={goals} cumStats={planStatus?.cumulative_stats} />
        </div>
      )}

      {/* Current goals */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mt-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-sm">
            {planDuration > 1 ? "Planmål" : "Sæsonmål"}
          </h2>
          <span className="text-white/40 text-xs font-mono">
            {goalsAchieved}/{nonCumulativeGoals.length} opfyldt
          </span>
        </div>
        {goals.length === 0 ? (
          <p className="text-white/30 text-sm">Ingen mål sat endnu</p>
        ) : (
          <div className="flex flex-col gap-2">
            {goals.map((g, i) => (
              <GoalCard
                key={i}
                goal={g}
                achieved={isGoalAchieved(g)}
                cumulativeProgress={
                  g.cumulative && g.type === "stage_wins" ? (planStatus?.cumulative_stats?.stage_wins ?? 0)
                  : g.cumulative && g.type === "gc_wins" ? (planStatus?.cumulative_stats?.gc_wins ?? 0)
                  : undefined
                }
              />
            ))}
          </div>
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

      {/* Season snapshot history (multi-year plans) */}
      {planDuration > 1 && snapshots.length > 0 && (
        <div className="mt-4">
          <SeasonSnapshotGrid snapshots={snapshots} />
        </div>
      )}

      {/* Satisfaction explanation */}
      <div className="bg-[#0f0f18] border border-white/5 rounded-xl p-5 mt-4">
        <h2 className="text-white font-semibold text-sm mb-4">Hvad betyder tilfredshed?</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { range: "70–100%", label: "Høj tilfredshed",    effect: "Sponsor × > 1.0 — ekstra indtægt", color: "text-green-400" },
            { range: "40–69%", label: "Moderat tilfredshed", effect: "Sponsor × 1.0 — normal indtægt",   color: "text-[#e8c547]" },
            { range: "0–39%",  label: "Lav tilfredshed",     effect: "Sponsor × < 1.0 — reduceret",      color: "text-red-400" },
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
