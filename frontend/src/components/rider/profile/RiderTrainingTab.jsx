// RiderTrainingTab — Træning-fanen (#2000 stykke 4).
//
// Spejler det ægte trænings-system (useTraining + lib/training.js +
// lib/trainingReport.js). Egen rytter: sæsonens kvittering pr. evne (#3709 trin
// 1), fokus-chips (sæt/skift fokus), intensitet (Hvile/Let/Normal/Hård), aktivt
// fokus, "hvert fokus træner …"-reference (fokus→evner), daglig træningslog
// (7 dage) og form & restitution. Fremmed rytter: låst kort (træning er skjult
// per spildesign).
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
import { TRAINING_FOCUS_ABILITIES, TRAINING_SETBACK_PCT, injuryDaysLeft } from "../../../lib/training.js";
import {
  riderHistoryFromRuns, breakthroughJumps, isBreakthrough,
  seasonAbilityGains, abilityReceipt,
} from "../../../lib/trainingReport.js";
import { ABILITY_CATEGORIES } from "../../../lib/abilities.js";
import { formatDate } from "../../../lib/intl.js";
import AbilityReceiptRow, { AbilityReceiptHeader } from "../../training/AbilityReceiptRow.jsx";
import FocusPanel from "../../training/FocusPanel.jsx";
import { dayTypeForProgram, sessionForProgram } from "../../../lib/trainingDayTypes.js";
import IconBase from "../../ui/icons/IconBase.jsx";
import { SkeletonLines } from "../../ui/Skeleton.jsx";

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
//
// #3721: fokus-chipsene og intensitets-segmentet er flyttet ind i det delte
// FocusPanel, så profilen og /training-rosteret vælger fokus på PRÆCIS samme
// flade. Kortet her er nu status ("hvad trænes han med lige nu") plus knappen
// der åbner panelet. "Hvert fokus træner …"-referencen er slettet: den stod som
// et opslagsværk et sted man ikke vælger noget, og står nu i panelets
// Træner-kolonne i det sekund valget træffes.
function FocusCard({ rider, training, t, onOpenPanel, actionError }) {
  // Dagstype-navnene bor i `training`-namespacet (samme kilde som panelet), så
  // profilen og /training ikke kan komme til at kalde den samme dag to ting.
  const { t: tTraining } = useTranslation("training");
  const { slots, planFor } = training;
  const plan = planFor(rider.id);
  const focus = plan?.focus ?? null;
  const intensity = plan?.intensity ?? "normal";
  // #3762: dagen udledes af det gemte par — også for en umigreret plan, så
  // kortet aldrig viser en tilstand modellen ikke tilbyder.
  const dayType = dayTypeForProgram(plan ?? null);
  const session = sessionForProgram(plan ?? null);

  const total = slots?.total ?? null; // null = ubegrænset (TRAINING_CONFIG.unlimitedSlots)
  const used = slots?.used ?? 0;

  const isRest = intensity === "rest";
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
          <span className="text-3xs text-cz-3">{t("profile.training.slotsUsed", { used, total })}</span>
        )}
      </div>

      {/* #3721: én knap i stedet for syv chips + et segment. Valget træffes i
          panelet, hvor hvert fokus står med hvad det træner ved siden af. */}
      <button
        type="button"
        onClick={onOpenPanel}
        className="mb-3 flex min-h-[44px] w-full items-center justify-between gap-3 rounded-cz border border-cz-border px-3 py-2 text-start transition-colors hover:border-cz-2/40 hover:bg-cz-subtle"
      >
        <span className="min-w-0">
          {/* #3762: kortet siger hvad det er for en DAG. Før stod der et
              fokusnavn med en intensitet under — to linjer der kunne modsige
              hinanden (fx "VO2max" over "Hvile", hvor motoren gav 0 vækst). */}
          <span className={`block truncate text-[13px] ${focus ? "font-semibold text-cz-1" : "text-cz-3"}`}>
            {focus ? tTraining(`dayPanel.dayType_${dayType}`) : t("profile.training.emptyFocus")}
          </span>
          {focus && session && (
            <span className="mt-0.5 block font-mono text-3xs uppercase tracking-[0.06em] text-cz-3">
              {tTraining(`dayPanel.session_${session}`)}
            </span>
          )}
        </span>
        <span className="flex-none text-2xs font-semibold text-cz-accent-t">
          {focus ? t("profile.training.changeFocus") : t("profile.training.chooseFocus")}
        </span>
      </button>

      {/* #2465: fejl-overflade for gem/ryd af fokus — tidligere tavs. */}
      {actionError && (
        <div role="alert" className="mb-[11px] px-2.5 py-1.5 rounded-cz border border-cz-danger/30 bg-cz-danger/10 text-2xs text-cz-danger">
          {t([`profile.training.actionErrors.${actionError}`, "profile.training.actionErrorGeneric"])}
        </div>
      )}

      {/* Aktivt fokus. Hvile = ingen vækst (egen gren); ellers hvad fokusset træner. */}
      <div className="border-t border-cz-border pt-[11px]">
        {!focus ? (
          <p className="text-[12px] text-cz-2 leading-snug">{t("profile.training.emptyFocus")}</p>
        ) : dayType === "recovery" ? (
          /* #3762: en restitutionsdag har ingen session, så "træner X med
             intensitet Y" ville være tomgang. Dagen forklarer sig selv. */
          <>
            <div className="flex items-center gap-2 mb-[7px]">
              <span className="text-cz-3 flex flex-none">
                <IconBase size={15}>{PENCIL_PATH}</IconBase>
              </span>
              <span className="text-[13px] text-cz-1 font-semibold">
                {tTraining("dayPanel.dayType_recovery")}
              </span>
            </div>
            <p className="mt-1 text-2xs text-cz-2 leading-snug">{tTraining("dayPanel.noSession_recovery")}</p>
          </>
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
            <p className="mt-1 text-2xs text-cz-2 leading-snug">{t("profile.training.restNote")}</p>
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
            {/* #3709 trin 1: den ene aggregerede progress-bar er væk herfra.
                Den viste ÉN af fokussets evner (den tættest på gennembrud), så
                en låst evne ved siden af var usynlig — rod-årsagen bag #3639 og
                #3649. Fremdriften står nu pr. evne i kvitteringen ovenfor, hvor
                den kan holdes op mod hvad rytteren faktisk fik i sæsonen. */}
            <p className="text-3xs text-cz-3">{t("profile.training.effectNote")}</p>
            <p className="mt-2 text-2xs text-cz-2 leading-snug">
              {risk > 0 ? t("profile.training.riskNote", { risk }) : t("profile.training.noRiskNote")}
            </p>
          </>
        )}

        {/* #3721: "Hvert fokus træner …"-referencen er slettet herfra. Den var
            det tredje sted den samme fokus→evne-tabel stod (de to andre var
            /training's accordion og selve valget), og den stod et sted man ikke
            vælger noget. Den lever nu i fokus-panelets Træner-kolonne. */}
      </div>
    </div>
  );
}

