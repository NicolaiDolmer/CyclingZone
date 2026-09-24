// TrainingDaySelect — EEN dagsvaelger pr. rytter (#5485, aendring 4).
//
// Clarity 16-23/9 fandt tre veje til at skifte en rytters dag (dropdown,
// knaprækken Rest/Active recovery/session og dagspanelet), og alle tre havde
// doedt-klik-signal: et tryk paa den allerede valgte knap gjorde intet, og
// "Save day" stod graa indtil valget baade var komplet OG aendret. Her er der
// een vaelger. Et valg gemmes med det samme, og kvitteringen "Saved" staar ved
// siden af, saa spilleren ser at tryk og gem er det samme.
//
// Listen er de DAGE der findes, grupperet som i dagspanelet og mængde-
// vaelgeren, saa en rytter aldrig kan faa en kombination han ikke kunne have
// faaet i panelet. Vaelgeren er en naturlig <select>: telefonens egen liste er
// den bedste tryk-flade, og tastaturvejen er gratis.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DAY_TYPES_WITHOUT_SESSION,
  SKILL_SESSIONS,
  TRAINING_LEVELS,
  TRAINING_SESSIONS_BY_LEVEL,
  dayTypeForProgram,
  sessionForProgram,
} from "../../lib/trainingDayTypes.js";
import { CheckIcon, ChevronDownIcon } from "../ui/icons/index.jsx";

export type DayPlan = { focus?: string | null; intensity?: string | null } | null | undefined;

// Planen som vaelgerens vaerdi: "rest" / "recovery" for dage uden session,
// ellers sessionens noegle. "" = ingen dag valgt.
export function dayChoiceForPlan(plan: DayPlan): string {
  if (!plan?.focus) return "";
  const dayType = dayTypeForProgram(plan) as string;
  if ((DAY_TYPES_WITHOUT_SESSION as readonly string[]).includes(dayType)) return dayType;
  return (sessionForProgram(plan) as string | null) ?? "";
}

const SAVED_VISIBLE_MS = 4000;

export default function TrainingDaySelect({
  riderName,
  plan,
  busy = false,
  error = null,
  onChoose,
  dataTour,
  compact = false,
  justSaved = false,
}: {
  riderName: string;
  plan: DayPlan;
  busy?: boolean;
  error?: string | null;
  // Resolver til true naar valget er gemt. Siden ejer mutationen og fejlen.
  onChoose: (choice: string) => Promise<boolean>;
  dataTour?: string;
  compact?: boolean;
  // #5485 (23/9): siden ved ogsaa hvornaar en dag er gemt ad en ANDEN vej
  // (fx "Use assistant pick" i samme raekke). Saa staar kvitteringen her, i
  // raekken, uanset hvilken knap der gemte dagen.
  justSaved?: boolean;
}) {
  const { t } = useTranslation("training");
  const value = dayChoiceForPlan(plan);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function handleChange(next: string) {
    if (!next || next === value) return;
    setSaved(false);
    const ok = await onChoose(next);
    if (!ok) return;
    setSaved(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), SAVED_VISIBLE_MS);
  }

  const unset = value === "";

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <div className={`relative ${compact ? "w-full" : "w-[168px]"} flex-none`}>
          <select
            value={value}
            disabled={busy}
            data-tour={dataTour}
            aria-label={t("daySelect.aria", { name: riderName })}
            onChange={(event) => void handleChange(event.target.value)}
            className={`w-full appearance-none rounded-cz border bg-cz-card py-1.5 pe-8 ps-2.5 text-xs transition-colors duration-150 ease-out disabled:opacity-50 ${
              unset
                ? "border-dashed border-cz-border font-semibold text-cz-accent-t"
                : "border-cz-border text-cz-1 hover:border-cz-2/40"
            }`}
          >
            <option value="" disabled>
              {t("daySelect.placeholder")}
            </option>
            <optgroup label={t("dayPanel.bulkWholeDay")}>
              <option value="rest">{t("dayPanel.dayType_rest")}</option>
              <option value="recovery">{t("dayPanel.dayType_recovery")}</option>
            </optgroup>
            {(TRAINING_LEVELS as readonly string[]).map((level) => (
              <optgroup key={level} label={`${t("dayPanel.dayType_training")} · ${t(`dayPanel.level_${level}`)}`}>
                {((TRAINING_SESSIONS_BY_LEVEL as Record<string, readonly string[]>)[level] ?? []).map((session) => (
                  <option key={session} value={session}>
                    {t(`dayPanel.session_${session}`)}
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label={t("dayPanel.dayType_skill")}>
              {(SKILL_SESSIONS as readonly string[]).map((session) => (
                <option key={session} value={session}>
                  {t(`dayPanel.session_${session}`)}
                </option>
              ))}
            </optgroup>
          </select>
          <ChevronDownIcon
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-cz-3"
          />
        </div>
        {(saved || justSaved) && (
          <span role="status" className="inline-flex flex-none items-center gap-1 text-2xs font-semibold text-cz-success">
            <CheckIcon size={12} aria-hidden="true" />
            {t("daySelect.saved")}
          </span>
        )}
      </div>
      {error && (
        <div role="alert" className="mt-0.5 text-3xs text-cz-danger">
          {t([`planActionError_${error}`, "planActionErrorGeneric"])}
        </div>
      )}
    </div>
  );
}
