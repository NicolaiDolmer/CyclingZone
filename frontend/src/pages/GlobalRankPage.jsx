import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import TeamLink from "../components/TeamLink";
import { formatNumber } from "../lib/intl";
import { useGlobalRank } from "../hooks/useGlobalRank";
import {
  Card, EmptyState, ErrorState, Input, Select, Button, DataTable, SkeletonLines, PodiumIcon,
} from "../components/ui";
import { WRAP } from "../components/ui/dataTableStyles.js";
import { RULES_NUMBERS } from "../lib/rulesNumbers";
import { divColor } from "../lib/divisionColors.js";

// #2453: division (tier) faner, samme konstant-mirror som StandingsPage.
const ALL_DIVISIONS = Array.from(
  { length: RULES_NUMBERS.maxDivision - RULES_NUMBERS.minDivision + 1 },
  (_, i) => RULES_NUMBERS.minDivision + i,
);
const DIV_ALL = "all";

// #2206-mønster: pagineret visning frem for at rendere hele ranglisten i ét skud.
const PAGE_SIZE = 50;

function MovementBadge({ movement, t }) {
  if (movement == null) {
    return <span className="text-cz-3 text-xs" title={t("newBadgeTooltip")}>{t("newBadge")}</span>;
  }
  if (movement === 0) {
    return <span className="text-cz-3 font-mono text-xs">·</span>;
  }
  const up = movement > 0;
  return (
    <span
      className={`font-mono text-xs font-bold inline-flex items-center gap-0.5 ${up ? "text-cz-success" : "text-cz-danger"}`}
      title={up ? t("movementUpTooltip", { n: movement }) : t("movementDownTooltip", { n: Math.abs(movement) })}>
      {up ? "▲" : "▼"} {Math.abs(movement)}
    </span>
  );
}

