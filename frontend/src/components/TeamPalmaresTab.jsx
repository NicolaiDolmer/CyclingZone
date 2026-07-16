// TeamPalmaresTab — Palmarès-fanen for HOLDSIDEN (#1997 holdside-slice).
// Spejler RiderPalmaresTab.jsx's mønstersprog (trofæskab/totaler-tiles øverst,
// derunder en tæt liste) anvendt på hold-niveau: karrieretotaler, sæson-for-
// sæson-historik (division/pulje/placering/point/sejre + op-/nedrykning) og
// holdets æresliste (hall_of_fame).
//
// Selvstændig fetch (samme mønster som TeamResultsTab.jsx) — TeamProfilePage's
// "Sæsonresultater"-boks henter kun SENESTE sæson (.limit(1).single()); denne
// fane henter HELE historikken pagineret (lib/supabasePagination.js), fordi
// PostgREST capper ved 1000 rækker/side (samme fælde som rytter-ranglisten).
//
// Datalag: lib/teamPalmares.js (rene, testede funktioner) — ingen dublet-logik
// her i komponenten.

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/supabasePagination";
import { buildSeasonHistory, teamCareerTotals, groupHallOfFame } from "../lib/teamPalmares.js";
import { formatNumber } from "../lib/intl";

async function loadTeamPalmares(teamId) {
  const [standingsRows, hofRows] = await Promise.all([
    fetchAllRows(() => supabase
      .from("season_standings")
      .select("id, division, league_division_id, rank_in_division, total_points, races_completed, stage_wins, gc_wins, season:season_id(number, status), pool:league_division_id(label)")
      .eq("team_id", teamId)
      .order("id", { ascending: true })),
    fetchAllRows(() => supabase
      .from("hall_of_fame")
      .select("id, category, value, season_id, season_number, recorded_at")
      .eq("team_id", teamId)
      .order("id", { ascending: true })),
  ]);
  return { standingsRows, hofRows };
}

// #1997 mobil-fund (16/7): en selvstændig "Movement"-kolonne skubbede tabellen
// bredere end en 390px-viewport kan vise (overflow-x-auto skjulte kolonnen uden
// synligt scroll-hint). Badgen renderes derfor INLINE i Division-cellen i stedet
// for som egen kolonne — 5 kolonner i stedet for 6, ingen tabt information.
// null/"maintained" viser ingen badge (fraværet KOMMUNIKERER "ingen ændring").
function MovementBadge({ movement, t }) {
  if (movement === "promoted") {
    return (
      <span className="font-mono text-[10px] font-bold px-1.5 py-[2px] rounded bg-cz-success-bg text-cz-success whitespace-nowrap">
        {"↑ "}{t("profile.palmares.movementPromoted")}
      </span>
    );
  }
  if (movement === "relegated") {
    return (
      <span className="font-mono text-[10px] font-bold px-1.5 py-[2px] rounded bg-cz-danger-bg text-cz-danger whitespace-nowrap">
        {"↓ "}{t("profile.palmares.movementRelegated")}
      </span>
    );
  }
  return null;
}

