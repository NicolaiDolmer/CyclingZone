import { useTranslation } from "react-i18next";
import { AlertTriangleIcon } from "../ui/icons";
import { formatDateTime } from "../../lib/intl.js";
import { RACE_TIMEZONE } from "../../lib/stageScheduleConfig.js";
import useRacePause from "../../hooks/useRacePause.ts";
import type { RacePause } from "../../lib/racePause.ts";

// #6970 — "Pauset"-banner paa loebet (ejer-default: ingen ny loebsstatus).
// Samme advarselsflade som driftsbanneret (RaceControlBanner, #3941): hairline,
// warning-tokens, stroke-ikon. Kilden er app_config `race_pause_notice`
// (se lib/racePause.ts). `pause` kan gives udefra (dashboardet har allerede
// hentet den); uden prop henter banneret selv. Ingen pause = intet renderes.
export default function RacePausedBanner({ pause }: { pause?: RacePause | null }) {
  const { t } = useTranslation("banners");
  const fetched = useRacePause(pause === undefined);
  const active = pause === undefined ? fetched : pause;
  if (!active) return null;

  const newStart = active.newStartMs != null
    ? formatDateTime(active.newStartMs, { timeZone: RACE_TIMEZONE })
    : null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-[5px] border border-cz-warning/30 bg-cz-warning-bg px-4 py-2.5 text-cz-warning"
    >
      <AlertTriangleIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1 text-sm leading-snug">
        <span className="font-semibold">{t("racePaused.title")}</span>
        {" "}
        <span className="tabular-nums">
          {newStart ? t("racePaused.newStart", { time: newStart }) : t("racePaused.newStartUnknown")}
        </span>
      </p>
    </div>
  );
}
