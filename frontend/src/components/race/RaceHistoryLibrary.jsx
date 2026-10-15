// #6514 · Løbshistorik: Resultater → Arkiv bag race_library_v2.
//
// Ejer-beslutning 15/10: kun afsluttede løb; pr. løb vindere pr. sæson, dit
// bedste resultat, forsvarende mester og typisk afgørelse (samme "afgøres i"
// som kalenderens løbskort, lib/racePeek.js). Ingen km, ingen fjerde side:
// løbets navn fører til den eksisterende løbsside (/race-archive/:navn), og
// hver udgave til sit eget resultat (/races/:id).
//
// T2 (PAGE_TEMPLATES): FilterBar (søg + én pulje-vælger) + DataTable med D-047
// på mobil (navn + tre kolonner, "Fuld tabel" til resten). Data hentes pr.
// pulje, så en udgave pr. sæson er entydig. Modellen er lib/raceHistoryModel.js.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { supabase } from "../../lib/supabase";
import { fetchAllRows } from "../../lib/supabasePagination";
import { applySeniorSquadFilter } from "../../lib/seniorScope.ts";
import { groupColor } from "../../lib/racePeek.js";
import { buildRaceHistory, matchesSearch, paginate, HISTORY_PAGE_SIZE } from "../../lib/raceHistoryModel.js";
import {
  FilterBar, DataTable, Section, SkeletonLines, ErrorState, EmptyState, Button,
  FlagIcon, ChevronLeftIcon, ChevronRightIcon,
} from "../ui";

const ID_CHUNK = 100; // samme loft som biblioteket i #6636 (URL-længde på .in())

function chunks(list) {
  const out = [];
  for (let i = 0; i < list.length; i += ID_CHUNK) out.push(list.slice(i, i + ID_CHUNK));
  return out;
}

async function readChunked(ids, build) {
  const out = [];
  for (const part of chunks(ids)) {
    const rows = await fetchAllRows(() => build(part));
    out.push(...rows);
  }
  return out;
}

// Hele læsningen for én pulje. Kaster ved fejl (ErrorState + retry).
async function loadHistory({ poolId, teamId }) {
  // pagination-safe: fetchAllRows + id-chunks; én pulje = én udgave pr. løb pr. sæson.
  const races = await fetchAllRows(() => applySeniorSquadFilter(supabase
    .from("races")
    .select("id, name, race_type, race_class, stages, status, season:season_id(number)"))
    .eq("league_division_id", poolId)
    .eq("status", "completed")
    .order("id", { ascending: true }));
  const flat = races.map((r) => ({ ...r, season_number: r.season?.number ?? null }));
  const oneDayIds = flat.filter((r) => r.race_type !== "stage_race").map((r) => r.id);
  const stageIds = flat.filter((r) => r.race_type === "stage_race").map((r) => r.id);
  const winnerCols = "race_id, stage_number, result_type, rank, rider_id, rider_name, team_name";

  const [oneDayWinners, stageWinners] = await Promise.all([
    readChunked(oneDayIds, (ids) => supabase.from("race_results").select(winnerCols)
      .in("race_id", ids).eq("result_type", "stage").eq("rank", 1).order("id", { ascending: true })),
    readChunked(stageIds, (ids) => supabase.from("race_results").select(winnerCols)
      .in("race_id", ids).eq("result_type", "gc").eq("rank", 1).order("id", { ascending: true })),
  ]);
  const winnerRows = [...oneDayWinners, ...stageWinners];

  // Holdets placeringer: kun den endelige stilling. Endagsløb = stage; etapeløb =
  // gc ved sidste etape, grupperet pr. sidste-etape-nummer så hver forespørgsel
  // kun henter den ene etapes gc-rækker.
  let myRows = [];
  if (teamId) {
    const lastStage = new Map();
    for (const w of stageWinners) {
      const n = Number(w.stage_number) || 1;
      if (!lastStage.has(w.race_id) || n > lastStage.get(w.race_id)) lastStage.set(w.race_id, n);
    }
    const byFinal = new Map();
    for (const [raceId, n] of lastStage) {
      if (!byFinal.has(n)) byFinal.set(n, []);
      byFinal.get(n).push(raceId);
    }
    const parts = await Promise.all([
      readChunked(oneDayIds, (ids) => supabase.from("race_results").select("race_id, stage_number, result_type, rank")
        .in("race_id", ids).eq("team_id", teamId).eq("result_type", "stage").order("id", { ascending: true })),
      ...[...byFinal].map(([n, ids]) => readChunked(ids, (part) => supabase.from("race_results")
        .select("race_id, stage_number, result_type, rank")
        .in("race_id", part).eq("team_id", teamId).eq("result_type", "gc").eq("stage_number", n)
        .order("id", { ascending: true }))),
    ]);
    myRows = parts.flat();
  }

  // Typisk afgørelse: ruten for hvert løbs nyeste udgave.
  const latestByFamily = new Map();
  for (const r of flat) {
    const key = `${r.name}|${r.race_type ?? ""}`;
    const cur = latestByFamily.get(key);
    if (!cur || (r.season_number ?? 0) > (cur.season_number ?? 0)) latestByFamily.set(key, r);
  }
  const profiles = await readChunked([...latestByFamily.values()].map((r) => r.id), (ids) => supabase
    .from("race_stage_profiles").select("race_id, stage_number, profile_type")
    .in("race_id", ids).order("race_id").order("stage_number"));

  return buildRaceHistory({ races: flat, winnerRows, myRows, profiles });
}

