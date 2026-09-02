import RiderLink from "./RiderLink";
import RaceLink from "./RaceLink";
import { TrophyIcon, ChevronRightIcon } from "./ui";

// #3398 (Maiden Win Engine) — DEN ene editorial moment-kort-visning, delt
// mellem dashboardet (MaidenWinMomentCard.jsx) og løbssiden (RaceDetailPage.jsx),
// så "MAIDEN VICTORY — Jonas Krogh, 21, wins his first race in club colours"
// altid ser ens ud uanset flade. i18n-namespace er ALTID "dashboard" (samme
// nøgler genbruges begge steder — ingen dubleret copy).
export const EVENT_LABEL_KEY = {
  maiden_win: "maidenWin",
  first_podium: "firstPodium",
  first_jersey: "firstJersey",
  club_milestone_win: "clubMilestoneWin",
};

export default function CareerFirstMomentRow({ event, t, isNew = false, showRaceLink = true }) {
  const labelKey = EVENT_LABEL_KEY[event.event_type] ?? "maidenWin";
  const age = event.params?.age;
  const raceName = event.params?.raceName;

  return (
    <div className="py-3 border-b border-cz-border last:border-0">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-cz-accent/10 text-cz-accent-t flex-shrink-0">
          <TrophyIcon size={14} />
        </span>
        <h3 className="font-display text-sm tracking-[0.04em] uppercase text-cz-1 m-0">
          {t(`dashboard:cards.maidenWin.headline.${labelKey}`)}
        </h3>
        {isNew && (
          <span className="text-3xs uppercase tracking-wide px-2 py-0.5 rounded-full border bg-cz-accent/10 text-cz-accent-t border-cz-accent/30 flex-shrink-0">
            {t("dashboard:cards.myResult.newBadge")}
          </span>
        )}
      </div>
      <p className="text-cz-2 text-sm m-0">
        {event.rider_id ? (
          <RiderLink id={event.rider_id} className="text-cz-1 font-semibold hover:underline">
            {event.rider_name || t("dashboard:cards.maidenWin.unknownRider")}
          </RiderLink>
        ) : (
          <span className="text-cz-1 font-semibold">{event.rider_name || t("dashboard:cards.maidenWin.unknownRider")}</span>
        )}
        {Number.isFinite(age) && <span className="text-cz-3">, {age}</span>}
        {" "}
        {t(`dashboard:cards.maidenWin.body.${labelKey}`, {
          race: raceName || "",
          count: event.params?.milestoneCount ?? "",
          team: event.team_name || "",
        })}
      </p>
      {showRaceLink && event.race_id && (
        <RaceLink id={event.race_id} className="inline-flex items-center gap-0.5 text-cz-accent-t text-xs hover:underline mt-1">
          {t("dashboard:cards.maidenWin.viewRace")}
          <ChevronRightIcon size={13} aria-hidden="true" />
        </RaceLink>
      )}
    </div>
  );
}
