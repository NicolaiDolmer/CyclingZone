import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchAllRows } from "../lib/supabasePagination";
import RiderLink from "./RiderLink";
import { formatNumber } from "../lib/intl";

// #824 (Discord-feedback): Holdets resultatliste — kun pointgivende resultater,
// med rytternavn pr. resultat. Attribution = race_results.team_id (holdet på
// løbstidspunktet — samme felt som præmie-udbetalingen bogfører på), IKKE
// rytterens nuværende hold, så solgte ryttere tæller stadig for det hold de
// kørte for.

function SortTh({ children, sortKey, current, dir, onSort, align = "left" }) {
  const active = current === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none py-2 text-${align} transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"}`}>
      {children}{active && <span className="ms-0.5 text-[10px]">{dir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

// Konkurrence-label pr. resultatrække. Etape viser etapenummer; gc på endagsløb
// vises som endagsresultat (samme skelnen som rytter-ranglistens klassiker-sejre).
function typeLabel(r, t) {
  if (r.result_type === "stage" && r.stage_number != null) {
    return t("results.stageN", { n: r.stage_number });
  }
  if (r.result_type === "gc" && r.race?.race_type === "single") {
    return t("results.type.oneday");
  }
  const key = `results.type.${r.result_type}`;
  const label = t(key);
  return label === key ? r.result_type : label;
}

export default function TeamResultsTab({ teamId }) {
  const { t } = useTranslation("team");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [seasonFilter, setSeasonFilter] = useState("current");
  const [sortKey, setSortKey] = useState("points");
  const [sortDir, setSortDir] = useState("desc");
  const [currentSeason, setCurrentSeason] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [rows, seasonRes] = await Promise.all([
          // Paginér: PostgREST capper ved 1000 — flere sæsoners resultater kan
          // overstige det (samme fælde som rytter-ranglisten).
          fetchAllRows(() => supabase
            .from("race_results")
            .select("id, rank, result_type, stage_number, points_earned, prize_money, rider_name, rider:rider_id(id, firstname, lastname), race:race_id(id, name, race_type, season:season_id(number))")
            .eq("team_id", teamId)
            .gt("points_earned", 0)
            .order("id", { ascending: true })),
          supabase.from("seasons").select("number").eq("status", "active").maybeSingle(),
        ]);
        if (cancelled) return;
        setResults(rows || []);
        setCurrentSeason(seasonRes?.data?.number ?? null);
      } catch {
        if (!cancelled) setError(t("results.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [teamId, t]);

  const availableSeasons = useMemo(() => {
    const set = new Set(results.map((r) => r.race?.season?.number).filter((n) => n != null));
    return [...set].sort((a, b) => b - a);
  }, [results]);

  const filtered = useMemo(() => {
    let list = results;
    if (seasonFilter === "current" && currentSeason != null) {
      list = list.filter((r) => r.race?.season?.number === currentSeason);
    } else if (seasonFilter !== "all" && seasonFilter !== "current") {
      const n = Number(seasonFilter);
      list = list.filter((r) => r.race?.season?.number === n);
    }
    return [...list].sort((a, b) => {
      let av, bv;
      if (sortKey === "rank") { av = a.rank ?? 9999; bv = b.rank ?? 9999; }
      else if (sortKey === "prize") { av = a.prize_money || 0; bv = b.prize_money || 0; }
      else { av = a.points_earned || 0; bv = b.points_earned || 0; }
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [results, seasonFilter, currentSeason, sortKey, sortDir]);

  const totals = useMemo(() => ({
    points: filtered.reduce((s, r) => s + (r.points_earned || 0), 0),
    prize: filtered.reduce((s, r) => s + (r.prize_money || 0), 0),
  }), [filtered]);

  function handleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  if (loading) return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );
  if (error) return (
    <div className="bg-cz-danger-bg border border-cz-danger/30 rounded-cz p-4">
      <p className="text-cz-danger text-sm">{error}</p>
    </div>
  );

  const noFilteredResults = filtered.length === 0 && results.length > 0;
  const noResults = results.length === 0;

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-cz-1 font-semibold text-sm">{t("results.title")}</h2>
          <p className="text-cz-3 text-xs mt-0.5">{t("results.subtitle")}</p>
        </div>
        <select value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)}
          className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-1.5 text-cz-1 text-sm focus:outline-none focus:border-cz-accent">
          <option value="all">{t("results.seasonFilterAll")}</option>
          {currentSeason != null && (
            <option value="current">{t("results.seasonFilterCurrent", { n: currentSeason })}</option>
          )}
          {availableSeasons.filter((n) => n !== currentSeason).map((n) => (
            <option key={n} value={n}>{t("results.seasonOption", { n })}</option>
          ))}
        </select>
      </div>

      {noResults && (
        <p className="text-cz-3 text-sm py-4">{t("results.emptyAll")}</p>
      )}

      {noFilteredResults && (
        <p className="text-cz-3 text-sm py-4">{t("results.emptyFiltered")}</p>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-cz-border">
                <th className="text-left py-2 text-cz-3">{t("results.thRace")}</th>
                <th className="text-left py-2 text-cz-3">{t("results.thType")}</th>
                <SortTh sortKey="rank" current={sortKey} dir={sortDir} onSort={handleSort} align="right">{t("results.thRank")}</SortTh>
                <th className="text-left py-2 ps-4 text-cz-3">{t("results.thRider")}</th>
                <SortTh sortKey="points" current={sortKey} dir={sortDir} onSort={handleSort} align="right">{t("results.thPoints")}</SortTh>
                <SortTh sortKey="prize" current={sortKey} dir={sortDir} onSort={handleSort} align="right">{t("results.thPrize")}</SortTh>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle/40">
                  <td className="py-2 pe-3">
                    {/* #1500: løbsnavn linker til løbet — og direkte til den rigtige
                        etape for stage-rækker (?stage=N). Gamle PCM-løb uden race.id
                        falder tilbage til ren tekst. */}
                    {r.race?.id ? (
                      <Link
                        to={`/races/${r.race.id}${r.result_type === "stage" && r.stage_number != null ? `?stage=${r.stage_number}` : ""}`}
                        className="text-cz-1 hover:text-cz-accent-t transition-colors"
                      >
                        {r.race.name || "—"}
                      </Link>
                    ) : (
                      <p className="text-cz-1">{r.race?.name || "—"}</p>
                    )}
                    {seasonFilter === "all" && r.race?.season?.number != null && (
                      <p className="text-cz-3 text-[10px]">{t("results.seasonRow", { n: r.race.season.number })}</p>
                    )}
                  </td>
                  <td className="py-2 pe-3 text-cz-2 whitespace-nowrap">{typeLabel(r, t)}</td>
                  <td className="py-2 text-right">
                    <span className={`font-mono font-bold ${r.rank === 1 ? "text-cz-accent-t" : r.rank <= 3 ? "text-cz-1" : "text-cz-2"}`}>
                      #{r.rank ?? "—"}
                    </span>
                  </td>
                  <td className="py-2 ps-4">
                    {r.result_type === "team" ? (
                      <span className="text-cz-2">{t("results.riderTeam")}</span>
                    ) : r.rider ? (
                      <RiderLink id={r.rider.id} className="text-cz-1 hover:text-cz-accent-t">
                        {r.rider.firstname} {r.rider.lastname}
                      </RiderLink>
                    ) : (
                      <span className="text-cz-2">{r.rider_name || "—"}</span>
                    )}
                  </td>
                  <td className="py-2 text-right font-mono font-bold text-cz-1 whitespace-nowrap">
                    {formatNumber(r.points_earned || 0)}
                  </td>
                  <td className="py-2 text-right font-mono text-cz-2 whitespace-nowrap">
                    {formatNumber(r.prize_money || 0)} <span className="text-cz-3 text-[10px]">CZ$</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-cz-border">
                <td colSpan={4} className="py-2 text-cz-2 font-medium">{t("results.total", { count: filtered.length })}</td>
                <td className="py-2 text-right font-mono font-bold text-cz-accent-t whitespace-nowrap">{formatNumber(totals.points)}</td>
                <td className="py-2 text-right font-mono text-cz-2 whitespace-nowrap">{formatNumber(totals.prize)} <span className="text-cz-3 text-[10px]">CZ$</span></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
