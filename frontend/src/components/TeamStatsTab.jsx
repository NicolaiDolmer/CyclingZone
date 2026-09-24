import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { supabase } from "../lib/supabase";
import { getRiderRankings } from "../lib/rankingsApi.ts";
import RiderLink from "./RiderLink";
import NationCell from "./rider/NationCell";
import { getCountryCode3 } from "../lib/countryUtils";
import { formatNumber } from "../lib/intl";
import { DataTable, EmptyState, ErrorState, SkeletonLines, Button, TrophyIcon } from "./ui";
import { squadGroupFilterToolbar } from "./squad/SquadGroupFilter.tsx";

// #3190: samme seks sejrs-kategorier som rytter-ranglisten (hooks/useRiderRankings.js's
// WIN_KEYS, #925's total_wins-definition) — dupliceret her i stedet for importeret,
// fordi hook'en henter ALLE ryttere i sæsonen (unødvendigt tungt for holdets egne
// ~20-30 ryttere, som vi allerede har id'erne på).
const WIN_KEYS = ["stage_wins", "gc_wins", "classic_wins", "pts_wins", "mtn_wins", "young_wins"];
const n = (v) => Number(v) || 0;
const EMPTY_STATS = { raceDays: 0, wins: 0, points: 0, prize: 0 };

