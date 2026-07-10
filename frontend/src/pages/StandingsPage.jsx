import { useState, useEffect, Fragment } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import TeamLink from "../components/TeamLink";
import LeaderBadge from "../components/LeaderBadge";
import CompareDrawer from "../components/CompareDrawer";
import { formatNumber } from "../lib/intl";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";
import { ABILITY_SELECT, ABILITY_SHORT, flattenAbilities } from "../lib/abilities";
import { mergeStandings } from "../lib/standingsMerge";
import { fetchAllRows } from "../lib/supabasePagination";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { Card, EmptyState, PageLoader, Input, PodiumIcon } from "../components/ui";
import { RULES_NUMBERS } from "../lib/rulesNumbers";
import { divColor } from "../lib/divisionColors.js";

// #1608/#1688 4-tier-pyramide: divisions-fanerne dækker tier 1..MAX_DIVISION (4).
// Tier-tallet hentes fra den delte konstant-mirror (rulesNumbers), så frontend ikke
// drifter fra backend-MAX_DIVISION. ALL_DIVISIONS = [1,2,3,4].
const ALL_DIVISIONS = Array.from(
  { length: RULES_NUMBERS.maxDivision - RULES_NUMBERS.minDivision + 1 },
  (_, i) => RULES_NUMBERS.minDivision + i,
);
const POOL_ALL = "all"; // pulje-sub-fane: vis hele tieren samlet.

