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
import RiderTypeBadge from "../components/rider/RiderTypeBadge";
import TeamCell from "../components/rider/TeamCell";
import { ageBadgeKey, getRiderAge } from "../lib/riderAge";
import { statStyle } from "../lib/statColor";
import { formatCz, getRiderMarketValue, getRiderSalary } from "../lib/marketValues.js";
import { formatNumber } from "../lib/intl";
import { cycleSortState } from "../lib/riderSort";
import {
  ExchangeIcon, CheckIcon, PageLoader, ToastViewport,
  PageHeader, Button, DataTable, EmptyState, StarIcon, FilterIcon,
} from "../components/ui";
import ScoutablePotentiale from "../components/rider/ScoutablePotentiale";
import { useScouting } from "../lib/useScouting";
import { scoutSortValue } from "../lib/scouting";
import WatchlistStar from "../components/WatchlistStar";
import { CompareToggle, CompareBar, MAX_COMPARE } from "../components/CompareSelection";

// Stat-kolonner = de 15 CZ-evner (delt config lib/abilities.js, importeret som STATS).
// #1529: erstattede de 14 PCM stat_*-kolonner — visningen viser nu evner.
// #2849 bølge 2: tabellen migreret til den kanoniske DataTable (T2 wide-data,
// docs/design/PAGE_TEMPLATES.md) — sorterings-UI leveres nu af DataTable selv,
// så den lokale SortTh-header er væk; cyklus-logikken (handleSort) er uændret.