export default function TeamPalmaresTab({ teamId }) {
  const { t } = useTranslation("team");
  const { t: tHof } = useTranslation("halloffame");
  const [standingsRows, setStandingsRows] = useState([]);
  const [hofRows, setHofRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadFailed(false);
      try {
        const { standingsRows: sr, hofRows: hr } = await loadTeamPalmares(teamId);
        if (cancelled) return;
        setStandingsRows(sr);
        setHofRows(hr);
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [teamId]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <p className="text-cz-3 text-center py-8">{t("profile.palmares.loadError")}</p>
      </div>
    );
  }

  const history = buildSeasonHistory(standingsRows);
  const totals = teamCareerTotals(standingsRows);
  const honours = groupHallOfFame(hofRows);

  if (history.length === 0) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-6 text-center">
        <h3 className="font-display text-lg tracking-[0.02em] uppercase text-cz-1 m-0 mb-1.5">
          {t("profile.palmares.emptyTitle")}
        </h3>
        <p className="text-cz-3 text-sm m-0">{t("profile.palmares.emptyBody")}</p>
      </div>
    );
  }

  const bestResultValue = totals.bestDivision != null
    ? t("profile.palmares.totals.bestResultValue", { division: totals.bestDivision, rank: totals.bestRank ?? "-" })
    : "-";

  const totalDefs = [
    { key: "seasons", value: totals.seasonsPlayed },
    { key: "wins", value: totals.totalWins },
    { key: "bestResult", value: bestResultValue },
    { key: "honours", value: honours.length },
  ];
  const tileLabel = "text-[10px] text-cz-3 uppercase tracking-[0.05em]";

  return (
    <div className="flex flex-col gap-[13px]">
      <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-3">
          {t("profile.palmares.totalsTitle")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-3">
          {totalDefs.map((d) => (
            <div key={d.key}>
              <div className="font-mono tabular-nums text-xl font-bold text-cz-1">{d.value}</div>
              <div className={tileLabel}>{t(`profile.palmares.totals.${d.key}`)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
        <div className="py-2 px-4 border-b border-cz-border">
          <h3 className="font-display text-[15px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
            {t("profile.palmares.seasonHistoryTitle")}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table data-sort-exempt="Saeson-historik, kronologisk" className="w-full text-xs">
            <thead>
              <tr className="border-b border-cz-border">
                <th className="text-left py-2 px-4 text-cz-3 font-medium">{t("profile.palmares.thSeason")}</th>
                <th className="text-left py-2 px-2 text-cz-3 font-medium">{t("profile.palmares.thDivision")}</th>
                <th className="text-right py-2 px-2 text-cz-3 font-medium">{t("profile.palmares.thRank")}</th>
                <th className="text-right py-2 px-2 text-cz-3 font-medium">{t("profile.palmares.thPoints")}</th>
                <th className="text-right py-2 px-4 text-cz-3 font-medium">{t("profile.palmares.thWins")}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id ?? row.season.number} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle/40">
                  <td className="py-2 px-4">
                    <span className="text-cz-1 font-semibold">{t("profile.seasonLabel", { n: row.season.number })}</span>
                    {row.season.status === "active" && (
                      <span className="ms-2 text-[9px] px-1.5 py-0.5 rounded-full bg-cz-success-bg text-cz-success border border-cz-success/30">
                        {t("profile.seasonOngoing")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-cz-1 whitespace-nowrap">{t("profile.division", { n: row.division })}</span>
                      {row.pool?.label && (
                        <span className="font-mono text-[10px] font-bold tracking-[0.03em] px-1.5 py-[1px] rounded bg-cz-subtle text-cz-2 whitespace-nowrap">
                          {row.pool.label}
                        </span>
                      )}
                      <MovementBadge movement={row.movement} t={t} />
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right">
                    <span className={`font-mono font-bold ${row.rank_in_division === 1 ? "text-cz-accent-t" : "text-cz-2"}`}>
                      {row.rank_in_division != null ? `#${row.rank_in_division}` : "-"}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono font-bold text-cz-1">
                    {formatNumber(row.total_points || 0)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-cz-2 whitespace-nowrap">
                    {row.stage_wins || 0}S {row.gc_wins || 0}GC
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
        <div className="py-2 px-4 border-b border-cz-border">
          <h3 className="font-display text-[15px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
            {t("profile.palmares.honoursTitle")}
          </h3>
        </div>
        {honours.length === 0 ? (
          <p className="text-cz-3 text-sm text-center py-6 px-4 m-0">{t("profile.palmares.honoursEmpty")}</p>
        ) : (
          <div className="flex flex-col">
            {honours.map((entry, idx) => (
              <div
                key={entry.id}
                className={`px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap ${idx > 0 ? "border-t border-cz-border" : ""}`}
              >
                <span className="text-[12.5px] text-cz-1 font-semibold">
                  {tHof(`categories.${entry.category}`, { defaultValue: entry.category })}
                </span>
                <div className="flex items-center gap-2">
                  {entry.season_number != null && (
                    <span className="text-cz-3 text-[10px]">{t("profile.seasonLabel", { n: entry.season_number })}</span>
                  )}
                  <span className="font-mono tabular-nums font-bold text-cz-accent-t">{formatNumber(entry.value)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
