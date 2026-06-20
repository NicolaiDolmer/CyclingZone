import { useState, useEffect, Fragment } from "react";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/supabasePagination";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import TeamLink from "../components/TeamLink";
import LeaderBadge from "../components/LeaderBadge";
import CompareDrawer from "../components/CompareDrawer";
import { formatNumber } from "../lib/intl";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";
import { ABILITY_SELECT, ABILITY_SHORT, flattenAbilities } from "../lib/abilities";
import { countTeamPodiums } from "../lib/standingsPodiums";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { Card, EmptyState, Spinner, Input, PodiumIcon } from "../components/ui";

// Division-markør holdt inden for guld+navy-systemet (ingen fremmede hues):
// div 1 = fuld guld (--accent), div 2 = dyb guld (--accent-t), div 3 = neutral
// (--div-3, tema-bevidst channel-token i index.css). Vi gemmer selve CSS-var-
// navnet og bygger rgb()-strenge med alpha via divColor() — så vi undgår hex-
// alpha-konkatenering (#rrggbbNN) og holder farverne token-drevne.
// (#671 anti-drift — erstatter chart-1/chart-2 blaa/violet division-kodning.)
const DIV_VARS = { 1: "--accent", 2: "--accent-t", 3: "--div-3" };
const divColor = (div, alpha = 1) => {
  const v = DIV_VARS[div] || DIV_VARS[1];
  return alpha >= 1 ? `rgb(var(${v}))` : `rgb(var(${v}) / ${alpha})`;
};
// Realtime: opdatér ranglisten live når en resultat-import skriver nye rækker (#783).
const REALTIME_TABLES = ["season_standings", "race_results"];
// Online-prik: bruger anses som online hvis last_seen < 5 min (foldet ind fra
// TeamsPage, #1609). Samme tærskel som TeamsPage.jsx:129.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
// #1529: "strong"-fremhævning på squad-styrke-linsen. Evne-skalaen er lavere
// (gns. ~40) end den gamle PCM-skala (gns. ~62), så 55 er den kalibrerede tærskel
// (genbrugt fra SeasonPreviewPage.jsx:14).
const STRONG_THRESHOLD = 55;
const LENS_STANDINGS = "standings";
const LENS_STRENGTH = "strength";

