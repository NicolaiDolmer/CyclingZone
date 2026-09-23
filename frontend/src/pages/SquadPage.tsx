// SquadPage: U23 team- og Junior team-siden (#5519, roadbook-løftet "U23 team
// and junior team become real squads").
//
// Bygget efter den ejer-godkendte hi-fi 2/9 (docs/design/youth-tiers/HANDOFF.md,
// artboard 3a + 3c): to Klubhus-menupunkter efter My Team, og "all three squad
// pages share the My Team template". T2 (docs/design/PAGE_TEMPLATES.md): samme
// 1600px-container, samme PageHeader, samme meta-linje, samme underline-faner og
// samme DataTable som My Team. Ingen egen bredde, radius eller typografi.
//
// Faner (HANDOFF pkt. 2): Squad · Calendar · Results · Standings · Development.
//   • Squad og Development viser ægte data: truppen afgøres server-side
//     (GET /api/youth-squads → effectiveSquad), visningen er My Teams.
//   • Calendar, Results og Standings er tomme tilstande indtil ungdomsløb
//     findes. Ingen tal for løb der ikke findes (TASTE P11).
//
// Bag kontakten youth_squad_pages: slukket svarer serveren 409, og siden sender
// videre til My Team, så en gammel URL aldrig viser en halv side.
//
// Hard rule 31: nye frontend-filer skrives i .ts/.tsx.
import { useState } from "react";
import { Navigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useScouting } from "../lib/useScouting.js";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import { getRiderMarketValue } from "../lib/marketValues.js";
import { formatNumber } from "../lib/intl.js";
import { isYouthSquad, type YouthSquad } from "../lib/youthSquadPages.ts";
import { PageLoader } from "../components/ui/index.js";
import { buttonClass } from "../components/ui/buttonStyles.js";
import TeamDevelopmentTab from "../components/TeamDevelopmentTab.jsx";
import { ErrorState, PageHeader, Tab, TabList, Tabs } from "../components/squad/squadUi.ts";
import { useYouthSquad } from "../components/squad/useYouthSquad.ts";
import YouthSquadTable from "../components/squad/YouthSquadTable.tsx";
import { YouthRacesEmptyState, YouthSquadEmptyState } from "../components/squad/SquadEmptyStates.tsx";

type SquadTabKey = "squad" | "calendar" | "results" | "standings" | "development";
const TAB_ORDER: SquadTabKey[] = ["squad", "calendar", "results", "standings", "development"];

export default function SquadPage() {
  const { squad } = useParams();
  if (!isYouthSquad(squad)) return <Navigate to="/team" replace />;
  // key: skift mellem U23 og Junior nulstiller fane og data.
  return <YouthSquadView key={squad} squad={squad} />;
}

function YouthSquadView({ squad }: { squad: YouthSquad }) {
  const { t } = useTranslation("squad");
  const { t: tTeam } = useTranslation("team");
  const scouting = useScouting();
  const seasonYear = useActiveSeasonYear();
  const { status, team, riders, reload } = useYouthSquad(squad);
  const [tab, setTab] = useState<SquadTabKey>("squad");

  if (status === "loading") return <PageLoader />;
  if (status === "disabled") return <Navigate to="/team" replace />;

  const title = team?.name
    ? t(`page.title.${squad}`, { team: team.name })
    : t(`page.fallbackTitle.${squad}`);

  const totalSalary = riders.reduce((sum, r) => sum + (Number(r.salary) || 0), 0);
  const totalValue = riders.reduce((sum, r) => sum + getRiderMarketValue(r), 0);

  const tabLabel: Record<SquadTabKey, string> = {
    squad: tTeam("tabs.squad", { count: riders.length }),
    calendar: t("tabs.calendar"),
    results: t("tabs.results"),
    standings: t("tabs.standings"),
    development: tTeam("tabs.development"),
  };

  return (
    <div className="max-w-[1600px] mx-auto" data-testid={`squad-page-${squad}`}>
      <PageHeader title={title} subtitle={t(`page.subtitle.${squad}`)} />

      {status === "error" ? (
        <ErrorState
          title={t("error.title")}
          description={t("error.description")}
          action={
            <button type="button" onClick={() => { void reload(); }}
              className={buttonClass({ variant: "secondary", size: "sm" })}>
              {t("error.retry")}
            </button>
          }
        />
      ) : (
        <>
          {/* Meta-linjen som på My Team (TeamPage.jsx). Kun tal der findes:
              ingen loft-tal (squads.js' SQUAD_CAPS er et sim-startpunkt, P11),
              og antallet står allerede i Squad-fanen (intet tal to gange). */}
          {riders.length > 0 && (
            <div className="-mt-4 mb-5 flex gap-4 flex-wrap text-sm text-cz-3 tabular-nums">
              <span>{tTeam("page.salaryPerSeason", { value: formatNumber(totalSalary) })}</span>
              <span>{t("page.squadValue", { value: formatNumber(totalValue) })}</span>
            </div>
          )}

          <Tabs value={tab} onChange={(next) => setTab(next as SquadTabKey)} className="mb-5">
            <TabList label={t("tabs.ariaLabel")}>
              {TAB_ORDER.map((key) => (
                <Tab key={key} value={key}>{tabLabel[key]}</Tab>
              ))}
            </TabList>
          </Tabs>

          {tab === "squad" && (riders.length === 0
            ? <YouthSquadEmptyState squad={squad} />
            : <YouthSquadTable riders={riders} scouting={scouting} seasonYear={seasonYear} label={tabLabel.squad} />)}
          {tab === "development" && (riders.length === 0
            ? <YouthSquadEmptyState squad={squad} />
            : <TeamDevelopmentTab riders={riders} scouting={scouting} seasonYear={seasonYear} />)}
          {(tab === "calendar" || tab === "results" || tab === "standings") && (
            <YouthRacesEmptyState squad={squad} tab={tab} />
          )}
        </>
      )}
    </div>
  );
}