function SidePanel({ title, rows, emptyLabel, unitLabel, valueKey, valueSuffix, navigate }) {
  return (
    <Card className="p-4">
      <h2 className="text-cz-1 font-semibold text-sm mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-cz-3 text-xs py-2">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row, i) => (
            <div key={row.team_id}
              onClick={() => navigate(`/teams/${row.team_id}?tab=results`)}
              className="flex items-center gap-2 py-1.5 border-b border-cz-border last:border-0 cursor-pointer hover:bg-cz-subtle rounded px-1 -mx-1 transition-colors">
              <span className="text-cz-3 font-mono text-xs w-4 flex-shrink-0">{i + 1}</span>
              <span className="text-cz-1 text-sm truncate flex-1">{row.name}</span>
              <span className="font-mono text-xs font-bold text-cz-accent-t flex-shrink-0">
                {valueKey === "places_gained" ? `+${row[valueKey]}` : formatNumber(row[valueKey])} {valueSuffix || unitLabel}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function GlobalRankPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("globalRank");
  const { teams, climbers, bestNewManagers, loading, error, reload } = useGlobalRank();
  const [myTeamId, setMyTeamId] = useState(null);
  const [divFilter, setDivFilter] = useState(DIV_ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: mine } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
      setMyTeamId(mine?.id || null);
    })();
  }, []);

  useEffect(() => { setPage(0); }, [divFilter, search]);

  const filtered = teams
    .filter(row => divFilter === DIV_ALL || row.division === divFilter)
    .filter(row => !search || (row.name || "").toLowerCase().includes(search.toLowerCase()));

  const myRow = teams.find(row => row.team_id === myTeamId) || null;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const divCounts = ALL_DIVISIONS.map(d => ({ div: d, count: teams.filter(row => row.division === d).length }));

  // #3104 etape C: siden er fane-indhold i Ranglister-hubben nu (RankingsHubPage
  // ejer PageHeader + faner), så egen PageHeader og yder-container udgik — samme
  // regel som RacePointsPage under #3102 etape 2. States renderer kun kropszonen.
  if (loading) return (
    <div className={`${WRAP} p-5`}>
      <SkeletonLines lines={6} />
    </div>
  );

  // #2849 bølge 3: hand-rolled fejl-banner (rounded-lg + ad-hoc knap) erstattet
  // af den kanoniske ErrorState — samme genindlæsning (setPage(0) + reload()).
  if (error) return (
    <ErrorState
      title={t("loadError")}
      action={<Button size="sm" variant="secondary" onClick={() => { setPage(0); reload(); }}>{t("retry")}</Button>}
    />
  );

  // #2849 bølge 3 — DataTable-kolonner (T2 wide-data-recipe). Rang + bevægelse +
  // holdnavn + badges samlet i ÉN sticky navnecelle (samme mønster som
  // StandingsPage's renderTeamCell), i stedet for separate "#"/"Bevægelse"-kolonner.
  const columns = [
    {
      key: "team",
      header: t("thTeam"),
      sticky: true,
      render: (row) => {
        const isMe = row.team_id === myTeamId;
        return (
          <span className="flex flex-wrap items-center gap-2">
            <span className={`font-mono font-bold text-sm ${row.global_rank === 1 ? "text-cz-accent-t" : row.global_rank <= 3 ? "text-cz-2" : "text-cz-3"}`}>
              #{row.global_rank}
            </span>
            <MovementBadge movement={row.movement} t={t} />
            <TeamLink id={row.team_id} tab="results" stopPropagation className="font-medium text-cz-1">{row.name}</TeamLink>
            {isMe && (
              <span className="shrink-0 rounded-full px-1.5 py-0.5 text-3xs font-bold uppercase"
                style={{ backgroundColor: "rgb(var(--me-badge-bg))", color: "rgb(var(--me-badge-fg))" }}>
                {t("youBadge")}
              </span>
            )}
            {row.is_ai && (
              <span className="shrink-0 rounded border border-cz-border px-1 py-0.5 text-3xs font-medium uppercase text-cz-3">
                {t("aiBadge")}
              </span>
            )}
            {row.is_rookie && (
              <span className="shrink-0 rounded border border-cz-accent/30 px-1 py-0.5 text-3xs font-medium uppercase text-cz-accent-t">
                {t("rookieBadge")}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "division",
      header: t("thDivision"),
      fold: true,
      foldValue: (row) => t("division", { n: row.division }),
      render: (row) => <span className="text-xs font-medium" style={{ color: divColor(row.division) }}>{t("division", { n: row.division })}</span>,
    },
    {
      key: "score",
      header: t("thScore"),
      numeric: true,
      render: (row) => <span className="font-bold text-cz-1">{formatNumber(row.global_points)}</span>,
    },
  ];

  // Leder-guld-tint (global_rank===1) + "mig"-ring (samme inset-konvention som
  // StandingsPage's rowProps) + helrække-klik til holdsiden.
  function rowProps(row) {
    const isMe = row.team_id === myTeamId;
    const isLeader = row.global_rank === 1;
    return {
      onClick: () => navigate(`/teams/${row.team_id}?tab=results`),
      className: `cursor-pointer${isLeader ? " bg-cz-accent/[0.08]" : ""}`,
      style: isMe ? { boxShadow: "inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)" } : undefined,
    };
  }

  return (
    <div>
      {/* #3104 etape C: formel-forklaringen fra det tidligere PageHeader-subtitle
          som fane-intro (RacePointsPage-mønsteret) — hubben ejer sidehovedet. */}
      <p className="mb-3 text-[13px] text-cz-2">{t("subtitle")}</p>

      {/* Egen placering — fastgjort bånd øverst, altid synlig uanset filter/side (godkendt mockup). */}
      {myRow && (
        <Card className="mb-4 px-4 py-3.5 flex items-center gap-4 flex-wrap"
          style={{ boxShadow: "inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)" }}>
          <span className="text-3xs font-bold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: "rgb(var(--me-badge-bg))", color: "rgb(var(--me-badge-fg))" }}>
            {t("youBadge")}
          </span>
          <span className="font-mono font-bold text-lg text-cz-accent-t">#{myRow.global_rank}</span>
          <MovementBadge movement={myRow.movement} t={t} />
          <span className="font-medium text-cz-1">{myRow.name}</span>
          <span className="text-cz-3 text-xs">{t("division", { n: myRow.division })}</span>
          <span className="font-mono text-cz-2">{formatNumber(myRow.global_points)} {t("scoreUnit")}</span>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div>
          {/* Filter-bar (T2-recept): division-select + search Input. */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Select
              size="sm"
              aria-label={t("divisionSelectLabel")}
              value={divFilter}
              onChange={(e) => setDivFilter(e.target.value === DIV_ALL ? DIV_ALL : Number(e.target.value))}
            >
              <option value={DIV_ALL}>{t("divisionAll")} ({teams.length})</option>
              {divCounts.map(({ div, count }) => (
                <option key={div} value={div}>{t("division", { n: div })} ({count})</option>
              ))}
            </Select>
            <div className="w-60">
              <Input type="text" size="sm" value={search} onChange={e => setSearch(e.target.value)}
                placeholder={t("searchPlaceholder")} />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<PodiumIcon className="w-8 h-8 text-cz-3" aria-hidden="true" />}
              title={search ? t("noMatch") : t("noData")}
            />
          ) : (
            <>
              <DataTable
                label={t("title")}
                columns={columns}
                rows={pageRows}
                rowKey={(row) => row.team_id}
                rowProps={rowProps}
                count={t("legendFormula")}
              />

              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between text-xs text-cz-3">
                  <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
                    className="px-3 py-1.5 rounded-cz border border-cz-border disabled:opacity-40 disabled:cursor-not-allowed hover:text-cz-1">
                    {t("prevPage")}
                  </button>
                  <span>{t("pageOf", { page: page + 1, total: totalPages })}</span>
                  <button disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    className="px-3 py-1.5 rounded-cz border border-cz-border disabled:opacity-40 disabled:cursor-not-allowed hover:text-cz-1">
                    {t("nextPage")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sidepaneler — godkendt mockup: "Climbers of the season" + "Best new manager". */}
        <div className="flex flex-col gap-4">
          <SidePanel
            title={t("climbersTitle")}
            rows={climbers}
            emptyLabel={t("climbersEmpty")}
            valueKey="places_gained"
            valueSuffix={t("placesUnit")}
            navigate={navigate}
          />
          <SidePanel
            title={t("bestNewManagerTitle")}
            rows={bestNewManagers}
            emptyLabel={t("bestNewManagerEmpty")}
            valueKey="global_points"
            unitLabel={t("scoreUnit")}
            navigate={navigate}
          />
        </div>
      </div>
    </div>
  );
}
