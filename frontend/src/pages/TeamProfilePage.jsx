import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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
import OnlineBadge from "../components/OnlineBadge";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";
import { sortRidersForTable } from "../lib/riderTableSort";
import { cycleSortState } from "../lib/riderSort";
import SortTh from "../components/rider/RiderSortTh";
import { formatNumber } from "../lib/intl";
import TeamTransferHistoryTab from "../components/TeamTransferHistoryTab";
import TeamResultsTab from "../components/TeamResultsTab";
import { PageLoader } from "../components/ui";

// Gyldige tab-nøgler — ?tab= i URL'en (fx ranglistens holdnavn-link → results, #824).
const TABS = ["squad", "results", "transfers"];

// Stat-kolonner = de 15 CZ-evner (delt config lib/abilities.js, importeret som STATS).
// #1529: erstattede de 14 PCM stat_*-kolonner — visningen viser nu evner. Korte
// labels = STATS[i].label (ABILITY_SHORT, oversættes ikke, jf. #487).
// #1755: SortTh er nu delt (components/rider/RiderSortTh) — fælles sort-adfærd.

export default function TeamProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation("team");
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [standing, setStanding] = useState(null);
  const [managerStatus, setManagerStatus] = useState({ isOnline: false, lastSeen: null });
  // #1095: eksplicit "nuværende" vs "kommende" trup-visning i stedet for vis/skjul-toggles.
  const [squadView, setSquadView] = useState("current");
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);
  const [tableSort, setTableSort] = useState({ key: "market_value", dir: "desc" });
  // #824: ranglistens holdnavn-link åbner resultat-tabben direkte via ?tab=results.
  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get("tab");
    return TABS.includes(tab) ? tab : "squad";
  });

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
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) { setLoading(false); return; }
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (myTeam) setMyTeamId(myTeam.id);

    const [teamRes, ridersRes, pendingRes, standingRes] = await Promise.all([
      supabase.from("teams").select("*, manager:user_id(last_seen)").eq("id", id).single(),
      supabase.from("riders")
        // #1529: evnerne hentes via join (ABILITY_SELECT) + flades op på rytter-objektet
        // med flattenAbilities, så rider.climbing osv. virker i render/sort.
        // #1531: rider_condition(injured_until) embeddes til skade-badget (RLS: alle authenticated).
        .select(`id, firstname, lastname, birthdate, market_value, salary, prize_earnings_bonus, is_u25, is_academy, pending_team_id, nationality_code, primary_type, secondary_type, ${ABILITY_SELECT}, ${CONDITION_SELECT}`)
        .eq("team_id", id)
        .order("market_value", { ascending: false }),
      supabase.from("riders")
        // #922: incoming-ryttere manglede nationality_code (var med for current på
        // linje 57), så NationCell fik undefined → intet flag på "se andet hold"-siden.
        .select(`id, firstname, lastname, birthdate, market_value, salary, prize_earnings_bonus, is_u25, is_academy, pending_team_id, nationality_code, primary_type, secondary_type, ${ABILITY_SELECT}, ${CONDITION_SELECT}`)
        .eq("pending_team_id", id)
        .order("market_value", { ascending: false }),
      supabase.from("season_standings")
        // #1095: join sæson-nummer + status, så "Sæsonresultater" kan vise HVILKEN
        // sæson tallene gælder (igangværende vs afsluttet) i stedet for at ligne nutid.
        .select("*, season:season_id(number, status)").eq("team_id", id)
        .order("updated_at", { ascending: false }).limit(1).single(),
    ]);

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

  if (loading) return (
    <PageLoader />
  );

  if (!team) return <div className="text-center py-16 text-cz-3">{t("profile.notFound")}</div>;

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

  // #1675: squad-fanen viser en bred trup-tabel (15 evne-kolonner) — den bruger fuld
  // content-bredde (Layout giver /teams/:id max-w-full, samme som "/team"). Header,
  // sæson-boks, tabs + resultat-/transfer-faner cappes til en læsbar kolonne.
  const isSquadTab = activeTab === "squad";
  return (
    <div className={isSquadTab ? "max-w-full" : "max-w-4xl mx-auto"}>
      <button onClick={() => navigate(-1)}
        className="text-cz-2 hover:text-cz-1 text-sm mb-5 flex items-center gap-2 transition-colors">
        {t("profile.back")}
      </button>

      {/* Header */}
      <div className="bg-cz-card border border-cz-border rounded-cz p-6 mb-4 max-w-4xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <h1 className="text-xl font-bold text-cz-1">{team.name}</h1>
              {isMyTeam && <span className="text-xs bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 px-2 py-0.5 rounded-full">{t("profile.yourTeam")}</span>}
            </div>
            {team.manager_name && (
              <p className="text-cz-2 text-sm flex items-center gap-2">
                <span>{t("profile.managerLabel", { name: team.manager_name })}</span>
                <OnlineBadge isOnline={managerStatus.isOnline} lastSeen={managerStatus.lastSeen} />
              </p>
            )}
            <p className="text-cz-2 text-sm">{t("profile.division", { n: team.division })}</p>
          </div>

        </div>

        <div className="grid grid-cols-4 gap-3 mt-5">
          {[
            { label: t("profile.statRidersNow"), value: currentRiders.length },
            { label: t("profile.statIncoming"), value: incomingRiders.length, color: incomingRiders.length > 0 ? "text-cz-success" : "text-cz-1" },
            { label: t("profile.statOutgoing"), value: outgoingRiders.length, color: outgoingRiders.length > 0 ? "text-cz-danger" : "text-cz-1" },
            { label: t("profile.statTeamValue"), value: `${formatNumber(totalValue)} CZ$`, color: "text-cz-accent-t" }, // value shown, balance hidden
          ].map(s => (
            <div key={s.label} className="bg-cz-subtle rounded-lg p-3 text-center">
              <p className="text-cz-3 text-[9px] uppercase tracking-wider mb-1">{s.label}</p>
              <p className={`font-mono font-bold text-sm ${s.color || "text-cz-1"}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Season standing */}
      {standing && (
        <div className="bg-cz-card border border-cz-border rounded-cz p-5 mb-4 max-w-4xl">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h2 className="text-cz-1 font-semibold text-sm">{t("profile.seasonResults")}</h2>
            {/* #1095: tydeliggør HVILKEN sæson resultaterne gælder + om den er afsluttet */}
            {standing.season?.number != null && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cz-subtle border border-cz-border text-cz-2">
                {t("profile.seasonLabel", { n: standing.season.number })}
              </span>
            )}
            {standing.season?.status && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                standing.season.status === "active"
                  ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                  : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                {standing.season.status === "active" ? t("profile.seasonOngoing") : t("profile.seasonFinished")}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: t("profile.seasonPoints"), value: formatNumber(standing.total_points) || 0, color: "text-cz-accent-t" },
              { label: t("profile.seasonStageWins"), value: standing.stage_wins || 0 },
              { label: t("profile.seasonGcWins"), value: standing.gc_wins || 0 },
            ].map(s => (
              <div key={s.label} className="bg-cz-subtle rounded-lg p-3 text-center">
                <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{s.label}</p>
                <p className={`font-mono font-bold text-lg ${s.color || "text-cz-1"}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4 max-w-4xl">
        {[
          { key: "squad", label: t("profile.tabSquad", { count: currentRiders.length }) },
          { key: "results", label: t("profile.tabResults") },
          { key: "transfers", label: t("profile.tabTransfers") },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${activeTab === tab.key ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "results" && (
        <TeamResultsTab teamId={id} isOwnTeam={isMyTeam} />
      )}

      {activeTab === "transfers" && (
        <TeamTransferHistoryTab teamId={id} />
      )}

      {/* Squad with FM toggle */}
      {activeTab === "squad" && (
      <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
        <div className="px-5 py-4 border-b border-cz-border flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-cz-1 font-semibold text-sm">{t("profile.squadTitle", { count: currentRiders.length })}</h2>
          {hasTransfers && (
            <div className="flex rounded-lg border border-cz-border overflow-hidden">
              {[
                { key: "current",  label: t("profile.viewCurrent",  { count: currentRiders.length }) },
                { key: "upcoming", label: t("profile.viewUpcoming", { count: upcomingCount }) },
              ].map(v => (
                <button key={v.key} onClick={() => setSquadView(v.key)}
                  className={`px-2.5 py-1 text-xs font-medium transition-all
                    ${squadView === v.key
                      ? "bg-cz-accent/10 text-cz-accent-t"
                      : "bg-cz-card text-cz-2 hover:text-cz-1"}`}>
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {squadView === "upcoming" && hasTransfers && (
          <p className="px-5 py-2 text-cz-3 text-xs border-b border-cz-border">{t("profile.viewUpcomingHint")}</p>
        )}
        {displayRiders.length === 0 ? (
          <div className="text-center py-12 text-cz-3"><p>{t("profile.noRiders")}</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table data-sortable className="w-full text-xs">
              <thead>
                <tr className="border-b border-cz-border">
                  <SortTh sortKey="nationality_code" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-2 py-3 text-left font-medium uppercase hidden sm:table-cell">{t("profile.thNation")}</SortTh>
                  <SortTh sortKey="firstname" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-4 py-3 text-left font-medium uppercase sticky left-0 z-20 bg-cz-card border-r border-cz-border">{t("profile.thRider")}</SortTh>
                  {/* #1755: Status sortérbar (alders-tier) + Alder/Type som egne
                      sorterbare kolonner — på linje med eget hold (#1482/#1674). */}
                  <SortTh sortKey="is_u25" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-4 py-3 text-left font-medium uppercase hidden sm:table-cell">{t("profile.thBadges")}</SortTh>
                  <SortTh sortKey="birthdate" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-3 py-3 text-center font-medium uppercase hidden sm:table-cell">{t("profile.thAge")}</SortTh>
                  <SortTh sortKey="primary_type" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase hidden sm:table-cell">{t("profile.thType")}</SortTh>
                  <SortTh sortKey="market_value" sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                    className="px-4 py-3 text-right font-medium">{t("profile.thValue")}</SortTh>
                  {STATS.map(({ key, label }) => (
                    <SortTh key={key} sortKey={key} sort={tableSort.key} sortDir={tableSort.dir} onSort={handleSort}
                      className="px-1.5 py-3 text-center font-medium w-10">{label}</SortTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRiders.map(r => (
                  <tr key={r.id}
                    className={`border-b border-cz-border hover:bg-cz-subtle cursor-pointer
                      ${r._isIncoming ? "bg-cz-success-bg0/3" : r._isOutgoing ? "bg-cz-danger-bg0/3" : ""}`}
                    onClick={() => navigate(`/riders/${r.id}`)}>
                    <td className="px-2 py-2.5 hidden sm:table-cell">
                      <NationCell code={r.nationality_code} />
                    </td>
                    <td className="px-4 py-2.5 sticky-name-cell sticky left-0 z-10 border-r border-cz-border shadow-[10px_0_16px_-16px_rgba(0,0,0,0.5)]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <RiderLink id={r.id} stopPropagation
                          className="text-cz-1 font-medium hover:text-cz-accent-t transition-colors">
                          {r.firstname} {r.lastname}
                        </RiderLink>
                        {/* #1531: skade-badge inline på mobil (Status-kolonnen er skjult <sm). */}
                        {isRiderInjured(r.injured_until) && (
                          <span className="sm:hidden">
                            <RiderBadges badges={["injured"]} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <div className="flex flex-wrap items-center gap-1">
                        {/* #1531: skade-badge først i Status-rækken når rytteren er skadet. */}
                        <RiderBadges badges={[isRiderInjured(r.injured_until) && "injured", r.is_academy && "academy", ageBadgeKey(r), r._isIncoming && "incoming", r._isOutgoing && "outgoing"]} />
                      </div>
                    </td>
                    {/* #1755: numerisk alder + ryttertype som egne celler (matcher eget hold). */}
                    <td className="px-3 py-2.5 hidden sm:table-cell text-center text-cz-2 font-mono text-xs">{getRiderAge(r.birthdate) ?? "—"}</td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} />
                    </td>
                    <td className="px-4 py-2.5 text-right text-cz-accent-t font-mono font-bold">
                      {formatCz(getRiderMarketValue(r)).replace(" CZ$", "")}
                    </td>
                    {STATS.map(({ key }) => (
                      <td key={key} className="px-1.5 py-2.5 text-center">
                        <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded" style={statStyle(r[key] || 0)}>
                          {r[key] || "—"}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
