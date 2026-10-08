// TrainingProgramAssign — under-fanen "Programs" paa Program-fanen, vendt
// (#6035, ejer-loefte til beta 1/10): FOERST rytter eller gruppe, DEREFTER
// programmet. Afloeser TrainingProgramList (#5932), hvor man saa alle
// programmer og valgte rytter i en select pr. raekke bagefter.
//
// Samme API som foer: onApply(programKey, target) med target = "squad",
// "group:<id>" eller et rytter-id. Tildelingen er stadig en KOPI ind i Plan
// (ejer-valg 26/9).
//
// TASTE: ingen gold (sidens ene gold er Train now), hairlines, rounded-cz,
// vaelgeren er Plan-fanens "Plan for"-select (samme anatomi).
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../ui/Button.jsx";
import { ChevronDownIcon, ChevronRightIcon } from "../../ui/icons/index.jsx";
import { programName, programTagline, type CatalogProgram } from "../../../lib/trainingPrograms.ts";
import type { ProgramsResult } from "../useTrainingPrograms.ts";
import { currentProgramKey, resolveTarget, sectionsForTarget, type AssignRider } from "./programAssignModel.ts";

export default function TrainingProgramAssign({
  weekdays,
  riders,
  catalog,
  busy,
  onApply,
  sessionShort,
  groups = [],
  assigned = null,
}: {
  weekdays: readonly string[];
  riders: AssignRider[];
  // #6000: en gruppe som modtager; value = "group:<id>".
  groups?: Array<{ value: string; label: string }>;
  catalog: CatalogProgram[];
  busy: boolean;
  onApply: (programKey: string, target: string) => Promise<ProgramsResult>;
  sessionShort: (session: string) => string;
  // rytter-id -> programnoegle (GET /api/training/programs).
  assigned?: Record<string, string> | null;
}) {
  const { t, i18n } = useTranslation("training");
  const tTypes = useTranslation("riderTypes").t;
  const lang = i18n?.language ?? "en";
  const [targetValue, setTargetValue] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const target = useMemo(() => resolveTarget(targetValue, riders, groups), [targetValue, riders, groups]);
  const { fits, others } = useMemo(() => sectionsForTarget(catalog, target), [catalog, target]);
  const current = currentProgramKey(target, assigned);
  const typeLabel = (type: string | null) => (type ? tTypes(`types.${type}`) : "");

  const forLabel = (program: CatalogProgram) =>
    program.targetTypes.length
      ? program.targetTypes.map((type) => typeLabel(type)).join(", ")
      : t(`programs.audience_${program.audience ?? "all"}`);

  const targetName = target.kind === "squad" ? t("programs.squadShort")
    : target.kind === "rider" ? target.rider.name
      : target.kind === "group" ? (groups.find((g) => g.value === target.value)?.label ?? "")
        : "";

  // Dobbelttryk-guard: `busy` naar foerst frem efter et render, saa et hurtigt
  // andet tryk ville sende kaldet to gange. Ref'en lukker det med det samme.
  const inFlight = useRef(false);
  // Taeller valg af modtager: et svar der kommer efter et nyt valg, kasseres.
  const targetGeneration = useRef(0);

  async function apply(program: CatalogProgram) {
    if (target.kind === "none" || inFlight.current) return;
    const generation = targetGeneration.current;
    inFlight.current = true;
    setMessage(null);
    let result: ProgramsResult;
    try {
      result = await onApply(program.key, targetValue);
    } catch {
      result = { ok: false };
    } finally {
      inFlight.current = false;
    }
    if (targetGeneration.current !== generation) return;
    setMessage(result.ok
      ? { type: "ok", text: t("programs.applied", { name: programName(program, lang), target: targetName }) }
      : { type: "error", text: t("programs.error") });
  }

  function chooseTarget(value: string) {
    targetGeneration.current += 1;
    setTargetValue(value);
    setMessage(null);
    setOpenKey(null);
  }

  const row = (program: CatalogProgram) => {
    const open = openKey === program.key;
    const isCurrent = current === program.key;
    return (
      <li key={program.key} data-testid="training-program-option">
        <div className="flex items-center gap-3 px-4 py-1.5 sm:px-5">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpenKey(open ? null : program.key)}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-start sm:min-h-9"
          >
            {open
              ? <ChevronDownIcon size={12} aria-hidden="true" className="flex-none text-cz-3" />
              : <ChevronRightIcon size={12} aria-hidden="true" className="flex-none text-cz-3" />}
            <span className="min-w-0 truncate text-xs text-cz-2">
              <span className="text-sm font-semibold text-cz-1">{programName(program, lang)}</span>
              {" · "}{programTagline(program, lang)}
            </span>
            <span className="hidden flex-none font-data text-3xs uppercase tracking-wider text-cz-3 md:inline">{forLabel(program)}</span>
          </button>
          {isCurrent && (
            <span className="flex-none rounded-cz border border-cz-border px-1.5 font-data text-3xs uppercase tracking-wider text-cz-2" data-testid="training-program-current">
              {t("programs.current")}
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || target.kind === "none"}
            onClick={() => apply(program)}
            aria-label={`${t("programs.putOn")} · ${programName(program, lang)}${targetName ? ` · ${targetName}` : ""}`}
            className="min-h-11 flex-none sm:min-h-0"
            data-testid="training-program-put-on"
          >
            {t("programs.putOn")}
          </Button>
        </div>
        {open && (
          <div className="flex flex-wrap gap-1 px-4 pb-2 sm:px-5" aria-label={programName(program, lang)}>
            {weekdays.map((weekday) => {
              const session = program.days[weekday];
              return (
                <span
                  key={weekday}
                  className={`rounded-cz border border-cz-border px-1.5 font-data text-2xs ${session === "rest" ? "text-cz-3" : "text-cz-2"}`}
                >
                  {t(`weekday_${weekday}`).slice(0, 3)} {sessionShort(session)}
                </span>
              );
            })}
          </div>
        )}
      </li>
    );
  };

  const sectionHead = (label: string) => (
    <li className="bg-cz-subtle px-4 py-1 font-data text-3xs uppercase tracking-wider text-cz-3 sm:px-5" aria-hidden="true">
      {label}
    </li>
  );

  return (
    <section className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" data-testid="training-programs">
      {/* ── Trin 1: hvem (Plan-fanens "Plan for"-vaelger) ──────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-cz-border px-4 py-2.5 sm:px-5">
        <select
          value={targetValue}
          onChange={(event) => chooseTarget(event.target.value)}
          disabled={riders.length === 0}
          aria-label={t("weekPlan.planFor")}
          className="min-h-11 w-full min-w-0 rounded-cz border border-cz-border bg-cz-card px-2.5 py-1.5 text-xs text-cz-1 disabled:opacity-50 sm:min-h-0 sm:w-auto sm:max-w-[280px]"
          data-testid="training-program-target"
        >
          <option value="">{t("programs.pickTarget")}</option>
          <option value="squad">{t("programs.squad", { n: riders.length })}</option>
          {groups.length > 0 && (
            <optgroup label={t("groups.section_groups")}>
              {groups.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}
            </optgroup>
          )}
          <optgroup label={t("groups.section_riders")}>
            {riders.map((rider) => (
              <option key={rider.id} value={rider.id}>
                {rider.type ? `${rider.name} · ${typeLabel(rider.type)}` : rider.name}
              </option>
            ))}
          </optgroup>
        </select>
        {/* Hele truppen erstatter alles ugeplan: sig det, foer der trykkes. */}
        {target.kind === "squad" && (
          <p className="text-xs text-cz-warning" data-testid="training-program-target-hint">
            {t("programs.replacesSquad", { n: riders.length })}
          </p>
        )}
      </div>

      {/* ── Trin 2: programmet ─────────────────────────────────────────── */}
      <ul className="divide-y divide-cz-border sm:max-h-[min(560px,calc(100vh-330px))] sm:min-h-[240px] sm:overflow-y-auto">
        {fits.length > 0 && sectionHead(t("programs.fitsType", { type: typeLabel(target.kind === "rider" ? target.rider.type : null) }))}
        {fits.map(row)}
        {fits.length > 0 && others.length > 0 && sectionHead(t("programs.otherPrograms"))}
        {others.map(row)}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cz-border px-4 py-2.5 sm:px-5">
        <p className="text-2xs text-cz-3">{t("programs.listNote")}</p>
        {message && (
          <span role="status" className={`text-xs ${message.type === "ok" ? "text-cz-success" : "text-cz-danger"}`}>
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
