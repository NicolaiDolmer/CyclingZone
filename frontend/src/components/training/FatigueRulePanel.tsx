// FatigueRulePanel — spillerens egne traeningsregler (#4854 + #5620, beta).
//
// Selvstaendig: henter og gemmer selv via /api/training/fatigue-rules, saa siden
// kun skal montere den (TrainingPage roerer ikke reglernes data). Serveren afgoer
// om funktionen findes for viewereren (stadie-flaget `training_fatigue_rules`);
// `enabled` false = panelet renderer intet.
//
// Tre dele, mobil foerst:
//   1. Holdreglen: "over traethed X: koer <pas> i stedet" + "dagen efter en etape:
//      foerste felt er aktiv restitution". Default slukket (G7).
//   2. Undtagelser pr. rytter: foelg holdet / egen graense / ingen graense.
//   3. Ugestriben: de seneste 7 datoer, hvilke ryttere reglen slog til for og hvorfor.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../ui/Button.jsx";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";
import {
  FATIGUE_FALLBACKS, effectiveLimit, exceptionMode, isFallback, isThreshold, ridersOverLimit, stripDays, weekdayKey,
  type ExceptionMode, type FatigueFallback, type FatigueRulesResponse, type RecentHit, type RuleView,
} from "./FatigueRuleModel.ts";

const BASE = "/api/training/fatigue-rules";
const DEFAULT_THRESHOLD = 70;

const inputClass = "w-full rounded-cz border border-cz-border bg-cz-card px-2.5 py-1.5 text-sm text-cz-1 disabled:opacity-50";
const labelClass = "font-data text-2xs font-semibold uppercase tracking-[.04em] text-cz-3";

