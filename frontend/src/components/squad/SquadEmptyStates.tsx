// #5519: de tomme tilstande på U23 team- og Junior team-siden.
//
// TASTE P6 / fork 4: stroke-ikon, titel som HANDLING, én sætning med et
// konkret faktum, én sekundær sm-knap der fører derhen. Aldrig guld her:
// sidens eneste guld-knap (Set tactics, HANDOFF pkt. 7) kommer først med
// ungdomsløbene.
//
// Calendar og Results viser ungdomsløbene siden #5843 (YouthRacesTab); tom
// tilstand kun når holdet ingen ungdomspulje eller løb har. Standings er tom
// indtil første løb er kørt. Ingen tal, ingen tomme tabeller og intet løfte om
// en dato (TASTE P11), kun hvor man kan følge med: roadmappen.
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { BikeIcon, CalendarIcon, FlagIcon, PodiumIcon } from "../ui/index.js";
import { buttonClass } from "../ui/buttonStyles.js";
import { EmptyState } from "./squadUi.ts";
import type { YouthSquad } from "../../lib/youthSquadPages.ts";

const SECONDARY_SM = `${buttonClass({ variant: "secondary", size: "sm" })} inline-flex`;

export function YouthSquadEmptyState({ squad }: { squad: YouthSquad }) {
  const { t } = useTranslation("squad");
  return (
    <EmptyState
      icon={<BikeIcon size={26} aria-hidden="true" />}
      title={t("empty.squad.title")}
      description={t(`empty.squad.description.${squad}`)}
      action={<Link to="/academy" className={SECONDARY_SM}>{t("empty.squad.action")}</Link>}
    />
  );
}

export type YouthRaceTab = "calendar" | "results" | "standings";

const RACE_ICON: Record<YouthRaceTab, typeof CalendarIcon> = {
  calendar: CalendarIcon,
  results: FlagIcon,
  standings: PodiumIcon,
};

// #5843: noPool = holdet har ingen pulje for truppen. Samme flade og ikon, men
// en tekst der siger hvorfor, så en tom fane kan skelnes fra "ingen løb endnu".
export function YouthRacesEmptyState({ squad, tab, noPool = false }: { squad: YouthSquad; tab: YouthRaceTab; noPool?: boolean }) {
  const { t } = useTranslation("squad");
  const Icon = RACE_ICON[tab];
  return (
    <EmptyState
      icon={<Icon size={26} aria-hidden="true" />}
      title={noPool ? t("youthRaces.noPool.title") : t("empty.races.title")}
      description={noPool ? t(`youthRaces.noPool.${squad}`) : t(`empty.races.${tab}.${squad}`)}
      action={<Link to="/roadmap" className={SECONDARY_SM}>{t("empty.races.action")}</Link>}
    />
  );
}
