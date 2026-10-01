// FatigueRulePanel — spillerens egne traeningsregler (#4854 + #5620, beta).
//
// #5932 (ejer-godkendt mockup 1/10, pin 5-6): under-fanen "Fatigue limit" paa
// Program-fanen. EET kort, ingen scroll:
//   1. Holdreglen paa een linje: "Team rule: above [65] run [Rest] instead".
//   2. Dagen efter en etape: foerste felt er aktiv restitution.
//   3. Undtagelser som chips; et tryk aabner rytterens linje, "+ Add" tilfoejer.
//   4. Seneste 7 dage som een linje, fold-ud viser hvem og hvorfor.
// Ingen gem-knap (og ingen ny gold): hver aendring gemmes med det samme, og en
// kort "Saved"-kvittering bekraefter det.
//
// Data kommer fra useFatigueRules (siden ejer det, fordi Today-fanen viser
// samme regel som een linje). Default slukket (G7): ingen raekke = ingen regel.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "../ui/icons/index.jsx";
import {
  FATIGUE_FALLBACKS, exceptionMode, isFallback, isThreshold, ridersOverLimit, stripDays, weekdayKey,
  type ExceptionMode, type FatigueFallback, type RecentHit, type RuleView,
} from "./FatigueRuleModel.ts";
import type { FatigueRulesClient } from "./useFatigueRules.ts";

const DEFAULT_THRESHOLD = 70;
const SAVED_MS = 2000;

const controlClass = "rounded-cz border border-cz-border bg-cz-card px-2 py-1 text-[13px] text-cz-1 disabled:opacity-50";
const labelClass = "font-data text-2xs font-semibold uppercase tracking-[.04em] text-cz-3";
const rowClass = "flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-cz-border px-4 py-2.5 first:border-t-0 sm:px-5";