export default function RaceHistoryLibrary() {
  const { t } = useTranslation(["results", "races"]);
  const [pools, setPools] = useState([]);
  const [team, setTeam] = useState(null); // { id, poolId }
  const [poolId, setPoolId] = useState(null);
  const [rows, setRows] = useState(null); // null = henter
  const [loadError, setLoadError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // Puljer + holdet: puljevælgerens indhold og standardvalget (egen pulje).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const [poolsRes, teamRes] = await Promise.all([
          applySeniorSquadFilter(supabase.from("league_divisions").select("id, tier, pool_index, label"))
            .order("tier").order("pool_index"),
          user ? supabase.from("teams").select("id, league_division_id").eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        if (!alive) return;
        if (poolsRes.error) { setLoadError(true); setRows([]); return; }
        const list = poolsRes.data || [];
        setPools(list);
        const own = teamRes.data ? { id: teamRes.data.id, poolId: teamRes.data.league_division_id ?? null } : null;
        setTeam(own);
        setPoolId(own?.poolId ?? list[0]?.id ?? null);
        if (!list.length) setRows([]);
      } catch {
        if (alive) { setLoadError(true); setRows([]); }
      }
    })();
    return () => { alive = false; };
  }, [retryTick]);

  useEffect(() => {
    if (poolId == null) return undefined;
    let alive = true;
    setRows(null);
    setLoadError(false);
    loadHistory({ poolId, teamId: team?.id ?? null })
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => {
        console.error("Race history load failed:", e);
        if (alive) { setLoadError(true); setRows([]); }
      });
    return () => { alive = false; };
  }, [poolId, team?.id, retryTick]);

  const retry = useCallback(() => setRetryTick((n) => n + 1), []);

  const filtered = useMemo(() => (rows || []).filter((r) => matchesSearch(r.name, search)), [rows, search]);
  const pg = paginate(filtered, page, HISTORY_PAGE_SIZE);

  const seasonTag = (n) => (n != null ? t("raceHistory.seasonShort", { number: n }) : "");
  const classLabel = (r) => (r.raceClass ? t(`races:classOption.${r.raceClass}`, { defaultValue: r.raceClass }) : null);
  const typeLabel = (r) => (r.raceType === "stage_race" ? t("raceHistory.stages", { count: r.stages }) : t("raceHistory.oneDay"));

  const columns = [
    {
      key: "name",
      header: t("raceHistory.th.race"),
      sticky: true,
      render: (r) => (
        <Link to={`/race-archive/${encodeURIComponent(r.name)}`} className="text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t">
          {r.name}
        </Link>
      ),
      subline: (r) => [classLabel(r), typeLabel(r)].filter(Boolean).join(" · "),
    },
    {
      key: "champion",
      header: t("raceHistory.th.champion"),
      mobileHeader: t("raceHistory.th.championShort"),
      render: (r) => (r.champion ? (
        <span className="block">
          <Link to={`/races/${r.champion.raceId}`} className="text-cz-1 hover:text-cz-accent-t">{r.champion.name}</Link>
          <span className="block font-data text-3xs uppercase tracking-[.04em] text-cz-3 tabular-nums">{seasonTag(r.champion.season)}</span>
        </span>
      ) : <span className="text-cz-3">{t("raceHistory.noWinner")}</span>),
    },
    {
      key: "best",
      header: t("raceHistory.th.best"),
      mobileHeader: t("raceHistory.th.bestShort"),
      numeric: true,
      render: (r) => (r.myBest ? (
        <Link to={`/races/${r.myBest.raceId}`} className="block text-cz-1 hover:text-cz-accent-t">
          <span className="font-data tabular-nums">{t("raceHistory.place", { rank: r.myBest.rank })}</span>
          <span className="block font-data text-3xs uppercase tracking-[.04em] text-cz-3 tabular-nums">{seasonTag(r.myBest.season)}</span>
        </Link>
      ) : <span className="text-cz-3">{t("raceHistory.notPlaced")}</span>),
    },
    {
      key: "decided",
      header: t("raceHistory.th.decided"),
      mobileHeader: t("raceHistory.th.decidedShort"),
      render: (r) => (r.decided.length ? (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px]">
          {r.decided.map((d, i) => (
            <span key={d.group} className="inline-flex items-center gap-1">
              {i > 0 && <span className="text-cz-3" aria-hidden="true">+</span>}
              <span aria-hidden="true" className="h-2 w-2 shrink-0" style={{ backgroundColor: groupColor(d.group) }} />
              <span>
                {t(`raceHistory.group.${d.group}`)}
                {r.decidedStageCount > 1 && <span className="font-data tabular-nums text-cz-3"> ({d.count})</span>}
              </span>
            </span>
          ))}
        </span>
      ) : <span className="text-cz-3">{t("raceHistory.noRoute")}</span>),
    },
    {
      key: "winners",
      header: t("raceHistory.th.winners"),
      render: (r) => (
        <ul className="m-0 list-none space-y-0.5 p-0">
          {r.editions.slice(0, 4).map((ed) => (
            <li key={ed.raceId} className="flex items-baseline gap-2">
              <span className="w-7 shrink-0 font-data text-3xs uppercase tracking-[.04em] text-cz-3 tabular-nums">{seasonTag(ed.season)}</span>
              <Link to={`/races/${ed.raceId}`} className="min-w-0 truncate text-cz-2 hover:text-cz-accent-t">
                {ed.winner?.name ?? t("raceHistory.noWinner")}
              </Link>
            </li>
          ))}
          {r.editions.length > 4 && (
            <li>
              <Link to={`/race-archive/${encodeURIComponent(r.name)}`} className="inline-flex items-center gap-0.5 text-2xs text-cz-accent-t hover:underline">
                {t("raceHistory.allEditions", { count: r.editions.length })}
                <ChevronRightIcon size={12} aria-hidden="true" />
              </Link>
            </li>
          )}
        </ul>
      ),
    },
  ];

  const ownPoolLabel = pools.find((p) => p.id === team?.poolId)?.label;
  const poolOptions = pools.map((p) => ({ value: String(p.id), label: p.label }));

  const emptyNode = search ? (
    <EmptyState
      icon={<FlagIcon size={26} aria-hidden="true" />}
      title={t("raceHistory.emptySearch.title")}
      description={t("raceHistory.emptySearch.desc")}
      action={<Button size="sm" variant="secondary" onClick={() => { setSearch(""); setPage(0); }}>{t("raceHistory.emptySearch.action")}</Button>}
    />
  ) : (
    <EmptyState
      icon={<FlagIcon size={26} aria-hidden="true" />}
      title={t("raceHistory.empty.title")}
      description={t("raceHistory.empty.desc")}
      action={team?.poolId != null && team.poolId !== poolId
        ? <Button size="sm" variant="secondary" onClick={() => { setPoolId(team.poolId); setPage(0); }}>{t("raceHistory.empty.action", { pool: ownPoolLabel ?? "" })}</Button>
        : <Link to="/resultater" className="text-xs font-medium text-cz-accent-t hover:underline">{t("raceHistory.empty.latest")}</Link>}
    />
  );

  return (
    <div data-testid="race-history-library">
      <FilterBar
        className="mb-4"
        search={{
          value: search,
          onChange: (e) => { setSearch(e.target.value); setPage(0); },
          placeholder: t("raceHistory.searchPlaceholder"),
          testId: "race-history-search",
        }}
        filters={poolOptions.length > 1 ? [{
          key: "pool",
          value: poolId != null ? String(poolId) : "",
          onChange: (e) => { setPoolId(Number(e.target.value)); setPage(0); },
          ariaLabel: t("raceHistory.poolLabel"),
          options: poolOptions,
        }] : []}
        meta={rows ? t("raceHistory.count", { count: filtered.length }) : null}
      />

      {rows === null ? (
        <Section><SkeletonLines lines={6} /></Section>
      ) : loadError ? (
        <Section>
          <ErrorState
            description={t("raceHistory.error")}
            action={<Button size="sm" variant="secondary" onClick={retry}>{t("raceHistory.retry")}</Button>}
          />
        </Section>
      ) : (
        <>
          <DataTable
            label={t("raceHistory.tableLabel")}
            rowKey={(r) => r.key}
            rows={pg.rows}
            columns={columns}
            mobileDefaults={["champion", "best", "decided"]}
            empty={emptyNode}
          />
          {pg.total > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="font-data text-xs text-cz-3 tabular-nums">
                {t("raceHistory.showing", { from: pg.from, to: pg.to, total: pg.total })}
              </span>
              {pg.pages > 1 && (
                <span className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" disabled={pg.page === 0} onClick={() => setPage(pg.page - 1)}
                    iconLeft={<ChevronLeftIcon size={14} aria-hidden="true" />}>
                    {t("raceHistory.prev")}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={pg.page >= pg.pages - 1} onClick={() => setPage(pg.page + 1)}
                    iconRight={<ChevronRightIcon size={14} aria-hidden="true" />}>
                    {t("raceHistory.next")}
                  </Button>
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
