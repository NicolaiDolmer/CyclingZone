// #5631 (plan S7): Standings-fanen på U23 team- og Junior team-siden.
//
// Viser KUN holdets egen ungdomsgruppe (plan S7: "kun egen pulje"); de andre
// grupper står på Youth races. Tilstandene, i rækkefølge:
//   • endpointet er slukket eller ikke deployet endnu, eller ingen hold har
//     kørt et ungdomsløb: samme tomme tilstand som før (ingen tal, P11)
//   • løbene er i gang, men holdet er ikke i en gruppe: sig det, peg på
//     Youth races
//   • ellers: gruppens tabel, eget hold markeret.
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { PodiumIcon, SkeletonLines } from "../ui/index.js";
import { buttonClass } from "../ui/buttonStyles.js";
import { EmptyState, ErrorState } from "./squadUi.ts";
import { YouthRacesEmptyState } from "./SquadEmptyStates.tsx";
import YouthStandingsTable from "./YouthStandingsTable.tsx";
import { useYouthStandings } from "./useYouthStandings.ts";
import { groupLetter, hasYouthResults, poolForTeam } from "../../lib/youthRankingsClient.ts";
import { youthRacesHref } from "./youthRoutes.ts";
import type { YouthSquad } from "../../lib/youthSquadPages.ts";

const SECONDARY_SM = `${buttonClass({ variant: "secondary", size: "sm" })} inline-flex`;

export default function YouthStandingsTab({ squad, myTeamId }: { squad: YouthSquad; myTeamId: string | null }) {
  const { t } = useTranslation("squad");
  const { status, pools, reload } = useYouthStandings(squad);

  if (status === "loading") return <SkeletonLines lines={6} />;
  if (status === "error") {
    return (
      <ErrorState
        title={t("standings.error.title")}
        description={t("standings.error.description")}
        action={
          <button type="button" onClick={() => { void reload(); }} className={buttonClass({ variant: "secondary", size: "sm" })}>
            {t("error.retry")}
          </button>
        }
      />
    );
  }
  if (status !== "ready" || !hasYouthResults(pools)) return <YouthRacesEmptyState squad={squad} tab="standings" />;

  const own = poolForTeam(pools, myTeamId);
  const allGroups = youthRacesHref(squad);
  if (!own) {
    return (
      <EmptyState
        icon={<PodiumIcon size={26} aria-hidden="true" />}
        title={t("standings.noGroup.title")}
        description={t(`standings.noGroup.description.${squad}`)}
        action={<Link to={allGroups} className={SECONDARY_SM}>{t("standings.allGroups")}</Link>}
      />
    );
  }

  const letter = groupLetter(own.index);
  const groupName = letter ? t("standings.group", { letter }) : (own.label ?? t("standings.ownGroup"));
  return (
    <YouthStandingsTable
      squad={squad}
      rows={own.rows}
      myTeamId={myTeamId}
      label={groupName}
      toolbar={
        <>
          <span className="text-[13px] font-semibold text-cz-1">{groupName}</span>
          <Link to={allGroups} className="ms-auto text-xs font-medium text-cz-accent-t hover:underline">
            {t("standings.allGroups")}
          </Link>
        </>
      }
    />
  );
}
