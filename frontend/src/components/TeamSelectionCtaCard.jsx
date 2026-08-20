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
import { Link } from "react-router";
import { Card, FlagIcon } from "./ui";
import { buttonClass } from "./ui/buttonStyles.js";
import { formatCountdown } from "../lib/stageScheduleConfig.js";

// #3243 — startAtMs/nowMs (valgfri): ægte race_stage_schedule-countdown til
// løbsstart, samme kilde+format som dashboardets "Kommende løb"-kort. Et helt
// nyt hold har intet andet signal for HVORNÅR deres første løb kører end dette
// kort, og uden countdown'en ved de kun AT det kommer, ikke hvornår de skal
// vende tilbage (funnel-fund #3243: 12% af nye hold venter 4+ dage på deres
// første resultat — transparens om timingen er billigere end at gætte).
export default function TeamSelectionCtaCard({ nextRace, startAtMs = null, nowMs = null, primary = true }) {
  const { t } = useTranslation("races");
  if (!nextRace) return null;

  const bodyKey = nextRace.race_type === "stage_race" ? "discoverCta.bodyStage" : "discoverCta.bodyOneDay";
  const showCountdown = Number.isFinite(startAtMs) && Number.isFinite(nowMs);

  return (
    <Card className="mb-5 p-5 flex flex-col sm:flex-row sm:items-center gap-4" data-testid="team-selection-cta">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <span className="flex-shrink-0 mt-0.5 text-cz-accent-t" aria-hidden="true">
          <FlagIcon size={20} />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-cz-1 text-sm">{t("discoverCta.title")}</h2>
          <p className="text-cz-3 text-xs mt-0.5">{t(bodyKey, { race: nextRace.name })}</p>
          {showCountdown && (
            <p className="text-cz-3 text-3xs mt-1 tabular-nums">{formatCountdown(startAtMs, nowMs, t)}</p>
          )}
        </div>
      </div>
      {/* #2288 F — landede tidligere øverst på race-siden uden at vise
          udtagelses-panelet; #selection-anchoret får RaceDetailPage til at
          scrolle direkte ned til RaceSelectionPanel ved load. */}
      <Link
        to={`/races/${nextRace.id}#selection`}
        className={`flex-shrink-0 self-start sm:self-auto ${buttonClass({ variant: primary ? "primary" : "secondary", size: "sm" })}`}
      >
        {t("discoverCta.action")}
      </Link>
    </Card>
  );
}
