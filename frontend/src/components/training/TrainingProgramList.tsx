// TrainingProgramList — under-fanen "Programs" paa Program-fanen (#5932,
// ejer-godkendt mockup 1/10, pin 4). Afloeser katalog-kortet fra #4629.
//
// En kompakt liste: et program pr. raekke med "Put on" i selve raekken, saa en
// tildeling er eet valg i stedet for vaelg + knap. Et tryk paa navnet viser
// ugen. Tildelingen er stadig en KOPI (ejer-valg 26/9): programmet skrives ind
// i Plan, hvor hvert felt kan rettes bagefter.
//
// TASTE: ingen gold i listen (sidens ene gold er Train now), hairlines,
// rounded-cz, tabular figures.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, ChevronRightIcon } from "../ui/icons/index.jsx";
import { catalogForRiderType, programName, programTagline, type CatalogProgram } from "../../lib/trainingPrograms.ts";
import type { ProgramsResult } from "./useTrainingPrograms.ts";
import { trainNowSaveErrorKey } from "./TrainNowState.ts";
import type { ProgramRider } from "./TrainingPlanCard.tsx";

export default function TrainingProgramList({
  weekdays,
  riders,
  catalog,
  busy,
  onApply,
  sessionShort,
  groups = [],
}: {
  weekdays: readonly string[];
  riders: ProgramRider[];
  // #6000: "Put on" en gruppe; target = "group:<id>".
  groups?: Array<{ value: string; label: string }>;
  catalog: CatalogProgram[];
  busy: boolean;
  onApply: (programKey: string, target: string) => Promise<ProgramsResult>;
  sessionShort: (session: string) => string;
}) {
  const { t, i18n } = useTranslation("training");
  const tTypes = useTranslation("riderTypes").t;
  const lang = i18n?.language ?? "en";
  const ordered = useMemo(() => catalogForRiderType(catalog, null), [catalog]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const forLabel = (program: CatalogProgram) =>
    program.targetTypes.length
      ? program.targetTypes.map((type) => tTypes(`types.${type}`)).join(", ")
      : t(`programs.audience_${program.audience ?? "all"}`);

  async function apply(program: CatalogProgram, target: string) {
    if (!target) return;
    setMessage(null);
    const result = await onApply(program.key, target);
    const who = target === "squad" ? t("programs.squadShort")
      : (riders.find((r) => r.id === target)?.name ?? groups.find((g) => g.value === target)?.label ?? "");
    setMessage(result.ok
      ? { type: "ok", text: t("programs.applied", { name: programName(program, lang), target: who }) }
      : { type: "error", text: t(trainNowSaveErrorKey(result.error, "programs.error")) });
  }

  return (
    <section className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" data-testid="training-programs">
      {/* Desktop: listen ruller inde i kortet, saa siden ikke scroller (mockup pin 1).
          Telefonen: ingen indlejret scroll, siden ruller som normalt. */}
      <ul className="divide-y divide-cz-border sm:max-h-[min(560px,calc(100vh-330px))] sm:min-h-[240px] sm:overflow-y-auto">
        {ordered.map((program) => {
          const open = openKey === program.key;
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
                  <span className="min-w-0 truncate text-[13px] text-cz-2">
                    <span className="font-semibold text-cz-1">{programName(program, lang)}</span>
                    {" · "}{programTagline(program, lang)}
                  </span>
                  <span className="hidden flex-none font-data text-3xs uppercase tracking-wider text-cz-3 md:inline">{forLabel(program)}</span>
                </button>
                <select
                  value=""
                  disabled={busy || riders.length === 0}
                  onChange={(event) => apply(program, event.target.value)}
                  aria-label={`${t("programs.putOn")} · ${programName(program, lang)}`}
                  className="min-h-11 w-28 flex-none rounded-cz border border-cz-border bg-cz-card px-2 py-1 text-xs text-cz-1 disabled:opacity-50 sm:min-h-0"
                  data-testid="training-program-put-on"
                >
                  <option value="">{t("programs.putOn")}</option>
                  <option value="squad">{t("programs.squad", { n: riders.length })}</option>
                  {groups.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}
                  {riders.map((rider) => (
                    <option key={rider.id} value={rider.id}>{rider.name}</option>
                  ))}
                </select>
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
        })}
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
