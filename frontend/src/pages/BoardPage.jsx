import { useState, useEffect } from "react";
import { useTranslation, Trans } from "react-i18next";
import { supabase } from "../lib/supabase";
import { satisfactionToModifier, getPlanDuration, isBoardGoalAchieved } from "../lib/boardUtils";
import { getBoardGoalLabel } from "../lib/boardGoalLabel";
import { getWizardBackState, canResumeNegotiation } from "../lib/boardWizardNav";
import { getCountryDisplay } from "../lib/countryUtils";
import { formatNumber } from "../lib/intl";
import { Flag } from "../components/Flag";
import { Link } from "react-router-dom";
import BoardEmptyState from "../components/BoardEmptyState";
import OnboardingTour from "../components/OnboardingTour";
import { startTour } from "../lib/onboardingTour";
import { logEvent } from "../lib/logEvent";
import { resolveApiError } from "../lib/apiError";
import { useModalA11y } from "../hooks/useModalA11y";
import {
  resolveBoardCopy,
  resolveBoardFeedbackHeadline,
  resolveBoardFeedbackSummary,
  resolveBoardIdentitySummary,
  resolveMemberLabel,
  resolveMemberShortDescription,
  resolveMemberLongDescription,
  resolveReactionQuote,
} from "../lib/boardCopy";

const API = import.meta.env.VITE_API_URL;
const PLAN_SEQUENCE = ["5yr", "3yr", "1yr"];

function buildBoardTourSteps(t) {
  return [
    { target: "[data-tour='board-plans']",        title: t("tour.plans.title"),        body: t("tour.plans.body") },
    { target: "[data-tour='board-satisfaction']", title: t("tour.satisfaction.title"), body: t("tour.satisfaction.body") },
    { target: "[data-tour='board-kpis']",         title: t("tour.kpis.title"),         body: t("tour.kpis.body") },
  ];
}

const GOAL_CHANGE_STYLE = {
  relaxed:   { accent: "text-cz-success", box: "border-cz-success/30 bg-cz-success-bg0/8" },
  tightened: { accent: "text-cz-danger",   box: "border-cz-danger/30 bg-cz-danger-bg0/8" },
  replaced:  { accent: "text-cz-info",  box: "border-cz-info/20 bg-cz-info-bg0/8" },
};

const GOAL_STATUS_STYLE = {
  behind:        { color: "text-cz-danger",     icon: "!" },
  near_miss:     { color: "text-cz-accent-t", icon: "~" },
  on_track:      { color: "text-cz-3",        icon: null },
  watch:         { color: "text-cz-accent-t", icon: "~" },
  awaiting_data: { color: null,               icon: null },
  neutral:       { color: null,               icon: null },
};

const STATUS_LABEL_KEYS = {
  behind: "status.behind",
  near_miss: "status.near_miss",
  on_track: "status.on_track",
  watch: "status.watch",
};

function getGoalStatusMeta(t, status) {
  const style = GOAL_STATUS_STYLE[status];
  if (!style) return null;
  const labelKey = STATUS_LABEL_KEYS[status];
  return { label: labelKey ? t(labelKey) : null, color: style.color, icon: style.icon };
}

// #955 · kvalitativ standing-label for et plan-panel ud fra bestyrelsens
// tilfredshed (0-100). UX-research: kvalitative labels slår rå %. 5 trin spejler
// >100%-skalaen fra #816 (Below par → Outstanding). Ingen backend-ændring.
const BENCHMARK_BUCKETS = [
  { min: 85, key: "outstanding", color: "text-cz-success" },
  { min: 70, key: "great",       color: "text-cz-success" },
  { min: 55, key: "good",        color: "text-cz-accent-t" },
  { min: 40, key: "onTrack",     color: "text-cz-accent-t" },
  { min: 0,  key: "belowPar",    color: "text-cz-danger" },
];
function getBenchmarkMeta(t, satisfaction) {
  const sat = satisfaction ?? 0;
  const bucket = BENCHMARK_BUCKETS.find(b => sat >= b.min) || BENCHMARK_BUCKETS[BENCHMARK_BUCKETS.length - 1];
  return { label: t(`status.benchmark.${bucket.key}`), color: bucket.color };
}

// #955 · trend-pil ud fra seneste afsluttede sæsons satisfaction_delta.
function getSatisfactionTrend(snapshots) {
  if (!snapshots?.length) return null;
  const latest = snapshots.reduce((a, b) =>
    (b.season_within_plan ?? b.season_number ?? 0) > (a.season_within_plan ?? a.season_number ?? 0) ? b : a);
  const delta = latest?.satisfaction_delta ?? 0;
  if (delta > 0) return { glyph: "▲", color: "text-cz-success", key: "up" };
  if (delta < 0) return { glyph: "▼", color: "text-cz-danger", key: "down" };
  return { glyph: "→", color: "text-cz-3", key: "flat" };
}

// #1073 · skærmlæser-alternativ for status-glyfferne (✓/!/~/○). Uden dette læses
// symbolerne op som "multiplication sign" / "tilde" uden betydning.
function getGoalStatusA11yLabel(t, { achieved, status }) {
  if (achieved) return t("a11y.goalStatus.achieved");
  if (status === "behind") return t("a11y.goalStatus.behind");
  if (status === "near_miss" || status === "watch") return t("a11y.goalStatus.nearMiss");
  return t("a11y.goalStatus.pending");
}

function getPlanLabel(t, planType) {
  return t(`planLabels.${planType}`);
}

function getFocusLabel(t, focus) {
  return t(`focus.${focus}`, { defaultValue: focus });
}

// getBoardGoalLabel er flyttet til ../lib/boardGoalLabel.js (#1233) så den kan
// unit-testes mod de rigtige locale-filer.

// #102 · kort type-navn til "Hvad vægter dette board?"-panelet (DNA goal_weighting).
function getGoalTypeLabel(t, type) {
  if (!type) return "";
  return t(`goalType.${type}`, { defaultValue: type });
}

// #989/#1096/#815 · "Hvordan måles dette?"-forklaring pr. måltype (genbrugs-primitiv).
// Returnerer "" hvis måltypen ikke har en forklaring → render skjules.
function getGoalHelpText(t, goal) {
  if (!goal?.type) return "";
  return t(`goalHelp.${goal.type}`, { target: goal.target, defaultValue: "" });
}

function getDnaCopy(t, dna, field) {
  if (!dna?.key) return "";
  const keyByField = {
    label: dna.label_key || `dna.${dna.key}.label`,
    shortDescription: dna.short_description_key || `dna.${dna.key}.shortDescription`,
    longDescription: dna.long_description_key || `dna.${dna.key}.longDescription`,
  };
  const fallbackByField = {
    label: dna.label,
    shortDescription: dna.short_description,
    longDescription: dna.long_description,
  };
  return t(keyByField[field], { defaultValue: fallbackByField[field] || "" });
}

function getDnaRationale(t, suggestion) {
  const rationaleKey = suggestion?.rationale_key || suggestion?.rationaleKey;
  if (!rationaleKey) return suggestion?.rationale || "";
  const params = suggestion.rationale_params || suggestion.rationaleParams || {};
  return t(rationaleKey, {
    ...params,
    specLabel: params.primarySpec
      ? t(`dna.specLabel.${params.primarySpec}`, { defaultValue: params.primarySpec })
      : "",
    defaultValue: suggestion.rationale || "",
  });
}

function formatBoardCopy(text) {
  if (!text) return "";
  return text
    .replace(/\bfra ([A-Z]{2})\b/g, (_match, code) => `fra ${getCountryDisplay(code).name || code}`)
    .replace(/\b([A-Z]{2})-kerne\b/g, (_match, code) => `${getCountryDisplay(code).name}-kerne`)
    .replace(/\b([A-Z]{2})-praegede\b/g, (_match, code) => `${getCountryDisplay(code).name}-praegede`);
}

function formatCash(value) {
  const num = Number(value || 0);
  return `${formatNumber(num)} CZ$`;
}

