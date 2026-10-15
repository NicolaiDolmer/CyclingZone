// #6514 · Løbshistorik: Resultater → Arkiv bag race_library_v2.
//
// Ejer-beslutning 15/10: kun afsluttede løb; pr. løb vindere pr. sæson, dit
// bedste resultat, forsvarende mester og terræn (samme glyffer og kalender-
// kategorier som kalenderens løbskort; ejer 14:06: "Afgøres i" udgår). Ingen km, ingen fjerde side:
// løbets navn fører til den eksisterende løbsside (/race-archive/:navn), og
// hver udgave til sit eget resultat (/races/:id).
//
// T2 (PAGE_TEMPLATES): FilterBar (søg + én pulje-vælger) + DataTable med D-047
// på mobil (navn + tre kolonner, "Fuld tabel" til resten). Data hentes pr.
// pulje, så en udgave pr. sæson er entydig. Modellen er lib/raceHistoryModel.ts.
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { supabase } from "../../lib/supabase.ts";
import { fetchAllRows } from "../../lib/supabasePagination.js";
import { applySeniorSquadFilter } from "../../lib/seniorScope.ts";
import {
  buildRaceHistory, matchesSearch, paginate, HISTORY_PAGE_SIZE,
  type HistoryRace, type HistoryRow, type ProfileRow, type ResultRow,
} from "../../lib/raceHistoryModel.ts";
import FilterBarBase from "../ui/FilterBar.jsx";
import { DataTable as DataTableBase } from "../ui/DataTable.jsx";
import SectionBase from "../ui/Section.jsx";
import { SkeletonLines as SkeletonLinesBase } from "../ui/Skeleton.jsx";
import ErrorStateBase from "../ui/ErrorState.jsx";
import EmptyStateBase from "../ui/EmptyState.jsx";
import ButtonBase from "../ui/Button.jsx";
import RaceTerrainGlyphs from "./RaceTerrainGlyphs.tsx";
import { FlagIcon, ChevronLeftIcon, ChevronRightIcon } from "../ui/icons/index.jsx";

// Primitiverne i components/ui er stadig .jsx uden typer (samme greb som
// TradeListPage.tsx): kontrakten skrives ned her, læst af filerne selv.
interface Column {
  key: string;
  header: string;
  sticky?: boolean;
  numeric?: boolean;
  mobileHeader?: string;
  render: (row: HistoryRow) => ReactNode;
  subline?: (row: HistoryRow) => ReactNode;
}
interface FilterBarProps {
  className?: string;
  search?: { value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void; placeholder: string; testId?: string };
  filters?: { key: string; value: string; onChange: (e: ChangeEvent<HTMLSelectElement>) => void; ariaLabel: string; options: { value: string; label: string }[] }[];
  meta?: ReactNode;
}
interface DataTableProps {
  label: string;
  rowKey: (row: HistoryRow) => string;
  rows: HistoryRow[];
  columns: Column[];
  mobileDefaults?: string[];
  dense?: boolean;
  empty?: ReactNode;
}
interface StateProps { icon?: ReactNode; title?: string; description?: string; action?: ReactNode }
interface ButtonProps {
  size?: string; variant?: string; disabled?: boolean; onClick?: () => void;
  iconLeft?: ReactNode; iconRight?: ReactNode; children?: ReactNode;
}
const FilterBar = FilterBarBase as unknown as ComponentType<FilterBarProps>;
const DataTable = DataTableBase as unknown as ComponentType<DataTableProps>;
const Section = SectionBase as unknown as ComponentType<{ children?: ReactNode }>;
const SkeletonLines = SkeletonLinesBase as unknown as ComponentType<{ lines?: number }>;
const ErrorState = ErrorStateBase as unknown as ComponentType<StateProps>;
const EmptyState = EmptyStateBase as unknown as ComponentType<StateProps>;
const Button = ButtonBase as unknown as ComponentType<ButtonProps>;

interface Pool { id: number; tier: number; pool_index: number; label: string }
interface RaceRow { id: string; name: string; race_type: string | null; race_class: string | null; stages: number | null; season: { number: number | null } | null }

const ID_CHUNK = 100; // samme loft som biblioteket i #6636 (URL-længde på .in())

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += ID_CHUNK) out.push(list.slice(i, i + ID_CHUNK));
  return out;
}

