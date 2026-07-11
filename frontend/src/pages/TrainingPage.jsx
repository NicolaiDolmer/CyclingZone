// TrainingPage — daglig træning (#1305).
//
// Viser holdets træningsprogrammer (fokus + intensitet per rytter) + dagens
// kørsel-knap (med konsistens-bonus) + rapport fra seneste kørsel.
// Rytterliste hentes fra Supabase (samme kilde som TeamPage) da det er holdets
// egne ryttere vi træner. Condition/progress/todayRun serveres fra useTraining.

import { useState, useEffect, useMemo, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import RiderLink from "../components/RiderLink.jsx";
import RiderTypeBadge from "../components/rider/RiderTypeBadge.jsx";
import { useTraining } from "../lib/useTraining.js";
import { useTrainingHistory } from "../lib/useTrainingHistory.js";
import { TRAINING_FOCUS_KEYS, TRAINING_FOCUS_ABILITIES, TRAINING_INTENSITIES, injuryDaysLeft, WEEKDAY_KEYS, weekdayKeyForDate, resolveDayIntensityDisplay } from "../lib/training.js";
import { groupRidersByType, UNTYPED_KEY } from "../lib/trainingRoster.js";
import { focusProgress, daySummary, breakthroughJumps, isBreakthrough, NEAR_BREAKTHROUGH } from "../lib/trainingReport.js";
import TrainingHistory from "../components/training/TrainingHistory.jsx";
import SortTh from "../components/rider/RiderSortTh.jsx";
import { useSortState, sortRows } from "../lib/useTableSort.js";

// Roster-tabellen sorterer på navn/type (tekst, asc-først) + form/træthed (tal,
// desc-først: "hvem er mest træt/i bedst form?" med ét klik).
const ROSTER_DESC_FIRST = new Set(["form", "fatigue"]);

// Bred side — samme mønster som TeamPage / RidersPage.
// (Layout WIDE_CONTENT_ROUTES håndterer kun specific paths — vi bruger inline max-w)

function MiniBar({ value, color, label }) {
  // value = 0..100
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]" title={`${label}: ${pct}`}>
      <div className="flex-1 h-1.5 bg-cz-subtle rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-cz-3 w-6 text-right">{pct}</span>
    </div>
  );
}

// Progress mod næste +1 for en fokus-evne (anticipation). Baren bliver grøn ved
// NEAR_BREAKTHROUGH+ ("tæt på gennembrud"). info = { ability, pct } eller null (tom-tilstand).
function FocusProgress({ info, emptyLabel, tRider, toGoLabel }) {
  if (!info) {
    return <span className="text-cz-3 text-xs">{emptyLabel}</span>;
  }
  const near = info.pct >= NEAR_BREAKTHROUGH * 100;
  const abilityLabel = tRider(`racePreview.derived.${info.ability}`);
  return (
    <div className="min-w-[96px]" title={toGoLabel({ pct: 100 - info.pct, ability: abilityLabel })}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] text-cz-2 truncate">{abilityLabel}</span>
        <span className={`text-[10px] font-mono ${near ? "text-cz-success" : "text-cz-3"}`}>{info.pct}%</span>
      </div>
      <div className="h-1.5 bg-cz-subtle rounded-cz overflow-hidden">
        <div
          className={`h-full rounded-cz transition-all ${near ? "bg-cz-success" : "bg-cz-accent"}`}
          style={{ width: `${info.pct}%` }}
        />
      </div>
    </div>
  );
}

