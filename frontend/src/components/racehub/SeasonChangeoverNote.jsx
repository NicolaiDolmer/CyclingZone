// #4124 — sæsonskiftets tidslinje var usynlig på fladen (egomadsen 23/8).
// Kort, collapsible fold (CollapsibleSection-kontrakten, #3914) på Season-
// visningen; korte punkter på selve fladen, den fulde forklaring bor i
// help.json (sections.season.seasonChangeover) via linket nederst.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import CollapsibleSection from "../ui/CollapsibleSection.jsx";

const ITEM_KEYS = ["age", "form", "fatigue", "injuries", "peaks", "wages"];

export default function SeasonChangeoverNote({ className = "" }) {
  const { t } = useTranslation("races");
  return (
    <CollapsibleSection title={t("seasonView.changeover.title")} className={className}>
      <ul className="mt-2 space-y-1">
        {ITEM_KEYS.map((key) => (
          <li key={key} className="flex items-start gap-1.5 text-xs text-cz-2">
            <span aria-hidden="true" className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-cz-3" />
            {t(`seasonView.changeover.items.${key}`)}
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-xs font-medium text-cz-1">{t("seasonView.changeover.firstRaceDay")}</p>
      <Link to="/help?section=season" className="mt-2.5 inline-block text-xs text-cz-accent-t hover:underline">
        {t("seasonView.changeover.readMore")}
      </Link>
    </CollapsibleSection>
  );
}