const PAGE_SIZE = 50;
// Matches ToastViewport's default auto-dismiss duration (#2467).
const TOAST_DURATION_MS = 4000;

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
  const [toasts, setToasts] = useState([]);

  function dismissToast(id) {
    setToasts(prev => prev.filter(item => item.id !== id));
  }

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
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) { setLoading(false); return; }
    setUserId(user.id);
    const { data } = await supabase
      .from("rider_watchlist")
      .select(`id, note, created_at,
        rider:rider_id(id, firstname, lastname, birthdate, market_value, is_u25,
          salary, current_production_value, team_id, nationality_code, primary_type, secondary_type, prize_earnings_bonus, ${ABILITY_SELECT},
          team:team_id(id, name))`)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    // Evnerne joines via rider_derived_abilities + flades op på rytter-objektet
    // (rider.climbing osv.) så render + klient-sort virker uændret (#1529).
    // #1918: et orphaned rider_id-join (slettet rytter) giver rider=null. Frasortér
    // ved kilden, så hverken filter-map (l.~138), render-loopet eller sort kan
    // deref'e e.rider.id på null og vælte hele siden.
    const list = (data || [])
      .filter(e => e.rider)
      .map(e => ({ ...e, rider: flattenAbilities(e.rider) }));
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
        const message = t("auctionStarted", {
          total: warning.totalAfter,
          max: warning.maxRiders,
          exceed: warning.exceedBy,
          fine: formatNumber(fine),
          points,
        });
        // #2467: native alert() replaced with the shared Toast component (same
        // pattern as ToastViewport elsewhere in the codebase). The translated
        // message uses "\n\n" to separate a short headline from the detail.
        // alert() used to block until dismissed, so the navigate() below only ran
        // once the manager had actually read the message — delay the navigate by
        // the toast's visible duration so a non-blocking toast doesn't get
        // whisked away by the route change before it can be read.
        const [toastTitle, ...toastRest] = message.split("\n\n");
        const toastId = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setToasts(prev => [...prev, {
          id: toastId,
          tone: "warning",
          title: toastTitle,
          description: toastRest.join("\n\n"),
        }]);
        setTimeout(() => navigate("/auctions"), TOAST_DURATION_MS);
        return;
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
    // #1755: delt cyklus-logik så watchlist sorterer som de øvrige rytter-tabeller.
    const next = cycleSortState({ sort, dir: sortDir }, key);
    riderFilters.onChange("sort", next.sort);
    riderFilters.onChange("sort_dir", next.dir);
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
    <PageLoader />
  );

  // #2849 bølge 2 — kolonne-definitioner til den kanoniske DataTable. Sticky
  // navnecelle (rytter) + resten som almindelige/fold-kolonner (T2-recepten).
  // Compare/stjerne/note/handling er interaktive og foldes IKKE ind i mobil-
  // underlinjen (giver ikke mening som tekst) — de forbliver almindelige
  // kolonner der scroller vandret bag den pinnede navnekolonne.
  const columns = [
    {
      key: "nation", header: t("thNation"), fold: true, sortKey: "nationality_code",
      foldValue: (entry) => entry.rider.nationality_code ? entry.rider.nationality_code.toUpperCase() : null,
      render: (entry) => <NationCell code={entry.rider.nationality_code} />,
    },
    {
      key: "rider", header: t("thRider"), sticky: true, sortKey: "firstname",
      render: (entry) => (
        <RiderNameCell id={entry.rider.id} firstname={entry.rider.firstname} lastname={entry.rider.lastname} />
      ),
    },
    {
      key: "compare",
      header: (
        <span title={t("compareTooltip")} className="flex justify-center">
          <ExchangeIcon size={14} aria-hidden="true" className="text-cz-3" />
        </span>
      ),
      render: (entry) => (
        <CompareToggle
          active={compareIds.includes(entry.rider.id)}
          disabled={compareIds.length >= MAX_COMPARE}
          onToggle={() => toggleCompare(entry.rider.id)}
        />
      ),
    },
    {
      key: "star", header: "",
      render: (entry) => <WatchlistStar active onToggle={() => removeFromWatchlist(entry.rider.id)} />,
    },
    {
      key: "team", header: t("thTeam"), fold: true, sortKey: "team_id",
      foldValue: (entry) => entry.rider.team?.name || t("teamFree"),
      render: (entry) => <TeamCell team={entry.rider.team} freeLabel={t("teamFree")} />,
    },
    {
      key: "badges", header: t("thBadges"), fold: true, sortKey: "is_u25",
      render: (entry) => (
        <div className="flex flex-wrap items-center gap-1">
          <RiderBadges badges={[ageBadgeKey(entry.rider)]} />
        </div>
      ),
    },
    {
      key: "age", header: t("thAge"), fold: true, numeric: true, sortKey: "birthdate",
      foldValue: (entry) => String(getRiderAge(entry.rider.birthdate) ?? "—"),
      render: (entry) => getRiderAge(entry.rider.birthdate) ?? "—",
    },
    {
      key: "type", header: t("thType"), fold: true, sortKey: "primary_type",
      render: (entry) => <RiderTypeBadge primaryType={entry.rider.primary_type} secondaryType={entry.rider.secondary_type} />,
    },
    {
      key: "value", header: t("thValue"), numeric: true, sortKey: "value",
      render: (entry) => (
        <span className="font-bold text-cz-accent-t">
          {formatCz(getRiderMarketValue(entry.rider)).replace(" CZ$", "")}
        </span>
      ),
    },
    {
      key: "salary", header: t("thSalary"), numeric: true, sortKey: "salary",
      render: (entry) => formatNumber(getRiderSalary(entry.rider)),
    },
    {
      key: "potential", header: t("thPotential"), sortKey: "_scoutMid",
      render: (entry) => <ScoutablePotentiale rider={entry.rider} scouting={scouting} />,
    },
    ...STATS.map(({ key, label }) => ({
      key, header: label, numeric: true, sortKey: key,
      render: (entry) => (
        <span
          className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded"
          style={statStyle(entry.rider[key] || 0)}
        >
          {entry.rider[key] || "—"}
        </span>
      ),
    })),
    {
      key: "note", header: t("thNote"),
      render: (entry) => (
        editingNote === entry.id ? (
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
        )
      ),
    },
    {
      key: "action", header: t("thAction"),
      render: (entry) => {
        const r = entry.rider;
        const isFree = !r.team_id;
        const inAuction = auctionRiderIds.has(r.id);
        return (
          <div className="flex items-center justify-center gap-1.5">
            {inAuction ? (
              <span className="text-[10px] px-2 py-0.5 rounded border font-medium uppercase
                bg-cz-accent/10 text-cz-accent-t border-cz-accent/30 whitespace-nowrap">
                {t("inAuction")}
              </span>
            ) : isFree ? (
              <Button variant="secondary" size="sm" onClick={() => startAuction(r)} className="whitespace-nowrap">
                {t("startAuction")}
              </Button>
            ) : (
              <span className="text-cz-3 text-xs">—</span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle", { count: entries.length })}
        // #2849 bølge 2: kun ÉN gold primary-knap pr. view — når ønskelisten er
        // tom, er EmptyState'ens egen CTA den ene primary, så header-knappen
        // udelades i stedet for at duplikere den (samme mål, to gold-knapper).
        actions={entries.length > 0 ? (
          <Button variant="primary" size="sm" onClick={() => navigate("/riders")}>
            {t("addRiders")}
          </Button>
        ) : null}
      />

      {actionError && (
        <div role="alert" className="mb-4 rounded-cz border border-cz-danger/30 bg-cz-danger-bg px-4 py-2.5 text-sm text-cz-danger">
          {actionError}
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={<StarIcon size={26} aria-hidden="true" />}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          action={<Button size="sm" onClick={() => navigate("/riders")}>{t("emptyCta")}</Button>}
        />
      ) : (
        <>
          <RiderFilters filters={riderFilters.filters} onChange={riderFilters.onChange} onReset={riderFilters.onReset} showTeamFilter={false} nationalities={riderFilters.nationalities} />

          {filtered.length === 0 ? (
            <EmptyState
              icon={<FilterIcon size={26} aria-hidden="true" />}
              title={t("common:controls.noFilterResults")}
              action={
                <Button variant="secondary" size="sm" onClick={riderFilters.onReset}>
                  {t("common:controls.clearFilters")}
                </Button>
              }
            />
          ) : (
            <>
              <DataTable
                label={t("title")}
                columns={columns}
                rows={visible}
                rowKey={(entry) => entry.id}
                sort={sort}
                sortDir={sortDir}
                onSort={handleSort}
                count={t("pagination", {
                  from: total === 0 ? 0 : pageStart + 1,
                  to: Math.min(pageStart + PAGE_SIZE, total),
                  total: formatNumber(total),
                })}
              />

              {/* Pagination */}
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" size="sm" disabled={safePage <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}>
                  {t("prev")}
                </Button>
                <Button variant="secondary" size="sm" disabled={safePage >= pageCount}
                  onClick={() => setPage(p => Math.min(pageCount, p + 1))}>
                  {t("next")}
                </Button>
              </div>
            </>
          )}
        </>
      )}

      <CompareBar ids={compareIds} onClear={() => setCompareIds([])} />
      <ToastViewport toasts={toasts} onDismiss={dismissToast} duration={TOAST_DURATION_MS} />
    </div>
  );
}