// Seniorpuljer (squad null/senior), også pensionerede: historikken dækker
// tidligere sæsoner. Callback-formen gør scopet synligt for #5517-vagten
// (backend/lib/squadSeniorReaders.test.js), samme greb som #6636.
function withSeniorSquadScope<R>(build: (scope: typeof applySeniorSquadFilter) => R): R {
  return build(applySeniorSquadFilter);
}

// "Jonas Riedel" -> "J. Riedel": tre tidligere vindere skal kunne stå på én linje.
function shortName(name: string): string {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : String(name);
}

// Henter alle rækker for en id-liste: id-chunks (URL-længde) og fetchAllRows pr.
// chunk (PostgREST' 1000-rækkers loft).
async function readChunked<T>(ids: readonly string[], build: (ids: string[]) => unknown): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunks(ids)) {
    const rows = (await fetchAllRows(() => build(part))) as T[];
    out.push(...rows);
  }
  return out;
}

// Hele læsningen for én pulje. Kaster ved fejl (ErrorState + retry).
async function loadHistory({ poolId, teamId }: { poolId: number; teamId: string | null }): Promise<HistoryRow[]> {
  // pagination-safe: fetchAllRows; én pulje = én udgave pr. løb pr. sæson.
  const races = (await fetchAllRows(() => applySeniorSquadFilter(supabase
    .from("races")
    .select("id, name, race_type, race_class, stages, status, season:season_id(number)"))
    .eq("league_division_id", poolId)
    .eq("status", "completed")
    .order("id", { ascending: true }))) as RaceRow[];
  const flat: HistoryRace[] = races.map((r) => ({
    id: r.id, name: r.name, race_type: r.race_type, race_class: r.race_class, stages: r.stages, season_number: r.season?.number ?? null,
  }));
  const oneDayIds = flat.filter((r) => r.race_type !== "stage_race").map((r) => r.id);
  const stageIds = flat.filter((r) => r.race_type === "stage_race").map((r) => r.id);
  const winnerCols = "race_id, stage_number, result_type, rank, rider_id, rider_name, team_name";

  const [oneDayWinners, stageWinners] = await Promise.all([
    readChunked<ResultRow>(oneDayIds, (ids) => supabase
      // pagination-safe: readChunked pager via fetchAllRows pr. id-chunk.
      .from("race_results").select(winnerCols)
      .in("race_id", ids).eq("result_type", "stage").eq("rank", 1).order("id", { ascending: true })),
    readChunked<ResultRow>(stageIds, (ids) => supabase
      // pagination-safe: readChunked pager via fetchAllRows pr. id-chunk.
      .from("race_results").select(winnerCols)
      .in("race_id", ids).eq("result_type", "gc").eq("rank", 1).order("id", { ascending: true })),
  ]);
  const winnerRows = [...oneDayWinners, ...stageWinners];

  // Holdets placeringer: kun den endelige stilling. Endagsløb = stage; etapeløb =
  // gc ved sidste etape, grupperet pr. sidste-etape-nummer så hver forespørgsel
  // kun henter den ene etapes gc-rækker.
  let myRows: ResultRow[] = [];
  if (teamId) {
    const lastStage = new Map<string, number>();
    for (const w of stageWinners) {
      const n = Number(w.stage_number) || 1;
      const cur = lastStage.get(w.race_id);
      if (cur === undefined || n > cur) lastStage.set(w.race_id, n);
    }
    const byFinal = new Map<number, string[]>();
    for (const [raceId, n] of lastStage) {
      const list = byFinal.get(n) ?? [];
      list.push(raceId);
      byFinal.set(n, list);
    }
    const parts = await Promise.all([
      readChunked<ResultRow>(oneDayIds, (ids) => supabase
        // pagination-safe: readChunked pager via fetchAllRows pr. id-chunk.
        .from("race_results").select("race_id, stage_number, result_type, rank")
        .in("race_id", ids).eq("team_id", teamId).eq("result_type", "stage").order("id", { ascending: true })),
      ...[...byFinal].map(([n, ids]) => readChunked<ResultRow>(ids, (part) => supabase
        // pagination-safe: readChunked pager via fetchAllRows pr. id-chunk.
        .from("race_results").select("race_id, stage_number, result_type, rank")
        .in("race_id", part).eq("team_id", teamId).eq("result_type", "gc").eq("stage_number", n)
        .order("id", { ascending: true }))),
    ]);
    myRows = parts.flat();
  }

  // Terræn: ruten for hvert løbs nyeste udgave.
  const latestByFamily = new Map<string, HistoryRace>();
  for (const r of flat) {
    const key = `${r.name}|${r.race_type ?? ""}`;
    const cur = latestByFamily.get(key);
    if (!cur || (r.season_number ?? 0) > (cur.season_number ?? 0)) latestByFamily.set(key, r);
  }
  const profiles = await readChunked<ProfileRow>([...latestByFamily.values()].map((r) => r.id), (ids) => supabase
    // pagination-safe: readChunked pager via fetchAllRows pr. id-chunk.
    .from("race_stage_profiles").select("race_id, stage_number, profile_type")
    .in("race_id", ids).order("race_id").order("stage_number"));

  return buildRaceHistory({ races: flat, winnerRows, myRows, profiles });
}


