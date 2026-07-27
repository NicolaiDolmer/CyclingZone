// Season Planner — status-linjen OVER fanerne (#3086, ejer-krav 27/7).
//
// Placeringen er hele pointen. Ejerens indvending mod den gamle flade var at det
// vigtige lå "i bunden, hvor det ikke engang er sikkert at spillerne ved at det
// er der". En linje inde i en fane arver præcis samme problem: den er væk så
// snart man skifter fane. Derfor står den her, uden for `Tabs`, og er synlig fra
// alle tre faner.
//
// Tre tal, ikke flere: hvor mange peaks er planlagt, hvor mange kræver handling,
// hvor længe til næste optakt begynder. Alt andet hører hjemme i en fane.
import { useTranslation } from "react-i18next";
import { AlertTriangleIcon, CheckIcon, ClockIcon, FlagIcon } from "../ui";

export default function PlannerStatusLine({ summary }) {
  const { t } = useTranslation("planner");
  const { peaksPlanned, needsAction, daysToNextLeadup } = summary;

  return (
    <div
      className="mb-[14px] flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-cz border border-cz-border bg-cz-card px-3 py-2.5"
      role="status"
    >
      <span className="flex items-center gap-1.5 text-[13px] text-cz-1">
        <FlagIcon size={14} aria-hidden="true" className="text-cz-3" />
        <span className="font-data tabular-nums">{t("statusLine.peaks", { count: peaksPlanned })}</span>
      </span>

      {needsAction > 0 ? (
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-cz-accent-t">
          <AlertTriangleIcon size={14} aria-hidden="true" />
          <span className="font-data tabular-nums">{t("statusLine.needsAction", { count: needsAction })}</span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-[13px] text-cz-2">
          <CheckIcon size={14} aria-hidden="true" className="text-cz-3" />
          {t("statusLine.allClear")}
        </span>
      )}

      <span className="flex items-center gap-1.5 text-[13px] text-cz-2">
        <ClockIcon size={14} aria-hidden="true" className="text-cz-3" />
        <span className="font-data tabular-nums">
          {daysToNextLeadup == null
            ? t("statusLine.noLeadup")
            : t("statusLine.nextLeadup", { count: daysToNextLeadup })}
        </span>
      </span>
    </div>
  );
}