export default function TrainingPage() {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;

  const tTypes = useTranslation("riderTypes").t;

  const training = useTraining();
  const {
    enabled, todayRun, condition, progress, trainability, smartDefaultFocus, loading,
    savingId, running, bulkApplying, setPlan, setPlanBulk, clearPlan, planFor, runToday,
    weekPlan, savingWeekPlan, setWeekPlan, clearWeekPlan,
  } = training;

  // #1895 PR 1: dagens ugedag (display) + lokalt draft-state for ugerytme-panelet.
  const todayWeekday = useMemo(() => weekdayKeyForDate(new Date()), []);
  const [weekDraft, setWeekDraft] = useState(null); // null = ikke redigeret endnu (spejler weekPlan)
  const [weekPlanMsg, setWeekPlanMsg] = useState(null);
  const activeWeekDays = weekDraft ?? weekPlan;

  // Træningsrapport-historik (#1533): seneste 30 dages kørsler. Egen RLS-låst
  // SELECT-hook (training_day_runs), uafhængig af useTraining's /me-state.
  const history = useTrainingHistory();

  const [riders, setRiders] = useState([]);
  const [ridersLoading, setRidersLoading] = useState(true);
  const [runError, setRunError] = useState(null);

  // Gruppering + multi-select + bulk-apply (#1480).
  const [groupByType, setGroupByType] = useState(false);
  const rosterSort = useSortState({ descFirstKeys: ROSTER_DESC_FIRST });
  const [selected, setSelected] = useState(() => new Set()); // valgte rider-id'er
  const [bulkFocus, setBulkFocus] = useState("");
  const [bulkIntensity, setBulkIntensity] = useState("normal");
  const [bulkMsg, setBulkMsg] = useState(null); // { type: "ok" | "partial" | "warn", text }

  // Hent egne ryttere fra Supabase — samme mønster som TeamPage.
  useEffect(() => {
    async function loadRiders() {
      setRidersLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: myTeam } = await supabase
          .from("teams")
          .select("id")
          .eq("user_id", user.id)
          .single();
        if (!myTeam) return;
        const { data } = await supabase
          .from("riders")
          .select("id, firstname, lastname, primary_type, secondary_type")
          .eq("team_id", myTeam.id)
          .order("lastname");
        setRiders(data || []);
      } finally {
        setRidersLoading(false);
      }
    }
    loadRiders();
  }, []);

  async function handleRunToday() {
    setRunError(null);
    const result = await runToday();
    if (result && !result.ok) {
      setRunError(result.error || "failed");
    }
  }

  // #1895 PR 1: ugerytme-panel — flad "normal"-skabelon som redigerings-
  // udgangspunkt når holdet endnu ikke har en rytme (weekPlan === null).
  function flatWeekTemplate(intensity = "normal") {
    const days = {};
    for (const k of WEEKDAY_KEYS) days[k] = { intensity };
    return days;
  }

  function setWeekDraftDay(weekday, intensity) {
    setWeekDraft((prev) => ({ ...(prev ?? weekPlan ?? flatWeekTemplate()), [weekday]: { intensity } }));
  }

  async function handleSaveWeekPlan() {
    setWeekPlanMsg(null);
    const days = weekDraft ?? weekPlan ?? flatWeekTemplate();
    const result = await setWeekPlan(days);
    setWeekPlanMsg(result.ok
      ? { type: "ok", text: t("weekRhythmSaved") }
      : { type: "error", text: t("weekRhythmSaveFailed") });
    if (result.ok) setWeekDraft(null);
  }

  async function handleResetWeekPlan() {
    setWeekPlanMsg(null);
    const result = await clearWeekPlan();
    setWeekPlanMsg(result.ok
      ? { type: "ok", text: t("weekRhythmReset") }
      : { type: "error", text: t("weekRhythmSaveFailed") });
    if (result.ok) setWeekDraft(null);
  }

  // Dagens tick-tidspunkt i dansk lokaltid (created_at er UTC). null → vis label uden kl.
  function trainedTime() {
    const ts = todayRun?.created_at;
    if (!ts) return null;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Copenhagen",
    });
  }

  // Bestem hvilken trained-today label der vises (med klokkeslæt når det kendes).
  function trainedTodayLabel() {
    const by = todayRun?.executed_by;
    const who = by === "assistant" || by === "cron" ? "assistant" : "you";
    const time = trainedTime();
    return time ? t(`trainedTodayAt_${who}`, { time }) : t(`trainedToday_${who}`);
  }

  const today = new Date();

  const isLoading = loading || ridersLoading;

  // Dags-opsummering til rapportens payoff-stribe (trænede / gennembrud / topform).
  const summary = todayRun?.report ? daySummary(todayRun.report.riders) : null;

  // --- Gruppering + multi-select (#1480) ---
  // Antal kolonner i roster-tabellen (select + type + 7 oprindelige) — bruges til
  // colSpan på gruppe-header-rækker.
  const ROSTER_COLS = 9;

  // Accessors til roster-sortering. form/fatigue bor i condition-map'et (ikke på
  // rytteren), så closure over condition — useMemo holder referencen stabil pr.
  // condition-ændring så sorteringen ikke re-kører hver render.
  const rosterAccessors = useMemo(() => ({
    name: (r) => `${r.lastname ?? ""} ${r.firstname ?? ""}`.trim(),
    primary_type: (r) => r.primary_type ?? "",
    form: (r) => condition[r.id]?.form ?? null,
    fatigue: (r) => condition[r.id]?.fatigue ?? null,
  }), [condition]);
  const rosterAccessor = rosterSort.sort ? rosterAccessors[rosterSort.sort] : null;
  const sortRoster = (list) => sortRows(list, rosterAccessor, rosterSort.sortDir);

  // Vis enten flade rækker eller type-grupper. Begge bruger samme allerede-hentede
  // riders-array (ingen ny query) og den samme aktive sortering.
  const groups = groupByType ? groupRidersByType(riders) : null;

  const allSelected = riders.length > 0 && selected.size === riders.length;

  function toggleSelect(riderId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(riderId)) next.delete(riderId);
      else next.add(riderId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === riders.length ? new Set() : new Set(riders.map((r) => r.id))));
  }

  function clearSelection() {
    setSelected(new Set());
    setBulkMsg(null);
  }

  function groupLabel(type) {
    return type === UNTYPED_KEY ? t("untypedGroup") : tTypes(`types.${type}`);
  }

  // Én roster-række (genbruges af både flad liste og type-grupperet visning).
  function renderRosterRow(rider) {
    const plan = planFor(rider.id);
    const cond = condition[rider.id] ?? {};
    const daysLeft = injuryDaysLeft(cond.injured_until, today);
    const injured = daysLeft > 0;
    const highRisk = !injured && (cond.risk ?? 0) >= 0.05;
    const busy = savingId === rider.id || bulkApplying;
    const isSelected = selected.has(rider.id);
    // #1974: coarse type-derived trainability-signal — hvorfor et fokus ikke rykker.
    const riderTrainability = trainability[rider.id] ?? {};
    const currentTrainability = plan?.focus ? riderTrainability[plan.focus] : null;

    // #1895 PR 1: ren visning — dagens EFFEKTIVE intensitet ift. ugerytmen. Kun
    // relevant når rytteren har en plan (uden plan er der intet sæson-tal at
    // afvige fra). Sandheden bor i motoren; dette er blot en frontend-hint.
    const effectiveTodayIntensity = plan?.intensity
      ? resolveDayIntensityDisplay({ weekday: todayWeekday, teamWeekDays: weekPlan, planIntensity: plan.intensity })
      : null;
    const intensityDiffersToday = effectiveTodayIntensity != null && effectiveTodayIntensity !== plan.intensity;

    return (
      <tr key={rider.id} className={`border-b border-cz-border last:border-0 hover:bg-cz-subtle ${isSelected ? "bg-cz-accent/5" : ""}`}>
        {/* Multi-select */}
        <td className="px-4 py-3 w-8">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelect(rider.id)}
            aria-label={`${t("selectAll")} — ${rider.firstname} ${rider.lastname}`}
            className="accent-cz-accent"
          />
        </td>

        {/* Navn */}
        <td className="px-4 py-3">
          <RiderLink id={rider.id} className="text-cz-1 font-medium hover:text-cz-accent transition-colors">
            {rider.firstname} {rider.lastname}
          </RiderLink>
        </td>

        {/* Ryttertype */}
        <td className="px-4 py-3">
          <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} />
        </td>

        {/* Fokus */}
        <td className="px-4 py-3">
          <select
            value={plan?.focus ?? ""}
            disabled={busy}
            aria-label={`${tRider("training.focus")} — ${rider.firstname} ${rider.lastname}`}
            onChange={(e) => {
              const newFocus = e.target.value;
              if (!newFocus) return;
              setPlan(rider.id, newFocus, plan?.intensity ?? "normal");
            }}
            className="bg-cz-subtle border border-cz-border rounded px-2 py-1 text-xs text-cz-1 disabled:opacity-50 max-w-[130px]"
          >
            <option value="">—</option>
            {TRAINING_FOCUS_KEYS.map((k) => {
              const level = riderTrainability[k];
              const marker = level ? t(`trainability_${level}`) : "";
              return (
                <option key={k} value={k}>
                  {tRider(`training.focus_${k}`)}{marker ? ` (${marker})` : ""}
                </option>
              );
            })}
          </select>
          {plan?.focus && (
            <button
              type="button"
              onClick={() => clearPlan(rider.id)}
              disabled={busy}
              className="ms-1 text-[10px] text-cz-3 hover:text-cz-danger disabled:opacity-40"
              title={tRider("training.remove")}
            >
              ×
            </button>
          )}
          {/* #1894 variant 1: for ryttere UDEN plan, vis hvilket fokus assistenten
              rent faktisk træner dem med (backend-leveret, samme regel som bulk-
              smart-mode og dailyTraining.js' resolveProgram — INGEN frontend-dublet
              af type→fokus-mappingen). */}
          {!plan?.focus && smartDefaultFocus[rider.id] && (
            <div className="mt-0.5 text-[10px] text-cz-3">
              {t("smartFocusHint", { focus: tRider(`training.focus_${smartDefaultFocus[rider.id]}`) })}
            </div>
          )}
          {(currentTrainability === "limited" || currentTrainability === "blocked") && (
            <span
              className={`ms-1 inline-block text-[10px] px-1.5 py-0.5 rounded-full border ${
                currentTrainability === "blocked"
                  ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
                  : "bg-cz-warning/10 text-cz-warning border-cz-warning/20"
              }`}
              title={t(currentTrainability === "blocked" ? "trainabilityChipBlockedTitle" : "trainabilityChipLimitedTitle")}
            >
              {t(currentTrainability === "blocked" ? "trainabilityChipBlocked" : "trainabilityChipLimited")}
            </span>
          )}
        </td>

        {/* Intensitet */}
        <td className="px-4 py-3">
          {plan?.focus ? (
            <div
              role="group"
              aria-label={`${tRider("training.intensity")} — ${rider.firstname} ${rider.lastname}`}
              className="inline-flex rounded border border-cz-border overflow-hidden"
            >
              {TRAINING_INTENSITIES.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={busy}
                  onClick={() => setPlan(rider.id, plan.focus, k)}
                  aria-pressed={plan.intensity === k}
                  className={`text-xs px-2 py-1 transition-colors disabled:opacity-50 ${
                    plan.intensity === k
                      ? "bg-cz-accent text-white"
                      : "text-cz-2 hover:bg-cz-subtle"
                  }`}
                >
                  {tRider(`training.intensity_${k}`)}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-cz-3 text-xs">—</span>
          )}
          {intensityDiffersToday && (
            <div className="mt-0.5 text-[10px] text-cz-3">
              {t("weekRhythmTodayHint", { intensity: tRider(`training.intensity_${effectiveTodayIntensity}`) })}
            </div>
          )}
        </td>

        {/* Progress mod næste +1 (anticipation) */}
        <td className="px-4 py-3">
          <FocusProgress
            info={focusProgress(plan?.focus, progress[rider.id])}
            emptyLabel={t("noFocus")}
            tRider={tRider}
            toGoLabel={(o) => t("toGo", o)}
          />
        </td>

        {/* Form */}
        <td className="px-4 py-3">
          <MiniBar value={cond.form} color="bg-cz-info" label={t("form")} />
        </td>

        {/* Træthed */}
        <td className="px-4 py-3">
          <MiniBar value={cond.fatigue} color="bg-cz-warning" label={t("fatigue")} />
        </td>

        {/* Status: skadet / høj risiko */}
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {injured && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cz-danger-bg text-cz-danger border border-cz-danger/30">
                {daysLeft === 1
                  ? t("injured", { days: daysLeft })
                  : t("injured_plural", { days: daysLeft })}
              </span>
            )}
            {highRisk && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cz-warning/10 text-cz-warning border border-cz-warning/20">
                {t("injuryRisk")}
              </span>
            )}
          </div>
        </td>
      </tr>
    );
  }

  async function handleBulkApply() {
    setBulkMsg(null);
    if (!bulkFocus) {
      setBulkMsg({ type: "warn", text: t("bulkPickFocus") });
      return;
    }
    const ids = [...selected];
    if (ids.length === 0) return;
    const result = await setPlanBulk(ids, bulkFocus, bulkIntensity);
    // #1894 variant 3: smart-mode springer ryttere MED eksisterende plan over
    // (server-håndhævet — overskriver ALDRIG en managers eget valg). Det er en
    // forventet, ikke-fejlende delmængde, så den vises separat fra "failed".
    const skippedHasPlan = result.skippedHasPlan ?? [];
    if (result.failed.length === 0) {
      const text = skippedHasPlan.length > 0
        ? `${t("bulkApplied", { n: result.applied })} ${t("bulkSmartSkippedHasPlan", { n: skippedHasPlan.length })}`
        : t("bulkApplied", { n: result.applied });
      setBulkMsg({ type: skippedHasPlan.length > 0 ? "partial" : "ok", text });
      setSelected(new Set());
    } else {
      setBulkMsg({
        type: "partial",
        text: t("bulkPartial", { applied: result.applied, total: ids.length, failed: result.failed.length }),
      });
      // Behold de fejlede valgte, så brugeren kan prøve igen.
      setSelected(new Set(result.failed.map((f) => f.riderId)));
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
        <div className="flex items-center gap-3">
          {todayRun ? (
            <span className="text-sm text-cz-success font-medium">{trainedTodayLabel()}</span>
          ) : !enabled ? (
            <span className="text-sm text-cz-3 italic">{t("disabledNote")}</span>
          ) : (
            <span className="text-sm text-cz-3">{t("notTrainedYetToday")}</span>
          )}
          <button
            type="button"
            onClick={handleRunToday}
            disabled={!enabled || !!todayRun || running}
            className="px-4 py-2 rounded-lg bg-cz-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {running ? t("loading") : t("trainToday")}
          </button>
        </div>
      </div>

      {runError && (
        <p className="text-cz-danger text-sm">{runError}</p>
      )}

      {/* Tick-model-besked (#1936): når dagens træning er kørt, forklar at ændringer
          nu gælder fra i morgen + at form/træthed kun rykker ved det daglige tick.
          Fjerner "fokus blev ikke gemt"/"træthed fryser"-forvirringen. */}
      {todayRun && (
        <div className="bg-cz-accent/5 border border-cz-accent/20 rounded-cz px-4 py-2.5">
          <p className="text-sm text-cz-2 leading-relaxed">{t("tickModelDone")}</p>
        </div>
      )}

      {/* Daglig recovery-forklaring (#1676) — svarer "Får man energi tilbage hver dag?" */}
      <div className="bg-cz-subtle border border-cz-border rounded-cz px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-cz-2 mb-1">
          {t("recoveryNoteTitle")}
        </p>
        <p className="text-sm text-cz-3 leading-relaxed">{t("recoveryNote")}</p>
      </div>

      {/* Fokus-guide (#1908) — hvad træner hvert fokus. Svarer den gentagne spiller-
          forvirring ("Teknik = brosten? Aero = nedkørsel?"). Bygges fra den delte
          TRAINING_FOCUS_ABILITIES + eksisterende i18n, så det aldrig driver fra motoren. */}
      <details className="bg-cz-subtle border border-cz-border rounded-cz px-4 py-3">
        <summary className="text-xs font-semibold uppercase tracking-wide text-cz-2 cursor-pointer select-none">
          {t("focusGuideTitle")}
        </summary>
        <p className="text-sm text-cz-3 leading-relaxed mt-2">{t("focusGuideIntro")}</p>
        <ul className="mt-2 space-y-1">
          {TRAINING_FOCUS_KEYS.map((k) => (
            <li key={k} className="text-sm text-cz-2">
              <span className="font-medium text-cz-1">{tRider(`training.focus_${k}`)}:</span>{" "}
              <span className="text-cz-3">
                {(TRAINING_FOCUS_ABILITIES[k] ?? [])
                  .map((a) => tRider(`racePreview.derived.${a}`))
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-cz-3 leading-relaxed mt-2">{t("focusGuideIntensity")}</p>
        <p className="text-xs text-cz-3 leading-relaxed mt-2">{t("focusGuideGating")}</p>
      </details>

      {/* Ugentlig træningsrytme (#1895 PR 1) — holdets ønskede intensitet pr.
          ugedag. Rører ALDRIG fokus (bor kun i training_plans + smartDefaultFocus).
          Hold uden gemt rytme = flad "normal" hver dag = bit-identisk med i dag. */}
      <details className="bg-cz-subtle border border-cz-border rounded-cz px-4 py-3">
        <summary className="text-xs font-semibold uppercase tracking-wide text-cz-2 cursor-pointer select-none">
          {t("weekRhythmTitle")}
        </summary>
        <p className="text-sm text-cz-3 leading-relaxed mt-2">{t("weekRhythmIntro")}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          {WEEKDAY_KEYS.map((weekday) => {
            const current = (activeWeekDays ?? flatWeekTemplate())[weekday]?.intensity ?? "normal";
            return (
              <div key={weekday} className="flex flex-col items-center gap-1">
                <span className="text-[10px] uppercase text-cz-3">{t(`weekday_${weekday}`)}</span>
                <select
                  value={current}
                  disabled={savingWeekPlan}
                  aria-label={`${t("weekRhythmTitle")} — ${t(`weekday_${weekday}`)}`}
                  onChange={(e) => setWeekDraftDay(weekday, e.target.value)}
                  className="bg-cz-card border border-cz-border rounded px-2 py-1 text-xs text-cz-1 disabled:opacity-50"
                >
                  {TRAINING_INTENSITIES.map((k) => (
                    <option key={k} value={k}>{tRider(`training.intensity_${k}`)}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSaveWeekPlan}
            disabled={savingWeekPlan}
            className="px-3 py-1.5 rounded-lg bg-cz-accent text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {savingWeekPlan ? t("loading") : t("weekRhythmSave")}
          </button>
          {weekPlan && (
            <button
              type="button"
              onClick={handleResetWeekPlan}
              disabled={savingWeekPlan}
              className="text-xs text-cz-3 hover:text-cz-danger disabled:opacity-40"
            >
              {t("weekRhythmResetButton")}
            </button>
          )}
          {weekPlanMsg && (
            <span className={`text-xs ${weekPlanMsg.type === "ok" ? "text-cz-success" : "text-cz-danger"}`}>
              {weekPlanMsg.text}
            </span>
          )}
        </div>

        <p className="text-xs text-cz-3 leading-relaxed mt-2">{t("weekRhythmBonusNote")}</p>
      </details>

      {/* Roster-værktøjslinje: gruppér-toggle (#1480) */}
      {!isLoading && riders.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-cz-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={groupByType}
              onChange={(e) => setGroupByType(e.target.checked)}
              className="accent-cz-accent"
            />
            {t("groupByType")}
          </label>
        </div>
      )}

      {/* Bulk-apply bjælke — vises kun når ryttere er valgt (#1480) */}
      {!isLoading && selected.size > 0 && (
        <div className="bg-cz-card border border-cz-border rounded-cz px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-cz-1">{t("selected", { n: selected.size })}</span>

          <select
            value={bulkFocus}
            disabled={bulkApplying}
            aria-label={t("bulkSetFocus")}
            onChange={(e) => setBulkFocus(e.target.value)}
            className="bg-cz-subtle border border-cz-border rounded px-2 py-1 text-xs text-cz-1 disabled:opacity-50"
          >
            <option value="">{t("bulkSetFocus")}</option>
            <option value="smart">{t("bulkSmartFocusOption")}</option>
            {TRAINING_FOCUS_KEYS.map((k) => (
              <option key={k} value={k}>{tRider(`training.focus_${k}`)}</option>
            ))}
          </select>

          <div role="group" aria-label={t("bulkIntensity")} className="inline-flex rounded border border-cz-border overflow-hidden">
            {TRAINING_INTENSITIES.map((k) => (
              <button
                key={k}
                type="button"
                disabled={bulkApplying}
                onClick={() => setBulkIntensity(k)}
                aria-pressed={bulkIntensity === k}
                className={`text-xs px-2 py-1 transition-colors disabled:opacity-50 ${
                  bulkIntensity === k ? "bg-cz-accent text-white" : "text-cz-2 hover:bg-cz-subtle"
                }`}
              >
                {tRider(`training.intensity_${k}`)}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleBulkApply}
            disabled={bulkApplying || !bulkFocus}
            className="px-3 py-1.5 rounded-lg bg-cz-accent text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {bulkApplying ? t("bulkApplying") : t("bulkApply", { n: selected.size })}
          </button>

          <button
            type="button"
            onClick={clearSelection}
            disabled={bulkApplying}
            className="text-xs text-cz-3 hover:text-cz-1 disabled:opacity-40"
          >
            {t("bulkClear")}
          </button>

          {bulkMsg && (
            <span
              className={`text-xs ${
                bulkMsg.type === "ok" ? "text-cz-success" : bulkMsg.type === "partial" ? "text-cz-warning" : "text-cz-danger"
              }`}
            >
              {bulkMsg.text}
            </span>
          )}
        </div>
      )}

      {/* Rosterbord */}
      <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : riders.length === 0 ? (
          <div className="text-center py-10 text-cz-3 text-sm">{t("noRiders")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-sortable>
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-4 py-3 text-left w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label={t("selectAll")}
                      className="accent-cz-accent"
                    />
                  </th>
                  <SortTh sortKey="name" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                    className="px-4 py-3 text-left font-medium text-xs uppercase">
                    {t("colRider")}
                  </SortTh>
                  <SortTh sortKey="primary_type" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                    className="px-4 py-3 text-left font-medium text-xs uppercase">
                    {t("colType")}
                  </SortTh>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">
                    {tRider("training.focus")}
                  </th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">
                    {tRider("training.intensity")}
                  </th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">
                    {t("colNextUp")}
                  </th>
                  <SortTh sortKey="form" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                    className="px-4 py-3 text-left font-medium text-xs uppercase">
                    {t("form")}
                  </SortTh>
                  <SortTh sortKey="fatigue" sort={rosterSort.sort} sortDir={rosterSort.sortDir} onSort={rosterSort.handleSort}
                    className="px-4 py-3 text-left font-medium text-xs uppercase">
                    {t("fatigue")}
                  </SortTh>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">
                    {t("colStatus")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupByType
                  ? groups.map((group) => (
                      <Fragment key={group.type}>
                        <tr className="bg-cz-subtle/60 border-b border-cz-border">
                          <td colSpan={ROSTER_COLS} className="px-4 py-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-cz-2">
                              {groupLabel(group.type)}
                            </span>
                            <span className="ms-2 text-[11px] text-cz-3">
                              {t("groupCount", { n: group.riders.length })}
                            </span>
                          </td>
                        </tr>
                        {sortRoster(group.riders).map((rider) => renderRosterRow(rider))}
                      </Fragment>
                    ))
                  : sortRoster(riders).map((rider) => renderRosterRow(rider))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rapport fra seneste kørsel */}
      {todayRun?.report && (
        <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
          <div className="px-5 py-4 border-b border-cz-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-cz-1">{t("report")}</h2>
            {todayRun.bonus_applied && (
              <span className="text-xs px-2 py-0.5 rounded-cz bg-cz-accent/10 text-cz-accent border border-cz-accent/30">
                {t("bonusApplied")}
              </span>
            )}
          </div>

          {/* Dags-opsummering (payoff, holdniveau) */}
          <div className="grid grid-cols-3 divide-x divide-cz-border border-b border-cz-border">
            <div className="px-5 py-3">
              <div className="text-lg font-bold text-cz-1">
                {summary.trained}<span className="text-cz-3 text-sm font-normal"> / {summary.total}</span>
              </div>
              <div className="text-[11px] uppercase tracking-wide text-cz-3">{t("summaryTrained")}</div>
            </div>
            <div className="px-5 py-3">
              <div className={`text-lg font-bold ${summary.breakthroughs > 0 ? "text-cz-success" : "text-cz-1"}`}>
                {summary.breakthroughs}
              </div>
              <div className="text-[11px] uppercase tracking-wide text-cz-3">{t("summaryBreakthroughs")}</div>
            </div>
            <div className="px-5 py-3">
              <div className="text-lg font-bold text-cz-1">{summary.peakForm}</div>
              <div className="text-[11px] uppercase tracking-wide text-cz-3">{t("summaryPeakForm")}</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-sort-exempt="Per-koersel traeningsrapport i rapport-orden">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colRider")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{tRider("training.focus")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{tRider("training.intensity")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colNextUp")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colGains")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colResult")}</th>
                </tr>
              </thead>
              <tbody>
                {(todayRun.report.riders ?? []).map((row) => {
                  const jumps = breakthroughJumps(row);
                  const breakthrough = isBreakthrough(row);
                  const fatigueDelta = row.fatigue_delta ?? 0;
                  const fatigueSign = fatigueDelta > 0 ? "+" : "";
                  const prog = focusProgress(row.focus, progress[row.rider_id]);
                  return (
                    <tr
                      key={row.rider_id}
                      className={`border-b border-cz-border last:border-0 hover:bg-cz-subtle ${breakthrough ? "bg-cz-success-bg border-l-2 border-l-cz-success" : ""}`}
                    >
                      <td className="px-4 py-2.5">
                        <RiderLink id={row.rider_id} className="text-cz-1 font-medium hover:text-cz-accent transition-colors">
                          {row.name}
                        </RiderLink>
                        {row.injured && (
                          <span className="ms-2 text-[10px] px-1.5 py-0.5 rounded bg-cz-danger-bg text-cz-danger">
                            {row.injury_days === 1
                              ? t("injured", { days: row.injury_days })
                              : t("injured_plural", { days: row.injury_days })}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-cz-2">
                        {row.focus ? tRider(`training.focus_${row.focus}`) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-cz-2">
                        {row.intensity ? tRider(`training.intensity_${row.intensity}`) : "—"}
                      </td>
                      {/* Progress mod næste +1 (anticipation efter kørsel) */}
                      <td className="px-4 py-2.5">
                        <FocusProgress
                          info={prog}
                          emptyLabel={row.intensity === "rest" ? t("restDay") : t("noFocus")}
                          tRider={tRider}
                          toGoLabel={(o) => t("toGo", o)}
                        />
                      </td>
                      {/* Gevinster — gennembrud vist som faktisk tal-spring */}
                      <td className="px-4 py-2.5">
                        {jumps.length > 0 ? (
                          <span className="text-cz-success text-xs font-medium">
                            {jumps.map((j) => (
                              j.from != null && j.to != null
                                ? t("gainJump", { from: j.from, to: j.to, ability: tRider(`racePreview.derived.${j.ability}`) })
                                : t("gains", { n: j.n, ability: tRider(`racePreview.derived.${j.ability}`) })
                            )).join(", ")}
                          </span>
                        ) : (
                          <span className="text-cz-3 text-xs">{t("noGains")}</span>
                        )}
                      </td>
                      {/* Result — dagsform + trætheds-delta (erstatter rå score) */}
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          {row.status === "over" && (
                            <span className="text-cz-success text-xs">{t("sharpDay")}</span>
                          )}
                          {row.status === "under" && (
                            <span className="text-cz-danger text-xs">{t("flatDay")}</span>
                          )}
                          <span className={`text-[11px] font-mono ${fatigueDelta > 0 ? "text-cz-warning" : fatigueDelta < 0 ? "text-cz-success" : "text-cz-3"}`}>
                            {t("fatigueChange", { delta: `${fatigueSign}${fatigueDelta}` })}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Træningsrapport-historik (#1533) — seneste 30 dage */}
      <TrainingHistory history={history} />
    </div>
  );
}