// #3190 — Mit Holds tredje fane: sæsonstats pr. rytter (løbsdage, sejre, point,
// præmiepenge), NFL-stil sæsonoversigt. Kilde: Discord #feedback-and-ideas 1/8
// (@thelamba), ejer-ja samme dag.
//
// GENBRUG FØRST: point/sejre/præmie kommer fra rider_rankings_mv (#2175) — det
// SAMME færdig-aggregerede matview som /rider-rankings (useRiderRankings.js) og
// get_season_honours (#2863) allerede bruger, blot filtreret til holdets egne
// rytter-id'er i stedet for hele sæsonen. Kun "løbsdage" findes ikke i forvejen
// noget sted — dét er den ene nye (meget lette, team-scoped) aggregering, se
// database/2026-08-03-3190-team-rider-race-days.sql for skema-verifikation +
// EXPLAIN ANALYZE mod prod.
//
// `riders` = holdets NUVÆRENDE trup (samme `currentRiders`-array TeamPage.jsx
// allerede beregner til sine egne sum-linjer — ingen ekstra fetch her).
//
// #5075 (spillerforslag @cybersimon 9/9): gruppe-filteret er den SAMME
// state som Trup-fanen (løftet til TeamPage.jsx, se squad/SquadGroupFilter.tsx) —
// tabellens rækker filtreres på den her, så tallene (i dag pr. rytter; en
// fremtidig sum-/gennemsnitslinje ville arve det samme) altid regnes på den
// viste, filtrerede liste. `riders` holder BEVIDST hele holdet (ikke det
// filtrerede sæt): stats hentes én gang for alle rytter-id'er, så et filter-
// klik ikke udløser en ny fetch — kun `rows` nedenfor filtreres.
//
// #5631: `squadFilter` (useSquadGroupFilter i TeamPage) erstatter de fire
// showSeniors/showAcademy-props: Senior / U23 / Junior. Uden squadFilter
// (U23 team- og Junior team-siden, SquadPage.tsx) vises hele den givne trup
// uden filter-kontrol, fordi siden allerede ER én trup.
export default function TeamStatsTab({ riders, squadFilter = null }) {
  const { t } = useTranslation("team");
  const navigate = useNavigate();
  const [season, setSeason] = useState(null);
  const [statsByRider, setStatsByRider] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [sortKey, setSortKey] = useState("points");
  const [sortDir, setSortDir] = useState("desc");

  const riderIds = riders.map((r) => r.id);
  const riderIdsKey = riderIds.join(",");
  // CodeRabbit (#5075 rettespor 23/9): riderIdsKey alene fanger IKKE en rytter
  // der skifter is_academy UDEN at skifte id (fx en graduering) — `rows`-memoet
  // nedenfor ville ellers beholde den GAMLE akademi-/senior-gruppering, indtil
  // noget andet (sort/statsByRider) tvang en genberegning. Samme stabile
  // streng-proxy-mønster som riderIdsKey, blot for is_academy-feltet.
  const academyFlagsKey = riders.map((r) => (r.is_academy ? "1" : "0")).join("");
  // #5075 rettespor 23/9: DataTable's toolbar-slot tjekker kun `toolbar && (...)`
  // (DataTable.jsx) — et React-element er ALTID sandt, også når komponenten selv
  // returnerer null. squadGroupFilterToolbar giver derfor null (ikke et element
  // der renderer null) når der intet er at filtrere, så DataTable ikke monterer
  // en tom toolbar-bjælke (148 af 258 menneskestyrede hold har ingen
  // akademiryttere).
  const filterKey = squadFilter?.key ?? "";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: seasonData, error: seasonErr } = await supabase
          .from("seasons").select("id, number").eq("status", "active").maybeSingle();
        if (seasonErr) throw seasonErr;
        if (cancelled) return;
        setSeason(seasonData);
        if (!seasonData || riderIds.length === 0) { setStatsByRider({}); return; }

        // #2891-lektionen: server-side aggregat, ikke rå race_results til klienten.
        const [rankingsRes, raceDaysRes] = await Promise.all([
          getRiderRankings(seasonData.id, riderIds),
          supabase.rpc("get_rider_race_days", { p_rider_ids: riderIds, p_season_id: seasonData.id }),
        ]);
        // Kast eksplicit (#1851-klassen): et tavst `|| []` ville vise en tom
        // stats-fane som om holdet ingen resultater havde.
        if (rankingsRes.error) throw new Error(`rider_rankings_mv: ${rankingsRes.error.message}`);
        if (raceDaysRes.error) throw new Error(`get_rider_race_days: ${raceDaysRes.error.message}`);

        const byId = {};
        (rankingsRes.data || []).forEach((row) => {
          const wins = WIN_KEYS.reduce((sum, k) => sum + n(row[k]), 0);
          byId[row.rider_id] = { ...EMPTY_STATS, points: n(row.points), prize: n(row.prize_earned), wins };
        });
        (raceDaysRes.data || []).forEach((row) => {
          byId[row.rider_id] = { ...(byId[row.rider_id] || EMPTY_STATS), raceDays: n(row.race_days) };
        });
        if (!cancelled) setStatsByRider(byId);
      } catch (e) {
        console.error("TeamStatsTab: failed to load season stats", e);
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // riderIdsKey er den stabile proxy for riderIds (nyt array-ref hver render) —
    // effekten skal kun genkøre når rytter-sættet eller reloadToken faktisk ændrer sig.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- riderIdsKey er den stabile streng-proxy for riderIds (nyt array-ref hver render)
  }, [riderIdsKey, reloadToken]);

  function handleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const rows = useMemo(() => {
    // #5075: samme akademi-/senior-filter som Trup-fanen — filtreres FØR sort,
    // så tabellens indhold (og enhver fremtidig sum-/gennemsnitslinje) matcher
    // den viste, filtrerede liste.
    const filtered = squadFilter ? riders.filter((r) => squadFilter.isVisible(r)) : riders;
    const withStats = filtered.map((r) => ({ ...r, ...(statsByRider[r.id] || EMPTY_STATS) }));
    return [...withStats].sort((a, b) => {
      const diff = (b[sortKey] || 0) - (a[sortKey] || 0);
      return sortDir === "desc" ? diff : -diff;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- memoet læser id/navn/nationalitet fra riders (stabile når riderIdsKey er uændret) og is_academy (stabilt når academyFlagsKey er uændret, CodeRabbit-fund #5075 23/9); tallene kommer fra statsByRider, som ER en dependency
  }, [riderIdsKey, academyFlagsKey, statsByRider, sortKey, sortDir, filterKey]);

  if (loading) return <SkeletonLines lines={6} />;

  if (error) return (
    <ErrorState
      title={t("stats.loadError")}
      action={<Button variant="secondary" size="sm" onClick={() => setReloadToken((x) => x + 1)}>{t("stats.retry")}</Button>}
    />
  );

  if (!season) {
    return <EmptyState icon={<TrophyIcon size={26} aria-hidden="true" />} title={t("stats.noActiveSeason")} />;
  }

  if (riders.length === 0) {
    return (
      <EmptyState
        icon={<TrophyIcon size={26} aria-hidden="true" />}
        title={t("squad.emptyState")}
        description={t("squad.emptyStateBody")}
      />
    );
  }

  const columns = [
    {
      key: "nation",
      header: t("squad.headers.nation"),
      fold: true,
      foldValue: (r) => getCountryCode3(r.nationality_code) || "—",
      render: (r) => <NationCell code={r.nationality_code} />,
    },
    {
      key: "name",
      header: t("squad.headers.rider"),
      sticky: true,
      render: (r) => (
        <RiderLink id={r.id} stopPropagation className="text-cz-1 hover:text-cz-accent-t transition-colors">
          {r.firstname} {r.lastname}
        </RiderLink>
      ),
    },
    {
      key: "raceDays",
      header: t("stats.headers.raceDays"),
      sortKey: "raceDays",
      numeric: true,
      compact: true,
      render: (r) => (
        <span className={sortKey === "raceDays" ? "font-bold text-cz-accent-t" : r.raceDays > 0 ? "text-cz-2" : "text-cz-3"}>
          {formatNumber(r.raceDays)}
        </span>
      ),
    },
    {
      key: "wins",
      header: t("stats.headers.wins"),
      sortKey: "wins",
      numeric: true,
      compact: true,
      render: (r) => (
        <span className={sortKey === "wins" ? "font-bold text-cz-accent-t" : r.wins > 0 ? "text-cz-2" : "text-cz-3"}>
          {formatNumber(r.wins)}
        </span>
      ),
    },
    {
      key: "points",
      header: t("stats.headers.points"),
      sortKey: "points",
      numeric: true,
      compact: true,
      render: (r) => (
        <span className={sortKey === "points" ? "font-bold text-cz-accent-t" : r.points > 0 ? "text-cz-2" : "text-cz-3"}>
          {formatNumber(r.points)}
        </span>
      ),
    },
    {
      key: "prize",
      header: t("stats.headers.prize"),
      sortKey: "prize",
      numeric: true,
      compact: true,
      render: (r) => (
        <span className={sortKey === "prize" ? "font-bold text-cz-accent-t" : r.prize > 0 ? "text-cz-2" : "text-cz-3"}>
          {formatNumber(r.prize)} <span className="text-3xs text-cz-3">CZ$</span>
        </span>
      ),
    },
  ];

  return (
    <div>
      {/* #3190: sæson skal fremgå tydeligt — stats-fanen er altid indeværende sæson. */}
      <p className="mb-3 text-[13px] text-cz-2">{t("stats.seasonLabel", { n: season.number })}</p>
      <DataTable
        label={t("tabs.stats")}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        /* D-047 (#5102): saesonen laeses paa sejre, point og praemiepenge. */
        mobileDefaults={["wins", "points", "prize"]}
        sort={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        rowProps={(r) => ({ onClick: () => navigate(`/riders/${r.id}`), className: "cursor-pointer" })}
        /* #5075: samme kontrol + state som Trup-fanen — ligger i tabellens egen
           toolbar, samme placering/mønster som SquadTab (#4628). Sendes KUN når
           filteret har noget at vise (se rettespor-kommentaren ovenfor) — ellers
           null, så DataTable ikke monterer en tom toolbar-bjælke. */
        toolbar={squadFilter ? squadGroupFilterToolbar(squadFilter, riders) : null}
        /* Holdet har ryttere, men filteret skjuler dem alle — toolbaren (og dermed
           til-/fravalget) skal blive stående, så spilleren kan slå det fra igen. */
        empty={<EmptyState icon={<TrophyIcon size={26} aria-hidden="true" />} title={t("squad.emptyView")} />}
        count={t("squad.count", { count: rows.length })}
      />
    </div>
  );
}