function MiniSparkline({ points, color }) {
  if (!points || points.length < 2) return <span className="text-cz-3 text-xs">—</span>;
  const max = Math.max(...points, 1);
  const w = 60, h = 24, p = 2;
  const pts = points.map((v, i) => {
    const x = p + (i / (points.length - 1)) * (w - p * 2);
    const y = h - p - (v / max) * (h - p * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
}

export default function StandingsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("standings");
  const [searchParams, setSearchParams] = useSearchParams();
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [divTab, setDivTab] = useState(1);
  const [myTeamId, setMyTeamId] = useState(null);
  const [season, setSeason] = useState(null);
  const [racePoints, setRacePoints] = useState({});
  const [teamComp, setTeamComp] = useState({});
  const [podiums, setPodiums] = useState({});
  const [prizeEarned, setPrizeEarned] = useState({});
  // Online-status pr. hold beregnes ved load (Date.now() er en uren funktion og
  // må ikke kaldes under render — purity-reglen, #1609). realtime-refetch +
  // 60s-heartbeat'en i Layout opdaterer last_seen, og loadAll re-kører på
  // season_standings/race_results-events, så prikken er fersk nok.
  const [onlineIds, setOnlineIds] = useState(() => new Set());
  const [races, setRaces] = useState([]);

  // Visnings-linse (?view=strength åbner Linse B). Squad-styrke-aggregater lever
  // i egen state og hentes lazy — Linse A betaler ikke for evne-fetch (#1609 §3.3).
  const [lens, setLens] = useState(searchParams.get("view") === LENS_STRENGTH ? LENS_STRENGTH : LENS_STANDINGS);
  const [strength, setStrength] = useState(null); // { [team_id]: aggregat } | null = ikke hentet
  const [strengthLoading, setStrengthLoading] = useState(false);

  // Fri tekst-søgning (foldet ind fra TeamsPage, #1609).
  const [search, setSearch] = useState("");

  // Compare-drawer (folder Head-to-Head ind). Multi-select 2 rækker → Compare.
  const [selected, setSelected] = useState([]); // op til 2 team_id'er
  const [compareTeams, setCompareTeams] = useState(null); // { a, b } når drawer åben

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: mine } = await supabase.from("teams").select("id, name, division").eq("user_id", user.id).single();
    setMyTeamId(mine?.id);
    if (mine?.division) setDivTab(mine.division);

    const { data: activeSeason } = await supabase.from("seasons").select("*").eq("status", "active").single();
    setSeason(activeSeason);

    const [teamsRes, standingsRes, racesRes] = await Promise.all([
      // last_seen joinet ind (#1609) til online-prik — samme som TeamsPage.jsx:41.
      supabase.from("teams").select("id, name, division, user:user_id(last_seen)").eq("is_ai", false).eq("is_test_account", false).eq("is_frozen", false).order("division").order("name"),
      activeSeason
        ? supabase.from("season_standings")
            .select("*, team:team_id(id, name, division, is_ai)")
            .eq("season_id", activeSeason.id)
            .order("total_points", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from("races")
        .select("id, name, edition_year, pool_race:pool_race_id(date_text)")
        .eq("season_id", activeSeason?.id || "")
        .order("name"),
    ]);

    // Index actual standings by team_id
    const standingsMap = {};
    (standingsRes.data || []).filter(s => !s.team?.is_ai).forEach(s => {
      standingsMap[s.team_id] = s;
    });

    // Online-prik (#1609, foldet ind fra TeamsPage): last_seen < 5 min. Beregnes
    // her ved load (uren Date.now() må ikke ramme render-path'en).
    const now = Date.now();
    const online = new Set();
    (teamsRes.data || []).forEach(team => {
      const seen = team.user?.last_seen;
      if (seen && (now - new Date(seen).getTime()) < ONLINE_WINDOW_MS) online.add(team.id);
    });
    setOnlineIds(online);

    // All human teams, merged with standings (0 points as fallback)
    const merged = (teamsRes.data || []).map(team => (
      standingsMap[team.id] || { id: team.id, team_id: team.id, team, total_points: 0, stage_wins: 0 }
    ));

    setStandings(merged);
    setRaces(racesRes.data || []);

    // Build race-by-race point progression
    if (racesRes.data?.length && merged.length) {
      // Paginér: PostgREST capper ved 1000 → ellers undertæller progression-grafen.
      const results = await fetchAllRows(() => supabase
        .from("race_results")
        .select("rider:rider_id(team_id), team_id, result_type, rank, prize_money, race_id")
        .in("race_id", racesRes.data.map(r => r.id))
        .order("id", { ascending: true }));

      const prog = {};
      const cumul = {};
      merged.forEach(s => { prog[s.team_id] = []; cumul[s.team_id] = 0; });

      racesRes.data.forEach(race => {
        const rr = (results || []).filter(r => r.race_id === race.id);
        const pts = {};
        rr.forEach(r => {
          if (r.rider?.team_id) pts[r.rider.team_id] = (pts[r.rider.team_id] || 0) + (r.prize_money || 0);
        });
        merged.forEach(s => {
          cumul[s.team_id] = (cumul[s.team_id] || 0) + (pts[s.team_id] || 0);
          prog[s.team_id].push(cumul[s.team_id]);
        });
      });
      setRacePoints(prog);

      // Holdkonkurrence: tæl team-classification-sejre — result_type='team', rider_id NULL, team_id sat.
      const comp = {};
      (results || []).forEach(r => {
        if (r.result_type !== "team" || !r.team_id) return;
        const c = comp[r.team_id] || (comp[r.team_id] = { wins: 0, podiums: 0 });
        if (r.rank === 1) c.wins += 1;
        if (r.rank <= 3) c.podiums += 1;
      });
      setTeamComp(comp);

      // Podier pr. hold (#1093): season_standings har ingen podiums-kolonne,
      // så kolonnen viste altid 0. Tælles client-side fra race_results —
      // semantik = rytter-ranglistens "Top 3" (kun stage + gc, rank <= 3).
      setPodiums(countTeamPodiums(results));

      // Præmiepenge pr. hold: summér prize_money på race_results.team_id (det felt
      // udbetalingen bogfører på — se prizePayoutEngine), så kolonnen viser præcis
      // hvad holdet står til at få udbetalt. Inkluderer alle completed-løb.
      const prize = {};
      merged.forEach(s => { prize[s.team_id] = 0; });
      (results || []).forEach(r => {
        if (r.team_id != null && prize[r.team_id] !== undefined) {
          prize[r.team_id] += (r.prize_money || 0);
        }
      });
      setPrizeEarned(prize);
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);
  useRealtimeRefetch("standings-live", REALTIME_TABLES, loadAll);

  // Lazy squad-styrke-fetch — kun når Linse B er aktiv, og kun én gang (#1609 §3.3).
  // Henter riders med ABILITY_SELECT (evner) + aggregerer trup-værdi/avg-evner/U25/
  // top-stjerne som SeasonPreviewPage.jsx:46-55. Linse A betaler aldrig for dette.
  useEffect(() => {
    if (lens !== LENS_STRENGTH || strength !== null || strengthLoading) return;
    let cancelled = false;
    (async () => {
      setStrengthLoading(true);
      const { data: riders } = await supabase
        .from("riders")
        .select(`id, team_id, firstname, lastname, market_value, is_u25, ${ABILITY_SELECT}`)
        .not("team_id", "is", null);
      const ridersByTeam = {};
      (riders || []).forEach(raw => {
        const r = flattenAbilities(raw);
        (ridersByTeam[r.team_id] ||= []).push(r);
      });
      const agg = {};
      Object.entries(ridersByTeam).forEach(([teamId, list]) => {
        const totalValue = list.reduce((s, r) => s + getRiderMarketValue(r), 0);
        const avgBj = list.length ? Math.round(list.reduce((s, r) => s + (r.climbing || 0), 0) / list.length) : 0;
        const avgSp = list.length ? Math.round(list.reduce((s, r) => s + (r.sprint || 0), 0) / list.length) : 0;
        const avgTt = list.length ? Math.round(list.reduce((s, r) => s + (r.time_trial || 0), 0) / list.length) : 0;
        const u25Count = list.filter(r => r.is_u25).length;
        const topRider = [...list].sort((a, b) => getRiderMarketValue(b) - getRiderMarketValue(a))[0];
        agg[teamId] = { totalValue, avgBj, avgSp, avgTt, u25Count, topRider, riderCount: list.length };
      });
      if (!cancelled) { setStrength(agg); setStrengthLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [lens, strength, strengthLoading]);

  // ?compare=1 deep-link (fra /head-to-head redirect): åbn drawer med eget hold som
  // A. Hold B vælges først når brugeren markerer en række — drawer'en åbnes da.
  // Vi venter på at myTeam er hentet og standings er klar.
  useEffect(() => {
    if (searchParams.get("compare") !== "1") return;
    if (!myTeamId) return;
    // Seed eget hold som første selection, så et enkelt række-klik fuldender parret.
    setSelected(prev => (prev.length === 0 ? [myTeamId] : prev));
    // Fjern flaget igen så et reload ikke re-seeder.
    const next = new URLSearchParams(searchParams);
    next.delete("compare");
    setSearchParams(next, { replace: true });
  }, [searchParams, myTeamId, setSearchParams]);

  function selectLens(next) {
    setLens(next);
    const params = new URLSearchParams(searchParams);
    if (next === LENS_STRENGTH) params.set("view", LENS_STRENGTH);
    else params.delete("view");
    setSearchParams(params, { replace: true });
  }

  function toggleSelect(teamId, e) {
    e.stopPropagation();
    setSelected(prev => {
      if (prev.includes(teamId)) return prev.filter(id => id !== teamId);
      if (prev.length >= 2) return [prev[1], teamId]; // hold seneste to
      return [...prev, teamId];
    });
  }

  function openCompare() {
    if (selected.length !== 2) return;
    const lookup = (id) => {
      const row = standings.find(s => s.team_id === id);
      return { id, name: row?.team?.name, division: row?.team?.division };
    };
    setCompareTeams({ a: lookup(selected[0]), b: lookup(selected[1]) });
  }

  const effectivePts = (s) => ((s?.total_points || 0) - (s?.penalty_points || 0));
  const matchesSearch = (s) => !search || (s.team?.name || "").toLowerCase().includes(search.toLowerCase());

  const divStandingsBase = standings
    .filter(s => s.team?.division === divTab)
    .sort((a, b) => effectivePts(b) - effectivePts(a));
  // Linse B sorteres efter trup-værdi; Linse A efter point. Søgning filtrerer begge.
  const strengthVal = (s) => (strength?.[s.team_id]?.totalValue || 0);
  const divRanked = lens === LENS_STRENGTH
    ? [...divStandingsBase].sort((a, b) => strengthVal(b) - strengthVal(a))
    : divStandingsBase;
  const divStandings = divRanked.filter(matchesSearch);

  // Zone-grænser beregnes på den point-sorterede liste (Linse A's rangering), så
  // op-/nedrykning altid følger point — også når Linse B viser en anden sortering.
  // NOTE (#1152): top-2/bund-2 er hardcodet her. Når #1152 fastlægger antal op/ned
  // + catch-up-regler, parameterisér PROMOTE_N/RELEGATE_N i stedet for konstanterne.
  const PROMOTE_N = 2;
  const RELEGATE_N = 2;
  const promoteIds = new Set(divStandingsBase.slice(0, PROMOTE_N).map(s => s.team_id));
  const relegateIds = new Set(divStandingsBase.slice(-RELEGATE_N).map(s => s.team_id));

  const maxPts = effectivePts(divStandingsBase[0]) || 1;
  const maxValue = lens === LENS_STRENGTH ? (strengthVal(divRanked[0]) || 1) : 1;
  const color = divColor(divTab);
  const colorSoft = divColor(divTab, 0.38); // svarer til den tidligere hex-alpha "60"
  const canPromote = divTab > 1;
  const canRelegate = divTab < 3;
  const divCounts = [1, 2, 3].map(d => ({
    div: d,
    count: standings.filter(s => s.team?.division === d).length,
  }));

  const COLSPAN = lens === LENS_STRENGTH ? 9 : 8;

  if (loading) return (
    <div className="flex justify-center py-16">
      <Spinner size={24} />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
          <p className="text-cz-3 text-sm" title={season ? t("seasonTooltip") : undefined}>
            {season ? t("season", { n: season.number }) : t("noActiveSeason")}
          </p>
        </div>
      </div>

      {/* Division tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {divCounts.map(({ div, count }) => (
          <button key={div} onClick={() => setDivTab(div)}
            className={`px-4 py-2 rounded-cz text-sm font-medium transition-all border
              ${divTab === div
                ? "border-opacity-30 text-cz-1"
                : "bg-cz-card text-cz-2 border-cz-border hover:text-cz-1"}`}
            style={divTab === div ? { backgroundColor: divColor(div, 0.08), borderColor: divColor(div, 0.25), color: divColor(div) } : {}}>
            {t("division", { n: div })}
            <span className="ms-2 text-[10px] opacity-60">({count})</span>
          </button>
        ))}
      </div>

      {/* Lens switch + search + compare action */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex rounded-cz border border-cz-border overflow-hidden">
          {[
            { key: LENS_STANDINGS, label: t("lens.standings") },
            { key: LENS_STRENGTH, label: t("lens.strength") },
          ].map(v => (
            <button key={v.key} onClick={() => selectLens(v.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-all
                ${lens === v.key ? "bg-cz-accent/10 text-cz-accent-t" : "bg-cz-card text-cz-2 hover:text-cz-1"}`}>
              {v.label}
            </button>
          ))}
        </div>

        <Input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")} className="w-44" />

        <button
          onClick={openCompare}
          disabled={selected.length !== 2}
          className={`ms-auto px-3 py-1.5 rounded-cz text-xs font-medium border transition-all
            ${selected.length === 2
              ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/40 hover:bg-cz-accent/20"
              : "bg-cz-card text-cz-3 border-cz-border cursor-not-allowed"}`}>
          {t("compare.action", { count: selected.length })}
        </button>
      </div>

      {divStandings.length === 0 ? (
        <EmptyState
          icon={<PodiumIcon className="w-8 h-8 text-cz-3" aria-hidden="true" />}
          title={search ? t("noMatch") : t("noData", { n: divTab })}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs w-8">#</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs">{t("thTeam")}</th>
                  {lens === LENS_STANDINGS ? (
                    <>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden sm:table-cell">{t("thStageWins")}</th>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden lg:table-cell" title={t("thTeamComp")}>
                        <span className="hidden xl:inline">{t("thTeamComp")}</span>
                        <span className="xl:hidden">{t("thTeamCompShort")}</span>
                      </th>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden md:table-cell">{t("thPodiums")}</th>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs">
                        <span className="hidden sm:inline">{t("thPrize")}</span>
                        <span className="sm:hidden">{t("thPrizeShort")}</span>
                      </th>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs">{t("thPoints")}</th>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden lg:table-cell w-20">{t("thProgress")}</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs">
                        <span className="hidden sm:inline">{t("thSquadValue")}</span>
                        <span className="sm:hidden">{t("thSquadValueShort")}</span>
                      </th>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden sm:table-cell">{t("thRiders")}</th>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden md:table-cell">{t("thU25")}</th>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden lg:table-cell">{ABILITY_SHORT.climbing}</th>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden lg:table-cell">{ABILITY_SHORT.sprint}</th>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden lg:table-cell">{ABILITY_SHORT.time_trial}</th>
                      <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden md:table-cell">{t("thTopStar")}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {divStandings.map((s, i) => {
                  const isMe = s.team_id === myTeamId;
                  const prog = racePoints[s.team_id] || [];
                  const eff = effectivePts(s);
                  const penalty = s.penalty_points || 0;
                  const ptsWidth = Math.round((eff / maxPts) * 100);
                  const agg = strength?.[s.team_id];
                  const valWidth = Math.round((strengthVal(s) / maxValue) * 100);
                  const isPromotion = promoteIds.has(s.team_id) && canPromote;
                  const isRelegation = relegateIds.has(s.team_id) && canRelegate;
                  const isLeader = lens === LENS_STANDINGS && i === 0;
                  const isSelected = selected.includes(s.team_id);
                  // Zone bar (green/red) + the neutral "you" ring can co-exist; gold
                  // never overrides a zone bar — the leader signal is the chip (PF2 B).
                  const bars = [];
                  if (isPromotion) bars.push("inset 3px 0 0 rgb(var(--success))");
                  else if (isRelegation) bars.push("inset 3px 0 0 rgb(var(--danger))");
                  if (isMe) bars.push("inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)");
                  if (isSelected) bars.push("inset 0 0 0 1.5px rgb(var(--accent) / 0.6)");
                  const rowStyle = bars.length ? { boxShadow: bars.join(", ") } : {};
                  // Zone-separatorer (Linse A, ingen aktiv søgning — index-baserede
                  // grænser kræver den uændrede point-sorterede rækkefølge).
                  const showZoneSeparators = lens === LENS_STANDINGS && !search;
                  return (
                    <Fragment key={s.id}>
                      {/* Separator before relegation zone */}
                      {showZoneSeparators && i === divStandings.length - RELEGATE_N && canRelegate && divStandings.length > 4 && (
                        <tr aria-hidden="true">
                          <td colSpan={COLSPAN} style={{ padding: 0, lineHeight: 0, border: 0 }}>
                            <div className="border-t border-cz-danger/30" />
                          </td>
                        </tr>
                      )}
                      <tr
                        onClick={() => navigate(`/teams/${s.team_id}?tab=results`)}
                        style={rowStyle}
                        className={`border-b border-cz-border last:border-0 cursor-pointer hover:bg-cz-subtle transition-colors
                          ${isLeader ? "bg-cz-accent/[0.08]" : isPromotion ? "bg-cz-success-bg" : isRelegation ? "bg-cz-danger-bg" : ""}`}>
                        <td className="px-4 py-3.5">
                          <button
                            type="button"
                            onClick={(e) => toggleSelect(s.team_id, e)}
                            aria-pressed={isSelected}
                            aria-label={t("compare.select", { team: s.team?.name })}
                            title={t("compare.selectHint")}
                            className={`font-mono font-bold text-sm w-6 h-6 inline-flex items-center justify-center rounded-cz transition-colors
                              ${isSelected ? "bg-cz-accent/15 text-cz-accent-t" : "hover:bg-cz-subtle " + (i === 0 ? "text-cz-accent-t" : i <= 2 ? "text-cz-2" : "text-cz-3")}`}>
                            {i + 1}
                          </button>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Online-prik (#1609, foldet ind fra TeamsPage): grøn = last_seen < 5 min. */}
                            <span aria-hidden="true"
                              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${onlineIds.has(s.team_id) ? "bg-cz-success" : "bg-cz-subtle"}`}
                              title={onlineIds.has(s.team_id) ? t("onlineNow") : t("offline")} />
                            {/* #824: fra ranglisten forventer man holdets RESULTATER, ikke truppen */}
                            <TeamLink id={s.team_id} tab="results" stopPropagation className="font-medium text-cz-1">{s.team?.name}</TeamLink>
                            {isLeader && <LeaderBadge />}
                            {isMe && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgb(var(--me-badge-bg))", color: "rgb(var(--me-badge-fg))" }}>{t("youBadge")}</span>}
                            {isPromotion && <span className="text-[9px] bg-cz-success-bg text-cz-success px-1.5 py-0.5 rounded font-medium">{t("promotionBadge")}</span>}
                            {isRelegation && <span className="text-[9px] bg-cz-danger-bg text-cz-danger px-1.5 py-0.5 rounded font-medium">{t("relegationBadge")}</span>}
                          </div>
                          {/* Mini progress bar — point-andel (Linse A) eller værdi-andel (Linse B) */}
                          <div className="mt-1.5 bg-cz-subtle rounded-full h-1 w-full max-w-32">
                            <div className="h-1 rounded-full" style={{ width: `${lens === LENS_STRENGTH ? valWidth : ptsWidth}%`, backgroundColor: colorSoft }} />
                          </div>
                        </td>

                        {lens === LENS_STANDINGS ? (
                          <>
                            <td className="px-4 py-3.5 text-right text-cz-2 hidden sm:table-cell font-mono">{s.stage_wins || 0}</td>
                            <td className="px-4 py-3.5 text-right text-cz-2 hidden lg:table-cell font-mono">{teamComp[s.team_id]?.wins || 0}</td>
                            <td className="px-4 py-3.5 text-right text-cz-2 hidden md:table-cell font-mono">{podiums[s.team_id] || 0}</td>
                            <td className="px-4 py-3.5 text-right font-mono text-cz-2 whitespace-nowrap">
                              {formatNumber(prizeEarned[s.team_id] || 0)} <span className="text-cz-3 text-[10px]">CZ$</span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="font-mono font-bold" style={{ color }}>
                                {formatNumber(eff)}
                              </span>
                              {penalty > 0 && (
                                <span
                                  className="ms-1.5 font-mono text-[10px] text-cz-danger"
                                  title={t("penaltyTooltip", { penalty, earned: formatNumber(s.total_points || 0) })}
                                >
                                  (−{penalty})
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-right hidden lg:table-cell">
                              <MiniSparkline points={prog} color={color} />
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3.5 text-right font-mono text-cz-2 whitespace-nowrap">
                              {strengthLoading && !agg ? <span className="text-cz-3">…</span> : <>{formatNumber(agg?.totalValue || 0)} <span className="text-cz-3 text-[10px]">CZ$</span></>}
                            </td>
                            <td className="px-4 py-3.5 text-right text-cz-2 hidden sm:table-cell font-mono">{agg?.riderCount || 0}</td>
                            <td className="px-4 py-3.5 text-right text-cz-2 hidden md:table-cell font-mono">{agg?.u25Count || 0}</td>
                            <td className={`px-4 py-3.5 text-right hidden lg:table-cell font-mono ${(agg?.avgBj || 0) >= STRONG_THRESHOLD ? "text-cz-accent-t font-bold" : "text-cz-2"}`}>{agg?.avgBj || 0}</td>
                            <td className={`px-4 py-3.5 text-right hidden lg:table-cell font-mono ${(agg?.avgSp || 0) >= STRONG_THRESHOLD ? "text-cz-accent-t font-bold" : "text-cz-2"}`}>{agg?.avgSp || 0}</td>
                            <td className={`px-4 py-3.5 text-right hidden lg:table-cell font-mono ${(agg?.avgTt || 0) >= STRONG_THRESHOLD ? "text-cz-accent-t font-bold" : "text-cz-2"}`}>{agg?.avgTt || 0}</td>
                            <td className="px-4 py-3.5 text-right hidden md:table-cell text-cz-2 text-xs whitespace-nowrap">
                              {agg?.topRider ? (
                                <span title={formatCz(getRiderMarketValue(agg.topRider))}>
                                  {agg.topRider.firstname} {agg.topRider.lastname}
                                </span>
                              ) : <span className="text-cz-3">—</span>}
                            </td>
                          </>
                        )}
                      </tr>
                      {/* Separator after promotion zone */}
                      {showZoneSeparators && i === PROMOTE_N - 1 && canPromote && divStandings.length > 2 && (
                        <tr aria-hidden="true">
                          <td colSpan={COLSPAN} style={{ padding: 0, lineHeight: 0, border: 0 }}>
                            <div className="border-t border-cz-success/30" />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 border-t border-cz-border flex items-center gap-4 flex-wrap">
            {lens === LENS_STANDINGS ? (
              <>
                <div className="flex items-center gap-1.5 text-xs text-cz-accent-t">
                  <span className="w-2 h-2 rounded-sm bg-cz-accent" />
                  {t("legendLeader")}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-cz-success/70">
                  <span className="w-2 h-2 rounded-sm bg-cz-success-bg border border-cz-success/30" />
                  {t("legendPromotion")}
                </div>
                {canRelegate && (
                  <div className="flex items-center gap-1.5 text-xs text-cz-danger/70">
                    <span className="w-2 h-2 rounded-sm bg-cz-danger-bg border border-cz-danger/30" />
                    {t("legendRelegation")}
                  </div>
                )}
                <div className="ms-auto text-xs text-cz-3">
                  {t("racesPlayed", { count: races.length })}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-xs text-cz-accent-t">
                  <span className="w-2 h-2 rounded-sm bg-cz-accent" />
                  {t("legendStrong", { n: STRONG_THRESHOLD })}
                </div>
                <div className="ms-auto text-xs text-cz-3">{t("strengthHint")}</div>
              </>
            )}
          </div>
        </Card>
      )}

      {compareTeams && (
        <CompareDrawer
          teamA={compareTeams.a}
          teamB={compareTeams.b}
          onClose={() => setCompareTeams(null)}
        />
      )}
    </div>
  );
}
