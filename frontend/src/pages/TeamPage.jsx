import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RiderLink from "../components/RiderLink";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { ABILITY_STATS as STATS, ABILITY_SELECT, flattenAbilities } from "../lib/abilities";
import { CONDITION_SELECT, flattenCondition, isRiderInjured } from "../lib/training.js";
import { supabase } from "../lib/supabase";
import { statStyle } from "../lib/statColor";
import NationCell from "../components/rider/NationCell";
import RiderBadges from "../components/rider/RiderBadges";
import RiderTypeBadge from "../components/rider/RiderTypeBadge";
import { ageBadgeKey, getRiderAge, isU23 } from "../lib/riderAge";
import { getRiderMarketValue, projectYouthSalary } from "../lib/marketValues";
import { getSquadLimits } from "../lib/dashboardSquadStats";
import { formatNumber } from "../lib/intl";
import { AcademyTransferConfirmModal } from "../components/AcademyTransferConfirmModal";
import ScoutablePotentiale from "../components/rider/ScoutablePotentiale";
import { useScouting } from "../lib/useScouting";
import { scoutSortValue } from "../lib/scouting";
import TeamTransferHistoryTab from "../components/TeamTransferHistoryTab";
import { resolveApiError } from "../lib/apiError";
import SortTh from "../components/rider/RiderSortTh";
import { cycleSortState } from "../lib/riderSort";
import { Card, Button, Input, BikeIcon, PageLoader } from "../components/ui";
import { buttonClass } from "../components/ui/buttonStyles.js";

// Stat-kolonner = de 15 CZ-evner (delt config lib/abilities.js, importeret som STATS).
// #1529: erstattede de 14 PCM stat_*-kolonner — visningen viser nu evner.
// #1755: SortTh er nu delt (components/rider/RiderSortTh) — fælles sort-adfærd.

