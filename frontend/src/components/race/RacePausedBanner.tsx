import { useTranslation } from "react-i18next";
import { AlertTriangleIcon } from "../ui/icons";
import { formatDateTime } from "../../lib/intl.js";
import { RACE_TIMEZONE } from "../../lib/stageScheduleConfig.js";
import { shouldAnnounceRacePause, type RacePause } from "../../lib/racePause.ts";

// #6970 — "Pauset"-banner paa dashboardet (ejer-default: ingen ny loebsstatus).
// Samme advarselsflade som driftsbanneret (RaceControlBanner, #3941): hairline,
// warning-tokens, stroke-ikon. Pausen kommer fra useRacePause (lib/racePause.ts),
// som dashboardet allerede har hentet. Alle andre sider, ogsaa loebssiden, viser
// den globale info-bjaelke (RacePauseInfoBar, #7335) i stedet, saa samme besked
// aldrig staar to gange. Ingen pause = intet renderes.
export default function RacePausedBanner({ pause }: { pause: RacePause | null }) {
  const { t } = useTranslation("banners");
  // Under saesonskiftet er pausen silent: dashboardet skjuler stadig de gamle tider,
  // men saesonskiftet staar allerede i "Naeste traek", saa ingen ekstra besked.
  if (!shouldAnnounceRacePause(pause)) return null;

  const newStart = pause.newStartMs != null
    ? formatDateTime(pause.newStartMs, { timeZone: RACE_TIMEZONE })
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
