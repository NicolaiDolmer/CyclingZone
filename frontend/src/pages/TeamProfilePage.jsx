import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import RiderLink from "../components/RiderLink";
import { supabase } from "../lib/supabase";
import { statStyle } from "../lib/statColor";
import { ABILITY_STATS as STATS, ABILITY_SELECT, flattenAbilities } from "../lib/abilities";
import { CONDITION_SELECT, flattenCondition, isRiderInjured } from "../lib/training.js";
import NationCell from "../components/rider/NationCell";
import RiderBadges from "../components/rider/RiderBadges";
import RiderTypeBadge from "../components/rider/RiderTypeBadge";
import { ageBadgeKey, getRiderAge } from "../lib/riderAge";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import OnlineBadge from "../components/OnlineBadge";
import { initialsFrom } from "../components/ui/avatarStyles.js";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";
import { FounderHeroLine } from "../components/FounderMark";
import { sortRidersForTable } from "../lib/riderTableSort";
import { cycleSortState } from "../lib/riderSort";
import { getCountryCode3 } from "../lib/countryUtils";
import { formatNumber } from "../lib/intl";
import TeamTransferHistoryTab from "../components/TeamTransferHistoryTab";
import TeamResultsTab from "../components/TeamResultsTab";
import TeamPalmaresTab from "../components/TeamPalmaresTab";
import TeamClubTab from "../components/TeamClubTab";
import {
  PageLoader,
  Button,
  CategoryTag,
  Section,
  SectionHeader,
  EmptyState,
  ErrorState,
  Tabs,
  TabList,
  Tab,
  TeamIcon,
  ChevronLeftIcon,
  DataTable,
  Segmented,
  HeroStats,
} from "../components/ui";
import { TEAM_PROFILE_TABS as TABS, resolveTeamProfileTab } from "../lib/teamProfileTabs.js";

// Gyldige tab-nøgler — ?tab= i URL'en (fx ranglistens holdnavn-link → results, #824).
// #1997 holdside-slice: "palmares" tilføjet efter "results" (spejler rytterprofilens
// fane-rækkefølge — Resultater → Palmarès).
// #2601: "club" tilføjet — read-only Staff + Facilities for ETHVERT hold (eget eller
// andres), samme fane-mønster som results/palmares/transfers (selv-hentende, teamId-prop).
// #3916: listen selv + default-reglen bor nu i lib/teamProfileTabs.js (testbar
// uden at rendere komponenten) — TABS her er blot et alias for bagudkompatibilitet.

// Stat-kolonner = de 15 CZ-evner (delt config lib/abilities.js, importeret som STATS).
// #1529: erstattede de 14 PCM stat_*-kolonner — visningen viser nu evner. Korte
// labels = STATS[i].label (ABILITY_SHORT, oversættes ikke, jf. #487).
// #1755: SortTh er nu delt (components/rider/RiderSortTh) — fælles sort-adfærd.

// #2849 bølge 5 gav siden en lokal HeroStatBlock-kopi. #4628: opskriften bor nu
// i kittet (components/ui/HeroStats) og stabler i to kolonner på mobil — den
// lokale kopi klippede holdets sidste stat-blokke væk på 375px.