function RiderActionModal({ rider, team, scouting, onClose, onAction, onDemote, ddActive }) {
  const { t } = useTranslation("team");
  // #932 S7: demote (senior → akademi) er kun muligt for U23-seniorer (alder ≤ 22,
  // ikke allerede akademi). Samme grænse som backend D5-gaten.
  const canDemote = !rider.is_academy && isU23(rider.birthdate);
  const riderValue = getRiderMarketValue(rider);
  const [auctionPrice, setAuctionPrice] = useState(riderValue);
  const [transferPrice, setTransferPrice] = useState(riderValue);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  // #671: success/fejl-farven blev tidligere udledt af om msg startede med
  // "✅" (emoji-som-state). Eksplicit boolean i stedet — ingen emoji i JSX.
  const [msgOk, setMsgOk] = useState(false);
  const [activeTab, setActiveTab] = useState("auction");
  // #778: flash-auktion (30 min) på egne ryttere — kun synlig under aktivt
  // Deadline Day (samme gating som RiderStatsPage's AuctionButton).
  const [flash, setFlash] = useState(false);
  // #1719/#1720: server-beregnede previews (gebyr / ny løn) hentes når fanen
  // åbnes, så manageren ser tallet før bekræftelse.
  const [releaseQuote, setReleaseQuote] = useState(null);
  const [extendQuote, setExtendQuote] = useState(null);
  // #1779: hvis quote-kaldet fejler (fx akademirytter → 403 fra extend-quote),
  // skal feltet vise en forklaring i stedet for evig "indlæser…". { release, extend }.
  const [quoteError, setQuoteError] = useState({ release: null, extend: null });

  // Squad-fanen viser kun egne ryttere → auktion må sættes mellem 0 og Værdi (ikke over).
  const auctionPriceError = auctionPrice > riderValue || auctionPrice < 0;

  // Hent quote ved skift til release/extend-fanen (kun én gang pr. åbning).
  useEffect(() => {
    let cancelled = false;
    async function fetchQuote(path, setter, errKey) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/riders/${rider.id}/${path}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (cancelled) return;
        if (res.ok) {
          setter(await res.json());
        } else {
          // #1779: vis fejl-årsagen (fx akademirytter) i stedet for evig "indlæser…".
          const data = await res.json().catch(() => ({}));
          setQuoteError(prev => ({ ...prev, [errKey]: resolveApiError(data, t, t("auth:error.connectionFailed")) }));
        }
      } catch {
        if (!cancelled) setQuoteError(prev => ({ ...prev, [errKey]: t("auth:error.connectionFailed") }));
      }
    }
    if (activeTab === "release" && releaseQuote === null && quoteError.release === null) fetchQuote("release-quote", setReleaseQuote, "release");
    if (activeTab === "extend" && extendQuote === null && quoteError.extend === null) fetchQuote("extend-quote", setExtendQuote, "extend");
    return () => { cancelled = true; };
  }, [activeTab, rider.id, releaseQuote, extendQuote, quoteError, t]);

  // #1719/#1720: begge handlinger er body-løse POST'er — serveren beregner
  // gebyr/løn fra rytter-state. Delt poster så fejl-/success-håndtering er ens.
  async function postRiderAction(path, successKey) {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/riders/${rider.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setMsgOk(true); setMsg(t(successKey)); setTimeout(() => { onAction(); onClose(); }, 1500); }
      else { setMsgOk(false); setMsg(`${t("actionModal.errorPrefix")}${resolveApiError(data, t)}`); }
    } catch {
      setMsgOk(false); setMsg(t("auth:error.connectionFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function startAuction() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ rider_id: rider.id, starting_price: auctionPrice, flash_auction: ddActive && flash }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setMsgOk(true); setMsg(t("actionModal.auction.successMsg")); setTimeout(() => { onAction(); onClose(); }, 1500); }
      else { setMsgOk(false); setMsg(`${t("actionModal.errorPrefix")}${resolveApiError(data, t)}`); }
    } catch {
      setMsgOk(false); setMsg(t("auth:error.connectionFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function listTransfer() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ rider_id: rider.id, asking_price: transferPrice }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setMsgOk(true); setMsg(t("actionModal.transfer.successMsg")); setTimeout(() => { onAction(); onClose(); }, 1500); }
      else { setMsgOk(false); setMsg(`${t("actionModal.errorPrefix")}${resolveApiError(data, t)}`); }
    } catch {
      setMsgOk(false); setMsg(t("auth:error.connectionFailed"));
    } finally {
      setLoading(false);
    }
  }

  const tabLabels = {
    auction: t("actionModal.tabs.auction"),
    transfer: t("actionModal.tabs.transfer"),
    release: t("actionModal.tabs.release"),
    extend: t("actionModal.tabs.extend"),
    demote: t("actionModal.tabs.demote"),
  };
  const tabKeys = ["auction", "transfer", "extend", "release", ...(canDemote ? ["demote"] : [])];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-cz-card border border-cz-border rounded-cz w-full max-w-md">
        <div className="flex items-start justify-between p-5 border-b border-cz-border">
          <div>
            <h2 className="text-cz-1 font-bold text-lg">{rider.firstname} {rider.lastname}</h2>
            <p className="text-cz-accent-t font-mono text-sm mt-0.5">{formatNumber(riderValue)} CZ$</p>
          </div>
          <button onClick={onClose} aria-label={t("common:actions.close")} className="text-cz-3 hover:text-cz-1 text-xl"><span aria-hidden="true">×</span></button>
        </div>
        <div className="p-5 border-b border-cz-border">
          {/* #1242: samme kvalitative scouting-præsentation som alle andre flader —
              det hardcodede rå tal (showValue) er fjernet. */}
          {scouting.estimateFor(rider.id) !== null && (
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-cz-border">
              <span className="text-cz-3 text-xs">{t("actionModal.potentialLabel")}</span>
              <ScoutablePotentiale rider={rider} scouting={scouting} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {STATS.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-cz-3 text-xs">{label}</span>
                <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded" style={statStyle(rider[key] || 0)}>
                  {rider[key] || "-"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-5">
          <div className="flex gap-2 mb-4 flex-wrap">
            {tabKeys.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-cz text-sm font-medium transition-all border
                  ${activeTab === tab ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "text-cz-2 border-cz-border hover:text-cz-1"}`}>
                {tabLabels[tab]}
              </button>
            ))}
          </div>
          {activeTab === "auction" && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.auction.description")}</p>
              {/* #778: flash-auktion på egne ryttere fra holdsiden — kun under Deadline Day */}
              {ddActive && (
                <label className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-3 cursor-pointer select-none">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={flash} onChange={e => setFlash(e.target.checked)}
                      className="rounded accent-cz-danger" />
                    <span className="text-sm text-cz-danger font-medium">{t("actionModal.auction.flashLabel")}</span>
                  </div>
                  <span className="text-xs text-cz-3 sm:ms-0 ms-6">{t("actionModal.auction.flashHint")}</span>
                </label>
              )}
              <div className="flex gap-2">
                <Input type="number" value={auctionPrice} min={0} max={riderValue}
                  error={auctionPriceError}
                  onChange={e => { const v = parseInt(e.target.value, 10); setAuctionPrice(Number.isNaN(v) ? 0 : v); }}
                  className="flex-1 font-mono" />
                <Button onClick={startAuction} disabled={loading || auctionPriceError}
                  className={ddActive && flash ? "!bg-cz-danger !text-white hover:brightness-110" : ""}>
                  {loading ? t("actionModal.loadingShort") : (ddActive && flash) ? t("actionModal.auction.startFlashButton") : t("actionModal.auction.startButton")}
                </Button>
              </div>
              {auctionPriceError && (
                <p className="text-cz-danger text-xs mt-1.5">
                  {t("actionModal.auction.priceError", { amount: formatNumber(riderValue) })}
                </p>
              )}
            </div>
          )}
          {activeTab === "transfer" && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.transfer.description")}</p>
              <div className="flex gap-2">
                <Input type="number" value={transferPrice} min={1}
                  onChange={e => setTransferPrice(parseInt(e.target.value))}
                  className="flex-1 font-mono" />
                <Button onClick={listTransfer} disabled={loading}>
                  {loading ? t("actionModal.loadingShort") : t("actionModal.transfer.listButton")}
                </Button>
              </div>
            </div>
          )}
          {/* #1720: Forlæng kontrakt — genforhandlet løn + ny udløbssæson som preview. */}
          {activeTab === "extend" && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.extend.description")}</p>
              {/* #1779: når quote-kaldet fejler (fx akademirytter) viste lønnen
                  tidligere evig "indlæser…". Vis i stedet fejl-årsagen + deaktivér
                  knappen, så det er tydeligt at handlingen ikke er mulig her. */}
              {quoteError.extend ? (
                <div className="rounded-cz border border-cz-danger/30 bg-cz-danger-bg px-3 py-2.5 text-cz-danger text-xs">
                  {quoteError.extend}
                </div>
              ) : (
                <>
                  <div className="space-y-1.5 mb-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-cz-3 text-xs">{t("actionModal.extend.currentSalaryLabel")}</span>
                      <span className="text-cz-2 font-mono">{formatNumber(rider.salary || 0)} CZ$</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-cz-3 text-xs">{t("actionModal.extend.newSalaryLabel")}</span>
                      <span className="text-cz-1 font-mono font-bold">
                        {extendQuote ? `${formatNumber(extendQuote.newSalary)} CZ$` : t("actionModal.loadingShort")}
                      </span>
                    </div>
                    {extendQuote && (
                      <div className="flex items-center justify-between">
                        <span className="text-cz-3 text-xs">{t("actionModal.extend.newContractLabel")}</span>
                        <span className="text-cz-2 font-mono">
                          {t("actionModal.extend.newContractValue", { season: extendQuote.contract_end_season })}
                        </span>
                      </div>
                    )}
                  </div>
                  <Button onClick={() => postRiderAction("extend-contract", "actionModal.extend.successMsg")}
                    disabled={loading || !extendQuote} className="w-full">
                    {loading ? t("actionModal.loadingShort") : t("actionModal.extend.confirmButton")}
                  </Button>
                </>
              )}
            </div>
          )}
          {/* #1719: Fyr rytter — buyout-gebyr som preview + balance-gate. */}
          {activeTab === "release" && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.release.description")}</p>
              <div className="space-y-1.5 mb-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-cz-3 text-xs">{t("actionModal.release.feeLabel")}</span>
                  <span className="text-cz-danger font-mono font-bold">
                    {releaseQuote ? `${formatNumber(releaseQuote.fee)} CZ$` : t("actionModal.loadingShort")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-cz-3 text-xs">{t("actionModal.release.balanceLabel")}</span>
                  <span className="text-cz-2 font-mono">{formatNumber(team?.balance ?? 0)} CZ$</span>
                </div>
              </div>
              <p className="text-cz-3 text-xs mb-3">
                {releaseQuote && releaseQuote.fee === 0
                  ? t("actionModal.release.freeHint")
                  : t("actionModal.release.feeHint")}
              </p>
              {releaseQuote && releaseQuote.affordable === false && (
                <p className="text-cz-danger text-xs mb-3">{t("actionModal.release.cannotAfford")}</p>
              )}
              <Button onClick={() => postRiderAction("release", "actionModal.release.successMsg")}
                disabled={loading || (releaseQuote && releaseQuote.affordable === false)}
                className="w-full !bg-cz-danger !text-white hover:brightness-110">
                {loading ? t("actionModal.loadingShort") : t("actionModal.release.confirmButton")}
              </Button>
            </div>
          )}
          {/* #932 S7: Demote til akademi — kun U23-seniorer. Selve bekræftelsen
              (cap + løn-delta + løb ryddet) sker i AcademyTransferConfirmModal på
              holdsiden; her forklarer vi handlingen og overdrager til forælderen. */}
          {activeTab === "demote" && canDemote && (
            <div>
              <p className="text-cz-2 text-xs mb-3">{t("actionModal.demote.description")}</p>
              <div className="space-y-1.5 mb-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-cz-3 text-xs">{t("actionModal.demote.currentSalaryLabel")}</span>
                  <span className="text-cz-2 font-mono">{formatNumber(rider.salary || 0)} CZ$</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-cz-3 text-xs">{t("actionModal.demote.youthSalaryLabel")}</span>
                  <span className="text-cz-1 font-mono font-bold">{formatNumber(projectYouthSalary(rider))} CZ$</span>
                </div>
              </div>
              <p className="text-cz-3 text-xs mb-3">{t("actionModal.demote.hint")}</p>
              <Button onClick={() => { onClose(); onDemote(rider); }}
                disabled={loading}
                className="w-full !bg-cz-warning !text-cz-on-accent hover:brightness-110">
                {t("actionModal.demote.confirmButton")}
              </Button>
            </div>
          )}
          {msg && <p className={`text-sm mt-3 ${msgOk ? "text-cz-success" : "text-cz-danger"}`}>{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function SquadTab({ riders, scouting, onSelectRider, windowOpen }) {
  const { t } = useTranslation("team");
  // #1131: fulde stat-navne som native tooltip på de forkortede kolonne-headers.
  const { t: tRider } = useTranslation("rider");
  // #1796: hele rytter-rækken navigerer til rytter-profilen (flest dead clicks på
  // /team var klik på værdi-/potentiale-cellen). Samme row-as-link-mønster som
  // /riders (RiderRow). Navn-linket + Handling-knappen stopper propagation.
  const navigate = useNavigate();
  // #1095: eksplicit "nuværende" vs "kommende" trup-visning i stedet for
  // vis/skjul-toggles — spillere med ind-/udgående ryttere skal tydeligt
  // kunne se begge tilstande.
  const [squadView, setSquadView] = useState("current");

  // Incoming = riders with pending_team_id = myTeam but team_id != myTeam
  // Outgoing = riders with team_id = myTeam but pending different team
  const incomingRiders = riders.filter(r => r._isIncoming);
  const outgoingRiders = riders.filter(r => r._isOutgoing);

  // Nuværende = ryttere på holdet nu (inkl. udgående, ekskl. indgående).
  // Kommende = truppen efter ventende transfers (uden udgående, med indgående).
  const currentCount  = riders.filter(r => !r._isIncoming).length;
  const upcomingCount = riders.filter(r => !r._isOutgoing).length;
  const displayRidersBase = (squadView === "upcoming"
    ? riders.filter(r => !r._isOutgoing)
    : riders.filter(r => !r._isIncoming)
    // #1162: dekorér med estimat-midtpunktet så potentiale-kolonnen kan sorteres
    // uden den rå (server-skjulte) potentiale.
  ).map(r => ({ ...r, _scoutMid: scoutSortValue(scouting.estimateFor(r.id)) }));
  const riderFilters = useClientRiderFilters(displayRidersBase);
  const displayRiders = riderFilters.filtered;
  const sort = riderFilters.filters.sort;
  const sortDir = riderFilters.filters.sort_dir;
  function handleSort(key) {
    // #1755: delt cyklus-logik så holdsiden sorterer som de øvrige rytter-tabeller.
    const next = cycleSortState({ sort, dir: sortDir }, key);
    riderFilters.onChange("sort", next.sort);
    riderFilters.onChange("sort_dir", next.dir);
  }

  const loanedInRiders  = riders.filter(r => r._isLoanedIn);
  const loanedOutRiders = riders.filter(r => r._isLoanedOut);
  const hasTransfers = incomingRiders.length > 0 || outgoingRiders.length > 0 || loanedInRiders.length > 0 || loanedOutRiders.length > 0;

  return (
    <div>
      {/* #1095: segmenteret nuværende/kommende-visning + loan-pills */}
      {hasTransfers && (
        <div className="flex gap-2 mb-4 flex-wrap items-center">
          {(incomingRiders.length > 0 || outgoingRiders.length > 0) && (
            <div className="flex rounded-cz border border-cz-border overflow-hidden">
              {[
                { key: "current",  label: t("squad.view.current",  { count: currentCount }) },
                { key: "upcoming", label: t("squad.view.upcoming", { count: upcomingCount }) },
              ].map(v => (
                <button key={v.key} onClick={() => setSquadView(v.key)}
                  className={`px-3 py-1.5 text-xs font-medium transition-all
                    ${squadView === v.key
                      ? "bg-cz-accent/10 text-cz-accent-t"
                      : "bg-cz-card text-cz-2 hover:text-cz-1"}`}>
                  {v.label}
                </button>
              ))}
            </div>
          )}
          {loanedInRiders.length > 0 && (
            <span className="flex items-center gap-2 px-3 py-1.5 text-xs bg-cz-info/10 text-cz-info border border-cz-info/20 rounded-cz">
              <span className="w-2 h-2 rounded-full bg-cz-info" />
              {t("squad.loanedIn", { count: loanedInRiders.length })}
            </span>
          )}
          {loanedOutRiders.length > 0 && (
            <span className="flex items-center gap-2 px-3 py-1.5 text-xs bg-cz-warning/10 text-cz-warning border border-cz-warning/20 rounded-cz">
              <span className="w-2 h-2 rounded-full bg-cz-warning" />
              {t("squad.loanedOut", { count: loanedOutRiders.length })}
            </span>
          )}
          {!windowOpen && (
            <span className="px-3 py-1.5 text-xs text-cz-3 bg-cz-subtle border border-cz-border rounded-cz">
              {t("squad.windowClosedHint")}
            </span>
          )}
        </div>
      )}

      {squadView === "upcoming" && (incomingRiders.length > 0 || outgoingRiders.length > 0) && (
        <p className="text-cz-3 text-xs mb-3">{t("squad.view.upcomingHint")}</p>
      )}

      {displayRiders.length === 0 ? (
        riders.length === 0 ? (
          /* #1569: ægte tom trup (ny spiller) — gør blindgyden guidende med en
             primær CTA til markedet, så "hvad gør jeg nu?" har et svar. */
          <div className="text-center py-16 text-cz-3">
            <BikeIcon size={40} className="mx-auto mb-3 text-cz-3" />
            <p className="text-cz-2 font-medium">{t("squad.emptyState")}</p>
            <p className="mt-1 text-sm">{t("squad.emptyStateBody")}</p>
            <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
              <Link to="/riders" className={`${buttonClass({ variant: "primary", size: "sm" })} inline-flex`}>
                {t("squad.emptyStateCta")}
              </Link>
              <Link to="/auctions" className={`${buttonClass({ variant: "secondary", size: "sm" })} inline-flex`}>
                {t("squad.emptyStateCtaAuctions")}
              </Link>
            </div>
          </div>
        ) : (
          /* Trup har ryttere, men den valgte visning/filter er tom. */
          <div className="text-center py-16 text-cz-3">
            <BikeIcon size={40} className="mx-auto mb-3 text-cz-3" />
            <p>{t("squad.emptyView")}</p>
          </div>
        )
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-cz-border">
                  {/* #1186: nation altid synlig (var skjult på mobil) — tabellen h-scroller allerede. */}
                  <SortTh sortKey="nationality_code" sort={sort} sortDir={sortDir} onSort={handleSort}
                    className="px-2 py-3 text-left font-medium uppercase tracking-wider">{t("squad.headers.nation")}</SortTh>
                  <SortTh sortKey="firstname" sort={sort} sortDir={sortDir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium uppercase tracking-wider sticky left-0 z-20 bg-cz-card border-r border-cz-border">{t("squad.headers.rider")}</SortTh>
                  <SortTh sortKey="value" sort={sort} sortDir={sortDir} onSort={handleSort}
                    className="px-3 py-3 text-right font-medium">{t("squad.headers.value")}</SortTh>
                  {/* #1131: Løn-kolonnen var eneste døde header i rækken (1.385 dead clicks
                      i Clarity 5/6-12/6) — sortérbar nu, samme som på /riders. */}
                  <SortTh sortKey="salary" sort={sort} sortDir={sortDir} onSort={handleSort}
                    className="px-3 py-3 text-right font-medium">{t("squad.headers.salary")}</SortTh>
                  <SortTh sortKey="_scoutMid" sort={sort} sortDir={sortDir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium">{t("squad.headers.potential")}</SortTh>
                  {/* #1482: status/badges, ryttertype og kontraktudløb som egne
                      kolonner (Discord-feedback) — U25/ind/ud flyttet ud af navne-cellen. */}
                  <th className="px-3 py-3 text-left text-cz-3 font-medium">{t("squad.headers.badges")}</th>
                  <SortTh sortKey="birthdate" sort={sort} sortDir={sortDir} onSort={handleSort}
                    className="px-3 py-3 text-center font-medium">{t("squad.headers.age")}</SortTh>
                  <SortTh sortKey="primary_type" sort={sort} sortDir={sortDir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium">{t("squad.headers.type")}</SortTh>
                  <SortTh sortKey="contract_end_season" sort={sort} sortDir={sortDir} onSort={handleSort}
                    className="px-3 py-3 text-left font-medium">{t("squad.headers.contract")}</SortTh>
                  {STATS.map(({ key, label }) => (
                    <SortTh key={key} sortKey={key} sort={sort} sortDir={sortDir} onSort={handleSort}
                      title={tRider(`racePreview.derived.${key}`)}
                      className="px-1.5 py-3 text-center font-medium w-10">{label}</SortTh>
                  ))}
                  <th className="px-3 py-3 text-center text-cz-3 font-medium">{t("squad.headers.action")}</th>
                </tr>
              </thead>
              <tbody>
                {displayRiders.map(r => (
                  <tr key={r.id}
                    onClick={() => navigate(`/riders/${r.id}`)}
                    className={`border-b border-cz-border hover:bg-cz-subtle cursor-pointer transition-colors
                      ${r._isIncoming  ? "bg-cz-success-bg0/3"  :
                        r._isOutgoing  ? "bg-cz-danger-bg0/3"    :
                        r._isLoanedIn  ? "bg-cz-info/3" :
                        r._isLoanedOut ? "bg-cz-warning/10" : ""}`}>
                    <td className="px-2 py-2.5">
                      <NationCell code={r.nationality_code} />
                    </td>
                    <td className="px-3 py-2.5 sticky-name-cell sticky left-0 z-10 border-r border-cz-border shadow-[10px_0_16px_-16px_rgba(0,0,0,0.5)]">
                      <div className="flex items-center gap-2 flex-wrap">
                        {r._isIncoming  && <span className="w-2 h-2 rounded-full bg-cz-success flex-shrink-0" />}
                        {r._isOutgoing  && <span className="w-2 h-2 rounded-full bg-cz-danger flex-shrink-0" />}
                        {r._isLoanedIn  && <span className="w-2 h-2 rounded-full bg-cz-info flex-shrink-0" />}
                        {r._isLoanedOut && <span className="w-2 h-2 rounded-full bg-cz-warning flex-shrink-0" />}
                        <RiderLink id={r.id} stopPropagation
                          className="text-cz-1 text-sm font-medium hover:text-cz-accent-t transition-colors">
                          {r.firstname} {r.lastname}
                        </RiderLink>
                        {/* #1482: U25/ind/ud-pills flyttet til Status-kolonnen.
                            Loan-pills bliver i navne-cellen (de bærer team/sæson-tooltip). */}
                        {r._isLoanedIn  && (
                          <span className="text-[9px] uppercase bg-cz-info/20 text-cz-info px-1.5 py-0.5 rounded"
                            title={t("squad.tooltips.loanedFrom", { team: r._loanInInfo?.from_team?.name, start: r._loanInInfo?.start_season, end: r._loanInInfo?.end_season })}>
                            {t("squad.tags.loanedIn")}
                          </span>
                        )}
                        {r._isLoanedOut && (
                          <span className="text-[9px] uppercase bg-cz-warning/20 text-cz-warning px-1.5 py-0.5 rounded"
                            title={t("squad.tooltips.loanedTo", { team: r._loanOutInfo?.to_team?.name, start: r._loanOutInfo?.start_season, end: r._loanOutInfo?.end_season })}>
                            {t("squad.tags.loanedOut")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-cz-accent-t font-mono text-sm font-bold">
                      {formatNumber(getRiderMarketValue(r))}
                    </td>
                    <td className="px-3 py-2.5 text-right text-cz-2 font-mono text-xs">{r.salary || 0}</td>
                    <td className="px-3 py-2.5">
                      <ScoutablePotentiale rider={r} scouting={scouting} />
                    </td>
                    {/* #1482: Status — alder + ind-/udgående som skanbare badges.
                        #1531: skade-badge når rytteren er skadet (injured_until i fremtiden). */}
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <RiderBadges badges={[isRiderInjured(r.injured_until) && "injured", ageBadgeKey(r), r._isIncoming && "incoming", r._isOutgoing && "outgoing"]} />
                      </div>
                    </td>
                    {/* #1674: numerisk alder i egen kolonne (Status-badget viser kun U23/U25-tier). */}
                    <td className="px-3 py-2.5 text-center text-cz-2 font-mono text-xs">{getRiderAge(r.birthdate) ?? "—"}</td>
                    {/* #1482: Ryttertype i egen kolonne (returnerer null uden type-data). */}
                    <td className="px-3 py-2.5">
                      <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} />
                    </td>
                    {/* #1482: Kontraktudløb i egen kolonne (sæson-number, "—" hvis ukendt). */}
                    <td className="px-3 py-2.5 text-cz-2 text-xs whitespace-nowrap">
                      {r.contract_end_season != null
                        ? t("squad.headers.contractValue", { season: r.contract_end_season })
                        : "—"}
                    </td>
                    {STATS.map(({ key }) => (
                      <td key={key} className="px-1.5 py-2.5 text-center">
                        <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded" style={statStyle(r[key] || 0)}>
                          {r[key] || "-"}
                        </span>
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-center">
                      {!r._isIncoming && (
                        <button onClick={(e) => { e.stopPropagation(); onSelectRider(r); }}
                          className="px-3 min-h-[44px] bg-cz-subtle hover:bg-cz-subtle text-cz-2 hover:text-cz-1 rounded text-xs transition-all border border-cz-border whitespace-nowrap">
                          {t("squad.actionButton")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export function TeamPage() {
  const { t } = useTranslation("team");
  const scouting = useScouting();
  const [team, setTeam] = useState(null);
  const [riders, setRiders] = useState([]);
  const [windowOpen, setWindowOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("squad");
  const [selectedRider, setSelectedRider] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ddActive, setDdActive] = useState(false);
  // #932 S7: demote-bekræftelse (senior → akademi). { rider, racesCleared } | null.
  const [demoteConfirm, setDemoteConfirm] = useState(null);
  const [demoteBusy, setDemoteBusy] = useState(false);
  const [demoteError, setDemoteError] = useState(null);

  useEffect(() => { loadAll(); loadDdStatus(); }, []);

  // Åbn demote-bekræftelsen: tæl fremtidige løb rytteren ville blive fjernet fra
  // (scheduled + stages_completed=0), så dialogen kan vise konsekvensen FØR confirm.
  async function handleDemote(rider) {
    setDemoteError(null);
    let racesCleared = 0;
    let academyCount = null;
    try {
      const [entriesRes, academyRes] = await Promise.all([
        supabase
          .from("race_entries")
          .select("race_id, races!inner(status, stages_completed)")
          .eq("rider_id", rider.id)
          .eq("races.status", "scheduled")
          .eq("races.stages_completed", 0),
        // Akademi-cap-effekt: tæl holdets nuværende akademiryttere (8-cap).
        team?.id
          ? supabase.from("riders").select("id", { count: "exact", head: true })
              .eq("team_id", team.id).eq("is_academy", true)
          : Promise.resolve({ count: null }),
      ]);
      racesCleared = (entriesRes.data || []).length;
      academyCount = academyRes.count ?? null;
    } catch { /* count er nice-to-have; vis dialogen uanset */ }
    setDemoteConfirm({ rider, racesCleared, academyCount });
  }

  async function confirmDemote() {
    if (!demoteConfirm) return;
    const rider = demoteConfirm.rider;
    setDemoteBusy(true);
    setDemoteError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/academy/demote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ riderId: rider.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDemoteConfirm(null);
        loadAll();
      } else {
        setDemoteError(resolveApiError(data, t, t("auth:error.connectionFailed")));
      }
    } catch {
      setDemoteError(t("auth:error.connectionFailed"));
    } finally {
      setDemoteBusy(false);
    }
  }

  // #778: action-modal'en skal vide om Deadline Day er aktiv for at kunne
  // tilbyde flash-auktion (30 min) — samme status-endpoint som RiderStatsPage.
  async function loadDdStatus() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/deadline-day/status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDdActive(data.active === true);
      }
    } catch { /* non-critical: flash-valget falder bare tilbage til skjult */ }
  }

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) { setLoading(false); return; }
    const { data: myTeam } = await supabase.from("teams").select("*").eq("user_id", user.id).single();
    if (!myTeam) { setLoading(false); return; }
    setTeam(myTeam);

    const [ridersRes, pendingRes, windowRes, loansOutRes, loansInRes] = await Promise.all([
      supabase.from("riders")
        .select(`id, firstname, lastname, birthdate, market_value, salary, prize_earnings_bonus, is_u25, is_academy, base_value, pending_team_id, nationality_code, primary_type, secondary_type, contract_end_season, ${ABILITY_SELECT}, ${CONDITION_SELECT}`)
        .eq("team_id", myTeam.id)
        .order("market_value", { ascending: false }),
      supabase.from("riders")
        .select(`id, firstname, lastname, birthdate, market_value, salary, prize_earnings_bonus, is_u25, is_academy, base_value, pending_team_id, nationality_code, primary_type, secondary_type, contract_end_season, ${ABILITY_SELECT}, ${CONDITION_SELECT}`)
        .eq("pending_team_id", myTeam.id)
        .order("market_value", { ascending: false }),
      supabase.from("transfer_windows")
        .select("status").order("created_at", { ascending: false }).limit(1).single(),
      // Riders we're lending out
      supabase.from("loan_agreements")
        .select("rider_id, to_team:to_team_id(name), start_season, end_season")
        .eq("from_team_id", myTeam.id).eq("status", "active"),
      // Riders we're borrowing
      supabase.from("loan_agreements")
        .select(`rider:rider_id(id, firstname, lastname, birthdate, market_value, salary, prize_earnings_bonus, is_u25, nationality_code, primary_type, secondary_type, contract_end_season, ${ABILITY_SELECT}, ${CONDITION_SELECT}), from_team:from_team_id(name), start_season, end_season, buy_option_price`)
        .eq("to_team_id", myTeam.id).eq("status", "active"),
    ]);

    const loanedOutIds = new Set((loansOutRes.data || []).map(l => l.rider_id));
    const loanedOutMap = Object.fromEntries((loansOutRes.data || []).map(l => [l.rider_id, l]));

    // #1529: evnerne kommer som joinet rider_derived_abilities-embed; flattenAbilities
    // løfter rider.climbing osv. op på rytter-objektet så render/sort virker uændret.
    // #1531: flattenCondition løfter rider_condition.injured_until op til skade-badget.
    const currentRiders = (ridersRes.data || []).map(r => ({
      ...flattenCondition(flattenAbilities(r)),
      _isOutgoing:  r.pending_team_id && r.pending_team_id !== myTeam.id,
      _isLoanedOut: loanedOutIds.has(r.id),
      _loanOutInfo: loanedOutMap[r.id] || null,
    }));
    const incomingRiders = (pendingRes.data || []).map(r => ({ ...flattenCondition(flattenAbilities(r)), _isIncoming: true }));
    const loanedInRiders = (loansInRes.data || []).map(l => ({
      ...flattenCondition(flattenAbilities(l.rider)),
      _isLoanedIn:  true,
      _loanInInfo:  { from_team: l.from_team, start_season: l.start_season, end_season: l.end_season, buy_option_price: l.buy_option_price },
    }));

    setRiders([...currentRiders, ...incomingRiders, ...loanedInRiders]);
    setWindowOpen(windowRes.data?.status === "open");
    setLoading(false);
  }

  const currentRiders = riders.filter(r => !r._isIncoming);
  const totalSalary = currentRiders.reduce((s, r) => s + (r.salary || 0), 0);
  const totalValue  = currentRiders.reduce((s, r) => s + getRiderMarketValue(r), 0);
  const incomingCount = riders.filter(r => r._isIncoming).length;
  const outgoingCount = riders.filter(r => r._isOutgoing).length;
  // #1886: kun senior-ryttere tæller mod squad-cap'en (30). Akademiryttere vises
  // i listen men er uden for cap'en — gør det eksplicit så en trup på fx 29+3
  // ikke ligner et cap-brud på 30.
  const seniorCount  = currentRiders.filter(r => !r.is_academy).length;
  const academyCount = currentRiders.filter(r =>  r.is_academy).length;
  const squadCap     = getSquadLimits(team?.division).max;

  if (loading) return (
    <PageLoader />
  );

  const tabs = [
    { key: "squad", label: t("tabs.squad", { count: currentRiders.length }) },
    { key: "transfers", label: t("tabs.transfers") },
  ];

  return (
    // #1186: fuld bredde på desktop — trup-tabellens 15 evne-kolonner var klemt i max-w-5xl.
    // Layout.jsx' WIDE_CONTENT_ROUTES giver /team full-bleed wrapper (#1027-mønstret).
    <div className="max-w-full">
      <div className="mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-cz-1">{team?.name || t("page.fallbackTitle")}</h1>
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${
            windowOpen
              ? "bg-cz-success-bg text-cz-success border-cz-success/30"
              : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
            <span className={`w-2 h-2 rounded-full ${windowOpen ? "bg-cz-success" : "bg-cz-3"}`} aria-hidden="true" />
            {windowOpen ? t("page.windowOpen") : t("page.windowClosed")}
          </span>
        </div>
        {team?.manager_name && (
          <p className="text-cz-2 text-sm mt-0.5">{t("page.managerLabel", { name: team.manager_name })}</p>
        )}
        <div className="flex gap-4 mt-1 flex-wrap text-sm">
          <span className="text-cz-accent-t font-mono font-bold" title={t("page.balanceTooltip")}>{t("page.balance", { value: formatNumber(team?.balance ?? 0) })}</span>
          <span className="text-cz-3" title={t("page.divisionTooltip")}>{t("page.division", { n: team?.division })}</span>
          <span className={`text-cz-3${seniorCount > squadCap ? " text-cz-danger" : ""}`} title={t("page.seniorCapTooltip", { cap: squadCap })}>{t("page.ridersCount", { count: seniorCount, cap: squadCap })}</span>
          {academyCount > 0 && <span className="text-cz-3 text-xs" title={t("page.academyCapTooltip", { cap: squadCap })}>{t("page.academyCount", { count: academyCount })}</span>}
          {incomingCount > 0 && <span className="text-cz-success text-xs">{t("page.incomingCount", { count: incomingCount })}</span>}
          {outgoingCount > 0 && <span className="text-cz-danger text-xs">{t("page.outgoingCount", { count: outgoingCount })}</span>}
          <span className="text-cz-3" title={t("page.salaryPerSeasonTooltip")}>{t("page.salaryPerSeason", { value: formatNumber(totalSalary) })}</span>
          <span className="text-cz-3">{t("page.teamValue", { value: formatNumber(totalValue) })}</span>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-cz text-sm font-medium transition-all border
              ${activeTab === tab.key ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "squad" && (
        <SquadTab riders={riders} scouting={scouting} onSelectRider={setSelectedRider} windowOpen={windowOpen} />
      )}
      {activeTab === "transfers" && team?.id && (
        <TeamTransferHistoryTab teamId={team.id} />
      )}

      {selectedRider && (
        <RiderActionModal rider={selectedRider} team={team} scouting={scouting} onClose={() => setSelectedRider(null)} onAction={loadAll} onDemote={handleDemote} ddActive={ddActive} />
      )}

      {/* #932 S7: Demote-bekræftelse (senior → akademi) — løn-delta + akademi-cap +
          fremtidige løb der ryddes. Genbruger den delte AcademyTransferConfirmModal. */}
      <AcademyTransferConfirmModal
        show={!!demoteConfirm}
        direction="demote"
        riderName={demoteConfirm ? `${demoteConfirm.rider.firstname} ${demoteConfirm.rider.lastname}`.trim() : ""}
        newSalary={demoteConfirm ? projectYouthSalary(demoteConfirm.rider) : 0}
        currentSalary={demoteConfirm?.rider?.salary ?? 0}
        capLabel={demoteConfirm?.academyCount != null ? `${demoteConfirm.academyCount} / 8` : null}
        capAfterLabel={demoteConfirm?.academyCount != null ? `${demoteConfirm.academyCount + 1} / 8` : null}
        racesCleared={demoteConfirm?.racesCleared ?? 0}
        busy={demoteBusy}
        onCancel={() => { if (!demoteBusy) { setDemoteConfirm(null); setDemoteError(null); } }}
        onConfirm={confirmDemote}
      />
      {demoteError && (
        <p className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-cz px-4 py-2 text-sm shadow-lg">
          {demoteError}
        </p>
      )}
    </div>
  );
}

export default TeamPage;
