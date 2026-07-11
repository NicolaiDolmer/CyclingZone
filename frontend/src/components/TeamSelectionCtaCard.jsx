// #1681 — gør holdudtagelse synlig fra dashboardet. Tidligere var den begravet 3
// klik nede (Races → vælg løb → scroll til RaceSelectionPanel) — selv ejeren
// kunne ikke finde den. Dette kort vises når der findes mindst ét kommende
// (scheduled) løb og linker MANAGEREN DIREKTE til det løbs detalje-side, hvor
// udtagelses-panelet bor.
//
// #2328: kortet linkede tidligere til det tidligst SCHEDULEDE løb uanset om
// udtagelse allerede var lavet (pickNextSelectableRace kender ikke til
// race_entries) — så CTA'en kunne pege på et løb manageren allerede havde
// udtaget til, mens et senere løb reelt manglede udtagelse. Kortet modtager nu
// direkte det næste løb der MANGLER udtagelse (samme kilde som DashboardPage's
// "Næste træk"-nudge: race_entries.is_auto_filled=false, count===0), i stedet
// for at udlede sit eget (potentielt forkerte) løb fra den rå races-liste.

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, FlagIcon } from "./ui";

export default function TeamSelectionCtaCard({ nextRace }) {
  const { t } = useTranslation("races");
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
      {/* #2288 F — landede tidligere øverst på race-siden uden at vise
          udtagelses-panelet; #selection-anchoret får RaceDetailPage til at
          scrolle direkte ned til RaceSelectionPanel ved load. */}
      <Link
        to={`/races/${nextRace.id}#selection`}
        className="flex-shrink-0 self-start sm:self-auto px-4 py-2 rounded-lg bg-cz-accent text-cz-on-accent text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        {t("discoverCta.action")}
      </Link>
    </Card>
  );
}
