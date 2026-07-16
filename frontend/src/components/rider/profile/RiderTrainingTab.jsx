// RiderTrainingTab — Træning-fanen (#2000 stykke 4).
//
// Spejler det ægte trænings-system (useTraining + lib/training.js +
// lib/trainingReport.js). Egen rytter: fokus-chips (sæt/skift fokus), intensitet
// (Hvile/Let/Normal/Hård), aktivt fokus + progress mod næste +1, "hvert fokus
// træner …"-reference (fokus→evner), daglig træningslog (7 dage) og form &
// restitution. Fremmed rytter: låst kort (træning er skjult per spildesign).
//
// ÆGTE data — intet opfundet. Slot-tælleren skjules når slots.total === null
// (daglig træning = ubegrænsede programmer, TRAINING_CONFIG.unlimitedSlots).
// "Træningsscore 0-100" er BEVIDST udskudt (ejer-beslutning #2000): den rå
// daglige score er en lille float som UI'et allerede skjuler, og et 0-100-
// sammenligningstal er balance-følsomt (kræver harness + ejer-review, som
// Scouting). Midlertidigt viser højre kolonne en ærlig 30-dages trænings-trend.
//
// Token-only (ingen rå hex); dark mode via tokens; interaktive kontroller har
// 44px hit-target + aria-pressed. i18n under profile.training.* i rider.json.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TRAINING_FOCUS_KEYS, TRAINING_FOCUS_ABILITIES, TRAINING_INTENSITIES,
  TRAINING_SETBACK_PCT, injuryDaysLeft,
} from "../../../lib/training.js";
import {
  focusProgress, riderHistoryFromRuns, breakthroughJumps, isBreakthrough,
} from "../../../lib/trainingReport.js";
import IconBase from "../../ui/icons/IconBase.jsx";

const LOG_DAYS = 7;

const PENCIL_PATH = (
  <>
    <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17z" />
    <path d="M14 7l3 3" />
  </>
);
const LOCK_PATH = (
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>
);

// Hele kalenderdage mellem en "YYYY-MM-DD" tick_date og i dag (sammenlign rene
// kalenderdage, så tidszone ikke flytter en dag). null = uparselig dato.
function dayDiff(tickDate) {
  if (!tickDate) return null;
  const [y, m, d] = String(tickDate).split("-").map(Number);
  if (!y || !m || !d) return null;
  const then = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - then) / 86_400_000);
}

// Relativ dag-label. 0 ⇒ "I dag", ellers "−Nd".
function dayLabel(tickDate, t) {
  const diff = dayDiff(tickDate);
  if (diff == null) return tickDate || "—";
  return diff <= 0 ? t("profile.training.log.today") : `−${diff}d`;
}

function formColor(form) {
  if (form >= 70) return "text-cz-success";
  if (form >= 40) return "text-cz-1";
  return "text-cz-danger";
}
function fatigueColor(fatigue) {
  if (fatigue >= 70) return "text-cz-danger";
  if (fatigue >= 40) return "text-cz-1";
  return "text-cz-success";
}

