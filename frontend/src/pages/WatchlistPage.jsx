import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { ABILITY_STATS as STATS, ABILITY_SELECT, flattenAbilities } from "../lib/abilities";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import NationCell from "../components/rider/NationCell";
import RiderNameCell from "../components/rider/RiderNameCell";
import RiderBadges from "../components/rider/RiderBadges";
import TeamCell from "../components/rider/TeamCell";
import { ageBadgeKey } from "../lib/riderAge";
import { statStyle } from "../lib/statColor";
import { formatCz, getRiderMarketValue, getRiderSalary } from "../lib/marketValues.js";
import { formatNumber } from "../lib/intl";
import { StarIcon, ExchangeIcon, CheckIcon } from "../components/ui";
import ScoutablePotentiale from "../components/rider/ScoutablePotentiale";
import { useScouting } from "../lib/useScouting";
import { scoutSortValue } from "../lib/scouting";
import WatchlistStar from "../components/WatchlistStar";
import { CompareToggle, CompareBar, MAX_COMPARE } from "../components/CompareSelection";

// Stat-kolonner = de 15 CZ-evner (delt config lib/abilities.js, importeret som STATS).
// #1529: erstattede de 14 PCM stat_*-kolonner — visningen viser nu evner.

function SortTh({ children, sortKey, sort, sortDir, onSort, className = "" }) {
  const active = sort === sortKey;
  return (
    <th onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none transition-colors ${active ? "text-cz-accent-t/80" : "text-cz-3 hover:text-cz-2"} ${className}`}>
      {children}{active && <span className="ms-0.5 text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );
}

const PAGE_SIZE = 50;

export default function WatchlistPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("watchlist");
  const scouting = useScouting();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [page, setPage] = useState(1);
  const [compareIds, setCompareIds] = useState([]);
  const [actionError, setActionError] = useState("");
  const [auctionRiderIds, setAuctionRiderIds] = useState(() => new Set());

  function toggleCompare(riderId) {
    setCompareIds(prev => {
      if (prev.includes(riderId)) return prev.filter(id => id !== riderId);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, riderId];
    });
  }

  async function loadWatchlist() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user.id);
    const { data } = await supabase
      .from("rider_watchlist")
      .select(`id, note, created_at,
        rider:rider_id(id, firstname, lastname, birthdate, market_value, is_u25,
          salary, team_id, nationality_code, prize_earnings_bonus, ${ABILITY_SELECT},
          team:team_id(id, name))`)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    // Evnerne joines via rider_derived_abilities + flades op på rytter-objektet
    // (rider.climbing osv.) så render + klient-sort virker uændret (#1529).
    const list = (data || []).map(e => ({ ...e, rider: flattenAbilities(e.rider) }));
    setEntries(list);

    // #251: markér ryttere der allerede er i en aktiv auktion, så vi kan vise
    // status-badge + undgå at tilbyde "Start auktion" (ellers fejler backend
    // med en sen in-app fejl-popup). Auktioner er læsbare for alle (auktionshus).
    const riderIds = list.map(e => e.rider?.id).filter(Boolean);
    if (riderIds.length) {
      const { data: auctions } = await supabase
        .from("auctions")
        .select("rider_id")
        .in("status", ["active", "extended"])
        .in("rider_id", riderIds);
      setAuctionRiderIds(new Set((auctions || []).map(a => a.rider_id)));
    } else {
      setAuctionRiderIds(new Set());
    }
    setLoading(false);
  }

  useEffect(() => { loadWatchlist(); }, []);

  async function removeFromWatchlist(riderId) {
    await supabase.from("rider_watchlist")
      .delete().eq("user_id", userId).eq("rider_id", riderId);
    setEntries(prev => prev.filter(e => e.rider.id !== riderId));
  }

  async function saveNote(entryId) {
    await supabase.from("rider_watchlist")
      .update({ note: noteText }).eq("id", entryId);
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, note: noteText } : e));
    setEditingNote(null);
  }

  async function startAuction(rider) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auctions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ rider_id: rider.id, starting_price: getRiderMarketValue(rider) }),
    });
    if (res.ok) {
      // Vis squad-cap-warning hvis bud bringer manager over max (#29 — non-blocking).
      const data = await res.json().catch(() => ({}));
      const warning = (data.warnings || []).find(w => w?.code === "squad_capacity_exceeded");
      if (warning) {
        const fine = warning.finePerRider * warning.exceedBy;
        const points = warning.penaltyPointsPerRider * warning.exceedBy;
        alert(t("auctionStarted", {
          total: warning.totalAfter,
          max: warning.maxRiders,
          exceed: warning.exceedBy,
          fine: formatNumber(fine),
          points,
        }));
      }
      navigate("/auctions");
    } else {
      // #864-fund 5: ingen rå backend-fejl via native alert() — vis oversat in-app besked.
      setActionError(t("auctionError"));
      setTimeout(() => setActionError(""), 5000);
    }
  }

  // #1162: dekorér med estimat-midtpunkt så potentiale-kolonnen kan sorteres
  // uden den rå (server-skjulte) potentiale.
  const riderFilters = useClientRiderFilters(
    entries.map(e => ({ ...e.rider, _scoutMid: scoutSortValue(scouting.estimateFor(e.rider.id)) }))
  );
  const filteredRiders = new Set(riderFilters.filtered.map(r => r.id));
  const sort = riderFilters.filters.sort;
  const sortDir = riderFilters.filters.sort_dir;
  function handleSort(key) {
    if (sort === key) riderFilters.onChange("sort_dir", sortDir === "desc" ? "asc" : "desc");
    else { riderFilters.onChange("sort", key); riderFilters.onChange("sort_dir", "desc"); }
    setPage(1);
  }
  const filtered = entries.filter(e => filteredRiders.has(e.rider.id))
    .sort((a, b) => {
      const ai = riderFilters.filtered.findIndex(r => r.id === a.rider.id);
      const bi = riderFilters.filtered.findIndex(r => r.id === b.rider.id);
      return ai - bi;
    });
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => { setPage(1); }, [riderFilters.filters]);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
          <p className="text-cz-3 text-sm">
            {t("subtitle", { count: entries.length })}
          </p>
        </div>
        <button onClick={() => navigate("/riders")}
          className="px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
            rounded-lg text-xs font-medium hover:bg-cz-accent/10 transition-all">
          {t("addRiders")}
        </button>
      </div>

      {actionError && (
        <div role="alert" className="mb-4 px-4 py-2.5 rounded-lg bg-cz-danger/10 border border-cz-danger/30 text-cz-danger text-sm">
          {actionError}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="text-center py-20 text-cz-3">
          <StarIcon className="w-14 h-14 mx-auto mb-4 text-cz-3" />
          <p className="text-lg font-medium text-cz-3">{t("emptyTitle")}</p>
          <p className="text-sm mt-2">{t("emptyBody")}</p>
          <button onClick={() => navigate("/riders")}
            className="mt-5 px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-lg text-sm hover:brightness-110">
            {t("emptyCta")}
          </button>
        </div>
      ) : (
        <>
          <div className="max-w-[1600px]">
            <RiderFilters filters={riderFilters.filters} onChange={riderFilters.onChange} onReset={riderFilters.onReset} showTeamFilter={false} nationalities={riderFilters.nationalities} />
          </div>

          {/* Table */}
          <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
            <div className="overflow-auto max-h-[calc(100vh-220px)]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-20 bg-cz-card shadow-sm">
                  <tr className="border-b border-cz-border">
                    <SortTh sortKey="nationality_code" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-2 py-3 text-left font-medium uppercase tracking-wider hidden sm:table-cell">{t("thNation")}</SortTh>
                    <SortTh sortKey="firstname" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-3 text-left font-medium uppercase tracking-wider sticky left-0 z-30 bg-cz-card border-r border-cz-border">{t("thRider")}</SortTh>
                    <th className="px-1 py-3 w-8" title={t("compareTooltip")}>
                      <ExchangeIcon size={14} aria-hidden="true" className="mx-auto text-cz-3" />
                    </th>
                    <th className="px-2 py-3 w-8" />
                    <th className="px-3 py-3 text-left text-cz-3 font-medium uppercase tracking-wider hidden sm:table-cell">{t("thTeam")}</th>
                    <th className="px-3 py-3 text-left text-cz-3 font-medium uppercase tracking-wider hidden sm:table-cell">{t("thBadges")}</th>
                    <SortTh sortKey="value" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-3 text-right font-medium">{t("thValue")}</SortTh>
                    <SortTh sortKey="salary" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-3 text-right font-medium">{t("thSalary")}</SortTh>
                    <SortTh sortKey="_scoutMid" sort={sort} sortDir={sortDir} onSort={handleSort}
                      className="px-3 py-3 text-left font-medium">{t("thPotential")}</SortTh>
                    {STATS.map(({ key, label }) => (
                      <SortTh key={key} sortKey={key} sort={sort} sortDir={sortDir} onSort={handleSort}
                        className="px-1.5 py-3 text-center font-medium w-10">{label}</SortTh>
                    ))}
                    <th className="px-3 py-3 text-center text-cz-3">{t("thNote")}</th>
                    <th className="px-3 py-3 text-center text-cz-3">{t("thAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={11 + STATS.length} className="px-3 py-12 text-center">
                        <p className="text-cz-3 text-sm">{t("common:controls.noFilterResults")}</p>
                        <button onClick={riderFilters.onReset}
                          className="mt-3 px-3 py-1.5 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
                            rounded-lg text-xs font-medium hover:bg-cz-accent/10 transition-all">
                          {t("common:controls.clearFilters")}
                        </button>
                      </td>
                    </tr>
                  )}
                  {visible.map(entry => {
                    const r = entry.rider;
                    const isFree = !r.team_id;
                    const inAuction = auctionRiderIds.has(r.id);
                    const compareActive = compareIds.includes(r.id);
                    return (
                      <tr key={entry.id} className={`border-b border-cz-border hover:bg-cz-subtle ${compareActive ? "bg-cz-accent/[0.04]" : ""}`}>
                        <td className="px-2 py-2.5 hidden sm:table-cell">
                          <NationCell code={r.nationality_code} />
                        </td>
                        <td className="px-3 py-2.5 sticky-name-cell sticky left-0 z-10 border-r border-cz-border shadow-[10px_0_16px_-16px_rgba(0,0,0,0.5)]">
                          <RiderNameCell id={r.id} firstname={r.firstname} lastname={r.lastname}
                            className="text-cz-1 text-sm font-medium hover:text-cz-accent-t transition-colors text-left" />
                        </td>
                        <td className="px-1 py-2.5 w-8">
                          <CompareToggle active={compareActive}
                            disabled={compareIds.length >= MAX_COMPARE}
                            onToggle={() => toggleCompare(r.id)} />
                        </td>
                        <td className="px-2 py-2.5 w-8">
                          <WatchlistStar active onToggle={() => removeFromWatchlist(r.id)} />
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <TeamCell team={r.team} freeLabel={t("teamFree")} />
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <div className="flex flex-wrap items-center gap-1">
                            <RiderBadges badges={[ageBadgeKey(r)]} />
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-cz-accent-t font-mono font-bold">
                          {formatCz(getRiderMarketValue(r)).replace(" CZ$", "")}
                        </td>
                        <td className="px-3 py-2.5 text-right text-cz-2 font-mono">
                          {formatNumber(getRiderSalary(r))}
                        </td>
                        <td className="px-3 py-2.5">
                          <ScoutablePotentiale rider={r} scouting={scouting} />
                        </td>
                        {STATS.map(({ key }) => (
                          <td key={key} className="px-1.5 py-2.5 text-center">
                            <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded" style={statStyle(r[key] || 0)}>
                              {r[key] || "—"}
                            </span>
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-center max-w-28">
                          {editingNote === entry.id ? (
                            <div className="flex gap-1">
                              <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && saveNote(entry.id)}
                                className="flex-1 bg-cz-subtle border border-cz-border rounded px-2 py-1
                                  text-cz-1 text-xs focus:outline-none focus:border-cz-accent w-20"
                                autoFocus placeholder={t("notePlaceholder")} aria-label={t("notePlaceholder")} />
                              <button onClick={() => saveNote(entry.id)} aria-label={t("common:a11y.saveNote")}
                                className="text-cz-success text-xs px-1"><CheckIcon size={14} aria-hidden="true" /></button>
                            </div>
                          ) : (
                            <button onClick={() => { setEditingNote(entry.id); setNoteText(entry.note || ""); }}
                              className="text-cz-3 hover:text-cz-2 text-xs truncate max-w-24 block mx-auto transition-colors">
                              {entry.note || t("addNote")}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1.5">
                            {inAuction ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium uppercase
                                bg-cz-accent/10 text-cz-accent-t border-cz-accent/30 whitespace-nowrap">
                                {t("inAuction")}
                              </span>
                            ) : isFree ? (
                              <button onClick={() => startAuction(r)}
                                className="px-2 py-1 bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30
                                  rounded text-xs hover:bg-cz-accent/10 transition-all whitespace-nowrap">
                                {t("startAuction")}
                              </button>
                            ) : (
                              <span className="text-cz-3 text-xs">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
            <span className="text-cz-3 text-xs">
              {t("pagination", { from: total === 0 ? 0 : pageStart + 1, to: Math.min(pageStart + PAGE_SIZE, total), total: formatNumber(total) })}
            </span>
            <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
              <button disabled={safePage <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
                  hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed">
                {t("prev")}
              </button>
              <button disabled={safePage >= pageCount}
                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                className="px-3 py-1.5 bg-cz-subtle rounded text-cz-2 text-xs
                  hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed">
                {t("next")}
              </button>
            </div>
          </div>
        </>
      )}

      <CompareBar ids={compareIds} onClear={() => setCompareIds([])} />
    </div>
  );
}