// #1030 · Affordance: satisfaction-tallet i plan-panelet scroller ned til den
// (tidligere frakoblede) tilfredshedsforklaring nederst på siden.
function scrollToSatisfactionExplainer() {
  if (typeof document === "undefined") return;
  document.getElementById("board-satisfaction-explainer")
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ── S-02c · Board-medlems-komponenter ──────────────────────────────────────────

// 5-kolonne avatar-grid (mobile-stackbar). Vises mellem BoardIdentityCard og plan-kort.
function BoardMembersGrid({ members = [], onSelect }) {
  const { t } = useTranslation("board");
  if (!members.length) return null;
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5 mt-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-cz-3 text-xs uppercase tracking-wider">{t("members.heading")}</p>
        <span className="text-cz-3 text-[10px]">{t("members.count", { count: members.length })}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {members.map((member) => (
          // #1030 · Affordance: kortet ser klikbart ud (avatar, formand-stjerne) →
          // gør det klikbart → dialog med portræt + fuld beskrivelse.
          <button key={member.archetype_key} type="button"
            onClick={() => onSelect?.(member)}
            title={t("members.viewProfile")}
            className={`bg-cz-subtle border rounded-lg p-3 flex flex-col items-center text-center gap-2
              hover:bg-cz-subtle/60 hover:border-cz-accent/40 transition-colors
              ${member.is_chairman ? "border-cz-accent/40" : "border-cz-border"}`}>
            <div className="relative w-12 h-12 rounded-full bg-cz-card border border-cz-border
              flex items-center justify-center text-2xl">
              <span aria-hidden>{member.emoji}</span>
              {member.is_chairman && (
                <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-cz-accent
                  text-cz-on-accent text-[9px] font-bold flex items-center justify-center
                  border border-cz-card" title={t("members.chairmanTitle")}>★</span>
              )}
            </div>
            <div>
              <p className="text-cz-1 font-medium text-xs leading-tight">{resolveMemberLabel(t, member)}</p>
              <p className="text-cz-3 text-[10px] mt-0.5 leading-tight line-clamp-2">{resolveMemberShortDescription(t, member)}</p>
              {member.is_chairman && (
                <p className="text-cz-accent-t text-[9px] uppercase tracking-wider mt-1 font-semibold">
                  {t("members.chairman")}
                </p>
              )}
              {member.selection_kind === "wildcard" && !member.is_chairman && (
                <p className="text-cz-3 text-[9px] uppercase tracking-wider mt-1">{t("members.wildcard")}</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// #1030 · Klik på et bestyrelsesmedlem → portræt + fuld karakter-beskrivelse.
function BoardMemberDialog({ member, onClose }) {
  const { t } = useTranslation("board");
  const dialogRef = useModalA11y(onClose);
  if (!member) return null;
  const roleLabel = member.is_chairman
    ? t("members.chairman")
    : member.selection_kind === "wildcard"
      ? t("members.wildcard")
      : t("members.identityMatch");
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="board-member-dialog-title"
        className="w-full max-w-md bg-cz-card border border-cz-border rounded-2xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start gap-3 mb-4">
          <div className={`relative w-12 h-12 rounded-full bg-cz-subtle border flex items-center justify-center text-2xl flex-shrink-0
            ${member.is_chairman ? "border-cz-accent/40" : "border-cz-border"}`}>
            <span aria-hidden>{member.emoji}</span>
            {member.is_chairman && (
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-cz-accent
                text-cz-on-accent text-[9px] font-bold flex items-center justify-center border border-cz-card"
                title={t("members.chairmanTitle")}>★</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p id="board-member-dialog-title" className="text-cz-1 font-semibold text-base leading-snug break-words">{resolveMemberLabel(t, member)}</p>
            <p className={`text-xs uppercase tracking-wider mt-0.5 ${member.is_chairman ? "text-cz-accent-t font-semibold" : "text-cz-3"}`}>
              {roleLabel}
            </p>
          </div>
          <button onClick={onClose} aria-label={t("a11y.closeDialog")} className="text-cz-3 hover:text-cz-2 text-xl leading-none flex-shrink-0 px-1"><span aria-hidden="true">×</span></button>
        </div>
        {resolveMemberShortDescription(t, member) && (
          <p className="text-cz-2 text-sm leading-relaxed">{resolveMemberShortDescription(t, member)}</p>
        )}
        {/* #1241 · text-cz-2 (før cz-3): lang brødtekst i modal skal være
            kontrast-sikker i begge temaer; hierarki bæres af mt-spacing. */}
        {resolveMemberLongDescription(t, member) && (
          <p className="text-cz-2 text-sm mt-3 leading-relaxed">{resolveMemberLongDescription(t, member)}</p>
        )}
      </div>
    </div>
  );
}

// ── S-02f · Klub-DNA-komponenter ───────────────────────────────────────────────

// Vises før første plan-card når manageren er i sæson 2+ (identity_basis findes,
// is_baseline_phase=false), men endnu ikke har valgt DNA. 3 forslag-kort + Vælg-knap.
function ClubDnaSelectionCard({ suggestions = [], onChoose, busy = false, error = "" }) {
  const { t } = useTranslation("board");
  if (!suggestions.length) return null;
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5 mt-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("dna.sectionLabel")}</p>
          <h2 className="text-cz-1 font-semibold text-base">{t("dna.selectHeading")}</h2>
          <p className="text-cz-2 text-sm mt-1">{t("dna.selectIntro")}</p>
        </div>
      </div>
      {error && (
        <div className="mb-3 p-3 rounded-lg border border-cz-danger/30 bg-cz-danger-bg0/8 text-cz-danger text-sm">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {suggestions.map((suggestion) => (
          <div key={suggestion.key}
            className="bg-cz-subtle border border-cz-border rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-full bg-cz-card border border-cz-border
                flex items-center justify-center text-2xl flex-shrink-0">
                <span aria-hidden>{suggestion.emoji}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-cz-3 text-[10px] uppercase tracking-wider">
                  {t(`dna.slot.${suggestion.suggestion_slot}`, { defaultValue: t("dna.slot.fallback") })}
                </p>
                <p className="text-cz-1 font-semibold text-sm leading-tight">{getDnaCopy(t, suggestion, "label")}</p>
              </div>
            </div>
            <p className="text-cz-2 text-xs leading-relaxed">{getDnaCopy(t, suggestion, "shortDescription")}</p>
            {getDnaCopy(t, suggestion, "longDescription") && (
              <p className="text-cz-3 text-[11px] italic leading-relaxed line-clamp-3">
                {getDnaCopy(t, suggestion, "longDescription")}
              </p>
            )}
            {getDnaRationale(t, suggestion) && (
              <p className="text-cz-accent-t text-[11px]">{getDnaRationale(t, suggestion)}</p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => onChoose(suggestion.key)}
              className="mt-auto py-2 bg-cz-accent text-cz-on-accent text-sm font-semibold rounded-lg
                hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {busy ? t("dna.saving") : t("dna.choose")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Vises efter DNA er valgt — kompakt badge der bekræfter valget + giver kontekst.
// #1030 · Affordance: badge'en ligner et åbnbart kort → gør den klikbar → dialog
// med fuld beskrivelse + "DNA låst for sæsonen".
function ClubDnaBadge({ dna, onSelect }) {
  const { t } = useTranslation("board");
  if (!dna) return null;
  return (
    <button type="button" onClick={onSelect} title={t("dna.badge.viewHint")}
      className="w-full text-left bg-cz-card border border-cz-border rounded-xl p-4 mt-4 flex items-start gap-4
        hover:border-cz-accent/40 hover:bg-cz-subtle/40 transition-colors group">
      <div className="w-12 h-12 rounded-full bg-cz-subtle border border-cz-border
        flex items-center justify-center text-2xl flex-shrink-0">
        <span aria-hidden>{dna.emoji}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-cz-3 text-xs uppercase tracking-wider">{t("dna.badge.label")}</p>
        <p className="text-cz-1 font-semibold text-sm">{getDnaCopy(t, dna, "label")}</p>
        <p className="text-cz-2 text-xs mt-1 leading-relaxed">{getDnaCopy(t, dna, "shortDescription")}</p>
        {getDnaCopy(t, dna, "longDescription") && (
          <p className="text-cz-3 text-[11px] mt-1 italic leading-relaxed">{getDnaCopy(t, dna, "longDescription")}</p>
        )}
      </div>
      <span aria-hidden className="text-cz-3 group-hover:text-cz-2 text-lg flex-shrink-0 self-center transition-colors">›</span>
    </button>
  );
}

// #102/#165 · "Hvad vægter dette board?"-panel.
//  - #102: de 2-3 højest-vægtede måltyper fra DNA'ets goal_weighting (>1.0 = boostet).
//  - #165: boardets SAMLEDE tilfredshed (gnsn. på tværs af aktive planer) som bar
//          + kvalitativ benchmark-label (genbruger getBenchmarkMeta fra >100%-issuet).
function BoardDriversPanel({ dna, plans }) {
  const { t } = useTranslation("board");

  // #165 · aggregér satisfaction fra de planer der findes (1yr/3yr/5yr).
  const sats = Object.values(plans || {})
    .map((p) => p?.board?.satisfaction)
    .filter((s) => typeof s === "number");
  const overall = sats.length ? Math.round(sats.reduce((a, b) => a + b, 0) / sats.length) : null;
  const benchmark = overall != null ? getBenchmarkMeta(t, overall) : null;
  const barColor = overall == null ? "bg-cz-3/30"
    : overall >= 70 ? "bg-cz-success" : overall >= 40 ? "bg-cz-accent" : "bg-cz-danger";

  // #102 · top-vægtede måltyper (kun boostede, >1.0), højeste først, maks 3.
  const topWeighted = Object.entries(dna?.goal_weighting || {})
    .filter(([, w]) => Number(w) > 1.0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([type]) => type);

  if (overall == null && !topWeighted.length) return null;

  return (
    <div data-testid="board-drivers" className="bg-cz-card border border-cz-border rounded-xl p-5 mt-4">
      <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">{t("drivers.heading")}</p>

      {overall != null && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-cz-2 text-sm">{t("drivers.satisfactionLabel")}</span>
            <span className="flex items-center gap-2">
              {benchmark && <span className={`text-xs font-semibold ${benchmark.color}`}>{benchmark.label}</span>}
              <span className="font-data font-bold text-sm text-cz-1">{overall}%</span>
            </span>
          </div>
          <div className="bg-cz-subtle rounded-full h-2" role="progressbar"
            aria-valuenow={overall} aria-valuemin={0} aria-valuemax={100}
            aria-label={t("drivers.satisfactionLabel")}>
            <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${overall}%` }} />
          </div>
        </div>
      )}

      {topWeighted.length > 0 && (
        <div>
          <p className="text-cz-3 text-[11px] mb-2">
            {dna?.emoji ? `${dna.emoji} ` : ""}{t("drivers.weightsLabel")}
          </p>
          <div className="flex flex-wrap gap-2">
            {topWeighted.map((type) => (
              <span key={type}
                className="text-xs bg-cz-subtle text-cz-2 px-2.5 py-1 rounded-full border border-cz-accent/30">
                {getGoalTypeLabel(t, type)}
              </span>
            ))}
          </div>
          <p className="text-cz-3 text-[11px] mt-2 leading-relaxed">{t("drivers.weightHint")}</p>
        </div>
      )}
    </div>
  );
}

// #1030 · DNA-detalje-dialog — fuld beskrivelse + forklaring på at DNA er låst for sæsonen.
function ClubDnaDialog({ dna, onClose }) {
  const { t } = useTranslation("board");
  const dialogRef = useModalA11y(onClose);
  if (!dna) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="club-dna-dialog-title"
        className="w-full max-w-md bg-cz-card border border-cz-border rounded-2xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-cz-subtle border border-cz-border
            flex items-center justify-center text-2xl flex-shrink-0">
            <span aria-hidden>{dna.emoji}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-cz-3 text-xs uppercase tracking-wider">{t("dna.badge.label")}</p>
            <p id="club-dna-dialog-title" className="text-cz-1 font-semibold text-base leading-snug">{getDnaCopy(t, dna, "label")}</p>
          </div>
          <button onClick={onClose} aria-label={t("a11y.closeDialog")} className="text-cz-3 hover:text-cz-2 text-xl leading-none flex-shrink-0 px-1"><span aria-hidden="true">×</span></button>
        </div>
        {getDnaCopy(t, dna, "shortDescription") && (
          <p className="text-cz-2 text-sm leading-relaxed">{getDnaCopy(t, dna, "shortDescription")}</p>
        )}
        {getDnaCopy(t, dna, "longDescription") && (
          <p className="text-cz-3 text-sm mt-3 italic leading-relaxed">{getDnaCopy(t, dna, "longDescription")}</p>
        )}
        <div className="mt-4 pt-4 border-t border-cz-border">
          <p className="text-cz-2 text-xs font-semibold">🔒 {t("dna.locked.heading")}</p>
          <p className="text-cz-3 text-xs mt-1 leading-relaxed">{t("dna.locked.body")}</p>
        </div>
      </div>
    </div>
  );
}

// Medlem-citat-panel inde i GoalCard expand eller PlanCard outlook-feedback.
function MemberReactionPanel({ reaction, compact = false }) {
  const { t } = useTranslation("board");
  if (!reaction?.quote) return null;
  return (
    <div className={`flex items-start gap-2 ${compact ? "p-2" : "p-3"} bg-cz-subtle border border-cz-border rounded-lg`}>
      <div className={`${compact ? "w-8 h-8 text-base" : "w-10 h-10 text-xl"} rounded-full
        bg-cz-card border border-cz-border flex items-center justify-center flex-shrink-0`}>
        <span aria-hidden>{reaction.emoji}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-cz-1 font-medium ${compact ? "text-xs" : "text-sm"}`}>{resolveMemberLabel(t, reaction)}</p>
        <p className={`text-cz-2 italic mt-0.5 ${compact ? "text-[11px]" : "text-xs"} leading-relaxed`}>
          &ldquo;{resolveReactionQuote(t, reaction)}&rdquo;
        </p>
      </div>
    </div>
  );
}

// ── Delte komponenter ─────────────────────────────────────────────────────────

function SatisfactionMeter({ value }) {
  const { t } = useTranslation("board");
  // #1072 WCAG: tidligere injicerede komponenten en rå hex via inline style — bright
  // guld (#e8c547) som tekst på Chalk ≈1.6:1 = AA-fail i light-mode. Nu tema-adaptive
  // semantiske tokens; teksten bruger cz-accent-t (deep-gold, kontrast-sikker i begge
  // temaer), mens bar-fyldet beholder den lyse cz-accent (grafisk fyld, ikke tekst).
  const tone = value >= 70 ? "success" : value >= 40 ? "mid" : "danger";
  const textClass = tone === "success" ? "text-cz-success" : tone === "mid" ? "text-cz-accent-t" : "text-cz-danger";
  const barClass = tone === "success" ? "bg-cz-success" : tone === "mid" ? "bg-cz-accent" : "bg-cz-danger";
  const labelKey = value >= 80 ? "veryHappy" : value >= 60 ? "happy" :
    value >= 40 ? "neutral" : value >= 20 ? "unhappy" : "veryUnhappy";
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-cz-3 text-xs uppercase tracking-wider">{t("satisfactionMeter.label")}</p>
        <span className={`font-data font-bold text-lg ${textClass}`}>{value}%</span>
      </div>
      <div className="bg-cz-subtle rounded-full h-3 mb-2">
        <div className={`h-3 rounded-full transition-all duration-500 ${barClass}`}
          style={{ width: `${value}%` }} />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-cz-2 text-sm font-medium">{t(`satisfactionMeter.${labelKey}`)}</p>
        <p className="text-cz-3 text-xs">{t("satisfactionMeter.sponsorModifier", { modifier: satisfactionToModifier(value).toFixed(2) })}</p>
      </div>
    </div>
  );
}

function GoalCard({ goal, achieved, cumulativeProgress, evaluation, onSelect }) {
  const { t } = useTranslation("board");
  const [identityExpanded, setIdentityExpanded] = useState(false);
  // S-02c: medlem-reaktion expand — klik på goal viser portræt + citat
  const [memberExpanded, setMemberExpanded] = useState(false);
  const status = evaluation?.status;
  const statusMeta = !achieved && status ? getGoalStatusMeta(t, status) : null;
  const isRequired = goal.importance === "required";
  const isBehind = status === "behind";
  const isNearMiss = status === "near_miss" || status === "watch";
  const identityRationale = goal.identity_basis_rationale || null;
  const memberReaction = evaluation?.member_reaction || null;

  const containerClass = achieved
    ? "bg-cz-success-bg0/8 border-cz-success/30"
    : isBehind && isRequired ? "bg-cz-danger-bg0/5 border-cz-danger/30"
    : isBehind ? "bg-cz-subtle border-cz-danger/50"
    : "bg-cz-subtle border-cz-border";

  const iconContent = achieved ? "✓" : isBehind ? "!" : isNearMiss ? "~" : "○";
  const iconClass = achieved ? "bg-cz-success-bg text-cz-success"
    : isBehind && isRequired ? "bg-cz-danger-bg text-cz-danger"
    : isBehind ? "bg-cz-danger-bg text-cz-danger"
    : isNearMiss ? "bg-cz-accent/10 text-cz-accent-t"
    : "bg-cz-subtle text-cz-3";

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${containerClass}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold ${iconClass}`}>
        <span aria-hidden="true">{iconContent}</span>
        <span className="sr-only">{getGoalStatusA11yLabel(t, { achieved, status })}</span>
      </div>
      <div className="flex-1">
        {/* #1030 · Affordance: mål-headeren er klikbar (åbner samme mini-dialog som
            de kompakte plan-paneler), så samme data ikke er død plain-tekst her. */}
        {onSelect ? (
          <button type="button" onClick={onSelect}
            className="flex items-start justify-between gap-2 w-full text-left rounded -mx-1 px-1 hover:bg-cz-subtle/40 transition-colors group/goal">
            <span className={`text-sm font-medium ${achieved ? "text-cz-success" : "text-cz-2"} group-hover/goal:text-cz-1`}>{getBoardGoalLabel(t, goal)}</span>
            {!achieved && evaluation?.actual != null && (
              <span className="text-xs font-mono text-cz-3 flex-shrink-0">
                {goal.type === "top_n_finish" ? `#${evaluation.actual}` : evaluation.actual}/{goal.type === "top_n_finish" ? `top ${evaluation.target}` : evaluation.target}
              </span>
            )}
          </button>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <p className={`text-sm font-medium ${achieved ? "text-cz-success" : "text-cz-2"}`}>{getBoardGoalLabel(t, goal)}</p>
            {!achieved && evaluation?.actual != null && (
              <span className="text-xs font-mono text-cz-3 flex-shrink-0">
                {goal.type === "top_n_finish" ? `#${evaluation.actual}` : evaluation.actual}/{goal.type === "top_n_finish" ? `top ${evaluation.target}` : evaluation.target}
              </span>
            )}
          </div>
        )}
        {goal.cumulative && cumulativeProgress !== undefined && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 bg-cz-subtle rounded-full h-1">
              <div className={`h-1 rounded-full transition-all ${achieved ? "bg-cz-success-bg0" : "bg-cz-accent"}`}
                style={{ width: `${Math.min(100, Math.round((cumulativeProgress / goal.target) * 100))}%` }} />
            </div>
            <span className="text-cz-3 text-xs font-mono">{cumulativeProgress}/{goal.target}</span>
          </div>
        )}
        {/* S-02g · relative_rank rich detail — viser live division-rangering så manager
            kan se konkret hvor mange managers han slår vs. mål-tærsklen. */}
        {goal.type === "relative_rank"
          && evaluation?.rank_in_division != null
          && evaluation?.division_manager_count != null && (
          <p className="text-[11px] text-cz-3 mt-1.5 leading-relaxed">
            {t("goal.relativeRankDetail", {
              rank: evaluation.rank_in_division,
              total: evaluation.division_manager_count,
              actual: evaluation.actual ?? 0,
              target: evaluation.target,
              check: evaluation.actual >= evaluation.target ? " ✓" : "",
            })}
          </p>
        )}
        <div className="flex flex-wrap gap-3 mt-1">
          {!achieved && isRequired && (
            <span className="text-[10px] text-cz-3 uppercase tracking-wider">{t("goal.required")}</span>
          )}
          {statusMeta?.label && (
            <span className={`text-xs font-medium ${statusMeta.color}`}>{statusMeta.label}</span>
          )}
          {goal.negotiated && <span className="text-xs text-cz-info/70">{t("goal.negotiated")}</span>}
          {/* S-02g · Tradeoff-stramning indikator. Vises når et mål er hævet pga. tidligere
              approved board request (lower_results_pressure / ease_identity_requirements). */}
          {goal.tradeoff_tightened && (
            <span className="text-xs text-cz-warning/80" title={t("goal.tightenedTitle")}>{t("goal.tightenedBadge")}</span>
          )}
          {goal.satisfaction_bonus > 0 && (
            <span className="text-xs text-cz-success/70">{t("goal.satisfactionBonus", { count: goal.satisfaction_bonus })}</span>
          )}
          {goal.satisfaction_penalty > 0 && (
            <span className="text-xs text-cz-danger/70">{t("goal.satisfactionPenalty", { count: goal.satisfaction_penalty })}</span>
          )}
        </div>
        {identityRationale && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setIdentityExpanded(v => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-cz-info hover:text-cz-info/80 underline-offset-2 hover:underline transition-colors"
            >
              <span>★</span>
              <span>{formatBoardCopy(identityRationale.short)}</span>
              <span className="text-cz-3">{identityExpanded ? "↑" : "↓"}</span>
            </button>
            {identityExpanded && (
              <p className="text-[11px] text-cz-3 mt-1.5 leading-relaxed bg-cz-subtle border border-cz-border rounded-md px-2.5 py-1.5">
                {formatBoardCopy(identityRationale.long)}
              </p>
            )}
          </div>
        )}
        {/* S-02c · Medlem-reaktion expand — klik viser portræt + citat fra dominant arketype */}
        {memberReaction && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setMemberExpanded(v => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-cz-2 hover:text-cz-1 underline-offset-2 hover:underline transition-colors"
            >
              <span>{memberReaction.emoji}</span>
              <span>{t("goal.memberReacts", { member: memberReaction.label })}</span>
              <span className="text-cz-3">{memberExpanded ? "↑" : "↓"}</span>
            </button>
            {memberExpanded && (
              <div className="mt-1.5">
                <MemberReactionPanel reaction={memberReaction} compact />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── S-02h · GoalMiniDialog — klik på mål i dashboard-panel → portræt + reaktion ──

function GoalMiniDialog({ goal, achieved, evaluation, cumulativeProgress, onClose }) {
  const { t } = useTranslation("board");
  const dialogRef = useModalA11y(onClose);
  const status = evaluation?.status;
  const statusMeta = !achieved && status ? getGoalStatusMeta(t, status) : null;
  const memberReaction = evaluation?.member_reaction || null;
  const identityRationale = goal?.identity_basis_rationale || null;
  const isBehind = status === "behind";
  const isNearMiss = status === "near_miss" || status === "watch";
  const iconContent = achieved ? "✓" : isBehind ? "!" : isNearMiss ? "~" : "○";
  const iconCls = achieved ? "bg-cz-success-bg text-cz-success"
    : isBehind ? "bg-cz-danger-bg text-cz-danger"
    : isNearMiss ? "bg-cz-accent/10 text-cz-accent-t"
    : "bg-cz-subtle text-cz-3";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="goal-mini-dialog-title"
        className="w-full max-w-lg bg-cz-card border border-cz-border rounded-2xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start gap-3 mb-4">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${iconCls}`}>
            <span aria-hidden="true">{iconContent}</span>
            <span className="sr-only">{getGoalStatusA11yLabel(t, { achieved, status })}</span>
          </div>
          <div className="flex-1">
            <p id="goal-mini-dialog-title" className="text-cz-1 font-semibold text-base leading-snug break-words">{getBoardGoalLabel(t, goal)}</p>
            {statusMeta?.label && (
              <p className={`text-sm mt-0.5 ${statusMeta.color}`}>{statusMeta.label}</p>
            )}
          </div>
          <button onClick={onClose} aria-label={t("a11y.closeDialog")} className="text-cz-3 hover:text-cz-2 text-xl leading-none flex-shrink-0 px-1"><span aria-hidden="true">×</span></button>
        </div>

        {evaluation?.actual != null && (
          <div className="bg-cz-subtle rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
            <span className="text-cz-3 text-sm">{t("goal.progress")}</span>
            <span className="font-mono text-cz-1 text-sm font-semibold">
              {goal.type === "top_n_finish" ? `#${evaluation.actual}` : evaluation.actual}
              {" / "}
              {goal.type === "top_n_finish" ? `top ${evaluation.target}` : evaluation.target}
            </span>
          </div>
        )}

        {goal.type === "relative_rank" && evaluation?.rank_in_division != null && (
          <p className="text-cz-3 text-sm mb-4 leading-relaxed">
            {t("goal.rankInDivisionShort", {
              rank: evaluation.rank_in_division,
              total: evaluation.division_manager_count,
            })}
          </p>
        )}

        {goal.cumulative && cumulativeProgress !== undefined && (
          <div className="mb-4">
            <div className="bg-cz-subtle rounded-full h-2">
              <div className={`h-2 rounded-full transition-all ${achieved ? "bg-cz-success-bg0" : "bg-cz-accent"}`}
                style={{ width: `${Math.min(100, Math.round((cumulativeProgress / goal.target) * 100))}%` }} />
            </div>
            <p className="text-cz-3 text-xs text-center mt-1">{cumulativeProgress}/{goal.target}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {goal.importance === "required" && <span className="text-xs bg-cz-subtle text-cz-3 px-2 py-0.5 rounded border border-cz-border">{t("goal.obligatory")}</span>}
          {goal.cumulative && <span className="text-xs bg-cz-info-bg0/10 text-cz-info px-2 py-0.5 rounded">{t("goal.cumulative")}</span>}
          {goal.tradeoff_tightened && <span className="text-xs text-cz-warning/80">{t("goal.tightenedBadge")}</span>}
          {goal.satisfaction_bonus > 0 && <span className="text-xs text-cz-success/70">{t("goal.satisfactionBonus", { count: goal.satisfaction_bonus })}</span>}
          {goal.satisfaction_penalty > 0 && <span className="text-xs text-cz-danger/70">{t("goal.satisfactionPenalty", { count: goal.satisfaction_penalty })}</span>}
          {goal.negotiated && <span className="text-xs text-cz-info/70">{t("goal.negotiated")}</span>}
        </div>

        {/* #989/#1096/#815 · "Hvordan måles dette?" — forklarer evalueringen for de
            måltyper hvor formatet/kriteriet ikke er selvforklarende. */}
        {getGoalHelpText(t, goal) && (
          <div className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 mb-4">
            <p className="text-[11px] text-cz-3 uppercase tracking-wider mb-1">{t("goalHelp.heading")}</p>
            <p className="text-cz-2 text-xs leading-relaxed">{getGoalHelpText(t, goal)}</p>
          </div>
        )}

        {identityRationale && (
          <div className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 mb-4">
            <p className="text-[11px] text-cz-info">★ {formatBoardCopy(identityRationale.short)}</p>
            {identityRationale.long && (
              <p className="text-[11px] text-cz-3 mt-1 leading-relaxed">{formatBoardCopy(identityRationale.long)}</p>
            )}
          </div>
        )}

        {memberReaction && (
          <div>
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("goal.boardReaction")}</p>
            <MemberReactionPanel reaction={memberReaction} />
          </div>
        )}
      </div>
    </div>
  );
}

function PlanTimelineBar({ planDuration, seasonsCompleted, snapshots }) {
  const { t } = useTranslation("board");
  if (planDuration <= 1) return null;
  return (
    // #920: scroll vandret når de N cirkler er bredere end kortet (lange planer /
    // smalle viewports) — centreret når de kan være der (min-w-full), ellers scroll (w-max).
    <div className="overflow-x-auto py-2">
      <div className="flex items-center justify-center gap-1 w-max min-w-full mx-auto">
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
                ? metPct >= 75 ? "bg-cz-success-bg border-cz-success/50 text-cz-success"
                  : metPct >= 50 ? "bg-cz-accent/10 border-cz-accent/50 text-cz-accent-t"
                  : "bg-cz-danger-bg border-cz-danger/30 text-cz-danger"
                : isCurrent
                ? "bg-cz-accent/10 border-cz-accent text-cz-accent-t"
                : "bg-cz-subtle border-cz-border text-cz-3"}`}>
              {isCompleted ? (
                <>
                  <span aria-hidden="true">{metPct >= 50 ? "✓" : "✗"}</span>
                  <span className="sr-only">{metPct >= 50 ? t("a11y.seasonComplete.good") : t("a11y.seasonComplete.poor")}</span>
                </>
              ) : seasonNum}
            </div>
            {i < planDuration - 1 && (
              <div className={`w-6 h-0.5 ${isCompleted ? "bg-cz-border" : "bg-cz-subtle"}`} />
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

function CumulativeStatsRow({ goals, cumStats }) {
  const { t } = useTranslation("board");
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
              {goal.type === "stage_wins" ? t("cumulative.stageWins") : t("cumulative.gcWins")}
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
  const { t } = useTranslation("board");
  if (!snapshots?.length) return null;
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5">
      <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">{t("snapshot.heading")}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-cz-3 border-b border-cz-border">
            <th className="text-left pb-2">{t("snapshot.columns.season")}</th>
            <th className="text-center pb-2">{t("snapshot.columns.rank")}</th>
            <th className="text-center pb-2">{t("snapshot.columns.stageWins")}</th>
            <th className="text-center pb-2">{t("snapshot.columns.gcWins")}</th>
            <th className="text-center pb-2">{t("snapshot.columns.goalsMet")}</th>
            <th className="text-right pb-2">{t("snapshot.columns.satisfaction")}</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map(s => (
            <tr key={s.id} className="border-t border-cz-border">
              <td className="py-2 text-cz-2">{t("snapshot.seasonNumber", { number: s.season_number })}</td>
              {/* #1072 · gold=leder: division-#1 får maillot-guld (deep-gold cz-accent-t =
                  WCAG-sikker som tekst i begge temaer), resten neutral. font-data på alle
                  tal-celler → tabular-justering (de havde ingen numerisk font før). */}
              <td className="py-2 text-center font-data">
                {s.division_rank
                  ? <span className={s.division_rank === 1 ? "text-cz-accent-t font-bold" : "text-cz-2"}>#{s.division_rank}</span>
                  : <span className="text-cz-3">{t("snapshot.rankNone")}</span>}
              </td>
              <td className="py-2 text-center text-cz-2 font-data">{s.stage_wins}</td>
              <td className="py-2 text-center text-cz-2 font-data">{s.gc_wins}</td>
              <td className="py-2 text-center font-data">
                <span className={s.goals_met >= s.goals_total * 0.7
                  ? "text-cz-success" : s.goals_met >= s.goals_total * 0.4
                  ? "text-cz-accent-t" : "text-cz-danger"}>
                  {s.goals_met}/{s.goals_total}
                </span>
              </td>
              <td className="py-2 text-right font-data">
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

function BoardIdentityCard({ identityProfile, title }) {
  const { t } = useTranslation("board");
  const resolvedTitle = title || t("identity.defaultTitle");
  if (!identityProfile) return null;
  const nationalCore = identityProfile.national_core;
  const starProfile = identityProfile.star_profile;
  const nationalCoreCountry = getCountryDisplay(nationalCore?.code);
  const nationalCoreValue = nationalCore?.established && nationalCore?.code
    ? (nationalCoreCountry.name || nationalCoreCountry.code)
    : t("identity.nationalCoreMixed");
  const nationalCoreSub = nationalCore?.established
    ? t("identity.nationalCoreSub", { count: nationalCore.count, percent: nationalCore.share_pct })
    : t("identity.nationalCoreNone");
  // #1084 · label_key resolves via board.json (dansk råtekst = fallback for
  // gamle payloads) — samme mønster som arketype-labels (#917/#694).
  const starProfileValue = resolveBoardCopy(t, starProfile?.label_key, starProfile?.label)
    || t("identity.starProfileUnknown");
  const starProfileSub = starProfile?.star_rider_count
    ? t("identity.starProfileSub", { count: starProfile.star_rider_count })
    : t("identity.starProfileNone");
  const primarySpecializationLabel = resolveBoardCopy(
    t, identityProfile.primary_specialization_label_key, identityProfile.primary_specialization_label
  );
  const secondarySpecializationLabel = resolveBoardCopy(
    t, identityProfile.secondary_specialization_label_key, identityProfile.secondary_specialization_label
  );
  const competitiveTierLabel = resolveBoardCopy(
    t, identityProfile.competitive_tier_label_key, identityProfile.competitive_tier_label
  );
  const squadStatusLabel = resolveBoardCopy(
    t, identityProfile.squad_status_label_key, identityProfile.squad_status_label
  );

  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5 mt-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{resolvedTitle}</p>
          <p className="text-cz-1 font-semibold text-sm break-words">{primarySpecializationLabel}</p>
          <p className="text-cz-2 text-sm mt-1 break-words">{formatBoardCopy(resolveBoardIdentitySummary(t, identityProfile))}</p>
        </div>
        {/* #1232 · U25-mål er et ANTAL — vis antallet som primær værdi; procent-
            observationen bevares som sekundær baggrundsinfo (Discord 9/6, @jeppek). */}
        <div className="text-right flex-shrink-0">
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("identity.u25")}</p>
          {typeof identityProfile.u25_count === "number" ? (
            <>
              <p className="font-mono font-bold text-sm text-cz-info">
                {t("identity.u25Count", { count: identityProfile.u25_count })}
              </p>
              <p className="text-cz-3 text-xs mt-0.5">
                {t("identity.u25ShareSub", { percent: identityProfile.u25_share_pct ?? 0 })}
              </p>
            </>
          ) : (
            <p className="font-mono font-bold text-sm text-cz-info">{identityProfile.u25_share_pct ?? 0}%</p>
          )}
        </div>
      </div>
      {/* #1241 · break-words på alle chip-værdier: lange enkeltord (fx
          "Etapejaegerhold") clippede ud over chip-kanten i 6-kolonne-gridet. */}
      <div className="grid sm:grid-cols-3 xl:grid-cols-6 gap-3 mt-4">
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3 min-w-0">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("identity.primary")}</p>
          <p className="text-cz-1 text-sm font-medium mt-1 break-words">{primarySpecializationLabel}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3 min-w-0">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("identity.secondary")}</p>
          <p className="text-cz-1 text-sm font-medium mt-1 break-words">{secondarySpecializationLabel}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3 min-w-0">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("identity.competitive")}</p>
          <p className="text-cz-1 text-sm font-medium mt-1 break-words">{competitiveTierLabel}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3 min-w-0">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("identity.squad")}</p>
          <p className="text-cz-1 text-sm font-medium mt-1">
            {identityProfile.rider_count}/{identityProfile?.squad_limits?.max}
          </p>
          <p className="text-cz-3 text-xs mt-1 break-words">{squadStatusLabel}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3 min-w-0">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("identity.nationalCore")}</p>
          <p className="text-cz-1 text-sm font-medium mt-1 inline-flex items-center gap-1.5 break-words max-w-full">
            {nationalCore?.established && nationalCore?.code && <Flag code={nationalCore.code} />}
            {nationalCoreValue}
          </p>
          <p className="text-cz-3 text-xs mt-1 break-words">{nationalCoreSub}</p>
        </div>
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3 min-w-0">
          <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("identity.starProfile")}</p>
          <p className="text-cz-1 text-sm font-medium mt-1 break-words">{starProfileValue}</p>
          <p className="text-cz-3 text-xs mt-1 break-words">{starProfileSub}</p>
        </div>
      </div>
    </div>
  );
}

const OUTCOME_STYLE = {
  approved: { accent: "text-cz-success",   box: "border-cz-success/30 bg-cz-success-bg0/8" },
  partial:  { accent: "text-cz-accent-t", box: "border-cz-accent/30 bg-cz-accent/10" },
  tradeoff: { accent: "text-cz-info",    box: "border-cz-info/20 bg-cz-info-bg0/8" },
  rejected: { accent: "text-cz-danger",     box: "border-cz-danger/30 bg-cz-danger-bg0/8" },
};

function BoardRequestPanel({ requestOptions, requestStatus, requestError, requestingType, onRequest }) {
  const { t } = useTranslation("board");
  const latestRequest = requestStatus?.latest_request;
  const usedThisSeason = Boolean(requestStatus?.used_this_season);
  const supported = requestStatus?.supported !== false;
  const goalChanges = latestRequest?.board_changes?.goal_changes || [];
  const focusBefore = latestRequest?.board_changes?.focus_before;
  const focusAfter = latestRequest?.board_changes?.focus_after;
  const focusChanged = Boolean(focusBefore && focusAfter && focusBefore !== focusAfter);
  const outcomeKey = latestRequest?.outcome && OUTCOME_STYLE[latestRequest.outcome] ? latestRequest.outcome : "partial";
  const latestStyle = OUTCOME_STYLE[outcomeKey];

  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("request.heading")}</p>
          <p className="text-cz-1 font-semibold text-sm">{t("request.subheading")}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`text-sm font-semibold ${usedThisSeason ? "text-cz-accent-t" : "text-cz-success"}`}>
            {usedThisSeason ? t("request.used") : t("request.ready")}
          </p>
        </div>
      </div>

      {!supported && (
        <div className="rounded-xl border border-cz-accent/30 bg-cz-accent/10 p-4 mt-4">
          <p className="text-cz-accent-t text-sm font-semibold">{t("request.pendingMigration")}</p>
        </div>
      )}

      {latestRequest && (
        <div className={`rounded-xl border p-4 mt-4 ${latestStyle.box}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              {/* #1084 · *_code resolves via board.json; gamle log-rækker uden koder
                  falder tilbage til den frosne danske råtekst (resolve-on-read). */}
              <p className="text-cz-1 text-sm font-semibold">{resolveBoardCopy(t, latestRequest.title_code, latestRequest.title)}</p>
              <p className="text-cz-2 text-xs mt-1">{resolveBoardCopy(t, latestRequest.request_label_key, latestRequest.request_label)}</p>
            </div>
            <span className={`text-xs font-semibold uppercase tracking-wider ${latestStyle.accent}`}>
              {t(`outcome.${outcomeKey}`)}
            </span>
          </div>
          <p className="text-cz-2 text-sm mt-2">
            {formatBoardCopy(resolveBoardCopy(t, latestRequest.summary_code, latestRequest.summary, latestRequest.summary_params || {}))}
          </p>
          {latestRequest.tradeoff_summary && (
            <p className="text-cz-2 text-sm mt-2">
              {formatBoardCopy(resolveBoardCopy(t, latestRequest.tradeoff_summary_code, latestRequest.tradeoff_summary))}
            </p>
          )}
          {(focusChanged || goalChanges.length > 0) && (
            <div className="mt-4 pt-4 border-t border-cz-border">
              <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-3">{t("request.changesHeading")}</p>
              <div className="flex flex-col gap-2">
                {focusChanged && (
                  <div className="bg-cz-subtle border border-cz-border rounded-lg p-3">
                    <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("request.focusLabel")}</p>
                    <p className="text-cz-2 text-sm mt-1">
                      {getFocusLabel(t, focusBefore)} → {getFocusLabel(t, focusAfter)}
                    </p>
                  </div>
                )}
                {goalChanges.map((change, index) => {
                  const kind = GOAL_CHANGE_STYLE[change.kind] ? change.kind : "replaced";
                  const style = GOAL_CHANGE_STYLE[kind];
                  return (
                    <div key={`${change.kind}-${index}`} className={`border rounded-lg p-3 ${style.box}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-cz-2 text-sm">{formatBoardCopy(change.before_label)}</p>
                          <p className="text-cz-3 text-xs mt-1">→ {formatBoardCopy(change.after_label)}</p>
                        </div>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${style.accent}`}>
                          {t(`changeKind.${kind}`)}
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
          <p className="text-cz-danger text-sm">{requestError}</p>
        </div>
      )}

      {supported && (
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          {(requestOptions || []).map((option) => {
            const disabled = Boolean(option.disabled);
            const isBusy = requestingType === option.type;
            return (
              <div key={option.type} className="bg-cz-subtle border border-cz-border rounded-xl p-4">
                {/* #1084 · requestDefs-keys resolves via board.json (dansk = fallback). */}
                <p className="text-cz-1 font-semibold text-sm">{resolveBoardCopy(t, option.label_key, option.label)}</p>
                <p className="text-cz-2 text-sm mt-1">{resolveBoardCopy(t, option.description_key, option.description)}</p>
                <p className="text-cz-3 text-xs mt-3">{resolveBoardCopy(t, option.tradeoff_preview_key, option.tradeoff_preview)}</p>
                <button
                  onClick={() => onRequest(option.type)}
                  disabled={disabled || Boolean(requestingType)}
                  className="w-full mt-4 py-2.5 rounded-lg text-sm font-semibold border transition-all
                    bg-cz-accent text-cz-on-accent border-cz-accent/40 hover:brightness-110
                    disabled:bg-cz-subtle disabled:text-cz-3 disabled:border-cz-border disabled:cursor-not-allowed"
                >
                  {isBusy ? t("request.sending") : t("request.send")}
                </button>
                {disabled && option.disabled_reason && (
                  <p className="text-cz-3 text-xs mt-2">
                    {resolveBoardCopy(t, option.disabled_reason_key, option.disabled_reason, option.disabled_reason_params || {})}
                  </p>
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

// S-02b · "Bestyrelse"-feed (Q-batch 1C Q21).
// Info-only board-relaterede notifs (board_update + board_critical) vises her
// så manageren har én samlet oversigt over bestyrelsens seneste reaktioner.
// S-02e · Konsekvens-tier (lag 2-5).
// Q-batch 1C Q21 låser routing: lag 1 (passive_modifier) vises kun via tilfredshed.
// Lag 2-3 = warning på BoardPage (ingen notif). Lag 4-5 = røde events i Bestyrelse-feed
// + 'Skal handles' notif. Lag 6 (bonus_offer) har egen card-komponent (BonusOfferCard).
const CONSEQUENCE_LAYER_STYLE = {
  2: { emoji: "🔒", severity: "warning"  },
  3: { emoji: "🛑", severity: "warning"  },
  4: { emoji: "📢", severity: "critical" },
  5: { emoji: "💸", severity: "critical" },
};

function describeConsequence(t, c) {
  const cash = formatCash(c.severity);
  switch (c.layer) {
    case 2: return t("consequence.layer2.describe", { cash });
    case 3: return t("consequence.layer3.describe", { cash });
    case 4: return t("consequence.layer4.describe", { rider: c.payload?.rider_name || t("consequence.layer4DefaultRider"), cash });
    case 5: return t("consequence.layer5.describe");
    default: return "";
  }
}

function BoardConsequencesPanel({ consequences = [] }) {
  const { t } = useTranslation("board");
  const visible = consequences.filter((c) => CONSEQUENCE_LAYER_STYLE[c.layer]);
  useEffect(() => {
    if (visible.length > 0) logEvent("feature_board_consequences_panel_viewed", { count: visible.length });
  }, [visible.length]);
  if (visible.length === 0) return null;

  return (
    <div className="mt-5 bg-cz-card border border-cz-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-cz-3 text-xs uppercase tracking-wider">{t("consequence.heading")}</p>
        <span className="text-cz-3 text-[10px]">{t("consequence.count", { count: visible.length })}</span>
      </div>
      <div className="flex flex-col gap-2">
        {visible.sort((a, b) => a.layer - b.layer).map((c) => {
          const style = CONSEQUENCE_LAYER_STYLE[c.layer];
          const isCritical = style.severity === "critical";
          return (
            <div key={c.id}
              className={`p-3 rounded-lg border ${isCritical
                ? "bg-cz-danger-bg0/8 border-cz-danger/30"
                : "bg-cz-accent/10 border-cz-accent/30"}`}>
              <div className="flex items-start gap-3">
                <span className="text-xl flex-shrink-0">{style.emoji}</span>
                <div className="flex-1">
                  <p className={`text-sm font-semibold ${isCritical ? "text-cz-danger" : "text-cz-accent-t"}`}>
                    {t(`consequence.layer${c.layer}.label`)}
                  </p>
                  <p className="text-cz-3 text-xs mt-1 leading-relaxed">{describeConsequence(t, c)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// S-02e · Bonus-offer card (lag 6). Q-batch 1B Q14: maks 1/sæson, +200K mod ekstra-mål.
function BonusOfferCard({ offer, onAccept, onDecline, busy }) {
  const { t } = useTranslation("board");
  if (!offer) return null;
  const goalLabel = offer.payload?.extra_goal_label || t("bonusOffer.defaultGoal");
  const bonus = offer.severity || 0;

  return (
    <div className="mt-5 rounded-xl p-5 border border-cz-success/40 bg-cz-success-bg0/8">
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0">🎁</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-cz-success">{t("bonusOffer.heading")}</p>
          <p className="text-cz-2 text-xs mt-2 leading-relaxed">
            <Trans
              i18nKey="board:bonusOffer.body"
              values={{ cash: formatCash(bonus), goal: goalLabel }}
              components={{
                bonus: <span className="font-mono font-bold text-cz-success" />,
                goal: <span className="font-medium text-cz-2" />,
              }}
            />
          </p>
          <p className="text-cz-3 text-xs mt-2 leading-relaxed">{t("bonusOffer.footer")}</p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              disabled={busy}
              onClick={onAccept}
              className="px-3 py-2 rounded-md bg-cz-success/20 hover:bg-cz-success/30 text-cz-success text-xs font-semibold border border-cz-success/40 disabled:opacity-50">
              {t("bonusOffer.accept")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDecline}
              className="px-3 py-2 rounded-md bg-cz-subtle hover:bg-cz-subtle/70 text-cz-2 text-xs font-medium border border-cz-border disabled:opacity-50">
              {t("bonusOffer.decline")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BoardFeedSection({ items = [] }) {
  const { t } = useTranslation("board");
  if (!items.length) return null;

  const recent = items.slice(0, 5);

  return (
    <div className="mt-5 bg-cz-card border border-cz-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-cz-3 text-xs uppercase tracking-wider">{t("feed.heading")}</p>
        <span className="text-cz-3 text-[10px]">{t("feed.latestCount", { count: items.length })}</span>
      </div>
      <div className="flex flex-col gap-2">
        {recent.map((item) => {
          const isCritical = item.type === "board_critical";
          return (
            <div key={item.id}
              className={`p-3 rounded-lg border ${isCritical
                ? "bg-cz-danger-bg0/8 border-cz-danger/30"
                : "bg-cz-subtle border-cz-border"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className={`text-sm font-medium ${isCritical ? "text-cz-danger" : "text-cz-2"}`}>
                    {item.title}
                  </p>
                  <p className="text-cz-3 text-xs mt-1 leading-relaxed">{item.message}</p>
                </div>
                {isCritical && (
                  <span className="text-[10px] uppercase tracking-wider text-cz-danger flex-shrink-0">
                    {t("feed.needsAction")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// S-02b · Auto-accept countdown-banner.
// Q-bekræftelse C (2026-05-05): T-3 (race_days=2) info, T-1 (=4) Skal-handles,
// auto-accept (>=5). UI viser kun hvis der findes en pending plan + race-days igang.
function BoardAutoAcceptCountdown({ isBaselinePhase, autoAccept, setupNextPlanType, plans }) {
  const { t } = useTranslation("board");
  if (isBaselinePhase || !autoAccept) return null;

  const hasPendingPlan = Boolean(setupNextPlanType)
    || PLAN_SEQUENCE.some((pt) => plans[pt]?.is_expired);
  if (!hasPendingPlan) return null;

  const raceDaysLeft = Number(autoAccept.race_days_left ?? 0);
  const raceDaysCompleted = Number(autoAccept.race_days_completed ?? 0);
  if (raceDaysCompleted <= 0 || raceDaysLeft <= 0) return null;

  const isCritical = raceDaysLeft <= 1;
  const isWarning = raceDaysLeft <= 3;

  const containerClass = isCritical
    ? "bg-cz-danger-bg0/8 border-cz-danger/40"
    : isWarning
      ? "bg-cz-accent/10 border-cz-accent/40"
      : "bg-cz-info-bg0/10 border-cz-info/30";

  const accentClass = isCritical
    ? "text-cz-danger"
    : isWarning ? "text-cz-accent-t" : "text-cz-info";

  return (
    <div className={`rounded-xl p-4 mb-5 border ${containerClass}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl">⏳</span>
        <div className="flex-1">
          <p className={`font-semibold text-sm ${accentClass}`}>
            {isCritical
              ? t("autoAccept.lastChance", { count: raceDaysLeft })
              : t("autoAccept.waiting",     { count: raceDaysLeft })}
          </p>
          <p className="text-cz-3 text-xs mt-1 leading-relaxed">{t("autoAccept.footer")}</p>
        </div>
      </div>
    </div>
  );
}

// ── S-02h · DashboardPlanPanel — kompakt panel i 3-kolonne grid ───────────────

function DashboardPlanPanel({ planType, planData, riders, standing, activeLoanCount, team,
  requestError, requestingType, onRequest, onRenew, onNegotiate, onGoalClick }) {
  const { t } = useTranslation("board");
  const [detailOpen, setDetailOpen] = useState(false);

  if (!planData) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-xl p-4 flex flex-col items-center justify-center gap-2 min-h-[120px] text-center">
        <div className="w-8 h-8 rounded-full bg-cz-subtle flex items-center justify-center text-cz-3 text-sm font-bold">
          {planType === "5yr" ? "5" : planType === "3yr" ? "3" : "1"}
        </div>
        <p className="text-cz-3 text-xs">{getPlanLabel(t, planType)}</p>
        <p className="text-cz-3 text-[11px]">{t("plan.autoConfigured")}</p>
      </div>
    );
  }

  const { board, plan_duration, seasons_remaining, seasons_completed, plan_progress_pct,
    cumulative_stats, snapshots, is_expired, renew_locked, outlook, request_status, request_options } = planData;

  const goals = typeof board.current_goals === "string"
    ? JSON.parse(board.current_goals) : (board.current_goals || []);

  // #55 · "Opnået" afgøres af bestyrelsens egen evaluering (status "ahead") for
  // ALLE måltyper; den lokale fallback (kun legacy-typer) bruges kun når outlook
  // mangler. Ren logik + de 7 nye typer dækkes af lib/boardUtils.test.js.
  function goalAchieved(goal, goalIndex) {
    return isBoardGoalAchieved(goal, outlook?.goal_evaluations?.[goalIndex], {
      cumulativeStats: cumulative_stats, riders, standing, team, board, activeLoanCount,
    });
  }

  const nonCumGoals = goals.filter(g => !g.cumulative);
  const cumGoals = goals.filter(g => g.cumulative);
  const goalsAchieved = nonCumGoals.filter(g => goalAchieved(g, goals.indexOf(g))).length;
  const modifier = satisfactionToModifier(board.satisfaction);
  const satColor = board.satisfaction >= 70 ? "text-cz-success"
    : board.satisfaction >= 40 ? "text-cz-accent-t" : "text-cz-danger";
  const benchmark = getBenchmarkMeta(t, board.satisfaction);
  const trend = getSatisfactionTrend(snapshots);
  const showMidReviewBanner = plan_duration > 1
    && seasons_completed === Math.floor(plan_duration / 2);

  return (
    <div className={`bg-cz-card border rounded-xl flex flex-col ${is_expired ? "border-cz-accent/40" : "border-cz-border"}`}>
      {/* Full-bredde header (#955 fane-rework) */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
              ${is_expired ? "bg-cz-accent/10 border border-cz-accent/30 text-cz-accent-t" : "bg-cz-subtle border border-cz-border text-cz-2"}`}>
              {planType === "5yr" ? "5" : planType === "3yr" ? "3" : "1"}
            </div>
            <div>
              <p className="text-cz-1 font-semibold text-base">{getPlanLabel(t, planType)}</p>
              <p className="text-cz-3 text-xs">{getFocusLabel(t, board.focus)}</p>
            </div>
          </div>
          {/* #1030 · Affordance: tilfredsheds-tallet ligner et drilbart KPI-tal →
              gør det klikbart → scroll til tilfredshedsforklaringen nederst. */}
          <button type="button" onClick={scrollToSatisfactionExplainer}
            title={t("satisfactionExplainer.heading")}
            className="text-right flex-shrink-0 rounded px-1 -mx-1 hover:bg-cz-subtle/40 transition-colors group/sat">
            <p className={`font-data font-bold text-base ${satColor} underline-offset-2 group-hover/sat:underline`}>{board.satisfaction}%</p>
            <p className="text-cz-3 text-[11px] font-data">×{modifier.toFixed(2)}</p>
          </button>
        </div>

        {is_expired ? (
          <button onClick={onNegotiate}
            className="w-full py-2.5 text-sm font-semibold bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 rounded-lg hover:bg-cz-accent/20 transition-all">
            {t("plan.negotiateExpired")}
          </button>
        ) : (
          <>
            {/* #955 · standing = kvalitativ label + trend-pil + bar + tal */}
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-cz-3 text-[11px] uppercase tracking-wider">{t("plan.standingHeading")}</span>
                <span className={`text-sm font-semibold ${benchmark.color}`}>{benchmark.label}</span>
                {trend && (
                  <>
                    <span aria-hidden="true" className={`text-xs ${trend.color}`}>{trend.glyph}</span>
                    <span className="sr-only">{t(`status.trend.${trend.key}`)}</span>
                  </>
                )}
              </div>
              <span className="text-cz-2 text-xs font-data flex-shrink-0">{t("plan.goalsLabel")} {goalsAchieved}/{nonCumGoals.length}</span>
            </div>
            <div className="bg-cz-subtle rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-cz-accent transition-all"
                style={{ width: `${nonCumGoals.length ? (goalsAchieved / nonCumGoals.length) * 100 : 0}%` }} />
            </div>
            {seasons_remaining != null && plan_duration > 1 && (
              <p className="text-cz-3 text-[11px] mt-1.5 text-right">{t("plan.seasonsRemaining", { count: seasons_remaining })}</p>
            )}
          </>
        )}
      </div>

      {/* #955 · Mål — fuld liste (alle mål), klikbare → GoalMiniDialog. Full bredde
          giver plads til hele listen, så top-3-trunkeringen + "+N mere"-affordancen
          (#1030) ikke længere er nødvendig — alt vises direkte. */}
      {!is_expired && goals.length > 0 && (
        <div className="border-t border-cz-border px-5 py-4">
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">
            {plan_duration > 1 ? t("plan.planGoalsLabel") : t("plan.seasonGoalsLabel")}
          </p>
          <div className="flex flex-col gap-2">
            {goals.map((g, i) => {
              const ach = goalAchieved(g, i);
              const evalItem = outlook?.goal_evaluations?.[i];
              const cumProg = g.cumulative && g.type === "stage_wins" ? (cumulative_stats?.stage_wins ?? 0)
                : g.cumulative && g.type === "gc_wins" ? (cumulative_stats?.gc_wins ?? 0)
                : undefined;
              return (
                <GoalCard key={i} goal={g} achieved={ach}
                  evaluation={evalItem}
                  cumulativeProgress={cumProg}
                  onSelect={() => onGoalClick(g, evalItem, ach, cumProg)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Detail toggle */}
      <div className="mt-auto border-t border-cz-border">
        <button onClick={() => setDetailOpen(v => !v)}
          className="w-full py-2.5 text-xs text-cz-3 hover:text-cz-2 transition-colors flex items-center justify-center gap-1">
          <span>{detailOpen ? "↑" : "↓"}</span>
          <span>{detailOpen ? t("plan.hideDetails") : t("plan.showDetails")}</span>
        </button>
      </div>

      {/* Expanded detail — historik/vurdering/requests (mål-listen vises nu altid i primær-området) */}
      {detailOpen && (
        <div className="border-t border-cz-border p-5 flex flex-col gap-4">
          {plan_duration > 1 && (
            <div>
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("plan.timelineHeading")}</p>
              <PlanTimelineBar planDuration={plan_duration} seasonsCompleted={seasons_completed} snapshots={snapshots} />
              <div className="mt-2">
                <div className="bg-cz-subtle rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-cz-accent transition-all"
                    style={{ width: `${plan_progress_pct || 0}%` }} />
                </div>
                <p className="text-cz-3 text-xs text-center mt-1">{t("plan.seasonsRemaining", { count: seasons_remaining })}</p>
              </div>
            </div>
          )}

          {showMidReviewBanner && (
            <div className="bg-cz-info-bg0/10 border border-cz-info/20 rounded-xl p-4">
              <p className="text-cz-info text-sm font-semibold">{t("plan.midReviewHeading")}</p>
              <p className="text-cz-info/60 text-xs mt-1">{t("plan.midReviewBody", { current: Math.floor(plan_duration / 2), total: plan_duration })}</p>
            </div>
          )}

          {plan_duration > 1 && cumGoals.length > 0 && (
            <CumulativeStatsRow goals={cumGoals} cumStats={cumulative_stats} />
          )}

          {plan_duration > 1 && snapshots?.length > 0 && (
            <SeasonSnapshotGrid snapshots={snapshots} />
          )}

          {outlook?.feedback && (
            <div className="bg-cz-subtle border border-cz-border rounded-xl p-4">
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("plan.outlookHeading")}</p>
              <p className="text-cz-1 text-sm font-semibold">{resolveBoardFeedbackHeadline(t, outlook.feedback)}</p>
              <p className="text-cz-2 text-sm mt-1">{resolveBoardFeedbackSummary(t, outlook.feedback)}</p>
              {outlook.feedback.dominant_member && (
                <div className="mt-3"><MemberReactionPanel reaction={outlook.feedback.dominant_member} /></div>
              )}
              {outlook.personality && (
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-cz-border">
                  {[
                    t(`personality.sports_ambition.${outlook.personality.sports_ambition}`, { defaultValue: "" }),
                    t(`personality.financial_risk.${outlook.personality.financial_risk}`, { defaultValue: "" }),
                    t(`personality.identity_strength.${outlook.personality.identity_strength}`, { defaultValue: "" }),
                  ].filter(Boolean).map(label => (
                    <span key={label} className="text-[10px] bg-cz-subtle text-cz-2 px-2 py-0.5 rounded-full border border-cz-border">{label}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          <BoardRequestPanel
            requestOptions={request_options || []}
            requestStatus={request_status}
            requestError={requestError}
            requestingType={requestingType}
            onRequest={onRequest}
          />

          {!is_expired && !renew_locked && (
            <button onClick={onRenew}
              className="w-full py-2 text-xs border border-cz-border text-cz-3 rounded-lg hover:text-cz-2 hover:border-cz-border/80 transition-all">
              {t("plan.renew")}
            </button>
          )}
          {!is_expired && renew_locked && (
            <p className="text-cz-3 text-[10px] text-center">{t("plan.renewLocked")}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Wizard trin ───────────────────────────────────────────────────────────────

const FOCUS_KEYS = ["balanced", "youth_development", "star_signing"];

function WizardStep1({ identityProfile, focus, setFocus, planType, previewGoals, previewLoading, previewError, onStart }) {
  const { t } = useTranslation("board");
  const duration = getPlanDuration(planType);
  const preview = previewGoals || [];
  return (
    <div>
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-full bg-cz-accent/10 border border-cz-accent/30
          flex items-center justify-center text-2xl mx-auto mb-4">◧</div>
        <h2 className="text-cz-1 font-bold text-xl">{t("wizard.step1Title")}</h2>
        <p className="text-cz-2 text-sm mt-1">{t("wizard.step1Subtitle")}</p>
      </div>

      <BoardIdentityCard identityProfile={identityProfile} title={t("identity.wizardTitle")} />

      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-cz-3 text-xs uppercase tracking-wider mb-2">{t("wizard.focusLabel")}</label>
            {FOCUS_KEYS.map(key => (
              <button key={key} onClick={() => setFocus(key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 border transition-all
                  ${focus === key
                    ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                    : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle hover:text-cz-2"}`}>
                {getFocusLabel(t, key)}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-cz-3 text-xs uppercase tracking-wider mb-2">{t("wizard.horizonLabel")}</label>
            <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-lg px-3 py-3">
              <p className="text-cz-accent-t font-semibold text-sm">{getPlanLabel(t, planType)}</p>
              <p className="text-cz-accent-t text-xs mt-0.5">{t(`planDescriptions.${planType}`)}</p>
            </div>
          </div>
        </div>
        {duration > 1 && (
          <p className="text-cz-3 text-xs mt-3 text-center">
            {t("wizard.horizonDuration", { count: duration })}
          </p>
        )}
      </div>

      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-6">
        <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">{t("wizard.requirementsHeading")}</p>
        {previewLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
          </div>
        ) : previewError ? (
          <p className="text-cz-danger text-sm">{previewError}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {preview.map((g, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-cz-subtle border border-cz-border">
                <div className="w-5 h-5 rounded-full bg-cz-subtle text-cz-3 flex items-center justify-center
                  flex-shrink-0 mt-0.5 text-xs">
                  <span aria-hidden="true">○</span>
                  <span className="sr-only">{t("a11y.goalStatus.pending")}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-cz-2 text-sm break-words">{getBoardGoalLabel(t, g)}</p>
                  <div className="flex gap-3 mt-1">
                    {g.cumulative && <span className="text-xs text-cz-info/50">{t("goal.cumulative")}</span>}
                    {g.satisfaction_bonus > 0 && <span className="text-xs text-cz-success/60">+{g.satisfaction_bonus}</span>}
                    {g.satisfaction_penalty > 0 && <span className="text-xs text-cz-danger/60">{t("goal.satisfactionPenalty", { count: g.satisfaction_penalty })}</span>}
                  </div>
                  {g.identity_basis_rationale && (
                    <p className="text-[11px] text-cz-info mt-1.5">
                      ★ {formatBoardCopy(g.identity_basis_rationale.short)}
                    </p>
                  )}
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
        {t("wizard.startNegotiation")}
      </button>
    </div>
  );
}

function WizardStep2({ goals, goalIdx, negotiated, negotiationOptions = [], pendingNegotiate, onAccept, onNegotiate, onAcceptNegotiated, onBack }) {
  const { t } = useTranslation("board");
  const current = goals[goalIdx];
  const total = goals.length;
  const negotiationsUsed = Object.values(negotiated).filter(Boolean).length;
  // #864 affordance: "Forhandl ned" var altid aktiveret, men handleren
  // returnerede tavst hvis målet ikke havde en forhandlings-option → dead-click
  // (brugere spam-klikkede uden respons). Deaktivér + forklar når der ikke er
  // noget at forhandle om, så klik altid giver feedback.
  const alreadyNegotiated = Boolean(negotiated[goalIdx]);
  const hasNegotiationOption = Boolean(negotiationOptions[goalIdx]);
  const negotiateDisabled = alreadyNegotiated || !hasNegotiationOption;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        {/* #1240 · Tilbage uden at miste valg: forrige mål, eller trin 1 fra første mål. */}
        {onBack && (
          <button type="button" onClick={onBack}
            className="text-cz-3 hover:text-cz-2 text-xs flex-shrink-0 transition-colors">
            {t("wizard.back")}
          </button>
        )}
        <span className="text-cz-3 text-xs flex-shrink-0">{t("wizard.goalCounter", { current: goalIdx + 1, total })}</span>
        <div className="flex-1 bg-cz-subtle rounded-full h-1.5">
          <div className="h-1.5 rounded-full bg-cz-accent transition-all"
            style={{ width: `${((goalIdx) / total) * 100}%` }} />
        </div>
      </div>

      <div className="text-center mb-8">
        <h2 className="text-cz-1 font-bold text-xl">{t("wizard.step2Title")}</h2>
        <p className="text-cz-2 text-sm mt-1">{t("wizard.step2Subtitle")}</p>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
        <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">{t("wizard.requirementsHeading")}</p>
        <div className={`flex items-start gap-3 p-4 rounded-lg border
          ${current?.negotiated ? "bg-cz-info-bg0/5 border-cz-info/20" : "bg-cz-subtle border-cz-border"}`}>
          <div className="w-6 h-6 rounded-full bg-cz-accent/10 border border-cz-accent/30
            flex items-center justify-center flex-shrink-0 text-xs text-cz-accent-t" aria-hidden="true">◎</div>
          <div className="flex-1 min-w-0">
            <p className="text-cz-1 font-semibold break-words">{getBoardGoalLabel(t, current)}</p>
            <div className="flex flex-wrap gap-3 mt-2">
              {current?.importance === "required" && (
                <span className="text-[10px] text-cz-3 uppercase tracking-wider">{t("wizard.obligatory")}</span>
              )}
              {current?.cumulative && <span className="text-xs text-cz-info/70 bg-cz-info-bg0/10 px-2 py-0.5 rounded">{t("goal.cumulative")}</span>}
              {current?.satisfaction_bonus > 0 && (
                <span className="text-xs text-cz-success/70">{t("goal.satisfactionBonus", { count: current?.satisfaction_bonus })}</span>
              )}
              {current?.satisfaction_penalty > 0 && (
                <span className="text-xs text-cz-danger/70">{t("goal.satisfactionPenalty", { count: current?.satisfaction_penalty })}</span>
              )}
              {current?.negotiated && <span className="text-xs text-cz-info/70">{t("wizard.negotiatedTick")}</span>}
            </div>
          </div>
        </div>
      </div>

      {!pendingNegotiate ? (
        <div className="flex gap-3">
          <button onClick={onNegotiate} disabled={negotiateDisabled}
            title={!hasNegotiationOption && !alreadyNegotiated ? t("wizard.cannotNegotiate") : undefined}
            className={`flex-1 py-3 rounded-xl text-sm font-medium border transition-all
              ${negotiateDisabled
                ? "bg-cz-subtle text-cz-3 border-cz-border cursor-not-allowed opacity-60"
                : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle hover:text-cz-2"}`}>
            {alreadyNegotiated
              ? t("wizard.alreadyNegotiated")
              : !hasNegotiationOption
                ? t("wizard.cannotNegotiate")
                : t("wizard.negotiateDown")}
          </button>
          <button onClick={onAccept}
            className="flex-1 py-3 bg-cz-accent text-cz-on-accent font-bold rounded-xl text-sm hover:brightness-110 transition-all">
            {t("wizard.accept")}
          </button>
        </div>
      ) : (
        <div>
          <div className="bg-cz-info-bg0/10 border border-cz-info/20 rounded-xl p-4 mb-4">
            <p className="text-cz-info text-sm font-medium">{t("wizard.compromiseHeading")}</p>
            <p className="text-cz-info text-xs mt-1">{t("wizard.compromiseBody")}</p>
          </div>
          <button onClick={onAcceptNegotiated}
            className="w-full py-3 bg-cz-accent text-cz-on-accent font-bold rounded-xl text-sm hover:brightness-110 transition-all">
            {t("wizard.acceptNegotiated")}
          </button>
        </div>
      )}

      {negotiationsUsed > 0 && (
        <p className="text-cz-3 text-xs text-center mt-4">{t("wizard.negotiationsUsed", { count: negotiationsUsed })}</p>
      )}
    </div>
  );
}

function WizardStep3({ finalGoals, planType, onSign, saving, onBack }) {
  const { t } = useTranslation("board");
  const duration = getPlanDuration(planType);
  return (
    <div>
      {/* #1240 · Tilbage til forhandlingen (sidste mål) uden at miste valg. */}
      {onBack && (
        <button type="button" onClick={onBack}
          className="text-cz-3 hover:text-cz-2 text-xs mb-4 transition-colors">
          {t("wizard.back")}
        </button>
      )}
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-full bg-cz-success-bg border border-cz-success/30
          flex items-center justify-center text-2xl mx-auto mb-4" aria-hidden="true">✍</div>
        <h2 className="text-cz-1 font-bold text-xl">{t("wizard.step3Title")}</h2>
        <p className="text-cz-2 text-sm mt-1">
          {t("wizard.step3Subtitle", { plan: getPlanLabel(t, planType), count: duration })}
        </p>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-6">
        <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">{t("wizard.agreedHeading")}</p>
        <div className="flex flex-col gap-2">
          {finalGoals.map((g, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border
              ${g.negotiated ? "bg-cz-info-bg0/5 border-cz-info/20" : "bg-cz-subtle border-cz-border"}`}>
              <div className="w-5 h-5 rounded-full bg-cz-subtle text-cz-3 flex items-center
                justify-center flex-shrink-0 mt-0.5 text-xs">
                <span aria-hidden="true">○</span>
                <span className="sr-only">{t("a11y.goalStatus.pending")}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-cz-2 text-sm font-medium break-words">{getBoardGoalLabel(t, g)}</p>
                <div className="flex gap-3 mt-1">
                  {g.cumulative && <span className="text-xs text-cz-info/50">{t("goal.cumulative")}</span>}
                  {g.negotiated && <span className="text-xs text-cz-info/70">{t("goal.negotiated")}</span>}
                  {g.satisfaction_bonus > 0 && <span className="text-xs text-cz-success/60">+{g.satisfaction_bonus}</span>}
                  {g.satisfaction_penalty > 0 && <span className="text-xs text-cz-danger/60">{t("goal.satisfactionPenalty", { count: g.satisfaction_penalty })}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onSign} disabled={saving}
        className="w-full py-3 bg-cz-accent text-cz-on-accent font-bold rounded-xl
          hover:brightness-110 disabled:opacity-50 transition-all">
        {saving ? t("wizard.signing") : t("wizard.sign")}
      </button>
    </div>
  );
}

// ── Hoved-komponent ───────────────────────────────────────────────────────────

export default function BoardPage() {
  const { t } = useTranslation("board");
  // Plandata
  const [plans, setPlans] = useState({ "5yr": null, "3yr": null, "1yr": null });
  // #955 · aktiv plan-fane (5/3/1-år vises én ad gangen, fuld bredde)
  const [activePlanTab, setActivePlanTab] = useState(PLAN_SEQUENCE[0]);
  const [setupNextPlanType, setSetupNextPlanType] = useState(null);
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [standing, setStanding] = useState(null);
  const [identityProfile, setIdentityProfile] = useState(null);
  const [activeLoanCount, setActiveLoanCount] = useState(0);
  const [loading, setLoading] = useState(true);
  // S-02a: sæson 1 = baseline observation. Window-state låser wizard.
  const [isBaselinePhase, setIsBaselinePhase] = useState(false);
  // S-02b: auto-accept countdown + board-feed
  const [autoAccept, setAutoAccept] = useState(null);
  const [boardFeed, setBoardFeed] = useState([]);
  // S-02c: 5 board-medlemmer (3 identity + 2 wildcards)
  const [teamMembers, setTeamMembers] = useState([]);
  // S-02e: Aktive konsekvenser (lag 2-6). bonusOffer = lag 6 udskilt.
  const [activeConsequences, setActiveConsequences] = useState([]);
  const [bonusOffer, setBonusOffer] = useState(null);
  const [bonusOfferBusy, setBonusOfferBusy] = useState(false);
  // S-02f: Klub-DNA — valgt arketype + 3 forslag når ikke valgt endnu
  const [teamDna, setTeamDna] = useState(null);
  const [dnaSuggestions, setDnaSuggestions] = useState([]);
  const [dnaChooseBusy, setDnaChooseBusy] = useState(false);
  const [dnaError, setDnaError] = useState("");

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
  // S-02h: GoalMiniDialog + multi-plan renewal queue
  const [goalMiniDialog, setGoalMiniDialog] = useState(null); // { goal, evaluation, achieved, cumulativeProgress }
  // #1030: medlem-portræt + DNA-detalje-dialoger (affordance-pakke)
  const [memberDialog, setMemberDialog] = useState(null); // decoreret member-objekt
  const [dnaDialogOpen, setDnaDialogOpen] = useState(false);
  const [renewalQueue, setRenewalQueue] = useState([]); // ['3yr', '1yr'] sorted by PLAN_SEQUENCE
  const [renewalQueueIdx, setRenewalQueueIdx] = useState(0);

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
      if (!proposal || proposal.error) {
        setPreviewGoals([]);
        setNegotiationOptions([]);
        setPreviewError(proposal?.error || t("wizard.errorProposal"));
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

    let res;
    try {
      res = await fetch(`${API}/api/board/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      setLoading(false);
      return;
    }
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json().catch(() => null);
    if (!data) { setLoading(false); return; }

    const newPlans = data.plans || { "5yr": null, "3yr": null, "1yr": null };
    setPlans(newPlans);
    setSetupNextPlanType(data.setup_next_plan_type || null);
    setIsBaselinePhase(Boolean(data.is_baseline_phase));
    setTeam(data.team || null);
    setRiders(data.riders || []);
    setStanding(data.standing || null);
    setIdentityProfile(data.identity_profile || null);
    setAutoAccept(data.auto_accept || null);
    setActiveLoanCount(data.active_loans_count || 0);
    setTeamMembers(Array.isArray(data.team_members) ? data.team_members : []);
    setActiveConsequences(Array.isArray(data.active_consequences) ? data.active_consequences : []);
    setBonusOffer(data.bonus_offer || null);
    setTeamDna(data.team_dna || null);
    setDnaSuggestions(Array.isArray(data.dna_suggestions) ? data.dna_suggestions : []);
    setDnaError("");

    // S-02b: hent seneste board-relaterede notifs til feed-sektion (Q-batch 1C Q21)
    try {
      const feedRes = await fetch(`${API}/api/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (feedRes.ok) {
        const allNotifs = await feedRes.json();
        const boardNotifs = (allNotifs || []).filter(n =>
          n.type === "board_update" || n.type === "board_critical"
        );
        setBoardFeed(boardNotifs);
      }
    } catch {
      // Feed er ikke kritisk — undlad at blokere page-load
    }

    // S-02a: I baseline-fase (sæson 1) er wizard låst — bestyrelsen observerer.
    // Auto-åbn wizard ved sekventiel onboarding (sæson 2+) når mindst én plan allerede findes.
    // Første gangs setup (board_plan_set === false) viser BoardEmptyState i hovedvisningen.
    const hasAnyPlan = Object.values(newPlans).some(p => p !== null);
    if (!data.is_baseline_phase && data.setup_next_plan_type && hasAnyPlan) {
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // #678 Track 3: resolveApiError foretrækker errorCode → errors:api.* (EN/DA)
      // og falder tilbage til den lokale t()-streng for u-kodede svar.
      return {
        error: resolveApiError(data, t, data?.code === "BOARD_DNA_REQUIRED"
          ? t("dna.requiredBeforePlan")
          : t("wizard.errorProposal")),
      };
    }
    return data;
  }

  function openWizard(planType, isSetup = false) {
    // S-02h Q19: multi-plan renewal always starts with the longest expired plan,
    // regardless of which plan the user clicked.
    let activePlanType = planType;
    if (!isSetup) {
      const allExpired = PLAN_SEQUENCE.filter(pt => plans[pt]?.is_expired);
      if (allExpired.length > 1) {
        activePlanType = allExpired[0];
        setRenewalQueue(allExpired);
        setRenewalQueueIdx(0);
      } else {
        setRenewalQueue([]);
        setRenewalQueueIdx(0);
      }
    }
    const existingFocus = plans[activePlanType]?.board?.focus || "balanced";
    setWizardPlanType(activePlanType);
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
    if (!goals.length) {
      const proposal = await fetchBoardProposal(wizardFocus, wizardPlanType);
      if (!proposal || proposal.error) {
        setPreviewError(proposal?.error || t("wizard.errorProposal"));
        return;
      }
      goals = proposal.goals || [];
      const nextNegotiationOptions = proposal.negotiation_options || [];
      setPreviewGoals(goals);
      setNegotiationOptions(nextNegotiationOptions);
    }
    // #1240 · Gik brugeren tilbage til trin 1 uden at ændre strategi (samme
    // proposal-reference), genoptages forhandlingen hvor den slap — valg bevares.
    // Fokus-/planskifte refetcher proposal (ny reference) → frisk start nedenfor.
    if (canResumeNegotiation({ proposedGoals, previewGoals: goals, finalGoals })) {
      setPendingNegotiate(false);
      setWizardStep(2);
      return;
    }
    setProposedGoals(goals);
    setFinalGoals(goals.map(goal => ({ ...goal })));
    setGoalIdx(0);
    setNegotiated({});
    setPendingNegotiate(false);
    setWizardStep(2);
  }

  // #1240 · Tilbage-knap i wizarden (trin 2/3). Ren state-logik i
  // lib/boardWizardNav.js — rører aldrig finalGoals/negotiated, så valg bevares.
  function handleWizardBack() {
    const back = getWizardBackState({ step: wizardStep, goalIdx, pendingNegotiate });
    if (!back) return;
    setWizardStep(back.step);
    setGoalIdx(back.goalIdx);
    setPendingNegotiate(back.pendingNegotiate);
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

    try {
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

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewError(resolveApiError(data, t, data?.code === "BOARD_DNA_REQUIRED"
          ? t("dna.requiredBeforePlan")
          : t("wizard.errorSign")));
        return;
      }

      if (res.ok) {
        // S-02h: Multi-plan renewal queue — auto-advance to next expired plan
        const nextIdx = renewalQueueIdx + 1;
        if (!wizardIsSetup && renewalQueue.length > nextIdx) {
          const nextPlanType = renewalQueue[nextIdx];
          setRenewalQueueIdx(nextIdx);
          const nextFocus = plans[nextPlanType]?.board?.focus || "balanced";
          setWizardPlanType(nextPlanType);
          setWizardFocus(nextFocus);
          setWizardStep(1);
          setPreviewGoals([]);
          setPreviewError("");
          setNegotiated({});
          setPendingNegotiate(false);
          loadAll();
        } else {
          setRenewalQueue([]);
          setRenewalQueueIdx(0);
          closeWizard();
          loadAll();
        }
      }
    } catch {
      setPreviewError(t("auth:error.connectionFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function sendBoardRequest(planType, requestType) {
    const key = `${planType}:${requestType}`;
    setRequestingType(key);
    setRequestErrors(e => ({ ...e, [planType]: "" }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setRequestErrors(e => ({ ...e, [planType]: t("errors.loginRequired") }));
        return;
      }

      const res = await fetch(`${API}/api/board/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_type: planType, request_type: requestType }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRequestErrors(e => ({ ...e, [planType]: resolveApiError(data, t, t("errors.requestFallback")) }));
        return;
      }

      await loadAll();
    } catch {
      setRequestErrors(e => ({ ...e, [planType]: t("auth:error.connectionFailed") }));
    } finally {
      setRequestingType("");
    }
  }

  // S-02e · Bonus-offer accept/decline (lag 6)
  async function chooseDna(dnaKey) {
    if (!dnaKey || dnaChooseBusy) return;
    setDnaChooseBusy(true);
    setDnaError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const res = await fetch(`${API}/api/board/dna-choose`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dna_key: dnaKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDnaError(resolveApiError(data, t, t("dna.errorFallback")));
        return;
      }
      const data = await res.json().catch(() => ({}));
      setTeamDna(data.team_dna || null);
      setTeamMembers(Array.isArray(data.team_members) ? data.team_members : []);
      setDnaSuggestions([]);
      await loadAll();
    } finally {
      setDnaChooseBusy(false);
    }
  }

  async function handleBonusOffer(action) {
    if (!bonusOffer || bonusOfferBusy) return;
    setBonusOfferBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const res = await fetch(`${API}/api/board/bonus-offer/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ offer_id: bonusOffer.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("Bonus offer action failed:", data.error);
        return;
      }
      await loadAll();
    } finally {
      setBonusOfferBusy(false);
    }
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

  // #1073 · Wizard-modalen rendres inline (ikke en mountet komponent), så a11y-hooket
  // kaldes her — før evt. early-return — med active styret af wizardPlanType. Escape
  // lukker kun når luk-knappen også er synlig (ikke under setup / multi-renewal-trin>0).
  const wizardClosable = !wizardIsSetup && !(renewalQueue.length > 1 && renewalQueueIdx > 0);
  const wizardDialogRef = useModalA11y(wizardClosable ? closeWizard : null, Boolean(wizardPlanType));

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  // ── Hoved-visning + wizard modal ────────────────────────────────────────────
  const hasAnyPlan = Object.values(plans).some(p => p !== null);
  // S-02h: wizard-context beregnes inline (bruges i modal nedenfor)
  const wizardSetupStep = wizardIsSetup ? PLAN_SEQUENCE.indexOf(wizardPlanType) + 1 : null;
  const wizardExistingPlanData = wizardPlanType ? plans[wizardPlanType] : null;
  const isMultiRenewal = !wizardIsSetup && renewalQueue.length > 1;

  return (
    <div className="max-w-4xl mx-auto board-a11y">
      <OnboardingTour pageKey="board" steps={buildBoardTourSteps(t)} />
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
          <p className="text-cz-3 text-sm">{t("page.subtitle")}</p>
        </div>
        <Link to="/finance"
          className="px-3 py-2 rounded-lg text-sm border bg-cz-subtle text-cz-2 border-cz-border
            hover:text-cz-1 hover:bg-cz-subtle transition-all">
          💰 {t("page.financeLink")}
        </Link>
      </div>

      {/* S-02a: Sæson 1 baseline — bestyrelsen observerer, ingen forhandling endnu. */}
      {isBaselinePhase && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl">👀</span>
            <div>
              <h2 className="text-cz-1 font-semibold text-base mb-1">{t("baseline.title")}</h2>
              <p className="text-cz-3 text-sm leading-relaxed">{t("baseline.body")}</p>
            </div>
          </div>
        </div>
      )}

      {!isBaselinePhase && !hasAnyPlan && setupNextPlanType && teamDna && (
        <BoardEmptyState
          onOpenWizard={() => openWizard(setupNextPlanType, true)}
          onStartTour={() => startTour("board")}
        />
      )}

      {/* S-02b: Auto-accept countdown — vises kun når der er en pending plan + race-days igang. */}
      <BoardAutoAcceptCountdown
        isBaselinePhase={isBaselinePhase}
        autoAccept={autoAccept}
        setupNextPlanType={setupNextPlanType}
        plans={plans}
      />

      <BoardIdentityCard identityProfile={identityProfile} />

      {/* S-02f · Klub-DNA */}
      {!isBaselinePhase && teamDna && <ClubDnaBadge dna={teamDna} onSelect={() => setDnaDialogOpen(true)} />}
      {!isBaselinePhase && teamDna && <BoardDriversPanel dna={teamDna} plans={plans} />}
      {!isBaselinePhase && !teamDna && dnaSuggestions.length > 0 && (
        <ClubDnaSelectionCard
          suggestions={dnaSuggestions}
          onChoose={chooseDna}
          busy={dnaChooseBusy}
          error={dnaError}
        />
      )}

      {/* S-02c · Bestyrelse-medlems-grid */}
      {!isBaselinePhase && teamDna && teamMembers.length > 0 && (
        <BoardMembersGrid members={teamMembers} onSelect={setMemberDialog} />
      )}

      {/* S-02e · Bonus-tilbud (lag 6) */}
      {!isBaselinePhase && bonusOffer && (
        <BonusOfferCard
          offer={bonusOffer}
          busy={bonusOfferBusy}
          onAccept={() => handleBonusOffer("accept")}
          onDecline={() => handleBonusOffer("decline")}
        />
      )}

      {/* S-02e · Aktive konsekvenser (lag 2-5) */}
      {!isBaselinePhase && activeConsequences.some((c) => c.layer >= 2 && c.layer <= 5) && (
        <BoardConsequencesPanel consequences={activeConsequences} />
      )}

      {/* #955 · Plan-faner — én plan ad gangen i fuld bredde (erstatter 3-kolonne grid). */}
      {!isBaselinePhase && (
        <div className="mt-5" data-tour="board-plans">
          <div role="tablist" aria-label={t("tabs.aria")} className="flex gap-1 border-b border-cz-border">
            {PLAN_SEQUENCE.map(planType => {
              const pd = plans[planType];
              const isActive = activePlanTab === planType;
              const num = planType === "5yr" ? "5" : planType === "3yr" ? "3" : "1";
              const expired = pd?.is_expired;
              const sat = pd?.board?.satisfaction;
              const dotColor = sat == null ? "bg-cz-3/40"
                : sat >= 70 ? "bg-cz-success" : sat >= 40 ? "bg-cz-accent" : "bg-cz-danger";
              return (
                <button key={planType} type="button" role="tab"
                  id={`plan-tab-${planType}`}
                  aria-selected={isActive}
                  aria-controls={`plan-panel-${planType}`}
                  aria-label={t("tabs.select", { plan: getPlanLabel(t, planType) })}
                  onClick={() => setActivePlanTab(planType)}
                  className={`group relative flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm transition-colors -mb-px
                    ${isActive ? "text-cz-1 font-semibold" : "text-cz-3 hover:text-cz-2"}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                    ${expired ? "bg-cz-accent/10 border border-cz-accent/40 text-cz-accent-t"
                      : isActive ? "bg-cz-accent/12 border border-cz-accent/30 text-cz-accent-t"
                      : "bg-cz-subtle border border-cz-border text-cz-3"}`}>{num}</span>
                  <span className="hidden sm:inline">{getPlanLabel(t, planType)}</span>
                  {sat != null && (
                    <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
                  )}
                  {/* aktiv fane = solid guld-streg; inaktiv = micro-interaction accent-dash ved hover (#1050-mønster) */}
                  <span aria-hidden="true"
                    className={`pointer-events-none absolute left-0 right-0 bottom-0 h-0.5 rounded-full bg-cz-accent origin-left transition-transform duration-200 ease-out motion-reduce:transition-none
                      ${isActive ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"}`} />
                </button>
              );
            })}
          </div>

          {/* #818 · forklar forhandlingsrækkefølge (5→3→1 år) */}
          <p className="text-cz-3 text-[11px] mt-2 px-1">{t("plan.negotiationOrder")}</p>

          <div className="mt-4" role="tabpanel" id={`plan-panel-${activePlanTab}`} aria-labelledby={`plan-tab-${activePlanTab}`}>
            <DashboardPlanPanel
              key={activePlanTab}
              planType={activePlanTab}
              planData={plans[activePlanTab]}
              team={team}
              riders={riders}
              standing={standing}
              activeLoanCount={activeLoanCount}
              requestError={requestErrors[activePlanTab] || ""}
              requestingType={
                requestingType.startsWith(`${activePlanTab}:`)
                  ? requestingType.split(":").slice(1).join(":")
                  : ""
              }
              onRequest={(requestType) => sendBoardRequest(activePlanTab, requestType)}
              onRenew={() => renewContract(activePlanTab)}
              onNegotiate={() => openWizard(activePlanTab, false)}
              onGoalClick={(goal, evaluation, achieved, cumProgress) =>
                setGoalMiniDialog({ goal, evaluation, achieved, cumulativeProgress: cumProgress })}
            />
          </div>
        </div>
      )}

      {/* S-02b: Bestyrelse-feed */}
      {!isBaselinePhase && <BoardFeedSection items={boardFeed} />}

      {/* Tilfredshedsforklaring — #1030: scroll-mål fra plan-panelets tilfredsheds-tal */}
      <div id="board-satisfaction-explainer" className="bg-cz-card border border-cz-border rounded-xl p-5 mt-5 scroll-mt-4">
        <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("satisfactionExplainer.heading")}</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { key: "high",     color: "text-cz-success" },
            { key: "moderate", color: "text-cz-accent-t" },
            { key: "low",      color: "text-cz-danger" },
          ].map(item => (
            <div key={item.key} className="bg-cz-subtle rounded-lg p-3 border border-cz-border">
              <p className={`font-mono font-bold text-sm ${item.color}`}>{t(`satisfactionExplainer.${item.key}.range`)}</p>
              <p className="text-cz-2 text-xs font-medium mt-1">{t(`satisfactionExplainer.${item.key}.label`)}</p>
              <p className="text-cz-3 text-xs mt-1">{t(`satisfactionExplainer.${item.key}.effect`)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* S-02h · Wizard modal overlay — vises oven på dashboard (ikke full-page takeover) */}
      {wizardPlanType && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-6 px-4">
          {/* #1241 · Solid tema-flade (bg-cz-body) bag wizard-indholdet: overskrifter,
              mål-tæller og knapper flød før direkte på den mørke overlay → tema-tokens
              (text-cz-1/2/3) blev ulæselige i light-mode ("gennemsigtig tekst"). */}
          <div ref={wizardDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("wizard.dialogAria")}
            className="w-full max-w-2xl bg-cz-body border border-cz-border rounded-2xl p-4 sm:p-6 shadow-2xl h-fit">
            {/* Onboarding-header (sæson 2 setup) */}
            {wizardIsSetup && (
              <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-xl p-4 mb-6">
                <p className="text-cz-accent-t text-sm font-semibold">
                  {t("wizard.setupHeading", { step: wizardSetupStep })}
                </p>
                {/* #1241 · solid accent-t (før /60 og /70 opacity): brødtekst på den
                    tonede boks faldt under kontrast-kravet i light-mode. */}
                <p className="text-cz-accent-t text-xs mt-1">
                  {t("wizard.setupBody", { plan: getPlanLabel(t, wizardPlanType) })}
                </p>
                <p className="text-cz-accent-t text-xs mt-2">
                  {t("wizard.setupSequence")}
                </p>
              </div>
            )}

            {/* Multi-plan renewal header (Q19) */}
            {isMultiRenewal && (
              <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-xl p-4 mb-6">
                <p className="text-cz-accent-t text-sm font-semibold">
                  {t("wizard.multiRenewalHeading", { current: renewalQueueIdx + 1, total: renewalQueue.length, plan: getPlanLabel(t, wizardPlanType) })}
                </p>
                <p className="text-cz-accent-t text-xs mt-1">
                  {renewalQueueIdx + 1 < renewalQueue.length
                    ? t("wizard.multiRenewalBodyNext", { next: getPlanLabel(t, renewalQueue[renewalQueueIdx + 1]) })
                    : t("wizard.multiRenewalBodyLast")}
                </p>
              </div>
            )}

            {/* Enkelt renewal header */}
            {!wizardIsSetup && !isMultiRenewal && wizardExistingPlanData?.is_expired && (
              <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-xl p-4 mb-6">
                <p className="text-cz-accent-t text-sm font-semibold">{t("wizard.singleRenewalHeading", { plan: getPlanLabel(t, wizardPlanType) })}</p>
                <p className="text-cz-accent-t text-xs mt-1">{t("wizard.singleRenewalBody", { plan: getPlanLabel(t, wizardPlanType) })}</p>
              </div>
            )}

            {/* Trin-indikator */}
            <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
              <div className="flex items-center">
                {[
                  { n: 1, labelKey: "strategy"    },
                  { n: 2, labelKey: "negotiation" },
                  { n: 3, labelKey: "signature"   },
                ].map(({ n, labelKey }, i) => (
                  <div key={n} className={`flex items-center ${i < 2 ? "flex-1" : ""}`}>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                        ${wizardStep === n ? "bg-cz-accent text-cz-on-accent"
                          : wizardStep > n ? "bg-cz-success-bg text-cz-success"
                          : "bg-cz-subtle text-cz-3"}`}>
                        {wizardStep > n ? (
                          <>
                            <span aria-hidden="true">✓</span>
                            <span className="sr-only">{t("a11y.wizardStepDone")}</span>
                          </>
                        ) : n}
                      </div>
                      <span className={`text-xs ${wizardStep === n ? "text-cz-2" : "text-cz-3"}`}>{t(`wizard.steps.${labelKey}`)}</span>
                    </div>
                    {i < 2 && (
                      <div className={`flex-1 h-px mx-3 ${wizardStep > n ? "bg-cz-success-bg0/30" : "bg-cz-subtle"}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {wizardExistingPlanData?.board && (
              <div className="mb-4">
                <SatisfactionMeter value={wizardExistingPlanData.board.satisfaction} />
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
                negotiationOptions={negotiationOptions}
                pendingNegotiate={pendingNegotiate}
                onAccept={acceptCurrentGoal}
                onNegotiate={negotiateCurrentGoal}
                onAcceptNegotiated={acceptNegotiatedGoal}
                onBack={handleWizardBack}
              />
            )}
            {wizardStep === 3 && (
              <WizardStep3
                finalGoals={finalGoals}
                planType={wizardPlanType}
                onSign={signContract}
                saving={saving}
                onBack={handleWizardBack}
              />
            )}

            {/* S-02h Q19: Tilbage til forrige plan i renewal queue */}
            {isMultiRenewal && renewalQueueIdx > 0 && (
              <button
                onClick={() => {
                  const prevIdx = renewalQueueIdx - 1;
                  const prevPlan = renewalQueue[prevIdx];
                  setRenewalQueueIdx(prevIdx);
                  setWizardPlanType(prevPlan);
                  setWizardFocus(plans[prevPlan]?.board?.focus || "balanced");
                  setWizardStep(1);
                  setPreviewGoals([]);
                  setPreviewError("");
                  setNegotiated({});
                  setPendingNegotiate(false);
                }}
                className="mt-4 w-full py-2 text-sm text-cz-3 hover:text-cz-2 transition-colors">
                {t("wizard.backToPlan", { plan: getPlanLabel(t, renewalQueue[renewalQueueIdx - 1]) })}
              </button>
            )}

            {/* Luk wizard — ikke vist under setup eller første trin i multi-renewal */}
            {!wizardIsSetup && !(isMultiRenewal && renewalQueueIdx > 0) && (
              <button onClick={closeWizard}
                className="mt-4 w-full py-2 text-sm text-cz-3 hover:text-cz-2 transition-colors">
                {t("wizard.backToOverview")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* S-02h · GoalMiniDialog — klik på mål i dashboard-panel */}
      {goalMiniDialog && (
        <GoalMiniDialog
          goal={goalMiniDialog.goal}
          achieved={goalMiniDialog.achieved}
          evaluation={goalMiniDialog.evaluation}
          cumulativeProgress={goalMiniDialog.cumulativeProgress}
          onClose={() => setGoalMiniDialog(null)}
        />
      )}

      {/* #1030 · Medlem-portræt-dialog */}
      {memberDialog && (
        <BoardMemberDialog member={memberDialog} onClose={() => setMemberDialog(null)} />
      )}

      {/* #1030 · Klub-DNA-detalje-dialog */}
      {dnaDialogOpen && teamDna && (
        <ClubDnaDialog dna={teamDna} onClose={() => setDnaDialogOpen(false)} />
      )}
    </div>
  );
}