// ── Fokus + intensitet + aktivt fokus ───────────────────────────────────────────
function FocusCard({ rider, training, progress, t }) {
  const { slots, planFor, setPlan, clearPlan, savingId } = training;
  const plan = planFor(rider.id);
  const focus = plan?.focus ?? null;
  const intensity = plan?.intensity ?? "normal";
  const busy = savingId === rider.id;

  const total = slots?.total ?? null; // null = ubegrænset (TRAINING_CONFIG.unlimitedSlots)
  const used = slots?.used ?? 0;

  // #2465: setPlan/clearPlan returnerer eksplicit {ok, error} — kaldes nu async +
  // await'et, så en fejl (udløbet session, netværk, backend-afvisning) vises i
  // stedet for at forsvinde stille (chippen opdaterede tidligere KUN ved success).
  const [actionError, setActionError] = useState(null);

  // Enkelt-valg med toggle: klik på det aktive fokus rydder planen (frigør slottet).
  const pickFocus = async (f) => {
    if (busy) return;
    setActionError(null);
    const result = focus === f ? await clearPlan(rider.id) : await setPlan(rider.id, f, intensity);
    if (result && !result.ok) setActionError(result.error || "failed");
  };
  const pickIntensity = async (i) => {
    if (busy || !focus) return;
    setActionError(null);
    const result = await setPlan(rider.id, focus, i);
    if (result && !result.ok) setActionError(result.error || "failed");
  };

  const isRest = intensity === "rest";
  const fp = focus && !isRest ? focusProgress(focus, progress) : null;
  const fpVal = fp ? rider.abilities?.[fp.ability] : null;
  const abilitiesLabel = focus
    ? TRAINING_FOCUS_ABILITIES[focus].map((a) => t(`racePreview.derived.${a}`)).join(" + ")
    : null;
  const risk = TRAINING_SETBACK_PCT[intensity] ?? 0;

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <div className="flex items-baseline justify-between gap-2 mb-[11px]">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
          {t("profile.training.title")}
        </h3>
        {total != null && (
          <span className="text-[10.5px] text-cz-3">{t("profile.training.slotsUsed", { used, total })}</span>
        )}
      </div>

      {/* Fokus-chips (enkelt-valg, aria-pressed). Aktiv = guld; inaktiv = stiplet. */}
      <div className="flex flex-wrap gap-[7px] mb-3">
        {TRAINING_FOCUS_KEYS.map((f) => {
          const on = focus === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => pickFocus(f)}
              disabled={busy}
              aria-pressed={on}
              className={`inline-flex items-center min-h-[44px] px-[13px] rounded-full text-[12px] transition-colors disabled:opacity-50 ${
                on
                  ? "border border-cz-accent bg-cz-accent/15 text-cz-accent-t font-semibold"
                  : "border border-dashed border-cz-border text-cz-3 hover:text-cz-2 hover:border-cz-2/40"
              }`}
            >
              {t(`profile.training.focus.${f}`)}
            </button>
          );
        })}
      </div>

      {/* Intensitet (segmenteret). Kræver et valgt fokus for at kunne sættes. */}
      <div className="flex items-center gap-2.5 mb-[11px]">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-cz-3 flex-none">
          {t("training.intensity")}
        </span>
        <div className="inline-flex gap-0.5 bg-cz-subtle border border-cz-border rounded-lg p-[3px]">
          {TRAINING_INTENSITIES.map((i) => {
            const on = intensity === i && !!focus;
            return (
              <button
                key={i}
                type="button"
                onClick={() => pickIntensity(i)}
                disabled={busy || !focus}
                aria-pressed={on}
                className={`min-h-[44px] px-3 rounded-[6px] text-[11.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  on ? "bg-cz-card text-cz-1 shadow-sm" : "text-cz-3 hover:text-cz-2"
                }`}
              >
                {t(`training.intensity_${i}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* #2465: fejl-overflade for pickFocus/pickIntensity — tidligere tavs. */}
      {actionError && (
        <div role="alert" className="mb-[11px] px-2.5 py-1.5 rounded-cz border border-cz-danger/30 bg-cz-danger/10 text-[11px] text-cz-danger">
          {t([`profile.training.actionErrors.${actionError}`, "profile.training.actionErrorGeneric"])}
        </div>
      )}

      {/* Aktivt fokus. Hvile = ingen vækst (egen gren); ellers progress mod næste +1. */}
      <div className="border-t border-cz-border pt-[11px]">
        {!focus ? (
          <p className="text-[12px] text-cz-2 leading-snug">{t("profile.training.emptyFocus")}</p>
        ) : isRest ? (
          <>
            <div className="flex items-center gap-2 mb-[7px]">
              <span className="text-cz-3 flex flex-none">
                <IconBase size={15}>{PENCIL_PATH}</IconBase>
              </span>
              <span className="text-[13px] text-cz-1 font-semibold">
                {t("profile.training.activeRest", { focus: t(`profile.training.focus.${focus}`) })}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-cz-2 leading-snug">{t("profile.training.restNote")}</p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-[7px]">
              <span className="text-cz-accent-t flex flex-none">
                <IconBase size={15}>{PENCIL_PATH}</IconBase>
              </span>
              <span className="text-[13px] text-cz-1 font-semibold">
                {t("profile.training.active", {
                  focus: t(`profile.training.focus.${focus}`),
                  intensity: t(`training.intensity_${intensity}`),
                  abilities: abilitiesLabel,
                })}
              </span>
            </div>
            <div className="relative h-[7px] bg-cz-subtle rounded-full" aria-hidden="true">
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-cz-accent/85 transition-[width] duration-500"
                style={{ width: `${fp?.pct ?? 0}%` }}
              />
            </div>
            <div className="flex justify-between gap-2 mt-1.5">
              <span className="text-[10.5px] text-cz-3">
                {fp && fpVal != null
                  ? t("profile.training.progressTo", {
                      ability: t(`racePreview.derived.${fp.ability}`),
                      from: fpVal, to: fpVal + 1, pct: fp.pct,
                    })
                  : t("profile.training.progressPending")}
              </span>
              <span className="text-[10.5px] text-cz-3 flex-none">{t("profile.training.effectNote")}</span>
            </div>
            <p className="mt-2 text-[11px] text-cz-2 leading-snug">
              {risk > 0 ? t("profile.training.riskNote", { risk }) : t("profile.training.noRiskNote")}
            </p>
          </>
        )}

        {/* "Hvert fokus træner …" — fokus → evner (altid synlig som reference). */}
        <div className="mt-[11px] pt-2.5 border-t border-cz-border">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-cz-3">
            {t("profile.training.focusRefTitle")}
          </span>
          <div className="grid grid-cols-2 gap-x-[14px] gap-y-1 mt-[7px]">
            {TRAINING_FOCUS_KEYS.map((f) => (
              <div key={f} className="flex justify-between gap-2">
                <span className="text-[11px] text-cz-1 font-semibold">{t(`profile.training.focus.${f}`)}</span>
                <span className="text-[10.5px] text-cz-3 text-right">
                  {TRAINING_FOCUS_ABILITIES[f].map((a) => t(`racePreview.derived.${a}`)).join(" · ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Daglig træningslog (sidste 7 dage) ──────────────────────────────────────────
function DailyLogCard({ riderId, runs, t }) {
  // Kun dage inden for de sidste 7 KALENDERDAGE, så overskriften er sand selv for
  // en nyligt købt rytter der ikke indgik i hver dags kørsel.
  const entries = riderHistoryFromRuns(runs, riderId)
    .filter(({ tick_date }) => { const d = dayDiff(tick_date); return d != null && d >= 0 && d <= LOG_DAYS - 1; })
    .slice(0, LOG_DAYS);
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-[9px]">
        {t("profile.training.log.title")}
      </h3>
      {entries.length === 0 ? (
        <p className="text-[12px] text-cz-3 py-1">{t("profile.training.log.empty")}</p>
      ) : (
        entries.map(({ tick_date, row }) => {
          const isRest = !row.intensity || row.intensity === "rest";
          const jumps = breakthroughJumps(row);
          const focusLabel = row.focus ? t(`profile.training.focus.${row.focus}`) : "—";
          const intensityLabel = t(`training.intensity_${isRest ? "rest" : row.intensity}`);
          let result;
          let resultClass = "text-cz-3";
          if (jumps.length === 1) {
            const j = jumps[0];
            result = j.from != null && j.to != null
              ? `${j.from}→${j.to} ${t(`racePreview.derived.${j.ability}`)}`
              : `+${j.n} ${t(`racePreview.derived.${j.ability}`)}`;
            resultClass = "text-cz-success";
          } else if (jumps.length > 1) {
            // Flere evner samme dag: opsummér så den kompakte række ikke flyder over.
            result = t("profile.training.log.gains", { count: jumps.reduce((s, j) => s + j.n, 0) });
            resultClass = "text-cz-success";
          } else if (row.status === "over") {
            result = t("profile.training.log.sharp");
            resultClass = "text-cz-success";
          } else if (row.status === "under") {
            result = t("profile.training.log.flat");
          } else {
            result = "—";
          }
          return (
            <div key={tick_date} className="flex items-center gap-[11px] py-2 border-t border-cz-border">
              <span className="font-mono text-[11px] text-cz-3 flex-none w-[42px]">{dayLabel(tick_date, t)}</span>
              <span className="text-[12px] text-cz-1 flex-1 min-w-0 truncate">
                {focusLabel}
                <span className="text-cz-3"> · {intensityLabel}</span>
              </span>
              <span className={`text-[11px] flex-none text-right ${resultClass}`}>{result}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── 30-dages trænings-trend (midlertidig erstatning for Træningsscore) ───────────
function TrendCard({ riderId, runs, t }) {
  const entries = riderHistoryFromRuns(runs, riderId);
  let trained = 0, breakthroughs = 0, sharp = 0;
  for (const { row } of entries) {
    if (!row.injured && row.intensity && row.intensity !== "rest") trained++;
    if (isBreakthrough(row)) breakthroughs++;
    if (row.status === "over") sharp++;
  }
  const tiles = [
    { value: trained, label: t("profile.training.trend.trained") },
    { value: breakthroughs, label: t("profile.training.trend.breakthroughs") },
    { value: sharp, label: t("profile.training.trend.sharp") },
  ];
  return (
    <div className="bg-cz-card border border-cz-border border-l-2 border-l-cz-accent rounded-cz py-[15px] px-[17px]">
      <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-cz-accent-t">
        {t("profile.training.trend.title")}
      </span>
      <div className="grid grid-cols-3 gap-2 mt-2.5">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <div className="font-mono tabular-nums text-2xl font-bold leading-none text-cz-1">{tile.value}</div>
            <div className="text-[10px] text-cz-3 mt-1.5 leading-tight">{tile.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 pt-2.5 border-t border-cz-border text-[10.5px] text-cz-3 leading-snug">
        {t("profile.training.trend.note")}
      </p>
    </div>
  );
}

// ── Form & restitution ──────────────────────────────────────────────────────────
function FormCard({ condition, t }) {
  const clamp = (n) => Math.max(0, Math.min(100, n));
  // Ingen condition-rad (fx friskkøbt rytter før første kørsel) → pending-tilstand,
  // ikke fabrikerede 50/0-defaults præsenteret som målte værdier.
  if (!condition) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-[9px]">
          {t("profile.training.form.title")}
        </h3>
        <p className="text-[12px] text-cz-3 py-1">{t("profile.training.form.pending")}</p>
      </div>
    );
  }
  const form = condition.form ?? 0;
  const fatigue = condition.fatigue ?? 0;
  const days = injuryDaysLeft(condition.injured_until ?? null);
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-[9px]">
        {t("profile.training.form.title")}
      </h3>
      <div className="flex flex-col gap-[11px]">
        <div>
          <div className="flex justify-between mb-1.5">
            <span className="text-[12px] text-cz-2">{t("condition.form")}</span>
            <span className={`font-mono font-bold text-[13px] ${formColor(form)}`}>{form}</span>
          </div>
          <div className="relative h-1.5 bg-cz-subtle rounded-full" aria-hidden="true">
            <div className="absolute left-0 top-0 h-full rounded-full bg-cz-success/80" style={{ width: `${clamp(form)}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between mb-1.5">
            <span className="text-[12px] text-cz-2">{t("condition.fatigue")}</span>
            <span className={`font-mono font-bold text-[13px] ${fatigueColor(fatigue)}`}>{fatigue}</span>
          </div>
          <div className="relative h-1.5 bg-cz-subtle rounded-full" aria-hidden="true">
            <div className="absolute left-0 top-0 h-full rounded-full bg-cz-warning/80" style={{ width: `${clamp(fatigue)}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          {days > 0 ? (
            <span className="inline-flex items-center text-[11px] px-2.5 py-1 rounded-full bg-cz-danger-bg border border-cz-danger/25 text-cz-danger">
              {t("condition.injured", { days })}
            </span>
          ) : (
            <>
              <span className="inline-flex items-center text-[11px] px-2.5 py-1 rounded-full bg-cz-success-bg border border-cz-success/25 text-cz-success">
                {t("profile.training.form.healthy")}
              </span>
              <span className="text-[11px] text-cz-3">{t("profile.training.form.healthyHint")}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Centreret info-kort (scouting-lås / pensioneret) ─────────────────────────────
function NoticeCard({ title, body }) {
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz px-6 py-10 text-center">
      <span className="text-cz-3 inline-flex">
        <IconBase size={26} strokeWidth={1.7}>{LOCK_PATH}</IconBase>
      </span>
      <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 mt-[11px] mb-[5px]">{title}</h3>
      <p className="text-[12.5px] text-cz-2 max-w-[42ch] mx-auto leading-relaxed">{body}</p>
    </div>
  );
}

export default function RiderTrainingTab({ rider, training, trainingHistory, progress = {}, viewer = "own", isRetired = false }) {
  const { t } = useTranslation("rider");

  if (viewer !== "own") {
    return <NoticeCard title={t("profile.training.locked.title")} body={t("profile.training.locked.body")} />;
  }
  if (isRetired) {
    return <NoticeCard title={t("profile.training.retired.title")} body={t("profile.training.retired.body")} />;
  }

  // Vent på trænings-state før vi tegner kort — ellers ville den korte load-vindue
  // vise misvisende tom-/default-tilstande (fokus ikke sat, 0/0/0, form-defaults).
  if (training.loading || trainingHistory?.loading) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5 flex items-center justify-center py-10">
        <div className="w-5 h-5 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" aria-label={t("profile.training.loading")} />
      </div>
    );
  }

  const runs = trainingHistory?.runs ?? [];
  const condition = training.condition?.[rider.id] ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-[13px] items-start">
      <div className="flex flex-col gap-[13px] min-w-0">
        <FocusCard rider={rider} training={training} progress={progress} t={t} />
        <DailyLogCard riderId={rider.id} runs={runs} t={t} />
      </div>
      <div className="flex flex-col gap-[13px] min-w-0">
        <TrendCard riderId={rider.id} runs={runs} t={t} />
        <FormCard condition={condition} t={t} />
      </div>
    </div>
  );
}
