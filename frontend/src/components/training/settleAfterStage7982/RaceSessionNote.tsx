// #7982: one short line in the training view once a race session has run after its stage
// (decision 8: no inbox message, it shows here). Renders nothing while the switch is off,
// so the page is unchanged.
import { useTranslation } from "react-i18next";
import type { ForecastResponse } from "../FatigueForecastModel.ts";
import { raceSessionNote } from "./settleAfterStageModel.ts";

export default function RaceSessionNote({ forecast, className = "" }: { forecast: ForecastResponse | null; className?: string }) {
  const { t } = useTranslation("training");
  const note = raceSessionNote(forecast);
  if (!note) return null;
  return (
    <p className={`text-2xs leading-snug text-cz-3 ${className}`} data-testid="training-race-session-note">
      {note.keys.map((key) => t(key, { n: note.n })).join(" ")}
    </p>
  );
}