// Løbets historikside, med løbstypen så et endagsløb og et etapeløb med samme navn holdes ude fra hinanden.
function archiveHref(r: HistoryRow): string {
  const base = `/race-archive/${encodeURIComponent(r.name)}`;
  return r.raceType ? `${base}?type=${encodeURIComponent(r.raceType)}` : base;
}

export default function RaceHistoryLibrary() {
  const { t } = useTranslation(["results", "races", "calendar"]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [team, setTeam] = useState<{ id: string; poolId: number | null } | null>(null);
  const [poolId, setPoolId] = useState<number | null>(null);
  const [rows, setRows] = useState<HistoryRow[] | null>(null); // null = henter
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
          withSeniorSquadScope((scope) => scope(supabase.from("league_divisions").select("id, tier, pool_index, label"))
            .order("tier").order("pool_index")),
          user ? supabase.from("teams").select("id, league_division_id").eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        ]);
        if (!alive) return;
        if (poolsRes.error || teamRes.error) { setLoadError(true); setRows([]); return; }
        const list = (poolsRes.data || []) as Pool[];
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

  const seasonTag = (n: number | null | undefined) => (n != null ? t("raceHistory.seasonShort", { number: n }) : "");
  const classLabel = (r: HistoryRow) => (r.raceClass ? t(`races:classOption.${r.raceClass}`, { defaultValue: r.raceClass }) : null);
  const typeLabel = (r: HistoryRow) => (r.raceType === "stage_race" ? t("raceHistory.stages", { count: r.stages }) : t("raceHistory.oneDay"));

  const columns: Column[] = [
    {
      key: "name",
      header: t("raceHistory.th.race"),
      sticky: true,
      render: (r) => (
        <Link to={archiveHref(r)} className="text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t">
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
      // Samme terrænsprog som kalenderens løbskort (calendar:terrain.*).
      key: "terrain",
      header: t("raceHistory.th.terrain"),
      render: (r) => (r.terrain.length ? (
        <RaceTerrainGlyphs
          terrain={r.terrain}
          label={(x) => t("calendar:peek.terrainCount", { type: t(`calendar:terrain.${x.kind}`), count: x.count })}
        />
      ) : <span className="text-cz-3">{t("raceHistory.noRoute")}</span>),
    },
    {
      // Vindere pr. sæson: den nyeste udgave står allerede som forsvarende
      // mester, så her står de tidligere (intet navn to gange i samme række).
      key: "winners",
      header: t("raceHistory.th.winners"),
      render: (r) => {
        const earlier = r.editions.slice(1);
        if (!earlier.length) return <span className="text-cz-3">{t("raceHistory.firstEdition")}</span>;
        return (
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
            {earlier.slice(0, 3).map((ed) => (
              <span key={ed.raceId} className="inline-flex items-baseline gap-1">
                <span className="font-data text-3xs uppercase tracking-[.04em] text-cz-3 tabular-nums">{seasonTag(ed.season)}</span>
                <Link to={`/races/${ed.raceId}`} className="text-cz-2 hover:text-cz-accent-t">
                  {ed.winner?.name ? shortName(ed.winner.name) : t("raceHistory.noWinner")}
                </Link>
              </span>
            ))}
            {earlier.length > 3 && (
              <Link to={archiveHref(r)} className="inline-flex items-center gap-0.5 text-2xs text-cz-accent-t hover:underline">
                {t("raceHistory.allEditions", { count: r.editions.length })}
                <ChevronRightIcon size={12} aria-hidden="true" />
              </Link>
            )}
          </span>
        );
      },
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
            mobileDefaults={["champion", "best", "terrain"]}
            dense
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