// ── Sæsonens kvittering (#3709 trin 1) ──────────────────────────────────────────
//
// Hovedleverancen på fanen: alle 15 synlige evner med hvad rytteren står på NU,
// hvor mange hele point han fik i DENNE SÆSON, og hvor langt han er mod næste
// point. En låst evne skriver "færdig" i stedet for en død bar.
//
// Hvad der IKKE er her: taget ("nu → tag" i spec §5.1). `ability_caps` forlader
// aldrig serveren (#1162), og patch note v7.119 lover spillerne at det præcise
// loft ikke kan aflæses på skærmen. Taget hører til trin 3.
//
// Kategori-grupperingen er den samme SSOT som Overblik-fanens evne-kolonner
// (lib/abilities.js → ABILITY_CATEGORIES), så de to flader viser evnerne i
// samme rækkefølge.
function SeasonReceiptCard({ rider, training, progress, trainingHistory, t }) {
  const { t: tTraining } = useTranslation("training");
  const { planFor, capped } = training;
  const focus = planFor(rider.id)?.focus ?? null;
  const focusAbilities = focus ? new Set(TRAINING_FOCUS_ABILITIES[focus] ?? []) : null;

  const seasonStart = trainingHistory?.seasonStart ?? null;
  const seasonGains = seasonAbilityGains(trainingHistory?.seasonRuns, rider.id, seasonStart);
  const rowsByAbility = Object.fromEntries(
    abilityReceipt(ABILITY_CATEGORIES.flatMap((c) => c.keys), {
      abilities: rider.abilities,
      progress,
      capped: capped?.[rider.id],
      seasonGains,
    }).map((row) => [row.ability, row]),
  );

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <div className="flex items-baseline justify-between gap-2 mb-[11px]">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
          {tTraining("receipt.title")}
        </h3>
        {seasonStart && (
          <span className="font-data text-3xs uppercase tracking-[.08em] text-cz-3">
            {tTraining("receipt.since", { date: formatDate(seasonStart) })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-[18px] gap-y-[13px]">
        {ABILITY_CATEGORIES.map((cat) => (
          <div key={cat.key} className="min-w-0">
            <span className="font-mono text-3xs font-bold uppercase tracking-[0.1em] text-cz-3">
              {t(`stats.categories.${cat.key}`)}
            </span>
            <div className="mt-[5px]">
              <AbilityReceiptHeader />
              {cat.keys.map((key) => (
                <AbilityReceiptRow
                  key={key}
                  row={rowsByAbility[key]}
                  inFocus={!!focusAbilities?.has(key)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 pt-2.5 border-t border-cz-border text-3xs text-cz-3 leading-snug">
        {seasonStart ? tTraining("receipt.note") : tTraining("receipt.pending")}
      </p>
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
              <span className="font-mono text-2xs text-cz-3 flex-none w-[42px]">{dayLabel(tick_date, t)}</span>
              <span className="text-[12px] text-cz-1 flex-1 min-w-0 truncate">
                {focusLabel}
                <span className="text-cz-3"> · {intensityLabel}</span>
              </span>
              <span className={`text-2xs flex-none text-right ${resultClass}`}>{result}</span>
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
    <div className="bg-cz-card border border-cz-border border-l-2 border-l-cz-border rounded-cz py-[15px] px-[17px]">
      <span className="font-mono text-3xs font-bold uppercase tracking-[0.12em] text-cz-accent-t">
        {t("profile.training.trend.title")}
      </span>
      <div className="grid grid-cols-3 gap-2 mt-2.5">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <div className="font-mono tabular-nums text-2xl font-bold leading-none text-cz-1">{tile.value}</div>
            <div className="text-3xs text-cz-3 mt-1.5 leading-tight">{tile.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 pt-2.5 border-t border-cz-border text-3xs text-cz-3 leading-snug">
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
            <span className="inline-flex items-center text-2xs px-2.5 py-1 rounded-full bg-cz-danger-bg border border-cz-danger/25 text-cz-danger">
              {t("condition.injured", { days })}
            </span>
          ) : (
            <>
              <span className="inline-flex items-center text-2xs px-2.5 py-1 rounded-full bg-cz-success-bg border border-cz-success/25 text-cz-success">
                {t("profile.training.form.healthy")}
              </span>
              <span className="text-2xs text-cz-3">{t("profile.training.form.healthyHint")}</span>
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

  // #3721: fokus-panelet. Hooks skal stå FØR de tidlige returns nedenfor
  // (låst/pensioneret/loading), ellers ændrer hook-rækkefølgen sig mellem
  // renders og React fejler.
  const [panelOpen, setPanelOpen] = useState(false);
  // #2465: setPlan/clearPlan returnerer eksplicit {ok, error} — en fejl
  // (udløbet session, netværk, backend-afvisning) skal vises, ikke forsvinde.
  const [actionError, setActionError] = useState(null);

  async function handlePanelSave(dayType, session) {
    setActionError(null);
    const result = await training.setPlan(rider.id, dayType, session);
    if (result && !result.ok) setActionError(result.error || "failed");
    else setPanelOpen(false);
  }
  async function handlePanelClear() {
    setActionError(null);
    const result = await training.clearPlan(rider.id);
    if (result && !result.ok) setActionError(result.error || "failed");
    else setPanelOpen(false);
  }

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
      <div className="bg-cz-card border border-cz-border rounded-cz p-5" role="status" aria-label={t("profile.training.loading")}>
        <SkeletonLines lines={4} />
      </div>
    );
  }

  const runs = trainingHistory?.runs ?? [];
  const condition = training.condition?.[rider.id] ?? null;
  const plan = training.planFor(rider.id);

  return (
    <div className="flex flex-col gap-[13px]">
      {/* #3709 trin 1: kvitteringen står øverst. "Det der fylder mest skal være
          dét rytteren fik" — en kvittering kan ikke være løgn, en forudsigelse
          kan (spec §5, docs/superpowers/specs/2026-08-14-3659-...). */}
      <SeasonReceiptCard
        rider={rider}
        training={training}
        progress={progress}
        trainingHistory={trainingHistory}
        t={t}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[13px] items-start">
        <div className="flex flex-col gap-[13px] min-w-0">
          <FocusCard
            rider={rider}
            training={training}
            t={t}
            actionError={actionError}
            onOpenPanel={() => setPanelOpen(true)}
          />
          <DailyLogCard riderId={rider.id} runs={runs} t={t} />
        </div>
        <div className="flex flex-col gap-[13px] min-w-0">
          <TrendCard riderId={rider.id} runs={runs} t={t} />
          <FormCard condition={condition} t={t} />
        </div>
      </div>

      {/* #3721: samme panel som /training-rosteret bruger — én komponent, så de
          to flader ikke kan sige forskellige ting om samme rytter. `perSeason`
          sendes ikke: trin 4 (#3741) er ikke merget, og panelet udelader
          kolonnen frem for at vise et opfundet tal. */}
      <FocusPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        rider={rider}
        badges={[rider.is_academy && "academy", injuryDaysLeft(condition?.injured_until ?? null) > 0 && "injured"]}
        focus={plan?.focus ?? null}
        intensity={plan?.intensity ?? "normal"}
        trainability={training.trainability?.[rider.id] ?? null}
        assistantFocus={training.smartDefaultFocus?.[rider.id] ?? null}
        saving={training.savingId === rider.id}
        error={actionError}
        onSave={handlePanelSave}
        onClear={handlePanelClear}
      />
    </div>
  );
}