export default function TeamProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation("team");
  const { t: tGR } = useTranslation("globalRank");
  // #4628: ryttertypen foldes ind i navnecellens underlinje på mobil og skal
  // dér være TEKST — samme kilde som Akademiets fold bruger.
  const { t: tTypes } = useTranslation("riderTypes");
  // #3071: sæson-referenceår til alders-visning/badges (se riderAge.js).
  const seasonYear = useActiveSeasonYear();
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [standing, setStanding] = useState(null);
  // #2453: Global Rank-placering vist i hold-headeren. null = ikke hentet/skjult
  // (fx inaktiv manager — global_rank_mv-rækken har global_rank=null da).
  const [globalRank, setGlobalRank] = useState(null);
  const [managerStatus, setManagerStatus] = useState({ isOnline: false, lastSeen: null });
  // #1095: eksplicit "nuværende" vs "kommende" trup-visning i stedet for vis/skjul-toggles.
  const [squadView, setSquadView] = useState("current");
  const [loading, setLoading] = useState(true);
  // #2849 bølge 5: adskiller "holdet findes ikke" fra "hentningen fejlede" — samme
  // ærlig-degraderings-mønster som RaceDetailPage (bølge 3): en ægte query-/netværks-
  // fejl får en ErrorState med retry i stedet for den misvisende "not found"-besked.
  const [loadError, setLoadError] = useState(false);
  const [myTeamId, setMyTeamId] = useState(null);
  const [tableSort, setTableSort] = useState({ key: "market_value", dir: "desc" });
  // #824: ranglistens holdnavn-link åbner resultat-tabben direkte via ?tab=results.
  const [activeTab, setActiveTab] = useState(() => resolveTeamProfileTab(searchParams.get("tab")));

  // #3916 defekt 1: React Router genbruger DENNE komponent-instans når man
  // navigerer fra ét holds side til et andet (samme /teams/:id-route, andet
  // id) — useState-initializeren ovenfor kører kun ved FØRSTE mount, så uden
  // denne effekt "lækker" den forrige holds fane-valg ind på det nye hold i
  // stedet for at nulstille til trup. Effekten er bevidst kun keyet på `id`
  // (ikke `searchParams`) — den skal reagere på HOLD-skift, ikke på fane-
  // skift (det håndteres af changeTab nedenfor, som selv skriver til URL'en).
  useEffect(() => {
    setActiveTab(resolveTeamProfileTab(searchParams.get("tab")));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bevidst kun keyet på id: hold-skift skal nulstille fanen, faneskift skal ikke
  }, [id]);

  // #3916 defekt 2: fane-valget spejles nu i URL'en (?tab=), med replace-
  // navigation (ingen historik-spam ved almindelige faneskift, samme mønster
  // som RaceDetailPage.jsx's changeTab for ?stage=N). Det betyder at et link
  // væk fra siden (fx til en rytterprofil) forlader browseren på en URL der
  // stadig peger på den fane brugeren var på — browser-tilbage lander derfor
  // på den rigtige fane igen, uden at kræve en separat "gendan fra URL"-effekt.
  const changeTab = useCallback((tab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === "squad") next.delete("tab"); // "squad" er default — hold URL'en ren
    else next.set("tab", tab);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  function handleSort(key) {
    // #1755: delt cyklus-logik. tableSort bruger {key,dir}; cycleSortState taler
    // {sort,dir} — oversæt frem og tilbage så samme regel gælder alle tabeller.
    setTableSort(s => {
      const next = cycleSortState({ sort: s.key, dir: s.dir }, key);
      return { key: next.sort, dir: next.dir };
    });
  }

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) { setLoading(false); return; }
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (myTeam) setMyTeamId(myTeam.id);

    const [teamRes, ridersRes, pendingRes, standingRes, globalRankRes] = await Promise.all([
      supabase.from("teams").select("*, manager:user_id(last_seen)").eq("id", id).single(),
      supabase.from("riders")
        // #1529: evnerne hentes via join (ABILITY_SELECT) + flades op på rytter-objektet
        // med flattenAbilities, så rider.climbing osv. virker i render/sort.
        // #1531: rider_condition(injured_until) embeddes til skade-badget (RLS: alle authenticated).
        .select(`id, firstname, lastname, birthdate, market_value, salary, prize_earnings_bonus, current_production_value, is_u25, is_academy, pending_team_id, nationality_code, primary_type, secondary_type, ${ABILITY_SELECT}, ${CONDITION_SELECT}`)
        .eq("team_id", id)
        .order("market_value", { ascending: false }),
      supabase.from("riders")
        // #922: incoming-ryttere manglede nationality_code (var med for current på
        // linje 57), så NationCell fik undefined → intet flag på "se andet hold"-siden.
        .select(`id, firstname, lastname, birthdate, market_value, salary, prize_earnings_bonus, current_production_value, is_u25, is_academy, pending_team_id, nationality_code, primary_type, secondary_type, ${ABILITY_SELECT}, ${CONDITION_SELECT}`)
        .eq("pending_team_id", id)
        .order("market_value", { ascending: false }),
      supabase.from("season_standings")
        // #1095: join sæson-nummer + status, så "Sæsonresultater" kan vise HVILKEN
        // sæson tallene gælder (igangværende vs afsluttet) i stedet for at ligne nutid.
        .select("*, season:season_id(number, status)").eq("team_id", id)
        .order("updated_at", { ascending: false }).limit(1).single(),
      // #2453: Global Rank-placering (null hvis inaktiv/ikke rankeret — skjules i UI).
      supabase.from("global_rank_mv").select("global_rank, global_points").eq("team_id", id).maybeSingle(),
    ]);

    // #2849 bølge 5: en ægte query-/netværksfejl (error != null) er noget andet end
    // en gyldig "holdet findes ikke" — kun sidstnævnte er notFound; førstnævnte får
    // en retry-mulighed (samme skelnen som RaceDetailPage, bølge 3).
    if (teamRes.error) {
      console.warn("TeamProfilePage: teams fetch failed:", teamRes.error.message);
      setLoadError(true);
      setLoading(false);
      return;
    }

    setGlobalRank(globalRankRes?.data?.global_rank != null ? globalRankRes.data : null);
    setTeam(teamRes.data);
    const lastSeen = teamRes.data?.manager?.last_seen || null;
    const isOnline = lastSeen ? (Date.now() - new Date(lastSeen).getTime()) < 5 * 60 * 1000 : false;
    setManagerStatus({ isOnline, lastSeen });
    // #1531: flattenCondition løfter rider_condition.injured_until op til skade-badget.
    const current = (ridersRes.data || []).map(r => ({
      ...flattenCondition(flattenAbilities(r)), _isOutgoing: r.pending_team_id && r.pending_team_id !== id,
    }));
    const incoming = (pendingRes.data || []).map(r => ({ ...flattenCondition(flattenAbilities(r)), _isIncoming: true }));
    setRiders([...current, ...incoming]);
    setStanding(standingRes.data);
    setLoading(false);
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // #2849 bølge 5c: T3-kort-anatomi (ejer-revision 24/7) — hero'en er et kort
  // med back-link OVER sig, ikke et full-bleed-bånd. Layout's full-bleed-route-
  // bucket giver stadig ingen padding/cap, så loading/fejl/not-found-grenene
  // sætter selv den samme ydre max-w-5xl-container som happy-path'en.
  if (loading) return (
    <div className="max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8">
      <PageLoader />
    </div>
  );

  if (loadError) return (
    <div className="max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8">
      <button type="button" onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1 transition-colors mb-3">
        <ChevronLeftIcon size={16} />{t("profile.back")}
      </button>
      <ErrorState
        description={t("profile.loadError.message")}
        action={<Button size="sm" variant="secondary" onClick={loadAll}>{t("profile.loadError.retry")}</Button>}
      />
    </div>
  );

  if (!team) return (
    <div className="max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8">
      <button type="button" onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1 transition-colors mb-3">
        <ChevronLeftIcon size={16} />{t("profile.back")}
      </button>
      <EmptyState icon={<TeamIcon size={26} aria-hidden="true" />} title={t("profile.notFound")} />
    </div>
  );

  const currentRiders = riders.filter(r => !r._isIncoming);
  const incomingRiders = riders.filter(r => r._isIncoming);
  const outgoingRiders = riders.filter(r => r._isOutgoing);
  const isMyTeam = team.id === myTeamId;

  // #1092: sortér værdi-kolonnen på den VISTE værdi (getRiderMarketValue),
  // som "Mit Hold" gør — aldrig på en rå/frossen kolonne direkte.
  // #1095: nuværende = på holdet nu (inkl. udgående); kommende = efter ventende transfers.
  const upcomingCount = riders.filter(r => !r._isOutgoing).length;
  const displayRiders = sortRidersForTable(
    squadView === "upcoming"
      ? riders.filter(r => !r._isOutgoing)
      : riders.filter(r => !r._isIncoming),
    tableSort);

  const hasTransfers = incomingRiders.length > 0 || outgoingRiders.length > 0;
  const totalValue = currentRiders.reduce((s, r) => s + getRiderMarketValue(r), 0);

  // #4628: kolonne-kontrakten. Nation/alder/type foldes ind i navnecellens
  // underlinje på ≤640px (samme fold-sæt som Akademiet og /riders bruger);
  // Status, Værdi og de 15 evner scroller vandret under den pinnede navne-
  // kolonne. Ingen kolonne forsvinder længere på mobil.
  const squadColumns = [
    {
      key: "nation",
      header: t("profile.thNation"),
      sortKey: "nationality_code",
      compact: true,
      fold: true,
      foldValue: (r) => getCountryCode3(r.nationality_code) || "—",
      render: (r) => <NationCell code={r.nationality_code} />,
    },
    {
      key: "name",
      header: t("profile.thRider"),
      sticky: true,
      sortKey: "firstname",
      render: (r) => (
        <>
          <RiderLink id={r.id} stopPropagation
            className="text-cz-1 hover:text-cz-accent-t transition-colors">
            {r.firstname} {r.lastname}
          </RiderLink>
          {/* #1531: skade-badget bliver ved navnet — Status-kolonnen scroller
              væk på mobil, og en skade skal kunne ses uden at scrolle. */}
          {isRiderInjured(r.injured_until) && <RiderBadges badges={["injured"]} />}
        </>
      ),
    },
    {
      key: "badges",
      header: t("profile.thBadges"),
      // #1755: Status sortérbar på alders-tier — som på eget hold (#1482).
      sortKey: "is_u25",
      compact: true,
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <RiderBadges badges={[
            isRiderInjured(r.injured_until) && "injured",
            r.is_academy && "academy",
            ageBadgeKey(r, seasonYear),
            r._isIncoming && "incoming",
            r._isOutgoing && "outgoing",
          ]} />
        </div>
      ),
    },
    {
      key: "age",
      header: t("profile.thAge"),
      sortKey: "birthdate",
      numeric: true,
      compact: true,
      fold: true,
      foldValue: (r) => String(getRiderAge(r.birthdate, seasonYear) ?? "—"),
      render: (r) => <span className="text-cz-2">{getRiderAge(r.birthdate, seasonYear) ?? "—"}</span>,
    },
    {
      key: "type",
      header: t("profile.thType"),
      sortKey: "primary_type",
      compact: true,
      fold: true,
      foldValue: (r) => {
        if (!r.primary_type) return "";
        const primary = tTypes(`types.${r.primary_type}`);
        const hasSecondary = r.secondary_type && r.secondary_type !== r.primary_type;
        return hasSecondary ? `${primary}/${tTypes(`types.${r.secondary_type}`)}` : primary;
      },
      render: (r) => <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} stacked />,
    },
    {
      key: "value",
      header: t("profile.thValue"),
      sortKey: "market_value",
      numeric: true,
      compact: true,
      render: (r) => (
        <span className="text-cz-accent-t font-bold">
          {formatCz(getRiderMarketValue(r)).replace(" CZ$", "")}
        </span>
      ),
    },
    ...STATS.map(({ key, label }) => ({
      key,
      header: label,
      sortKey: key,
      numeric: true,
      tight: true,
      render: (r) => (
        <span className="inline-block min-w-[24px] text-center text-xs font-mono px-1 py-0.5 rounded"
          style={statStyle(r[key] || 0)}>
          {r[key] || "-"}
        </span>
      ),
    })),
  ];

  // #2849 bølge 5: hero stat-række — de fire altid-kendte holdtal + (hvis en
  // sæsonplacering findes) point/etapesejre/GC-sejre. Erstatter de to separate
  // håndrullede kort ("Header"-statistik + "Season standing") fra før-T3-versionen.
  const statBlocks = [
    { label: t("profile.statRidersNow"), value: String(currentRiders.length) },
    { label: t("profile.statIncoming"), value: String(incomingRiders.length) },
    { label: t("profile.statOutgoing"), value: String(outgoingRiders.length) },
    { label: t("profile.statTeamValue"), value: `${formatNumber(totalValue)} CZ$` },
    ...(standing ? [
      {
        label: t("profile.seasonPoints"),
        value: String(formatNumber(standing.total_points) || 0),
        sub: standing.season?.number != null
          ? `${t("profile.seasonLabel", { n: standing.season.number })}${
              standing.season.status ? ` · ${standing.season.status === "active" ? t("profile.seasonOngoing") : t("profile.seasonFinished")}` : ""
            }`
          : null,
      },
      { label: t("profile.seasonStageWins"), value: String(standing.stage_wins || 0) },
      { label: t("profile.seasonGcWins"), value: String(standing.gc_wins || 0) },
    ] : []),
  ];

  const TAB_LABELS = {
    squad: t("profile.tabSquad", { count: currentRiders.length }),
    results: t("profile.tabResults"),
    palmares: t("profile.tabPalmares"),
    transfers: t("profile.tabTransfers"),
    club: t("profile.tabClub"),
  };

  return (
    <div>
      {/* #2849 bølge 5c: ejer-revision 24/7 (2. iteration) — hero'en er et KORT
          igen, ikke et full-bleed-bånd. Guldlinjen (T3-signatur) følger kortets
          afrundede topkant, back-linket ligger over kortet, og tabs står under
          kortet på sidens baggrund (rytterprofil-mønstret, RiderStatsPage). */}
      <div className="max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8">
        <button type="button" onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1 transition-colors mb-3">
          <ChevronLeftIcon size={16} />{t("profile.back")}
        </button>

        <section className="bg-cz-card border border-cz-border border-t-2 border-t-cz-accent rounded-cz overflow-hidden px-4 md:px-6 pt-5 pb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
            <div className="min-w-0 flex items-start gap-4 sm:gap-5">
              {/* Identitets-slot (hold → initialer; hold får ikke fotos, så
                  ingen "PHOTO"-label — kun rytter/staff-slottet bærer den). */}
              <div className="mt-1 w-20 h-20 sm:w-24 sm:h-24 flex-none bg-cz-subtle border border-cz-border rounded-cz flex items-center justify-center">
                <span aria-hidden="true" className="font-display text-[26px] sm:text-[30px] leading-none text-cz-2">
                  {initialsFrom(team.name)}
                </span>
              </div>
              <div className="min-w-0">
                {/* Holdnavnet FØRST (sidens vigtigste ord) — tags/meta UNDER navnet. */}
                <h1 className="font-display text-[40px] leading-[.92] uppercase text-cz-1 break-words">{team.name}</h1>
                {/* #4649: "Founder supporter no. N of 50" under holdnavnet — synligt for ALLE besøgende. */}
                <FounderHeroLine teamId={team.id} className="mt-1" />
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  {isMyTeam && <CategoryTag>{t("profile.yourTeam")}</CategoryTag>}
                  <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">
                    {t("profile.division", { n: team.division })}
                  </span>
                  {team.manager_name && (
                    <>
                      <span className="text-cz-3 text-2xs" aria-hidden="true">·</span>
                      <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">
                        {t("profile.managerLabel", { name: team.manager_name })}
                      </span>
                      <OnlineBadge isOnline={managerStatus.isOnline} lastSeen={managerStatus.lastSeen} />
                    </>
                  )}
                </div>
              </div>
            </div>
            {globalRank && (
              <div className="flex gap-2 flex-none">
                <Button size="sm" variant="secondary" onClick={() => navigate("/standings?tab=global")}>
                  {tGR("title")} #{globalRank.global_rank}
                </Button>
              </div>
            )}
          </div>
          <HeroStats items={statBlocks} />
        </section>

        {/* Tabs UNDER kortet på sidens baggrund — TabList bærer sin egen
            hairline-bundrule (tabsStyles.js); ingen -mb-px-fusion mod kortet. */}
        <Tabs value={activeTab} onChange={changeTab} className="mt-5">
          <TabList label={t("profile.tabsAriaLabel")}>
            {TABS.map(key => (
              <Tab key={key} value={key}>{TAB_LABELS[key]}</Tab>
            ))}
          </TabList>
        </Tabs>
      </div>

      <div className="max-w-5xl mx-auto pt-5 px-4 md:px-8 pb-24 md:pb-16">
        <div className="flex flex-col gap-[14px]">

          {activeTab === "results" && (
            <TeamResultsTab teamId={id} isOwnTeam={isMyTeam} />
          )}

          {/* #1997 holdside-slice — sæson-for-sæson-historik, karrieretotaler + æresliste. */}
          {activeTab === "palmares" && (
            <TeamPalmaresTab teamId={id} />
          )}

          {activeTab === "transfers" && (
            <TeamTransferHistoryTab teamId={id} />
          )}

          {activeTab === "club" && (
            <TeamClubTab teamId={id} />
          )}

          {/* #4628 (slice 3 af #4622, audit 2026-09 række #31): truppen brugte
              sin egen kopi af tabel-markuppen, hvor Status/Alder/Type var
              `hidden sm:table-cell` — på 375px forsvandt de HELT: hverken foldet
              ind i navnecellens underlinje eller nåelige ved vandret scroll
              (TASTE P10 / PAGE_TEMPLATES T2's mobil-regel). Den kanoniske
              DataTable ejer begge dele: pinned navnekolonne, ubetinget vandret
              scroll, og `fold` der lægger nation/alder/type i underlinjen. */}
          {activeTab === "squad" && (
            <Section>
              <SectionHeader title={t("profile.squadTitle", { count: currentRiders.length })} />
              {squadView === "upcoming" && hasTransfers && (
                <p className="text-cz-3 text-xs mb-3">{t("profile.viewUpcomingHint")}</p>
              )}
              {displayRiders.length === 0 ? (
                <EmptyState icon={<TeamIcon size={26} aria-hidden="true" />} title={t("profile.noRiders")} />
              ) : (
                <DataTable
                  label={t("profile.squadTitle", { count: currentRiders.length })}
                  columns={squadColumns}
                  rows={displayRiders}
                  rowKey={(r) => r.id}
                  dense
                  rowZone={(r) => (r._isIncoming ? "success" : r._isOutgoing ? "danger" : null)}
                  rowProps={(r) => ({ onClick: () => navigate(`/riders/${r.id}`), className: "cursor-pointer" })}
                  sort={tableSort.key}
                  sortDir={tableSort.dir}
                  onSort={handleSort}
                  toolbar={hasTransfers && (
                    <Segmented
                      label={t("profile.squadTitle", { count: currentRiders.length })}
                      value={squadView}
                      onChange={setSquadView}
                      options={[
                        { value: "current", label: t("profile.viewCurrent", { count: currentRiders.length }) },
                        { value: "upcoming", label: t("profile.viewUpcoming", { count: upcomingCount }) },
                      ]}
                    />
                  )}
                />
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
