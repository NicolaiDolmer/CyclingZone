import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import TeamLink from "../components/TeamLink";
import { formatNumber } from "../lib/intl";
import { useGlobalRank } from "../hooks/useGlobalRank";
import { Card, EmptyState, PageLoader, Input, PodiumIcon } from "../components/ui";
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

export default function GlobalRankPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("globalRank");
  const { teams, loading, error, reload } = useGlobalRank();
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

  if (loading) return <PageLoader />;

  if (error) return (
    <div className="max-w-full">
      <h1 className="text-xl font-bold text-cz-1 mb-4">{t("title")}</h1>
      <div className="text-center py-16 text-cz-3">
        <p>{t("loadError")}</p>
        <button onClick={() => { setPage(0); reload(); }}
          className="mt-4 px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
            rounded-lg text-xs font-medium hover:bg-cz-accent/10 transition-all">
          {t("retry")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
          <p className="text-cz-3 text-sm">{t("subtitle")}</p>
        </div>
      </div>

      {/* Egen placering fremhævet, altid synlig uanset filter/side (#2453 accept). */}
      {myRow && (
        <Card className="mb-4 px-4 py-3.5 flex items-center gap-4 flex-wrap"
          style={{ boxShadow: "inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)" }}>
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: "rgb(var(--me-badge-bg))", color: "rgb(var(--me-badge-fg))" }}>
            {t("youBadge")}
          </span>
          <span className="font-mono font-bold text-lg text-cz-accent-t">#{myRow.global_rank}</span>
          <span className="font-medium text-cz-1">{myRow.name}</span>
          <span className="text-cz-3 text-xs">{t("division", { n: myRow.division })}</span>
          <span className="font-mono text-cz-2">{formatNumber(myRow.global_score)} {t("scoreUnit")}</span>
          <MovementBadge movement={myRow.movement} t={t} />
        </Card>
      )}

      {/* Division-faner */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setDivFilter(DIV_ALL)}
          className={`px-4 py-2 rounded-cz text-sm font-medium transition-all border
            ${divFilter === DIV_ALL ? "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t" : "bg-cz-card text-cz-2 border-cz-border hover:text-cz-1"}`}>
          {t("divisionAll")}
          <span className="ms-2 text-[10px] opacity-60">({teams.length})</span>
        </button>
        {divCounts.map(({ div, count }) => (
          <button key={div} onClick={() => setDivFilter(div)}
            className={`px-4 py-2 rounded-cz text-sm font-medium transition-all border
              ${divFilter === div ? "border-opacity-30 text-cz-1" : "bg-cz-card text-cz-2 border-cz-border hover:text-cz-1"}`}
            style={divFilter === div ? { backgroundColor: divColor(div, 0.08), borderColor: divColor(div, 0.25), color: divColor(div) } : {}}>
            {t("division", { n: div })}
            <span className="ms-2 text-[10px] opacity-60">({count})</span>
          </button>
        ))}
        <Input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")} className="w-44 ms-auto" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<PodiumIcon className="w-8 h-8 text-cz-3" aria-hidden="true" />}
          title={search ? t("noMatch") : t("noData")}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table data-sort-exempt="Global rank, iboende vægtet point-orden" className="w-full text-sm">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs w-10">#</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs">{t("thTeam")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs hidden sm:table-cell">{t("thDivision")}</th>
                  <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs hidden md:table-cell">{t("thSeasons")}</th>
                  <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs">{t("thScore")}</th>
                  <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs">{t("thMovement")}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(row => {
                  const isMe = row.team_id === myTeamId;
                  return (
                    <tr key={row.team_id}
                      onClick={() => navigate(`/teams/${row.team_id}?tab=results`)}
                      style={isMe ? { boxShadow: "inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)" } : {}}
                      className={`border-b border-cz-border last:border-0 cursor-pointer hover:bg-cz-subtle transition-colors
                        ${row.global_rank === 1 ? "bg-cz-accent/[0.08]" : ""}`}>
                      <td className="px-4 py-3.5">
                        <span className={`font-mono font-bold text-sm ${row.global_rank === 1 ? "text-cz-accent-t" : row.global_rank <= 3 ? "text-cz-2" : "text-cz-3"}`}>
                          {row.global_rank}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <TeamLink id={row.team_id} tab="results" stopPropagation className="font-medium text-cz-1">{row.name}</TeamLink>
                          {isMe && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgb(var(--me-badge-bg))", color: "rgb(var(--me-badge-fg))" }}>{t("youBadge")}</span>}
                          {row.is_ai && <span className="text-[9px] font-medium uppercase text-cz-3 border border-cz-border px-1 py-0.5 rounded">{t("aiBadge")}</span>}
                          {row.seasons_played <= 1 && <span className="text-[9px] font-medium uppercase text-cz-accent-t border border-cz-accent/30 px-1 py-0.5 rounded">{t("newManagerBadge")}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 hidden sm:table-cell">
                        <span className="text-xs font-medium" style={{ color: divColor(row.division) }}>{t("division", { n: row.division })}</span>
                      </td>
                      <td className="px-4 py-3.5 text-right text-cz-2 hidden md:table-cell font-mono">{row.seasons_played}</td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-cz-1">{formatNumber(row.global_score)}</td>
                      <td className="px-4 py-3.5 text-right"><MovementBadge movement={row.movement} t={t} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-cz-border flex items-center justify-between text-xs text-cz-3">
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

          <div className="px-4 py-3 border-t border-cz-border text-xs text-cz-3">
            {t("legendFormula")}
          </div>
        </Card>
      )}
    </div>
  );
}