// #6000: `groupExceptions` = gruppe-undtagelsernes chips (groups/GroupFatigueExceptions.tsx).
export default function FatigueRulePanel({ rules, className = "", groupExceptions = null }: {
  rules: FatigueRulesClient; className?: string; groupExceptions?: ReactNode;
}) {
  const { t } = useTranslation("training");
  const { data, busy, save } = rules;
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Holdreglens kladde (tallet gemmes ved blur/Enter, resten ved aendring).
  const [threshold, setThreshold] = useState<string>(String(DEFAULT_THRESHOLD));
  const team = data?.team ?? null;
  const limitOn = !!team && isThreshold(team.threshold) && isFallback(team.fallback);
  const savedThreshold = limitOn ? (team!.threshold as number) : DEFAULT_THRESHOLD;
  const fallback: FatigueFallback = limitOn ? (team!.fallback as FatigueFallback) : "rest";
  const afterStage = team?.recoveryAfterStage === true;
  useEffect(() => { setThreshold(String(savedThreshold)); }, [savedThreshold]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [stripOpen, setStripOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const roster = useMemo(() => data?.roster ?? [], [data?.roster]);
  const riderRules = useMemo(() => data?.riders ?? {}, [data?.riders]);
  const nameById = useMemo(() => new Map(roster.map((r) => [r.id, r.name])), [roster]);
  const days = useMemo(() => stripDays(data?.days ?? [], data?.recent ?? []), [data?.days, data?.recent]);

  if (!data?.enabled) return null;

  const activeDate = selectedDate ?? [...days].reverse().find((d) => d.riders.length > 0)?.date ?? null;
  const activeDay = days.find((d) => d.date === activeDate) ?? null;
  const thresholdNumber = threshold.trim() === "" ? NaN : Number(threshold);
  const thresholdValid = isThreshold(thresholdNumber);
  const overNow = ridersOverLimit(roster, team, riderRules);
  const exceptionIds = Object.keys(riderRules).filter((id) => nameById.has(id));
  const addable = roster.filter((r) => !exceptionIds.includes(r.id));
  const fallbackLabel = (value: string | null | undefined) => (isFallback(value) ? t(`fatigueRule.fallback_${value}`) : "");

  async function persist(path: string, body: unknown) {
    const ok = await save(path, body);
    setStatus(ok ? "saved" : "error");
    if (timer.current) clearTimeout(timer.current);
    if (ok) timer.current = setTimeout(() => setStatus(null), SAVED_MS);
    return ok;
  }

  function saveTeam(next: { on: boolean; threshold: number; fallback: FatigueFallback; afterStage: boolean }) {
    return persist("/team", {
      threshold: next.on ? next.threshold : null,
      fallback: next.on ? next.fallback : null,
      recoveryAfterStage: next.afterStage,
    });
  }

  function commitThreshold() {
    if (!limitOn || !thresholdValid || thresholdNumber === savedThreshold) return;
    saveTeam({ on: true, threshold: thresholdNumber, fallback, afterStage });
  }

  function saveException(riderId: string, mode: ExceptionMode, own?: { threshold: number; fallback: FatigueFallback }) {
    return persist(`/riders/${riderId}`, mode === "own" ? { mode, ...own } : { mode });
  }

  function chipText(id: string) {
    const rule = riderRules[id];
    const name = nameById.get(id) ?? "";
    return exceptionMode(rule) === "off"
      ? t("fatigueRule.chipOff", { name })
      : t("fatigueRule.chipOwn", { name, threshold: rule.threshold, fallback: fallbackLabel(rule.fallback) });
  }

  function reason(hit: RecentHit) {
    return hit.kind === "after_stage"
      ? t("fatigueRule.reason_after_stage", { fallback: fallbackLabel(hit.fallback) })
      : t("fatigueRule.reason_fatigue", { fatigue: hit.fatigue, threshold: hit.threshold, fallback: fallbackLabel(hit.fallback) });
  }

  return (
    <section
      className={`overflow-hidden rounded-cz border border-cz-border bg-cz-card ${className}`}
      data-testid="training-fatigue-rule"
    >
      <div className="flex items-start justify-between gap-3 border-b border-cz-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-cz-1">{t("fatigueRule.title")}</h2>
          <p className="mt-0.5 text-[12.5px] text-cz-2">{t("fatigueRule.dateStartNote")}</p>
        </div>
        <span role="status" aria-live="polite" className="flex-none text-xs" data-testid="fatigue-rule-status">
          {busy ? <span className="text-cz-3">{t("fatigueRule.saving")}</span>
            : status === "saved" ? <span className="text-cz-success">{t("fatigueRule.saved")}</span>
            : status === "error" ? <span className="text-cz-danger">{t("fatigueRule.error")}</span>
            : null}
        </span>
      </div>

      {/* ── 1. Holdreglen paa een linje ─────────────────────────────────── */}
      <div className={rowClass}>
        <label className="flex min-h-11 items-center gap-2 text-[13px] text-cz-1 sm:min-h-0">
          <input
            type="checkbox"
            checked={limitOn}
            disabled={busy || (!limitOn && !thresholdValid)}
            onChange={(e) => saveTeam({ on: e.target.checked, threshold: thresholdValid ? thresholdNumber : DEFAULT_THRESHOLD, fallback, afterStage })}
            className="h-4 w-4 accent-cz-1"
            data-testid="fatigue-rule-limit-toggle"
            aria-label={t("fatigueRule.useLimit")}
          />
          <span>{t("fatigueRule.teamRuleAbove")}</span>
        </label>
        <span className="flex min-w-0 basis-full items-center gap-2 text-[13px] text-cz-1 sm:basis-auto">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            value={threshold}
            disabled={busy}
            onChange={(e) => setThreshold(e.target.value)}
            onBlur={commitThreshold}
            onKeyDown={(e) => { if (e.key === "Enter") commitThreshold(); }}
            aria-label={t("fatigueRule.aboveLabel")}
            aria-invalid={!thresholdValid}
            className={`${controlClass} min-h-11 w-16 font-data tabular-nums sm:min-h-0`}
            data-testid="fatigue-rule-threshold"
          />
          <span>{t("fatigueRule.teamRuleRun")}</span>
          <select
            value={fallback}
            disabled={busy || !limitOn}
            onChange={(e) => saveTeam({ on: true, threshold: thresholdValid ? thresholdNumber : savedThreshold, fallback: e.target.value as FatigueFallback, afterStage })}
            aria-label={t("fatigueRule.insteadLabel")}
            className={`${controlClass} min-h-11 min-w-0 flex-1 sm:min-h-0 sm:flex-none`}
            data-testid="fatigue-rule-fallback"
          >
            {FATIGUE_FALLBACKS.map((f) => <option key={f} value={f}>{fallbackLabel(f)}</option>)}
          </select>
          <span className="flex-none">{t("fatigueRule.teamRuleInstead")}</span>
        </span>
        {limitOn && (
          <span className="basis-full font-data text-2xs tabular-nums text-cz-3 sm:ms-auto sm:basis-auto" data-testid="fatigue-rule-over-now">
            {t("fatigueRule.overNow", { count: overNow })}
          </span>
        )}
      </div>

      {/* ── 2. Dagen efter en etape ─────────────────────────────────────── */}
      <div className={rowClass}>
        <label className="flex min-h-11 items-center gap-2 text-[13px] text-cz-1 sm:min-h-0">
          <input
            type="checkbox"
            checked={afterStage}
            disabled={busy}
            onChange={(e) => saveTeam({ on: limitOn, threshold: limitOn && thresholdValid ? thresholdNumber : savedThreshold, fallback, afterStage: e.target.checked })}
            className="h-4 w-4 accent-cz-1"
            data-testid="fatigue-rule-after-stage"
          />
          {t("fatigueRule.afterStage")}
        </label>
      </div>

      {/* ── 3. Undtagelser som chips ────────────────────────────────────── */}
      <div className={rowClass}>
        <span className={`${labelClass} basis-full sm:basis-auto`}>{t("fatigueRule.exceptions")}</span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {exceptionIds.length === 0 && !adding && !groupExceptions && <span className="text-xs text-cz-3">{t("fatigueRule.exceptionsEmpty")}</span>}
          {groupExceptions}
          {exceptionIds.map((id) => (
            <button
              key={id}
              type="button"
              aria-expanded={openId === id}
              onClick={() => { setAdding(false); setOpenId((prev) => (prev === id ? null : id)); }}
              className={`min-h-11 rounded-cz-pill border px-2.5 text-xs tabular-nums sm:min-h-0 sm:py-0.5 ${
                openId === id ? "border-cz-1 bg-cz-subtle text-cz-1" : "border-cz-border text-cz-2 hover:bg-cz-subtle"
              }`}
              data-testid="fatigue-rule-exception"
            >
              {chipText(id)}
            </button>
          ))}
          {addable.length > 0 && (
            <button
              type="button"
              aria-expanded={adding}
              onClick={() => { setOpenId(null); setAdding((v) => !v); }}
              className="inline-flex min-h-11 items-center gap-1 rounded-cz-pill border border-cz-border px-2.5 text-xs text-cz-2 hover:bg-cz-subtle sm:min-h-0 sm:py-0.5"
              data-testid="fatigue-rule-add"
            >
              <PlusIcon size={11} aria-hidden="true" />
              {t("fatigueRule.add")}
            </button>
          )}
        </span>
        {adding && (
          <select
            value=""
            disabled={busy}
            autoFocus
            onChange={async (e) => {
              const id = e.target.value;
              if (!id) return;
              const ok = await saveException(id, "own", { threshold: DEFAULT_THRESHOLD, fallback: "recovery" });
              setAdding(false);
              if (ok) setOpenId(id);
            }}
            aria-label={t("fatigueRule.addException")}
            className={`${controlClass} min-h-11 w-full sm:min-h-0 sm:w-auto`}
            data-testid="fatigue-rule-add-rider"
          >
            <option value="">{t("fatigueRule.addException")}</option>
            {addable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        {openId && riderRules[openId] && (
          <ExceptionEditor
            key={`${openId}-${riderRules[openId].threshold}-${riderRules[openId].fallback}`}
            name={nameById.get(openId) ?? ""}
            rule={riderRules[openId]}
            busy={busy}
            fallbackLabel={fallbackLabel}
            onSave={async (mode, own) => {
              const ok = await saveException(openId, mode, own);
              if (ok && mode === "team") setOpenId(null);
            }}
          />
        )}
      </div>

      {/* ── 4. Seneste 7 dage som een linje med fold-ud ─────────────────── */}
      <div className={rowClass}>
        <button
          type="button"
          aria-expanded={stripOpen}
          onClick={() => setStripOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-start sm:min-h-0"
          data-testid="fatigue-rule-strip-toggle"
        >
          <span className={labelClass}>{t("fatigueRule.stripTitle")}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-data text-xs tabular-nums text-cz-2">
              {days.map((day, i) => (
                <span key={day.date}>
                  {i > 0 && " · "}
                  <span className={day.riders.length > 0 ? "font-semibold text-cz-1" : ""}>
                    {t(`weekday_${weekdayKey(day.date)}`).slice(0, 3)} {day.riders.length}
                  </span>
                </span>
              ))}
            </span>
            {stripOpen
              ? <ChevronDownIcon size={13} aria-hidden="true" className="flex-none text-cz-3" />
              : <ChevronRightIcon size={13} aria-hidden="true" className="flex-none text-cz-3" />}
          </span>
        </button>
        {stripOpen && (
          <div className="w-full">
            <ol className="grid grid-cols-7 gap-1" data-testid="fatigue-rule-strip">
              {days.map((day) => {
                const count = day.riders.length;
                const isActive = day.date === activeDate;
                return (
                  <li key={day.date}>
                    <button
                      type="button"
                      onClick={() => setSelectedDate(day.date)}
                      aria-pressed={isActive}
                      aria-label={`${t(`weekday_${weekdayKey(day.date)}`)} ${day.date}: ${t("fatigueRule.stripCount", { count })}`}
                      className={`flex min-h-11 w-full flex-col items-center justify-center rounded-cz border px-0.5 py-1 sm:min-h-0 ${
                        isActive ? "border-cz-1 bg-cz-subtle" : "border-cz-border hover:bg-cz-subtle"
                      }`}
                    >
                      <span className="font-data text-3xs uppercase text-cz-3">{t(`weekday_${weekdayKey(day.date)}`).slice(0, 3)}</span>
                      <span className={`font-data text-sm tabular-nums ${count > 0 ? "font-semibold text-cz-1" : "text-cz-3"}`}>{count}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="mt-2" aria-live="polite">
              {activeDay && activeDay.riders.length > 0 ? (
                <ul className="space-y-1">
                  {activeDay.riders.map(({ riderId, hits }) => (
                    <li key={riderId} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <span className="font-semibold text-cz-1">{nameById.get(riderId) ?? ""}</span>
                      <span className="text-cz-2 tabular-nums">{hits.map(reason).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-cz-3">{t("fatigueRule.stripEmpty")}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// Rytterens undtagelse: gemmes ved aendring (tallet ved blur/Enter).
function ExceptionEditor({
  name, rule, busy, fallbackLabel, onSave,
}: {
  name: string;
  rule: RuleView;
  busy: boolean;
  fallbackLabel: (value: string) => string;
  onSave: (mode: ExceptionMode, own?: { threshold: number; fallback: FatigueFallback }) => void;
}) {
  const { t } = useTranslation("training");
  const mode = exceptionMode(rule);
  const [threshold, setThreshold] = useState(String(rule.threshold ?? DEFAULT_THRESHOLD));
  const fallback: FatigueFallback = isFallback(rule.fallback) ? rule.fallback : "recovery";
  const thresholdNumber = threshold.trim() === "" ? NaN : Number(threshold);
  const valid = isThreshold(thresholdNumber);

  function commitThreshold() {
    if (mode !== "own" || !valid || thresholdNumber === rule.threshold) return;
    onSave("own", { threshold: thresholdNumber, fallback });
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-cz bg-cz-subtle px-2.5 py-2" data-testid="fatigue-rule-exception-editor">
      <span className="min-w-0 basis-full truncate text-[13px] font-semibold text-cz-1 sm:basis-auto">{name}</span>
      <select
        value={mode}
        disabled={busy}
        onChange={(e) => {
          const next = e.target.value as ExceptionMode;
          onSave(next, next === "own" ? { threshold: valid ? thresholdNumber : DEFAULT_THRESHOLD, fallback } : undefined);
        }}
        aria-label={name}
        className={`${controlClass} min-h-11 sm:min-h-0`}
      >
        {(["team", "own", "off"] as const).map((m) => <option key={m} value={m}>{t(`fatigueRule.mode_${m}`)}</option>)}
      </select>
      {mode === "own" && (
        <>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            value={threshold}
            disabled={busy}
            aria-label={t("fatigueRule.aboveLabel")}
            aria-invalid={!valid}
            onChange={(e) => setThreshold(e.target.value)}
            onBlur={commitThreshold}
            onKeyDown={(e) => { if (e.key === "Enter") commitThreshold(); }}
            className={`${controlClass} min-h-11 w-16 font-data tabular-nums sm:min-h-0`}
          />
          <select
            value={fallback}
            disabled={busy}
            aria-label={t("fatigueRule.insteadLabel")}
            onChange={(e) => onSave("own", { threshold: rule.threshold as number, fallback: e.target.value as FatigueFallback })}
            className={`${controlClass} min-h-11 sm:min-h-0`}
          >
            {FATIGUE_FALLBACKS.map((f) => <option key={f} value={f}>{fallbackLabel(f)}</option>)}
          </select>
        </>
      )}
    </div>
  );
}