// Division-markør holdt inden for guld+navy-systemet (ingen fremmede hues):
// div 1 = fuld guld (--accent), div 2 = dyb guld (--accent-t), div 3 = neutral
// (--div-3, tema-bevidst channel-token i index.css). Vi gemmer selve CSS-var-
// navnet og bygger rgb()-strenge med alpha via divColor() — så vi undgår hex-
// alpha-konkatenering (#rrggbbNN) og holder farverne token-drevne.
// (#671 anti-drift — erstatter chart-1/chart-2 blaa/violet division-kodning.)
// DIV_VARS + divColor flyttet til ../lib/divisionColors.js (delt med race-hub S6-browse).
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
  const [error, setError] = useState(null);
  const [divTab, setDivTab] = useState(1);
  // #1688 pulje-sub-faner: valgt pulje inden for tieren (league_division_id) eller
  // POOL_ALL = hele tieren samlet. league_divisions hentes ved load.
  const [pools, setPools] = useState([]);
  const [poolTab, setPoolTab] = useState(POOL_ALL);
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

  // #2175: loadAll pakket i try/catch/finally → en fejlet query viser fejl-UI,
  // ikke en uendelig spinner. Både useEffect og realtime-refetch kalder wrapperen.
  async function loadAll() {
    setError(null);
    try {
      await loadAllInner();
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadAllInner() {
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) { return; }
    const { data: mine } = await supabase.from("teams").select("id, name, division").eq("user_id", user.id).single();
    setMyTeamId(mine?.id);
    if (mine?.division) setDivTab(mine.division);

    const { data: activeSeason } = await supabase.from("seasons").select("*").eq("status", "active").single();
    setSeason(activeSeason);

    const [teamsRes, standingsRes, racesRes, poolsRes] = await Promise.all([
      // last_seen joinet ind (#1609) til online-prik — samme som TeamsPage.jsx:41.
      // #1688: league_division_id med, så holdet kan placeres i sin pulje-sub-fane.
      // #1718: AI-hold MED — divisioner der (næsten) kun er AI fremstod tomme da
      // is_ai-filteret holdt dem ude. is_ai joines ind så de kan markeres diskret.
      // Test- og frosne konti holdes stadig ude (de er ikke ægte konkurrenter).
      supabase.from("teams").select("id, name, division, league_division_id, is_ai, user:user_id(last_seen)").eq("is_test_account", false).eq("is_frozen", false).order("division").order("name"),
      activeSeason
        ? supabase.from("season_standings")
            // #1688: league_division_id med (GRANT på plads i league-divisions-pyramid-
            // migrationen) + join til league_divisions for puljens label.
            .select("*, team:team_id(id, name, division, is_ai, league_division_id), pool:league_division_id(id, tier, pool_index, label)")
            .eq("season_id", activeSeason.id)
            .order("total_points", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from("races")
        .select("id, name, edition_year, pool_race:pool_race_id(date_text)")
        .eq("season_id", activeSeason?.id || "")
        .order("name"),
      // #1688: alle 15 puljer (reference-data) til pulje-sub-fanerne. Offentlig
      // læse-policy findes (league-divisions-pyramid-migrationen).
      supabase.from("league_divisions").select("id, tier, pool_index, label").order("tier").order("pool_index"),
    ]);
    setPools(poolsRes.data || []);

    // Index actual standings by team_id. #1718: AI-rækker beholdes nu — de skal
    // vises (markeres diskret i tabellen), ikke filtreres væk.
    const standingsMap = {};
    (standingsRes.data || []).forEach(s => {
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

    // All teams (#1718: inkl. AI), merged with standings (0 points as fallback).
    const merged = mergeStandings(teamsRes.data || [], standingsMap);

    setStandings(merged);
    setRaces(racesRes.data || []);

    // #2175: afledte hold-metrics kommer nu fra matviews i stedet for en client-agg
    // over ~38k race_results (den gamle uendelig-spinner-flaskehals). season_standings
    // dækker fortsat points/stage_wins/gc_wins (uændret, backend-vedligeholdt).
    //   team_standings_ext_mv  = holdkonkurrence, podier, præmie (skalar-kolonner)
    //   team_race_points_mv    = pr-løb-points → kumuleres client-side til grafen
    if (activeSeason && merged.length) {
      // BEGGE matview-reads pagineres via fetchAllRows: team_race_points_mv har
      // >1000 rækker (hold × løb), og PostgREST capper stille ved db-max-rows
      // (1000) → progressions-grafen mistede punkter for de sidste hold (#2206,
      // samme rod-årsag som rytterranglisten). Stabil .order() kræves af helper'en.
      const [extData, progData] = await Promise.all([
        fetchAllRows(() => supabase.from("team_standings_ext_mv").select("*")
          .eq("season_id", activeSeason.id)
          .order("team_id", { ascending: true })),
        fetchAllRows(() => supabase.from("team_race_points_mv").select("team_id, race_id, race_points")
          .eq("season_id", activeSeason.id)
          .order("team_id", { ascending: true }).order("race_id", { ascending: true })),
      ]);

      // Skalar-kolonner. comp/podier keyes frit (UI slår op pr. team_id); præmie
      // begrænses til merged-hold (matcher den gamle prize[team_id]!==undefined-guard).
      const comp = {};
      const podiums = {};
      const prize = {};
      merged.forEach(s => { prize[s.team_id] = 0; });
      (extData || []).forEach(row => {
        comp[row.team_id] = { wins: Number(row.comp_wins) || 0, podiums: Number(row.comp_podiums) || 0 };
        const p = Number(row.podiums) || 0;
        if (p > 0) podiums[row.team_id] = p; // matcher countTeamPodiums: kun hold med podier
        if (row.team_id in prize) prize[row.team_id] = Number(row.prize_earned) || 0;
      });
      setTeamComp(comp);
      setPodiums(podiums);
      setPrizeEarned(prize);

      // Progressions-graf: pr-løb-points → kumuleret pr. hold over racesRes-
      // rækkefølgen (samme orden som før). Attribution = rytterens nuværende hold
      // (matview'ets ri.team_id, præcis som den gamle `r.rider?.team_id`).
      const pointsByTeamRace = {};
      (progData || []).forEach(row => {
        (pointsByTeamRace[row.team_id] ||= {})[row.race_id] = Number(row.race_points) || 0;
      });
      const prog = {};
      merged.forEach(s => {
        let cumul = 0;
        prog[s.team_id] = (racesRes.data || []).map(race => {
          cumul += pointsByTeamRace[s.team_id]?.[race.id] || 0;
          return cumul;
        });
      });
      setRacePoints(prog);
    }
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
      // Paginér: ~4.9k ryttere er på hold, men PostgREST capper ved 1000 → uden
      // dette manglede trup-styrke for de fleste hold i Linse B (#2206).
      const riders = await fetchAllRows(() => supabase
        .from("riders")
        .select(`id, team_id, firstname, lastname, market_value, is_u25, ${ABILITY_SELECT}`)
        .not("team_id", "is", null)
        .order("id", { ascending: true }));
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

  // Pulje-id pr. række: foretræk holdets pulje (team.league_division_id), fald tilbage
  // til standings-rækkens egen pulje-akse. Et 0-point-hold (uden standings-række) bærer
  // pulje på sit team-objekt fra teams-queryen.
  const rowPoolId = (s) => s.team?.league_division_id ?? s.league_division_id ?? null;

  // Puljerne i den valgte tier (sorteret efter pool_index) → pulje-sub-faner.
  const tierPools = pools
    .filter(p => p.tier === divTab)
    .sort((a, b) => a.pool_index - b.pool_index);
  const hasPoolSubtabs = tierPools.length > 1;

  const divStandingsBase = standings
    .filter(s => s.team?.division === divTab)
    // #1688: når tieren har flere puljer og en specifik pulje er valgt, filtrér til den.
    .filter(s => !hasPoolSubtabs || poolTab === POOL_ALL || rowPoolId(s) === poolTab)
    .sort((a, b) => effectivePts(b) - effectivePts(a));
  // Linse B sorteres efter trup-værdi; Linse A efter point. Søgning filtrerer begge.
  const strengthVal = (s) => (strength?.[s.team_id]?.totalValue || 0);
  const divRanked = lens === LENS_STRENGTH
    ? [...divStandingsBase].sort((a, b) => strengthVal(b) - strengthVal(a))
    : divStandingsBase;
  const divStandings = divRanked.filter(matchesSearch);

  const canPromote = divTab > RULES_NUMBERS.minDivision;
  const canRelegate = divTab < RULES_NUMBERS.maxDivision;

  // #1152/#1760: op-/nedrykning afgøres PR. PULJE — top 2 op til forælder-puljen, bund 4
  // ned delt til de to børne-puljer (binær-træ-engine, economyEngine.js PROMOTION_SLOTS=2
  // / RELEGATION_SLOTS=4). Zone-id'erne beregnes én gang fra tierens samlede point-
  // sorterede liste pr. pulje, så markeringen er identisk uanset hvilken fane man står på
  // og tallene summer korrekt (N puljer × 2 op, N puljer × 4 ned). Kun puljer med flere
  // hold end op+ned-pladser tilsammen får en zone (ellers ville hele puljen være markeret).
  const PROMOTE_N = 2;
  const RELEGATE_N = 4;
  const tierPointSorted = standings
    .filter(s => s.team?.division === divTab)
    .sort((a, b) => effectivePts(b) - effectivePts(a));
  const promoteIds = new Set();
  const relegateIds = new Set();
  const standingsByPool = new Map();
  for (const s of tierPointSorted) {
    const key = rowPoolId(s) ?? "__none__";
    if (!standingsByPool.has(key)) standingsByPool.set(key, []);
    standingsByPool.get(key).push(s);
  }
  standingsByPool.forEach(poolRows => {
    if (poolRows.length <= PROMOTE_N + RELEGATE_N) return;
    if (canPromote) poolRows.slice(0, PROMOTE_N).forEach(s => promoteIds.add(s.team_id));
    if (canRelegate) poolRows.slice(-RELEGATE_N).forEach(s => relegateIds.add(s.team_id));
  });

  // #1760: nedryknings-destinationen (tieren under) kan være dormant — Div4-puljer åbnes
  // per pulje når en Div3-pulje er all-real (#1152), så Div3 relegerer reelt ikke før
  // Div4 er åbnet. Zonen vises stadig, men summarie-linjen forklarer udskydelsen.
  const relegationTargetTier = divTab + 1;
  const relegationDormant = canRelegate &&
    standings.filter(s => s.team?.division === relegationTargetTier).length === 0;

  // Antal i den aktuelle visning ("Alle" = hele tieren, ellers kun den valgte pulje), så
  // summarie-tallene matcher det man faktisk ser på fanen.
  const inCurrentPool = (s) => !hasPoolSubtabs || poolTab === POOL_ALL || rowPoolId(s) === poolTab;
  const promoteCount = tierPointSorted.filter(s => inCurrentPool(s) && promoteIds.has(s.team_id)).length;
  const relegateCount = tierPointSorted.filter(s => inCurrentPool(s) && relegateIds.has(s.team_id)).length;

  const maxPts = effectivePts(divStandingsBase[0]) || 1;
  const maxValue = lens === LENS_STRENGTH ? (strengthVal(divRanked[0]) || 1) : 1;
  const color = divColor(divTab);
  const colorSoft = divColor(divTab, 0.38); // svarer til den tidligere hex-alpha "60"
  // #1608/#1688: faner for alle 4 tiers. Tællingen er pr. TIER (på tværs af puljer),
  // så fanens badge viser holdtallet i hele tieren.
  const divCounts = ALL_DIVISIONS.map(d => ({
    div: d,
    count: standings.filter(s => s.team?.division === d).length,
  }));

  const COLSPAN = lens === LENS_STRENGTH ? 9 : 8;

  if (loading) return (
    <PageLoader />
  );

  // #2175: eksplicit fejl-tilstand med retry frem for uendelig spinner ved fejl.
  if (error) return (
    <div className="max-w-full">
      <h1 className="text-xl font-bold text-cz-1 mb-4">{t("title")}</h1>
      <div className="text-center py-16 text-cz-3">
        <p>{t("loadError")}</p>
        <button onClick={() => { setLoading(true); loadAll(); }}
          className="mt-4 px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
            rounded-lg text-xs font-medium hover:bg-cz-accent/10 transition-all">
          {t("retry")}
        </button>
      </div>
    </div>
  );

  return (
    // #2253: translate="no" — standings-tabellerne re-renderer hyppigt;
    // browser-oversættere muterede tekst-noderne og udløste NotFoundError-crashes
    // (Sentry-events med url=/standings). Se PR #2272.
    <div translate="no" className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
          <p className="text-cz-3 text-sm" title={season ? t("seasonTooltip") : undefined}>
            {season ? t("season", { n: season.number }) : t("noActiveSeason")}
          </p>
        </div>
      </div>

      {/* Division (tier) tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {divCounts.map(({ div, count }) => (
          <button key={div} onClick={() => { setDivTab(div); setPoolTab(POOL_ALL); }}
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

      {/* #1688 pulje-sub-faner: kun når den valgte tier har flere puljer (tier 2:2,
          3:4, 4:8). "All" samler hele tieren; hver pulje-fane filtrerer til puljen. */}
      {hasPoolSubtabs && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          <button onClick={() => setPoolTab(POOL_ALL)}
            className={`px-3 py-1.5 rounded-cz text-xs font-medium transition-all border
              ${poolTab === POOL_ALL
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/40"
                : "bg-cz-card text-cz-2 border-cz-border hover:text-cz-1"}`}>
            {t("poolAll")}
          </button>
          {tierPools.map(p => {
            const poolCount = standings.filter(s => s.team?.division === divTab && rowPoolId(s) === p.id).length;
            return (
              <button key={p.id} onClick={() => setPoolTab(p.id)}
                className={`px-3 py-1.5 rounded-cz text-xs font-medium transition-all border
                  ${poolTab === p.id
                    ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/40"
                    : "bg-cz-card text-cz-2 border-cz-border hover:text-cz-1"}`}>
                {p.label}
                <span className="ms-1.5 text-[10px] opacity-60">({poolCount})</span>
              </button>
            );
          })}
        </div>
      )}

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

      {/* #1745/#1760: entydig op-/nedryknings-summarie. Tallene er antal i den aktuelle
          visning; regel-teksten forklarer per-pulje-mekanikken (top 2 op, bund 4 ned).
          Kun i Linse A uden aktiv søgning, og kun når tieren faktisk kan rykke. */}
      {lens === LENS_STANDINGS && !search && divStandings.length > 0 && (canPromote || canRelegate) && (
        <div className="mb-4 px-3.5 py-2.5 rounded-cz border border-cz-border bg-cz-card text-xs text-cz-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-cz-3 font-medium uppercase tracking-wide text-[10px]">{t("movement.label")}</span>
          {canPromote && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-cz-success-bg border border-cz-success/40" />
              {t("movement.up", { count: promoteCount })}
            </span>
          )}
          {canRelegate && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-cz-danger-bg border border-cz-danger/40" />
              {t("movement.down", { count: relegateCount })}
            </span>
          )}
          <span className="text-cz-3">
            {canPromote && canRelegate
              ? (hasPoolSubtabs && poolTab === POOL_ALL
                  ? t("movement.ruleBothPerPool", { up: PROMOTE_N, down: RELEGATE_N, pools: tierPools.length })
                  : t("movement.ruleBoth", { up: PROMOTE_N, down: RELEGATE_N }))
              : canRelegate
                ? t("movement.ruleDown", { down: RELEGATE_N })
                : t("movement.ruleUp", { up: PROMOTE_N })}
          </span>
          {relegationDormant && (
            <span className="text-cz-3 italic">{t("movement.dormant", { n: relegationTargetTier })}</span>
          )}
        </div>
      )}

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
                      {showZoneSeparators && !(hasPoolSubtabs && poolTab === POOL_ALL) && canRelegate && divStandings.length > PROMOTE_N + RELEGATE_N && i === divStandings.length - RELEGATE_N && (
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
                            {/* #1718: diskret AI-markør (uden eget hue/emoji, samme dæmpede stil som
                                rytter-ranglistens AI-tag) — AI-hold vises nu, men skal kunne skelnes. */}
                            {s.team?.is_ai && <span className="text-[9px] font-medium uppercase text-cz-3 border border-cz-border px-1 py-0.5 rounded">{t("aiBadge")}</span>}
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
                      {showZoneSeparators && !(hasPoolSubtabs && poolTab === POOL_ALL) && canPromote && divStandings.length > PROMOTE_N + RELEGATE_N && i === PROMOTE_N - 1 && (
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
                {canPromote && (
                  <div className="flex items-center gap-1.5 text-xs text-cz-success/70">
                    <span className="w-2 h-2 rounded-sm bg-cz-success-bg border border-cz-success/30" />
                    {t("legendPromotion")}
                  </div>
                )}
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
