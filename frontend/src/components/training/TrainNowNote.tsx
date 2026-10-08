// TrainNowNote - the one short line under the training page's gold button (#4847).
//
// Before the press it says what the press does (owner copy, EN first / DA in
// training.json). After the press it says the day is decided and when fatigue and
// form move. Prose about the mechanic lives in Help, not here (TASTE: short on the
// surface). Renders nothing while the flag is off, so the page is unchanged.
import { useTranslation } from "react-i18next";
import { LockIcon } from "../ui/icons/index.jsx";
import {
  trainNowNoteKeys, trainNowPressCounts, trainNowRaceNames, type TrainNowPressResult, type TrainNowStatus,
} from "./TrainNowState.ts";

export default function TrainNowNote({
  status, result = null, error = null, className = "",
}: {
  status: TrainNowStatus;
  result?: TrainNowPressResult | null;
  error?: string | null;
  className?: string;
}) {
  const { t } = useTranslation("training");
  const keys = trainNowNoteKeys(status, result, error);
  if (!keys.length) return null;
  const decided = status.locked || status.settled;
  return (
    <div
      className={`flex items-start gap-1.5 text-2xs leading-snug ${error ? "text-cz-danger" : "text-cz-3"} ${className}`}
      data-testid="training-train-now-note"
      role={error ? "alert" : undefined}
    >
      {decided && !error && <LockIcon size={12} aria-hidden="true" className="mt-px flex-none" />}
      <span>{keys.map((key) => t(key, { ...(trainNowPressCounts(result) ?? {}), race: trainNowRaceNames(status) })).join(" ")}</span>
    </div>
  );
}
