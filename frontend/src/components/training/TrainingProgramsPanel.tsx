// TrainingProgramsPanel — Program-fanen: katalog, tildeling og 7 x N-gitteret
// (#4629, beta 26/9).
//
// Formen er laast (TRAINING_RULES §13.3 beslutning 8 + §13.1): programmet er et
// gitter på 7 ugedage x N loebsdage. N følger dagens loebsdags-kolonner
// (buildRaceDayColumns): med `training_tick_per_race_day` OFF er der een
// kolonne, og gitteret viser kun "Hele dagen". Ugedagens session fylder alle
// loebsdags-slots; en enkelt celle kan overstyres.
//
// Ejer-valg 26/9:
//   1. KOPI ved tildeling — "Baseret paa Sprinter · 2 aendret" er proveniens,
//      ikke en live-kobling. Kun spillerens klik aendrer planen.
//   2. Loeb er loeb — ingen taktik-felt her; en loebsdag springer sessionen over.
//   3. Kataloget kommer fra serveren (konfiguration), ikke fra denne fil.
//
// TASTE/PAGE_TEMPLATES: een gold primary i viewet ("Brug program"), hairline-
// borders, 5 px radius (rounded-cz), tabular figures, stroke-ikoner.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../ui/Button.jsx";
import { CheckIcon } from "../ui/icons/index.jsx";
import type { RaceDayColumn } from "../../lib/trainingMobileModel.ts";
import {
  PROGRAM_SLOTS, cellSession, isCellOverridden, isProgramPlan, changedCellCount, catalogForRiderType,
  programName, programTagline, slotForColumnIndex, type CatalogProgram, type ProgramWeekDays,
} from "../../lib/trainingPrograms.ts";
import type { ProgramsResult } from "./useTrainingPrograms.ts";

export type ProgramRider = { id: string; name: string; type: string | null };

// Raekkefoelgen i session-vaelgeren: hele dage, faerdighed, traening.
const SESSION_ORDER = [
  "rest", "recovery",
  "technique", "aero", "loebslaere",
  "endurance", "tempo",
  "vo2max", "vo2max_climb", "vo2max_punch", "threshold", "sprint",
  "cobbled_sectors", "echelon_drills", "attack_repeats",
] as const;

