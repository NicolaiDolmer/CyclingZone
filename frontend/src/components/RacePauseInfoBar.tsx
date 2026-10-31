import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { InfoIcon } from "./ui/icons";
import { formatDateTime } from "../lib/intl.js";
import { RACE_TIMEZONE } from "../lib/stageScheduleConfig.js";
import useRacePause from "../hooks/useRacePause.ts";
import { racePauseInfoBarHiddenOnPath } from "../lib/racePause.ts";

// #7335 — blaa info-bjaelke paa ALLE manager-sider naar loebene er sat paa pause.
// Samme flade og placering som driftsbanneret (RaceControlBanner, severity info):
// fuld bredde oeverst i <main>. Kilden er app_config `race_pause_notice` (lib/racePause.ts),
// saa bjaelken forsvinder af sig selv naar pausen fjernes eller den nye start er naaet.
// Dashboardet har allerede sin egen "Pauset"-flade (RacePausedBanner),
// dér skjules bjaelken, saa samme besked ikke staar to gange.
export default function RacePauseInfoBar() {
  const { t } = useTranslation("banners");
  const { pathname } = useLocation();
  const pause = useRacePause(true, pathname); // hent igen ved sidenavigation: Layout bliver monteret
  if (!pause || racePauseInfoBarHiddenOnPath(pathname)) return null;

  const newStart = pause.newStartMs != null
    ? formatDateTime(pause.newStartMs, { timeZone: RACE_TIMEZONE })
    : null;

  return (
    <div
      role="status"
      aria-label={t("racePauseInfoBar.regionAriaLabel")}
      className="flex items-start gap-3 border-b border-cz-info/30 bg-cz-info-bg px-4 py-2.5 text-cz-info md:px-8"
    >
      <InfoIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1 text-sm leading-snug">
        <span className="font-semibold">{t("racePauseInfoBar.title")}</span>
        {" "}
        <span className="tabular-nums">
          {newStart ? t("racePauseInfoBar.newStart", { time: newStart }) : t("racePauseInfoBar.newStartUnknown")}
        </span>
      </p>
    </div>
  );
}