export default function FatigueRulePanel({ className = "" }: { className?: string }) {
  const { t } = useTranslation("training");
  const [data, setData] = useState<FatigueRulesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  // Holdreglens kladde.
  const [limitOn, setLimitOn] = useState(false);
  const [threshold, setThreshold] = useState<string>(String(DEFAULT_THRESHOLD));
  const [fallback, setFallback] = useState<FatigueFallback>("rest");
  const [afterStage, setAfterStage] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Ryttere valgt i "Tilfoej undtagelse", som endnu ikke er gemt.
  const [draftIds, setDraftIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return;
    const res = await apiFetch(BASE, { headers }, { source: "training-fatigue-rules" });
    if (!res.ok) return;
    const next = (res.data ?? {}) as FatigueRulesResponse;
    setData(next);
    const team = next.team ?? null;
    const on = !!team && isThreshold(team.threshold) && isFallback(team.fallback);
    setLimitOn(on);
    setThreshold(String(on ? team!.threshold : DEFAULT_THRESHOLD));
    setFallback(on ? (team!.fallback as FatigueFallback) : "rest");
    setAfterStage(team?.recoveryAfterStage === true);
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = useCallback(async (path: string, body: unknown) => {
    const headers = await authHeaders();
    if (!headers) return false;
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch(`${BASE}${path}`, { method: "PUT", headers, body: JSON.stringify(body) }, { source: "training-fatigue-rules" });
      if (!res.ok) { setMessage({ type: "error", text: t("fatigueRule.error") }); return false; }
      await load();
      setDraftIds([]);
      setMessage({ type: "ok", text: t("fatigueRule.saved") });
      return true;
    } catch {
      setMessage({ type: "error", text: t("fatigueRule.error") });
      return false;
    } finally {
      setBusy(false);
    }
  }, [load, t]);

  const roster = data?.roster ?? [];
  const riderRules = data?.riders ?? {};
  const nameById = useMemo(() => new Map(roster.map((r) => [r.id, r.name])), [roster]);
  const days = useMemo(() => stripDays(data?.days ?? [], data?.recent ?? []), [data?.days, data?.recent]);
  const activeDate = selectedDate ?? [...days].reverse().find((d) => d.riders.length > 0)?.date ?? null;
  const activeDay = days.find((d) => d.date === activeDate) ?? null;

  if (!data?.enabled) return null;

  const thresholdNumber = Number(threshold);
  const thresholdValid = isThreshold(thresholdNumber);
  const draftTeam: RuleView = limitOn && thresholdValid
    ? { threshold: thresholdNumber, fallback, recoveryAfterStage: afterStage }
    : { threshold: null, fallback: null, recoveryAfterStage: afterStage };
  const overNow = ridersOverLimit(roster, draftTeam, riderRules);
  const savedIds = Object.keys(riderRules).filter((id) => nameById.has(id));
  const exceptionIds = [...savedIds, ...draftIds.filter((id) => !riderRules[id] && nameById.has(id))];
  const addable = roster.filter((r) => !exceptionIds.includes(r.id));
  const fallbackLabel = (value: string | null | undefined) => (isFallback(value) ? t(`fatigueRule.fallback_${value}`) : "");

  function saveTeam() {
    if (limitOn && !thresholdValid) return;
    send("/team", {
      threshold: limitOn ? thresholdNumber : null,
      fallback: limitOn ? fallback : null,
      recoveryAfterStage: afterStage,
    });
  }

  function saveException(riderId: string, mode: ExceptionMode, own?: { threshold: number; fallback: FatigueFallback }) {
    send(`/riders/${riderId}`, mode === "own" ? { mode, ...own } : { mode });
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
      <div className="border-b border-cz-border px-4 py-3 sm:px-5">
        <h2 className="text-[15px] font-semibold text-cz-1">{t("fatigueRule.title")}</h2>
        <p className="mt-0.5 text-[12.5px] text-cz-2">{t("fatigueRule.intro")}</p>
      </div>

      {/* ── 1. Holdreglen ─────────────────────────────────────────────────── */}
      <div className="space-y-3 px-4 py-3 sm:px-5">
        <label className="flex min-h-11 items-center gap-2.5 text-[13px] text-cz-1 sm:min-h-0">
          <input
            type="checkbox"
            checked={limitOn}
            disabled={busy}
            onChange={(e) => setLimitOn(e.target.checked)}
            className="h-4 w-4 accent-cz-1"
            data-testid="fatigue-rule-limit-toggle"
          />
          {t("fatigueRule.useLimit")}
        </label>

        {limitOn && (
          <div className="grid grid-cols-[5.5rem_1fr] gap-2.5 sm:max-w-md">
            <label className="space-y-1">
              <span className={labelClass}>{t("fatigueRule.aboveLabel")}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                value={threshold}
                disabled={busy}
                onChange={(e) => setThreshold(e.target.value)}
                aria-invalid={!thresholdValid}
                className={`${inputClass} font-data tabular-nums`}
                data-testid="fatigue-rule-threshold"
              />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>{t("fatigueRule.insteadLabel")}</span>
              <select
                value={fallback}
                disabled={busy}
                onChange={(e) => setFallback(e.target.value as FatigueFallback)}
                className={inputClass}
                data-testid="fatigue-rule-fallback"
              >
                {FATIGUE_FALLBACKS.map((f) => <option key={f} value={f}>{fallbackLabel(f)}</option>)}
              </select>
            </label>
          </div>
        )}

        <label className="flex min-h-11 items-start gap-2.5 text-[13px] text-cz-1 sm:min-h-0">
          <input
            type="checkbox"
            checked={afterStage}
            disabled={busy}
            onChange={(e) => setAfterStage(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-cz-1"
            data-testid="fatigue-rule-after-stage"
          />
          {t("fatigueRule.afterStage")}
        </label>

        <p className="text-xs text-cz-3">{t("fatigueRule.dateStartNote")}</p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={saveTeam}
            disabled={busy || (limitOn && !thresholdValid)}
            className="min-h-11 w-full sm:min-h-0 sm:w-auto"
            data-testid="fatigue-rule-save"
          >
            {busy ? t("fatigueRule.saving") : t("fatigueRule.save")}
          </Button>
          {limitOn && thresholdValid && (
            <span className="font-data text-2xs tabular-nums text-cz-3" data-testid="fatigue-rule-over-now">
              {t("fatigueRule.overNow", { count: overNow })}
            </span>
          )}
          {message && (
            <span role="status" className={`text-xs ${message.type === "ok" ? "text-cz-success" : "text-cz-danger"}`}>
              {message.text}
            </span>
          )}
        </div>
      </div>

      {/* ── 2. Undtagelser pr. rytter ────────────────────────────────────── */}
      <div className="border-t border-cz-border px-4 py-3 sm:px-5">
        <h3 className={labelClass}>{t("fatigueRule.exceptions")}</h3>
        {exceptionIds.length > 0 && (
          <ul className="mt-2 divide-y divide-cz-border">
            {exceptionIds.map((id) => (
              <ExceptionRow
                key={id}
                name={nameById.get(id) ?? ""}
                rule={riderRules[id] ?? NO_RULE}
                initialMode={riderRules[id] ? undefined : "own"}
                busy={busy}
                fallbackLabel={fallbackLabel}
                onSave={(mode, own) => saveException(id, mode, own)}
              />
            ))}
          </ul>
        )}
        {exceptionIds.length === 0 && <p className="mt-1 text-xs text-cz-3">{t("fatigueRule.exceptionsEmpty")}</p>}
        {addable.length > 0 && (
          <select
            value=""
            disabled={busy}
            onChange={(e) => { if (e.target.value) setDraftIds((ids) => [...ids, e.target.value]); }}
            aria-label={t("fatigueRule.addException")}
            className={`${inputClass} mt-2 sm:max-w-xs`}
            data-testid="fatigue-rule-add-rider"
          >
            <option value="">{t("fatigueRule.addException")}</option>
            {addable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
      </div>

      {/* ── 3. Ugestriben ────────────────────────────────────────────────── */}
      <div className="border-t border-cz-border px-4 py-3 sm:px-5">
        <h3 className={labelClass}>{t("fatigueRule.stripTitle")}</h3>
        <ol className="mt-2 grid grid-cols-7 gap-1" data-testid="fatigue-rule-strip">
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
                  className={`flex min-h-11 w-full flex-col items-center justify-center rounded-cz border px-0.5 py-1 ${
                    isActive ? "border-cz-1 bg-cz-subtle" : "border-cz-border hover:bg-cz-subtle"
                  }`}
                >
                  <span className="font-data text-3xs uppercase text-cz-3">{t(`weekday_${weekdayKey(day.date)}`)}</span>
                  <span className={`font-data text-sm tabular-nums ${count > 0 ? "font-semibold text-cz-1" : "text-cz-3"}`}>
                    {count}
                  </span>
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
                  <span className="text-cz-2">{hits.map(reason).join(" · ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-cz-3">{t("fatigueRule.stripEmpty")}</p>
          )}
        </div>
      </div>
    </section>
  );
}

const NO_RULE: RuleView = { threshold: null, fallback: null, recoveryAfterStage: null };

function ExceptionRow({
  name, rule, initialMode, busy, fallbackLabel, onSave,
}: {
  name: string;
  rule: RuleView;
  initialMode?: ExceptionMode;
  busy: boolean;
  fallbackLabel: (value: string) => string;
  onSave: (mode: ExceptionMode, own?: { threshold: number; fallback: FatigueFallback }) => void;
}) {
  const { t } = useTranslation("training");
  const savedMode = exceptionMode(rule);
  const [mode, setMode] = useState<ExceptionMode>(initialMode ?? savedMode);
  const [threshold, setThreshold] = useState(String(rule.threshold ?? DEFAULT_THRESHOLD));
  const [fallback, setFallback] = useState<FatigueFallback>(isFallback(rule.fallback) ? rule.fallback : "rest");
  const thresholdNumber = Number(threshold);
  const valid = mode !== "own" || isThreshold(thresholdNumber);
  const own = effectiveLimit(null, rule);
  const dirty = mode !== savedMode
    || (mode === "own" && (own?.threshold !== thresholdNumber || own?.fallback !== fallback));

  return (
    <li className="flex flex-wrap items-center gap-2 py-2" data-testid="fatigue-rule-exception">
      <span className="min-w-0 flex-1 basis-full truncate text-[13px] font-semibold text-cz-1 sm:basis-auto">{name}</span>
      <select
        value={mode}
        disabled={busy}
        onChange={(e) => setMode(e.target.value as ExceptionMode)}
        aria-label={name}
        className={`${inputClass} w-auto`}
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
            className={`${inputClass} w-20 font-data tabular-nums`}
          />
          <select
            value={fallback}
            disabled={busy}
            aria-label={t("fatigueRule.insteadLabel")}
            onChange={(e) => setFallback(e.target.value as FatigueFallback)}
            className={`${inputClass} w-auto`}
          >
            {FATIGUE_FALLBACKS.map((f) => <option key={f} value={f}>{fallbackLabel(f)}</option>)}
          </select>
        </>
      )}
      {dirty && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy || !valid}
          onClick={() => onSave(mode, mode === "own" ? { threshold: thresholdNumber, fallback } : undefined)}
          className="min-h-11 sm:min-h-0"
        >
          {t("fatigueRule.save")}
        </Button>
      )}
    </li>
  );
}
