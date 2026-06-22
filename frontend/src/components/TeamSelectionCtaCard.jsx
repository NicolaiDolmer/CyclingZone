// #1681 — gør holdudtagelse synlig fra dashboardet. Tidligere var den begravet 3
// klik nede (Races → vælg løb → scroll til RaceSelectionPanel) — selv ejeren
// kunne ikke finde den. Dette kort vises når der findes mindst ét kommende
// (scheduled) løb og linker MANAGEREN DIREKTE til det løbs detalje-side, hvor
// udtagelses-panelet bor. "Selectable race" udledes klient-side fra races-data
// (status === "scheduled"), så kortet ikke kræver et ekstra backend-deploy.

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, FlagIcon } from "./ui";
import { pickNextSelectableRace } from "../lib/nextSelectableRace";

export default function TeamSelectionCtaCard({ races }) {
  const { t } = useTranslation("races");
  const nextRace = pickNextSelectableRace(races);
  if (!nextRace) return null;

  const bodyKey = nextRace.race_type === "stage_race" ? "discoverCta.bodyStage" : "discoverCta.bodyOneDay";

  return (
    <Card className="mb-5 p-5 flex flex-col sm:flex-row sm:items-center gap-4" data-testid="team-selection-cta">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <span className="flex-shrink-0 mt-0.5 text-cz-accent-t" aria-hidden="true">
          <FlagIcon size={20} />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-cz-1 text-sm">{t("discoverCta.title")}</h2>
          <p className="text-cz-3 text-xs mt-0.5">{t(bodyKey, { race: nextRace.name })}</p>
        </div>
      </div>
      <Link
        to={`/races/${nextRace.id}`}
        className="flex-shrink-0 self-start sm:self-auto px-4 py-2 rounded-lg bg-cz-accent text-cz-on-accent text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        {t("discoverCta.action")}
      </Link>
    </Card>
  );
}