export default function TrainingProgramsPanel({
  weekdays,
  todayWeekday,
  columns,
  riders,
  riderWeekPlans,
  catalog,
  assigned,
  busy,
  onApply,
  onSetCell,
}: {
  weekdays: readonly string[];
  todayWeekday: string;
  columns: RaceDayColumn[];
  riders: ProgramRider[];
  riderWeekPlans: Record<string, ProgramWeekDays | undefined>;
  catalog: CatalogProgram[];
  assigned: Record<string, string>;
  busy: boolean;
  onApply: (programKey: string, target: string) => Promise<ProgramsResult>;
  onSetCell: (riderId: string, weekday: string, slotIndex: number | null, session: string) => Promise<ProgramsResult>;
}) {
  const { t, i18n } = useTranslation("training");
  const tTypes = useTranslation("riderTypes").t;
  const lang = i18n?.language ?? "en";
  const multi = columns.length > 1;

  const [target, setTarget] = useState<string>("squad");
  const [planRiderId, setPlanRiderId] = useState<string | null>(null);
  const targetRider = riders.find((r) => r.id === target) ?? null;
  const ordered = useMemo(
    () => catalogForRiderType(catalog, targetRider?.type ?? null),
    [catalog, targetRider?.type],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = catalog.find((p) => p.key === selectedKey) ?? null;
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const programByKey = useMemo(() => new Map(catalog.map((p) => [p.key, p])), [catalog]);
  const onProgram = riders.filter((r) => isProgramPlan(riderWeekPlans[r.id], weekdays));
  const editRiderId = planRiderId && riders.some((r) => r.id === planRiderId)
    ? planRiderId
    : (onProgram[0]?.id ?? riders[0]?.id ?? null);
  const editDays = editRiderId ? riderWeekPlans[editRiderId] : null;
  const editIsProgram = isProgramPlan(editDays, weekdays);
  const editProgram = editRiderId ? programByKey.get(assigned[editRiderId] ?? "") ?? null : null;

  const sessionLabel = (session: string) =>
    session === "rest" || session === "recovery"
      ? t(`dayPanel.dayType_${session}`)
      : t(`dayPanel.session_${session}`);
  const shortLabel = (session: string) => t(`mobile.sessionShort_${session}`, { defaultValue: sessionLabel(session) });
  const forLabel = (program: CatalogProgram) =>
    program.targetTypes.length
      ? program.targetTypes.map((type) => tTypes(`types.${type}`)).join(", ")
      : t(`programs.audience_${program.audience ?? "all"}`);

  async function handleApply() {
    if (!selected) return;
    setMessage(null);
    const result = await onApply(selected.key, target);
    if (result.ok) {
      const who = target === "squad" ? t("programs.squadShort") : (targetRider?.name ?? "");
      setMessage({ type: "ok", text: t("programs.applied", { name: programName(selected, lang), target: who }) });
      if (target !== "squad") setPlanRiderId(target);
    } else {
      setMessage({ type: "error", text: t("programs.error") });
    }
  }

  async function handleCell(weekday: string, slotIndex: number | null, session: string) {
    if (!editRiderId) return;
    const result = await onSetCell(editRiderId, weekday, slotIndex, session);
    if (!result.ok) setMessage({ type: "error", text: t("programs.error") });
  }

  const sessionSelect = (
    value: string,
    onChange: (session: string) => void,
    ariaLabel: string,
    overlay = false,
  ) => (
    <select
      value={value}
      disabled={busy}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className={overlay
        ? "absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        : "w-full rounded-cz border border-cz-border bg-cz-card px-1.5 py-1 text-xs text-cz-1 disabled:opacity-50"}
    >
      {SESSION_ORDER.map((session) => (
        <option key={session} value={session}>{sessionLabel(session)}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-3.5" data-testid="training-programs">
      {/* ── Kataloget + tildeling ─────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        <div className="border-b border-cz-border px-4 py-3 sm:px-5">
          <h2 className="text-[15px] font-semibold text-cz-1">{t("programs.title")}</h2>
          <p className="mt-0.5 text-[12.5px] text-cz-2">{t("programs.intro")}</p>
        </div>

        <ul role="radiogroup" aria-label={t("programs.title")} className="max-h-[420px] divide-y divide-cz-border overflow-y-auto">
          {ordered.map((program) => {
            const isSelected = program.key === selectedKey;
            return (
              <li key={program.key}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setSelectedKey(program.key)}
                  className={`flex min-h-11 w-full items-start gap-3 px-4 py-2 text-start sm:px-5 ${
                    isSelected ? "bg-cz-subtle" : "hover:bg-cz-subtle"
                  }`}
                  data-testid="training-program-option"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
                      isSelected ? "border-cz-1 bg-cz-1 text-cz-card" : "border-cz-border"
                    }`}
                  >
                    {isSelected && <CheckIcon size={10} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[13px] font-semibold text-cz-1">{programName(program, lang)}</span>
                      <span className="font-data text-3xs uppercase tracking-[.05em] text-cz-3">{forLabel(program)}</span>
                    </span>
                    <span className="block text-xs text-cz-2">{programTagline(program, lang)}</span>
                    <span className="mt-1 flex flex-wrap gap-1" aria-hidden="true">
                      {weekdays.map((weekday) => {
                        const session = program.days[weekday];
                        return (
                          <span
                            key={weekday}
                            className={`rounded-[3px] border border-cz-border px-1 font-data text-3xs ${
                              session === "rest" ? "text-cz-3" : "text-cz-2"
                            }`}
                          >
                            {t(`weekday_${weekday}`).slice(0, 2)} {shortLabel(session)}
                          </span>
                        );
                      })}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center gap-3 border-t border-cz-border px-4 py-3 sm:px-5">
          <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
            <span className="font-data text-2xs font-semibold uppercase tracking-[.04em] text-cz-3">{t("programs.putOn")}</span>
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              aria-label={t("programs.putOn")}
              className="min-w-0 flex-1 rounded-cz border border-cz-border bg-cz-card px-2.5 py-1.5 text-xs text-cz-1 sm:min-w-[200px] sm:flex-none"
            >
              <option value="squad">{t("programs.squad", { n: riders.length })}</option>
              {riders.map((rider) => (
                <option key={rider.id} value={rider.id}>{rider.name}</option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleApply}
            disabled={!selected || busy || riders.length === 0}
            className="min-h-11 sm:min-h-0"
            data-testid="training-program-apply"
          >
            {busy ? t("programs.applying") : t("programs.apply")}
          </Button>
          {target === "squad" && selected && (
            <span className="font-data text-2xs tabular-nums text-cz-3">
              {t("programs.replacesSquad", { n: riders.length })}
            </span>
          )}
          {message && (
            <span role="status" className={`text-xs ${message.type === "ok" ? "text-cz-success" : "text-cz-danger"}`}>
              {message.text}
            </span>
          )}
        </div>
      </section>

      {/* ── Planen: 7 ugedage x N loebsdage ──────────────────────────────── */}
      <section className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cz-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-cz-1">{t("programs.planTitle")}</h2>
            <p className="mt-0.5 text-[12.5px] text-cz-2">
              {editIsProgram && editProgram
                ? (
                  <>
                    {t("programs.basedOn", { name: programName(editProgram, lang) })}
                    {changedCellCount(editDays, editProgram, weekdays) > 0 && (
                      <span className="tabular-nums">
                        {" · "}{t("programs.changed", { n: changedCellCount(editDays, editProgram, weekdays) })}
                      </span>
                    )}
                  </>
                )
                : editIsProgram ? t("programs.ownProgram") : t("programs.noProgram")}
            </p>
          </div>
          {riders.length > 0 && (
            <label className="flex min-w-0 items-center gap-2">
              <span className="font-data text-2xs font-semibold uppercase tracking-[.04em] text-cz-3">{t("weekPlan.planFor")}</span>
              <select
                value={editRiderId ?? ""}
                onChange={(event) => setPlanRiderId(event.target.value)}
                aria-label={t("weekPlan.planFor")}
                className="min-w-0 max-w-[220px] rounded-cz border border-cz-border bg-cz-card px-2.5 py-1.5 text-xs text-cz-1"
              >
                {riders.map((rider) => {
                  const program = programByKey.get(assigned[rider.id] ?? "");
                  const on = isProgramPlan(riderWeekPlans[rider.id], weekdays);
                  return (
                    <option key={rider.id} value={rider.id}>
                      {on && program ? `${rider.name} · ${programName(program, lang)}` : rider.name}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
        </div>

        {editIsProgram && editRiderId ? (
          <div className="px-3 py-3 sm:px-5">
            <div
              className="grid overflow-hidden rounded-cz border border-cz-border"
              style={{
                gridTemplateColumns: `minmax(40px, 96px) minmax(0, ${multi ? "150px" : "1fr"})${
                  multi ? ` repeat(${columns.length}, minmax(34px, 1fr))` : ""
                }`,
              }}
              data-testid="training-program-grid"
            >
              <span className="bg-cz-subtle px-2 py-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
                {t("weekPlan.colDay")}
              </span>
              <span className="border-s border-cz-border bg-cz-subtle px-2 py-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
                {t("weekPlan.colWholeDay")}
              </span>
              {multi && columns.map((column) => (
                <span
                  key={column.key}
                  className="border-s border-cz-border bg-cz-subtle px-0.5 py-1.5 text-center font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3"
                >
                  {t("mobile.raceDayShort", { n: column.index })}
                </span>
              ))}
              {weekdays.map((weekday) => {
                const isToday = weekday === todayWeekday;
                const rowBg = isToday ? "bg-cz-subtle" : "bg-cz-card";
                const daySession = cellSession(editDays, weekday) ?? "rest";
                return (
                  <div key={weekday} className="contents" data-testid="training-program-row">
                    <span className={`flex items-center gap-1.5 border-t border-cz-border px-2 py-1.5 text-[13px] font-semibold text-cz-1 ${rowBg}`}>
                      <span className="truncate">{t(`weekday_${weekday}`)}</span>
                      {isToday && (
                        <span className="hidden rounded-[3px] bg-cz-1 px-1 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-card sm:inline">
                          {t("weekPlan.today")}
                        </span>
                      )}
                    </span>
                    <span className={`border-s border-t border-cz-border px-1 py-1 ${rowBg}`}>
                      {sessionSelect(
                        daySession,
                        (session) => handleCell(weekday, null, session),
                        `${t("weekPlan.colWholeDay")} · ${t(`weekday_${weekday}`)}`,
                      )}
                    </span>
                    {multi && columns.map((column) => {
                      const slot = slotForColumnIndex(column.index);
                      if (slot >= PROGRAM_SLOTS) return null;
                      const session = cellSession(editDays, weekday, slot) ?? daySession;
                      const overridden = isCellOverridden(editDays, weekday, slot);
                      return (
                        <span
                          key={column.key}
                          title={overridden ? t("programs.cellOverridden") : undefined}
                          className={`relative flex min-h-11 items-center justify-center border-s border-t border-cz-border px-0.5 font-data text-2xs sm:min-h-0 sm:py-1.5 ${
                            overridden
                              ? "font-semibold text-cz-1 underline decoration-dotted decoration-cz-1 underline-offset-2"
                              : session === "rest" ? "text-cz-3" : "text-cz-2"
                          } ${rowBg}`}
                        >
                          <span className="truncate">{shortLabel(session)}</span>
                          {sessionSelect(
                            session,
                            (next) => handleCell(weekday, slot, next),
                            `${t(`weekday_${weekday}`)} · ${t("mobile.raceDayShort", { n: column.index })}`,
                            true,
                          )}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-2xs text-cz-3">{t("programs.raceNote")}</p>
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-cz-3 sm:px-5">{t("programs.noProgramHint")}</p>
        )}
      </section>
    </div>
  );
}
