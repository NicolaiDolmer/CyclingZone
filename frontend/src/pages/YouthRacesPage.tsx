// YouthRacesPage: Youth races, v1 (#5631, plan S8).
//
// T2 wide data (docs/design/PAGE_TEMPLATES.md), samme 1600px-container,
// PageHeader og underline-faner som trup-siderne. Sidehovedets action-cluster
// har præcis ÉN Select (U23 team / Junior team), ingen guld-knap: "Set
// tactics" hører til ungdomskalenderen og kommer først med den (plan S8).
//
// Faner: Standings · Calendar · Results.
//   • Standings viser én ungdomsgruppe ad gangen (holdets egen som standard,
//     ellers gruppe A), valgt i tabellens toolbar. Ingen samlet placering på
//     tværs af grupper: placeringen er serverens rank_in_pool, og klienten
//     regner aldrig en placering ud selv.
//   • Calendar og Results er tomme tilstande indtil ungdomskalenderen findes.
//
// Bag kontakten youth_squad_pages (v1 genbruger trup-sidernes kontakt, spec Y7
// S8): slukket svarer stillings-endpointet 409, og siden sender videre til
// /standings, så en gammel URL aldrig viser en halv side. Intet menupunkt i
// v1; siden nås fra Standings-fanen på U23 team- og Junior team-siden.
//
// Hard rule 31: nye frontend-filer skrives i .ts/.tsx.
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { SkeletonLines } from "../components/ui/index.js";
import { buttonClass } from "../components/ui/buttonStyles.js";
import { ErrorState, PageHeader, Select, Tab, TabList, Tabs } from "../components/squad/squadUi.ts";
import { YouthRacesEmptyState } from "../components/squad/SquadEmptyStates.tsx";
import YouthStandingsTable from "../components/squad/YouthStandingsTable.tsx";
import { useOwnTeamId, useYouthStandings } from "../components/squad/useYouthStandings.ts";
import { youthRacesHref, youthRacesPoolFromSearch, youthRacesSquadFromSearch } from "../components/squad/youthRoutes.ts";
import { groupLetter, hasYouthResults, poolForTeam, type YouthStandingsPool } from "../lib/youthRankingsClient.ts";
import { YOUTH_SQUADS, isYouthSquad, type YouthSquad } from "../lib/youthSquadPages.ts";

type RacesTabKey = "standings" | "calendar" | "results";
const TAB_ORDER: RacesTabKey[] = ["standings", "calendar", "results"];

export default function YouthRacesPage() {
  const location = useLocation();
  const squad = youthRacesSquadFromSearch(location.search);
  // key: skift af trup nulstiller fane og data.
  return <YouthRacesView key={squad} squad={squad} initialPool={youthRacesPoolFromSearch(location.search)} />;
}

function YouthRacesView({ squad, initialPool }: { squad: YouthSquad; initialPool: number | null }) {
  const { t } = useTranslation("squad");
  const navigate = useNavigate();
  const myTeamId = useOwnTeamId();
  const { status, pools, reload } = useYouthStandings(squad);
  const [tab, setTab] = useState<RacesTabKey>("standings");
  const [pickedPool, setPickedPool] = useState<number | null>(initialPool);

  if (status === "disabled") return <Navigate to="/standings" replace />;

  const tabLabel: Record<RacesTabKey, string> = {
    standings: t("tabs.standings"),
    calendar: t("tabs.calendar"),
    results: t("tabs.results"),
  };

  const squadSelect = (
    <Select
      size="sm"
      aria-label={t("youthRaces.squadLabel")}
      value={squad}
      onChange={(e) => {
        const next = e.target.value;
        if (isYouthSquad(next)) navigate(youthRacesHref(next), { replace: true });
      }}
    >
      {YOUTH_SQUADS.map((s) => <option key={s} value={s}>{t(`page.fallbackTitle.${s}`)}</option>)}
    </Select>
  );

  return (
    <div className="max-w-[1600px] mx-auto" data-testid={`youth-races-${squad}`}>
      <PageHeader title={t("youthRaces.title")} subtitle={t(`youthRaces.subtitle.${squad}`)} actions={squadSelect} />

      <Tabs value={tab} onChange={(next) => setTab(next as RacesTabKey)} className="mb-5">
        <TabList label={t("youthRaces.tabsLabel")}>
          {TAB_ORDER.map((key) => <Tab key={key} value={key}>{tabLabel[key]}</Tab>)}
        </TabList>
      </Tabs>

      {tab === "standings" && (
        <StandingsBody
          squad={squad}
          status={status}
          pools={pools}
          myTeamId={myTeamId}
          pickedPool={pickedPool}
          onPickPool={(id) => {
            setPickedPool(id);
            navigate(youthRacesHref(squad, id), { replace: true });
          }}
          onRetry={() => { void reload(); }}
        />
      )}
      {(tab === "calendar" || tab === "results") && <YouthRacesEmptyState squad={squad} tab={tab} />}
    </div>
  );
}

function poolName(pool: YouthStandingsPool, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const letter = groupLetter(pool.index);
  if (letter) return t("standings.group", { letter });
  return pool.label ?? t("standings.ownGroup");
}

function StandingsBody({ squad, status, pools, myTeamId, pickedPool, onPickPool, onRetry }: {
  squad: YouthSquad;
  status: string;
  pools: YouthStandingsPool[];
  myTeamId: string | null;
  pickedPool: number | null;
  onPickPool: (id: number) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation("squad");

  if (status === "loading") return <SkeletonLines lines={6} />;
  if (status === "error") {
    return (
      <ErrorState
        title={t("standings.error.title")}
        description={t("standings.error.description")}
        action={
          <button type="button" onClick={onRetry} className={buttonClass({ variant: "secondary", size: "sm" })}>
            {t("error.retry")}
          </button>
        }
      />
    );
  }
  if (status !== "ready" || !hasYouthResults(pools)) return <YouthRacesEmptyState squad={squad} tab="standings" />;

  // Kun rigtige grupper i vælgeren; hold uden gruppe (serverens egen
  // partition) er ikke en gruppe man kan vælge.
  const groups = pools.filter((p) => p.id != null);
  const selected = groups.find((p) => p.id === pickedPool)
    ?? poolForTeam(groups, myTeamId)
    ?? groups[0]
    ?? null;
  if (!selected || selected.id == null) return <YouthRacesEmptyState squad={squad} tab="standings" />;

  const name = poolName(selected, t);
  return (
    <YouthStandingsTable
      squad={squad}
      rows={selected.rows}
      myTeamId={myTeamId}
      label={name}
      toolbar={
        <div className="flex items-center gap-2">
          <label htmlFor="youth-group" className="text-xs text-cz-3 select-none">{t("standings.groupLabel")}</label>
          <Select
            id="youth-group"
            size="sm"
            value={String(selected.id)}
            onChange={(e) => onPickPool(Number(e.target.value))}
          >
            {groups.map((p) => <option key={String(p.id)} value={String(p.id)}>{poolName(p, t)}</option>)}
          </Select>
        </div>
      }
    />
  );
}
