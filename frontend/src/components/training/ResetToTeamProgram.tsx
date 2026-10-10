// ResetToTeamProgram — raekke-handlingen "Back to team program" (#6123).
//
// Spillere (Discord 2/10) fandt ikke en vej tilbage fra en rytters egen plan:
// nulstillingen boede i ugeplan-arket og i Fokus-panelet, to lag der skal
// kendes for at findes. Her staar den paa selve Today-raekken, men KUN naar
// rytteren har noget at fjerne (`visible`), og den samme handling fjerner begge
// lag (ugeplan-override + egen dag).
//
// Kvitteringen har samme anatomi som TrainingDaySelect ("Saved"): hake + kort
// tekst i raekken. Knappen forsvinder naar planen er vaek, saa kvitteringen
// bor i komponenten selv og overlever at `visible` bliver false.
//
// TASTE: stille tekstknap (ingen ny primary), hairline, ingen skygge, ikon som
// stroke. Fejl vises under knappen; laas-fejlen faar sin egen forklaring via
// trainNowSaveErrorKey.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon } from "../ui/icons/index.jsx";
import { trainNowSaveErrorKey } from "./TrainNowState.ts";

const DONE_VISIBLE_MS = 4000;

export type ResetResult = { ok: boolean; error?: string | null };

export default function ResetToTeamProgram({
  visible,
  locked = false,
  busy = false,
  onReset,
  compact = false,
}: {
  // Rytteren har egen plan/override (hasOwnProgram(...).any).
  visible: boolean;
  // Train now-laasen gaelder: handlingen er slaaet fra.
  locked?: boolean;
  busy?: boolean;
  onReset: () => Promise<ResetResult>;
  // Telefon: stoerre trykflade.
  compact?: boolean;
}) {
  const { t } = useTranslation("training");
  const [done, setDone] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function handleClick() {
    if (working) return;
    setError(null);
    setDone(false);
    setWorking(true);
    try {
      const result = await onReset();
      if (!result.ok) {
        setError(result.error ?? "failed");
        return;
      }
      setDone(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), DONE_VISIBLE_MS);
    } finally {
      setWorking(false);
    }
  }

  if (!visible && !done && !error) return null;

  return (
    <div className={`min-w-0 ${compact ? "text-end" : ""} mt-0.5`} data-testid="training-reset-program">
      {done ? (
        <span role="status" className="inline-flex items-center gap-1 text-2xs font-semibold text-cz-success">
          <CheckIcon size={12} aria-hidden="true" />
          {t("resetProgram.done")}
        </span>
      ) : visible ? (
        <button
          type="button"
          onClick={() => void handleClick()}
          disabled={locked || busy || working}
          title={locked ? t("trainNow.planLocked") : undefined}
          className={`inline-flex items-center text-start text-xs font-medium text-cz-accent-t transition-colors duration-150 hover:underline disabled:cursor-not-allowed disabled:text-cz-3 disabled:no-underline ${
            compact ? "min-h-10" : "min-h-6"
          }`}
        >
          {t("resetProgram.action")}
        </button>
      ) : null}
      {error && (
        <div role="alert" className="mt-0.5 text-3xs text-cz-danger" data-testid="training-reset-error">
          {t(trainNowSaveErrorKey(error, "resetProgram.error"))}
        </div>
      )}
    </div>
  );
}
