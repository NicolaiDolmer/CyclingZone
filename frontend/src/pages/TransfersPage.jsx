import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import RiderFilters from "../components/RiderFilters";
import { useClientRiderFilters } from "../lib/useRiderFilters";
import { statStyle } from "../lib/statColor";
import { ConfettiModal } from "../components/ConfettiModal";
import { BidConfirmModal } from "../components/BidConfirmModal";
import { Flag } from "../components/Flag";
import { formatCz, getRiderMarketValue, getRiderSalary, computeBidValueDelta, computeValueDeviationPct } from "../lib/marketValues.js";
import { getEffectiveOfferAmount, isCounterAmount } from "../lib/offerAmount.js";
import { formatNumber, formatDate } from "../lib/intl";
import { resolveApiError } from "../lib/apiError";
import { sortRows } from "../lib/useTableSort.js";
import { previewBulkPriceAdjust } from "../lib/bulkPriceAdjust.js";
import { parseAmountInput, parseAdjustmentValue } from "../lib/amountInput.js";
import { cycleSortState } from "../lib/riderSort.js";
import SortableTh from "../components/ui/SortableTh.jsx";
import {
  AmountInput, EmptyState, ExchangeIcon, InboxIcon, PageLoader,
  PageHeader, Section, Button, Select, Tabs, TabList, Tab, BlockedNote,
  ArrowUpIcon, ArrowDownIcon, BikeIcon,
} from "../components/ui";
import { useBlockedAction } from "../lib/useBlockedAction.js";
// #2849 bølge 2: markeds-tabellens wrap/border deles med cz-table-recipen (T2),
// men tabellen konverteres IKKE til <DataTable> — se kommentar ved MarketTable
// (bulk-select-checkbokse + en expander-handlingsrække pr. listing er uden for
// DataTable's API, ligesom AuctionsPage's sticky bud-kolonne i bølge 1).
import { WRAP } from "../components/ui/dataTableStyles.js";
import { ABILITY_STATS as LISTING_STATS, ABILITY_KEYS, ABILITY_SHORT, flattenAbilities } from "../lib/abilities";
import { getRiderAge, retirementBidWarningTier } from "../lib/riderAge";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import NationCell from "../components/rider/NationCell";
import RiderNameCell from "../components/rider/RiderNameCell";
import TeamCell from "../components/rider/TeamCell";
import ValueDeltaBadge from "../components/rider/ValueDeltaBadge";

// #2329: markedstabellens ÉN kanoniske sort-state (useSortState) — headers og
// de gamle knapper/evne-dropdown deler samme { sort, dir }, så de aldrig kan
// komme i konflikt. Erstattede den listing-niveau sortListings (#1185/#2031),
// som kun kunne rammes fra knapperne, ikke fra header-klik.
//
// #4628: de otte sorterings-knapper (#2031) og evne-dropdownen er fjernet —
// kolonneoverskrifterne sorterer allerede paa de samme noegler, saa fladen bar
// to idiomer for én state. Mobil-pariteten ligger nu i MarketSortControl.

// Numeriske kolonner + evner starter faldende ved første header-klik ("bedst/
// dyrest øverst"), som resten af sidens tabeller (riderSort-konventionen).
const MARKET_SORT_DESC_FIRST_KEYS = new Set(["age", "listed", "value", "salary", "price", ...ABILITY_KEYS]);

// #2849 bølge 2: cz-table-recipens header-typografi (11px uppercase, tracking
// .06em, font-data) — samme delte konstant som AuctionsPage's TH_BASE (bølge 1).
// Markeds-tabellen konverteres IKKE til <DataTable> (bulk-select-checkbokse +
// en expander-handlingsrække pr. listing er uden for DataTable's API), men
// genbruger recipens VÆRDIER direkte via dataTableStyles (WRAP) + denne konstant.
const MARKET_TH_BASE = "font-data text-2xs font-semibold uppercase tracking-[.06em]";

// Accessorer pr. sorterbar kolonne. Rytterens evner er fladtgjort op på
// listing.rider[<key>] (flattenAbilities ved load) — se abilities.js (SSOT).
const MARKET_SORT_ACCESSORS = {
  rider: (l) => (l.rider ? `${l.rider.firstname || ""} ${l.rider.lastname || ""}`.trim() || null : null),
  seller: (l) => l.seller?.name ?? null,
  // #3071: modul-konstant kan ikke se komponentens seasonYear-state — men
  // alders-SORTERING er ordinalt uafhængig af referenceåret (samme offset for
  // alle ryttere), så vi sorterer på det negerede fødselsår i stedet (ældre
  // fødselsår = højere alder). Ingen wall-clock involveret.
  age: (l) => (l.rider?.birthdate ? -new Date(l.rider.birthdate).getFullYear() : null),
  listed: (l) => (l.created_at ? new Date(l.created_at).getTime() : null),
  value: (l) => (l.rider ? getRiderMarketValue(l.rider) : null),
  salary: (l) => (l.rider ? getRiderSalary(l.rider) : null),
  price: (l) => l.asking_price ?? null,
  ...Object.fromEntries(
    ABILITY_KEYS.map((key) => [key, (l) => (typeof l.rider?.[key] === "number" ? l.rider[key] : null)]),
  ),
};

const API = import.meta.env.VITE_API_URL;

// #987: faner kan deep-linkes via ?tab= (fx /transfers?tab=market fra nav'ens
// "Transferliste"-genvej). Ukendte værdier falder tilbage til "received".
// #2358: swap-fanen fjernet — swaps demoteres til en handling på rytterprofilen
// (SwapOfferButton, RiderStatsPage.jsx). Eksisterende åbne swap-tilbud er stadig
// synlige/besvarlige, blot flyttet ind i "received"/"sent" (se render nedenfor).
// #1994: loans-fanen fjernet — udlåns-featuren er afviklet.
const VALID_TABS = ["received", "sent", "archive", "market"];
const DEFAULT_TAB = "received";

// #58: de 6 sideordnede faner er grupperet i 3 handlingsorienterede modes, så en
// manager hurtigt ser "hvad skal jeg handle på nu?" uden at scanne 6 faner. Modes
// er ren UI-gruppering OVENPÅ det eksisterende ?tab=-dataflow: de gamle tab-værdier
// (og deres deep-links) router uændret — hvert mode peger blot på en delmængde af
// VALID_TABS. Rækkefølgen af faner i et mode = visnings-rækkefølge i sub-fane-båndet.
const TAB_MODES = [
  { key: "handle",       tabs: ["received"] },
  { key: "negotiations", tabs: ["sent", "archive"] },
  { key: "market",       tabs: ["market"] },
];

// #4628 — mobil-sortering for markeds-tabellen. Paa mobil er de fleste sorterbare
// kolonneoverskrifter skjult (hidden sm/md:table-cell), saa saelger/alder/listet/
// loen ikke kan sorteres. Denne select + retnings-toggle eksponerer NOEJAGTIG de
// samme sort-noegler som headerne og skriver til samme marketSortState via
// handleMarketSort — ingen ny sort-logik. Synlig kun under sm-breakpointet.
// Samme komponent-moenster som RidersPage's MobileSortControl (#9).
function MarketSortControl({ sort, sortDir, onSort, statCols, t }) {
  const baseOptions = [
    { key: "rider", label: t("marketRow.rider") },
    { key: "seller", label: t("marketRow.seller") },
    { key: "age", label: t("marketRow.age") },
    { key: "listed", label: t("marketRow.listed") },
    { key: "value", label: t("marketRow.value") },
    { key: "salary", label: t("marketRow.salary") },
    { key: "price", label: t("marketRow.price") },
  ];
  const options = [...baseOptions, ...statCols.map(({ key, label }) => ({ key, label }))];
  const dirAria = sortDir === "desc" ? t("marketSort.descAria") : t("marketSort.ascAria");

  return (
    <div className="sm:hidden flex items-end gap-2 mb-3">
      <label className="flex-1 min-w-0">
        <span className="block text-cz-3 text-3xs uppercase tracking-wider mb-1">{t("marketSort.label")}</span>
        <Select size="sm" value={sort} onChange={e => onSort(e.target.value)} className="w-full">
          {options.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </Select>
      </label>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onSort(sort)}
        aria-label={dirAria}
        title={dirAria}
        className="flex-shrink-0"
      >
        {sortDir === "desc"
          ? <ArrowDownIcon size={16} aria-hidden="true" />
          : <ArrowUpIcon size={16} aria-hidden="true" />}
      </Button>
    </div>
  );
}

// tab → mode-opslag (afledt af TAB_MODES, så de aldrig kan divergere). Bruges til at
// udlede det aktive mode fra den aktive fane (som stadig lever i ?tab=).
const TAB_TO_MODE = Object.fromEntries(
  TAB_MODES.flatMap((m) => m.tabs.map((tab) => [tab, m.key])),
);

// #1529: stat-kolonnerne = de 15 CZ-evner (delt config, importeret som LISTING_STATS).
// Erstattede de 14 PCM stat_*. Backend /api/transfers (+ my-offers/swaps) leverer
// rider_derived_abilities, som flades op på rytter-objektet (flattenAbilities) ved load.
//
// #2002: SwapCard's hurtig-preview er en KURATERET delmængde (4 evner) — men både
// rækkefølge og labels udledes af SSOT (abilities.js), så den aldrig kan divergere
// fra de andre evne-flader. Nøglerne holdes i ABILITY_KEYS-rækkefølge (guard-test i
// TransfersPage.abilities.test.js fejler hvis en nøgle er ukendt eller ude af orden),
// og labelen kommer fra ABILITY_SHORT i stedet for en hardcodet streng.
const SWAP_PREVIEW_KEYS = ["climbing", "sprint", "flat", "time_trial"];
const SWAP_PREVIEW = SWAP_PREVIEW_KEYS.map((key) => [ABILITY_SHORT[key], key]);

function useTimeAgo() {
  const { t } = useTranslation("transfers");
  return (d) => {
    if (!d) return t("relativeTime.dash");
    const diff = new Date() - new Date(d);
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const day = Math.floor(diff / 86400000);
    if (m < 1) return t("relativeTime.justNow");
    if (m < 60) return t("relativeTime.minutes", { m });
    if (h < 24) return t("relativeTime.hours", { h });
    return t("relativeTime.days", { day });
  };
}

const STATUS_STYLE = {
  pending:                { color: "text-cz-accent-t",   bg: "bg-cz-accent/10 border-cz-accent/30" },
  countered:              { color: "text-cz-warning",  bg: "bg-cz-warning-bg border-cz-warning/30" },
  awaiting_confirmation:  { color: "text-cz-info",    bg: "bg-cz-info/20 border-cz-info/30" },
  accepted:               { color: "text-cz-success",   bg: "bg-cz-success-bg border-cz-success/30" },
  rejected:               { color: "text-cz-danger",     bg: "bg-cz-danger-bg border-cz-danger/30" },
  withdrawn:              { color: "text-cz-3",   bg: "bg-cz-subtle border-cz-border" },
};

const STATUS_LABEL_KEY = {
  pending: "status.pending",
  countered: "status.countered",
  awaiting_confirmation: "status.awaitingConfirmation",
  accepted: "status.accepted",
  rejected: "status.rejected",
  withdrawn: "status.withdrawn",
};

function statusCfg(t, status) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.pending;
  const labelKey = STATUS_LABEL_KEY[status] || STATUS_LABEL_KEY.pending;
  return { ...style, label: t(labelKey) };
}

// ── Modtaget tilbud ──────────────────────────────────────────────────────────
function ReceivedOfferCard({ offer, onAction, showArchive = true }) {
  const { t } = useTranslation("transfers");
  const timeAgo = useTimeAgo();
  const [counterAmt, setCounterAmt] = useState(offer.offer_amount || 0);
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);

  const isPending = offer.status === "pending";
  const isAwaiting = offer.status === "awaiting_confirmation";
  const canArchive = showArchive && ["accepted", "rejected", "withdrawn"].includes(offer.status);
  const cfg = statusCfg(t, offer.status);
  // #4156: ét beløb, én kilde — samme regel som backend afregner efter.
  const priceNum = getEffectiveOfferAmount(offer);
  const price = priceNum != null ? formatNumber(priceNum) : "";

  async function doAction(action, extra = {}) {
    setLoading(true);
    try {
      await onAction(offer.id, action, extra);
      setMode(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    // #2849 bølge 2: kanonisk section-card-recipe (Section = 20px/16px mobil-
    // padding, ingen skygge). Bølge 6: statusfarven sendes nu som `borderClass`-prop.
    // Via className tabte den cascaden mod Cards egen hairline — og kun for GULD:
    // `.border-cz-info/30` ligger efter `.border-cz-border` i bundtet og virkede,
    // mens `.border-cz-accent/30` ligger før og forsvandt tavst. Resultatet var at
    // "afventer dig"-tilbud aldrig fik deres guldkant, mens "afventer modpart" fik sin.
    <Section
      borderClass={isAwaiting ? "border-cz-info/30" : isPending ? "border-cz-accent/30" : "border-cz-border"}
      className={`transition-all ${isAwaiting || isPending ? "" : "opacity-70"}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div className="min-w-0">
          <RiderLink id={offer.rider?.id}
            className="text-cz-1 font-semibold hover:text-cz-accent-t transition-colors block">
            {offer.rider?.nationality_code && <Flag code={offer.rider.nationality_code} className="me-1" />}{offer.rider?.firstname} {offer.rider?.lastname}
          </RiderLink>
          <p className="text-cz-3 text-xs">{t("offerCard.from")}: <TeamLink id={offer.buyer?.id} className="hover:text-cz-accent-t transition-colors">{offer.buyer?.name || "—"}</TeamLink> · {t("offerCard.round", { round: offer.round || 1 })} · {timeAgo(offer.created_at)}</p>
        </div>
        <div className="flex flex-col gap-1 items-end flex-shrink-0">
          <span className={`text-3xs uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
          {offer.seller_squad_critical && (
            <span className="text-3xs px-2 py-1 rounded-full border font-medium bg-cz-danger-bg text-cz-danger border-cz-danger/30 whitespace-nowrap">
              {t("offerCard.squadCriticalReceived")}
            </span>
          )}
        </div>
      </div>

      <div className="bg-cz-subtle rounded-cz px-4 py-3 mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          {/* #4156: etiket OG beløb følger den samme værdi-baserede regel. Den
              gamle status-betingelse viste det oprindelige bud igen, så snart et
              modbud blev accepteret (status skifter væk fra "countered"). */}
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-0.5">
            {isCounterAmount(offer) ? t("offerCard.counterLabel") : t("offerCard.offerLabel")}
          </p>
          <p className="text-cz-accent-t font-mono font-bold text-xl">
            {formatNumber(priceNum)} CZ$
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-cz-3 text-xs">{t("offerCard.value")}</p>
          <p className="text-cz-2 font-mono text-sm">{formatCz(getRiderMarketValue(offer.rider))}</p>
          <p className="text-cz-3 text-xs mt-1">
            {offer.rider?.contract_length != null ? t("offerCard.salary") : t("offerCard.estSalary")}:{" "}
            <span className="text-cz-2 font-mono">{formatCz(getRiderSalary(offer.rider))}</span>
          </p>
          {offer.rider?.contract_length != null ? (
            <p className="text-cz-3 text-3xs">{t("offerCard.contractExpires", { season: offer.rider.contract_end_season })}</p>
          ) : (
            <p className="text-cz-3 text-3xs">{t("offerCard.noContract")}</p>
          )}
        </div>
      </div>

      {offer.message && (
        <div className="bg-cz-subtle rounded-cz px-3 py-2 mb-3 text-cz-2 text-xs italic">
          &quot;{offer.message}&quot;
        </div>
      )}

      {isPending && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button onClick={() => doAction("accept")} disabled={loading}
              className="min-h-[44px] flex-1 py-2 bg-cz-success-bg text-cz-success border border-cz-success/25 rounded-cz text-sm font-medium hover:bg-cz-success/15 transition-all disabled:opacity-50">
              {t("offerCard.buttons.accept")}
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`min-h-[44px] flex-1 py-2 rounded-cz text-sm font-medium border transition-all
                ${mode === "counter"
                  ? "bg-cz-warning-bg text-cz-warning border-cz-warning/30"
                  : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("offerCard.buttons.counter")}
            </button>
            <button onClick={() => doAction("reject")} disabled={loading}
              className="min-h-[44px] flex-1 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-cz text-sm font-medium hover:bg-cz-danger-bg transition-all disabled:opacity-50">
              {t("offerCard.buttons.reject")}
            </button>
          </div>

          {mode === "counter" && (
            <div className="bg-cz-subtle rounded-cz p-3 flex flex-col gap-2">
              <label className="text-cz-3 text-xs uppercase tracking-wider">{t("offerCard.form.counterLabel")}</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <AmountInput value={counterAmt}
                  onValueChange={v => setCounterAmt(v ?? 0)}
                  wrapperClassName="min-w-0 flex-1"
                  className="w-full bg-cz-subtle border border-cz-border rounded-cz px-3 py-2 text-cz-1 font-mono focus:outline-none focus:border-cz-accent" />
                <button onClick={() => doAction("counter", { counter_amount: counterAmt, message: msg })}
                  disabled={loading || counterAmt <= 0}
                  className="min-h-[44px] w-full sm:w-auto px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-cz text-sm hover:brightness-110 disabled:opacity-50">
                  {t("offerCard.buttons.send")}
                </button>
              </div>
              <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
                placeholder={t("offerCard.form.messageBuyer")}
                className="bg-cz-subtle border border-cz-border rounded-cz px-3 py-2 text-cz-1 text-sm focus:outline-none" />
            </div>
          )}
        </div>
      )}

      {isAwaiting && (
        <div className="flex flex-col gap-2">
          {offer.seller_confirmed ? (
            <div className="bg-cz-info-bg border border-cz-info/20 rounded-cz px-4 py-3 text-center">
              <p className="text-cz-info text-sm font-medium">{t("offerCard.awaiting.sellerAccepted")}</p>
              <p className="text-cz-3 text-xs mt-1">{price} CZ$ · {offer.buyer?.name}</p>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => doAction("confirm")} disabled={loading}
                className="min-h-[44px] flex-1 py-2 bg-cz-info-bg text-cz-info border border-cz-info/25 rounded-cz text-sm font-medium hover:bg-cz-info/15 transition-all disabled:opacity-50">
                {t("offerCard.buttons.confirmDeal", { amount: price })}
              </button>
            </div>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="min-h-[44px] w-full py-2 bg-cz-danger-bg text-cz-danger/70 border border-cz-danger/15 rounded-cz text-sm
              hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
            {t("offerCard.buttons.cancelDeal")}
          </button>
        </div>
      )}

      {canArchive && (
        <Button variant="secondary" size="sm" fullWidth className="mt-3"
          onClick={() => doAction("archive")} disabled={loading}>
          {t("offerCard.buttons.archive")}
        </Button>
      )}
    </Section>
  );
}

// ── Sendt tilbud ─────────────────────────────────────────────────────────────
function SentOfferCard({ offer, onAction, showArchive = true }) {
  const { t } = useTranslation("transfers");
  const timeAgo = useTimeAgo();
  const [newAmt, setNewAmt] = useState(offer.counter_amount || offer.offer_amount || 0);
  const [msg, setMsg] = useState("");
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);

  const isCountered = offer.status === "countered";
  const isPending = offer.status === "pending";
  const isAwaiting = offer.status === "awaiting_confirmation";
  const isActive = isCountered || isPending || isAwaiting;
  const canArchive = showArchive && ["accepted", "rejected", "withdrawn"].includes(offer.status);
  const cfg = statusCfg(t, offer.status);
  // #4156: ét beløb, én kilde — samme regel som backend afregner efter.
  const priceNum = getEffectiveOfferAmount(offer);
  const price = priceNum != null ? formatNumber(priceNum) : "";
  // Mens modbuddet STÅR ÅBENT (status "countered") er de to beløb konkurrerende
  // forslag, og begge vises side om side. I alle andre tilstande er der kun ét
  // beløb i spil — det effektive. Før #4156 viste kortet altid det rå
  // offer_amount, så et ACCEPTERET modbud lignede en handel til dit eget bud.
  const primaryAmount = isCountered ? offer.offer_amount : priceNum;
  const primaryLabel = isCountered || !isCounterAmount(offer)
    ? t("offerCard.yourBidLabel")
    : t("offerCard.counterAmountLabel");

  async function doAction(action, extra = {}) {
    setLoading(true);
    try {
      await onAction(offer.id, action, extra);
      setMode(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    // #2849 bølge 2: kanonisk section-card-recipe, status-border via className-
    // override (samme mønster som ReceivedOfferCard/AuctionsPage bølge 1).
    <Section className={`transition-all
      ${isAwaiting ? "border-cz-info/30" : isCountered ? "border-cz-warning/30" : isActive ? "border-cz-border" : "border-cz-border opacity-60"}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div className="min-w-0">
          <RiderLink id={offer.rider?.id}
            className="text-cz-1 font-semibold hover:text-cz-accent-t transition-colors block">
            {offer.rider?.nationality_code && <Flag code={offer.rider.nationality_code} className="me-1" />}{offer.rider?.firstname} {offer.rider?.lastname}
          </RiderLink>
          <p className="text-cz-3 text-xs">{t("offerCard.to")}: <TeamLink id={offer.seller?.id} className="hover:text-cz-accent-t transition-colors">{offer.seller?.name || "—"}</TeamLink> · {t("offerCard.round", { round: offer.round || 1 })} · {timeAgo(offer.updated_at)}</p>
        </div>
        <div className="flex flex-col gap-1 items-end flex-shrink-0">
          <span className={`text-3xs uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
          {offer.seller_squad_critical && (
            <span className="text-3xs px-2 py-1 rounded-full border font-medium bg-cz-danger-bg text-cz-danger border-cz-danger/30 whitespace-nowrap">
              {t("offerCard.squadCriticalSent")}
            </span>
          )}
        </div>
      </div>

      <div className="bg-cz-subtle rounded-cz px-4 py-3 mb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-0.5">{primaryLabel}</p>
            <p className="text-cz-1 font-mono font-bold text-lg">{formatNumber(primaryAmount)} CZ$</p>
          </div>
          {isCountered && offer.counter_amount && (
            <div className="sm:text-right">
              {/* Modbuddet kommer fra SÆLGER her — "Dit modbud" (counterLabel)
                  hører til sælgerens eget kort. #4156. */}
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-0.5">{t("offerCard.counterAmountLabel")}</p>
              <p className="text-cz-warning font-mono font-bold text-lg">{formatNumber(offer.counter_amount)} CZ$</p>
            </div>
          )}
        </div>
      </div>

      {offer.message && (
        <div className="bg-cz-subtle rounded-cz px-3 py-2 mb-3 text-cz-2 text-xs italic">
          &quot;{offer.message}&quot;
        </div>
      )}

      {isCountered && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
            <button onClick={() => doAction("accept_counter")} disabled={loading}
              className="min-h-[44px] flex-1 py-2 bg-cz-success-bg text-cz-success border border-cz-success/25 rounded-cz text-sm font-medium hover:bg-cz-success/15 disabled:opacity-50">
              {t("offerCard.buttons.acceptCounter", { amount: formatNumber(offer.counter_amount) })}
            </button>
            <button onClick={() => setMode(mode === "new_offer" ? null : "new_offer")}
              className={`min-h-[44px] px-4 py-2 rounded-cz text-sm font-medium border transition-all
                ${mode === "new_offer"
                  ? "bg-cz-info-bg text-cz-info border-cz-info/30"
                  : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("offerCard.buttons.newOffer")}
            </button>
            <button onClick={() => doAction("withdraw")} disabled={loading}
              className="min-h-[44px] px-4 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-cz text-sm font-medium hover:bg-cz-danger-bg disabled:opacity-50">
              {t("offerCard.buttons.withdraw")}
            </button>
          </div>

          {mode === "new_offer" && (
            <div className="bg-cz-subtle rounded-cz p-3 flex flex-col gap-2">
              <label className="text-cz-3 text-xs uppercase tracking-wider">{t("offerCard.form.newOfferLabel")}</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <AmountInput value={newAmt}
                  onValueChange={v => setNewAmt(v ?? 0)}
                  wrapperClassName="min-w-0 flex-1"
                  className="w-full bg-cz-subtle border border-cz-border rounded-cz px-3 py-2 text-cz-1 font-mono focus:outline-none focus:border-cz-accent" />
                <button onClick={() => doAction("new_offer", { counter_amount: newAmt, message: msg })}
                  disabled={loading || newAmt <= 0}
                  className="min-h-[44px] w-full sm:w-auto px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-cz text-sm hover:brightness-110 disabled:opacity-50">
                  {t("offerCard.buttons.send")}
                </button>
              </div>
              <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
                placeholder={t("offerCard.form.messagePlaceholder")}
                className="bg-cz-subtle border border-cz-border rounded-cz px-3 py-2 text-cz-1 text-sm focus:outline-none" />
            </div>
          )}
        </div>
      )}

      {isPending && (
        <Button variant="secondary" size="sm" fullWidth
          className="text-cz-3 hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30"
          onClick={() => doAction("withdraw")} disabled={loading}>
          {t("offerCard.buttons.withdrawOffer")}
        </Button>
      )}

      {isAwaiting && (
        <div className="flex flex-col gap-2">
          {offer.buyer_confirmed ? (
            <div className="bg-cz-info-bg border border-cz-info/20 rounded-cz px-4 py-3 text-center">
              <p className="text-cz-info text-sm font-medium">{t("offerCard.awaiting.buyerConfirmed")}</p>
              <p className="text-cz-3 text-xs mt-1">{price} CZ$ · {offer.seller?.name}</p>
            </div>
          ) : (
            <button onClick={() => doAction("confirm")} disabled={loading}
              className="min-h-[44px] w-full py-2 bg-cz-info-bg text-cz-info border border-cz-info/25 rounded-cz text-sm font-medium hover:bg-cz-info/15 transition-all disabled:opacity-50">
              {t("offerCard.buttons.confirmDeal", { amount: price })}
            </button>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="min-h-[44px] w-full py-2 bg-cz-danger-bg text-cz-danger/70 border border-cz-danger/15 rounded-cz text-sm
              hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
            {t("offerCard.buttons.cancelDeal")}
          </button>
        </div>
      )}

      {canArchive && (
        <Button variant="secondary" size="sm" fullWidth className="mt-3"
          onClick={() => doAction("archive")} disabled={loading}>
          {t("offerCard.buttons.archive")}
        </Button>
      )}
    </Section>
  );
}

// ── Swap offer card ──────────────────────────────────────────────────────────
function SwapCard({ swap, myTeamId, onAction, showArchive = true }) {
  const { t } = useTranslation("transfers");
  const [counterCash, setCounterCash] = useState(swap.counter_cash ?? swap.cash_adjustment ?? 0);
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);

  const isProposing     = swap.proposing?.id === myTeamId;
  const isReceiving     = swap.receiving?.id === myTeamId;
  const isPending       = swap.status === "pending";
  const isCountered     = swap.status === "countered";
  const isAwaiting      = swap.status === "awaiting_confirmation";
  // #3492: samme arkiv-affordance som transfertilbud har haft siden 30/4 —
  // uden den voksede Forhandlinger-fanen monotont med afsluttede bytteforslag.
  const canArchive = showArchive && ["accepted", "rejected", "withdrawn"].includes(swap.status);
  const cfg = statusCfg(t, swap.status);

  const effectiveCash = isCountered ? swap.counter_cash : swap.cash_adjustment;
  const cashLabel = effectiveCash === 0 ? t("swapCard.pureSwap")
    : effectiveCash > 0 ? t("swapCard.cashFrom", { amount: formatNumber(effectiveCash), team: swap.proposing?.name })
    : t("swapCard.cashFrom", { amount: formatNumber(Math.abs(effectiveCash)), team: swap.receiving?.name });

  async function doAction(action, extra = {}) {
    setLoading(true);
    try {
      await onAction(swap.id, action, extra);
      setMode(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    // #2849 bølge 2: kanonisk section-card-recipe, status-border via className-override.
    <Section className={`transition-all
      ${isAwaiting ? "border-cz-info/30" : isCountered ? "border-cz-warning/30" : isPending ? "border-cz-border" : "border-cz-border opacity-60"}`}>

      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-cz-3 text-xs">
            {isProposing ? `${t("offerCard.to")}: ${swap.receiving?.name}` : `${t("offerCard.from")}: ${swap.proposing?.name}`}
          </p>
        </div>
        <span className={`text-3xs uppercase px-2 py-1 rounded-full border font-medium ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        {[
          { label: isProposing ? t("swapCard.youOffer") : t("swapCard.theyOffer"), rider: swap.offered },
          { label: isProposing ? t("swapCard.youWant")  : t("swapCard.theyWant"),  rider: swap.requested },
        ].map(({ label, rider }) => (
          <RiderLink key={rider?.id} id={rider?.id}
            aria-label={rider ? `${rider.firstname} ${rider.lastname}` : undefined}
            className="group block bg-cz-subtle rounded-cz px-3 py-2 transition-colors hover:ring-1 hover:ring-cz-accent/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cz-accent/40">
            <p className="text-cz-3 text-3xs uppercase tracking-wider mb-1">{label}</p>
            <p className="text-cz-1 text-sm font-semibold transition-colors group-hover:text-cz-accent-t">
              {rider?.firstname} {rider?.lastname}
            </p>
            <div className="flex gap-2 mt-1">
              {SWAP_PREVIEW.map(([l, k]) => (
                <span key={k} className="text-3xs text-cz-3">{l}<span className="text-cz-2 ms-0.5">{rider?.[k] ?? "—"}</span></span>
              ))}
            </div>
          </RiderLink>
        ))}
      </div>

      <div className={`rounded-cz px-3 py-2 mb-3 text-xs text-center font-medium
        ${effectiveCash === 0 ? "bg-cz-subtle text-cz-2" : "bg-cz-accent/10 text-cz-accent-t/80"}`}>
        {cashLabel}
        {isCountered && <span className="text-cz-warning ms-2">{t("swapCard.counterTag")}</span>}
      </div>

      {swap.message && (
        <div className="bg-cz-subtle rounded-cz px-3 py-2 mb-3 text-cz-2 text-xs italic">
          &quot;{swap.message}&quot;
        </div>
      )}

      {isPending && isReceiving && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button onClick={() => doAction("accept")} disabled={loading}
              className="min-h-[44px] flex-1 py-2 bg-cz-success-bg text-cz-success border border-cz-success/25 rounded-cz text-sm font-medium hover:bg-cz-success/15 disabled:opacity-50">
              {t("swapCard.buttons.accept")}
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`min-h-[44px] flex-1 py-2 rounded-cz text-sm font-medium border transition-all
                ${mode === "counter" ? "bg-cz-warning-bg text-cz-warning border-cz-warning/30" : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("swapCard.buttons.counter")}
            </button>
            <button onClick={() => doAction("reject")} disabled={loading}
              className="min-h-[44px] flex-1 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-cz text-sm font-medium hover:bg-cz-danger-bg disabled:opacity-50">
              {t("swapCard.buttons.reject")}
            </button>
          </div>
          {mode === "counter" && (
            <div className="bg-cz-subtle rounded-cz p-3 flex flex-col gap-2">
              <label className="text-cz-3 text-xs uppercase tracking-wider">{t("swapCard.form.cashReceiveLabel")}</label>
              <div className="flex gap-2">
                <AmountInput value={counterCash}
                  onValueChange={v => setCounterCash(v ?? 0)}
                  allowNegative
                  wrapperClassName="flex-1"
                  className="w-full bg-cz-subtle border border-cz-border rounded-cz px-3 py-2 text-cz-1 font-mono focus:outline-none focus:border-cz-accent" />
                {/* #2843: counter_cash gemmes i SAMME konvention som cash_adjustment
                    (schema: positiv = proposing betaler receiving; transferExecution
                    vælger payer med `cash > 0 ? proposing : receiving`). Feltet
                    prefilles på linje ~450 med den RÅ lagrede værdi, så input'et ER
                    i rå konvention. For den modtagende part betyder positiv altså
                    "jeg modtager", præcis som cashReceiveLabel lover — værdien må
                    derfor IKKE negeres på vej ud. */}
                <button onClick={() => doAction("counter", { counter_cash: counterCash })}
                  disabled={loading}
                  className="min-h-[44px] px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-cz text-sm hover:brightness-110 disabled:opacity-50">
                  {t("swapCard.buttons.send")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isPending && isProposing && (
        <Button variant="secondary" size="sm" fullWidth
          className="text-cz-3 hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30"
          onClick={() => doAction("withdraw")} disabled={loading}>
          {t("swapCard.buttons.withdraw")}
        </Button>
      )}

      {isCountered && isProposing && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button onClick={() => doAction("accept_counter")} disabled={loading}
              className="min-h-[44px] flex-1 py-2 bg-cz-success-bg text-cz-success border border-cz-success/25 rounded-cz text-sm font-medium hover:bg-cz-success/15 disabled:opacity-50">
              {t("swapCard.buttons.acceptCounter")}
            </button>
            <button onClick={() => setMode(mode === "counter" ? null : "counter")}
              className={`min-h-[44px] flex-1 py-2 rounded-cz text-sm font-medium border transition-all
                ${mode === "counter" ? "bg-cz-warning-bg text-cz-warning border-cz-warning/30" : "bg-cz-subtle text-cz-2 border-cz-border hover:bg-cz-subtle"}`}>
              {t("swapCard.buttons.counter")}
            </button>
            <button onClick={() => doAction("withdraw")} disabled={loading}
              className="min-h-[44px] px-4 py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-cz text-sm hover:bg-cz-danger-bg disabled:opacity-50">
              {t("swapCard.buttons.rejectShort")}
            </button>
          </div>
          {mode === "counter" && (
            <div className="bg-cz-subtle rounded-cz p-3 flex flex-col gap-2">
              <label className="text-cz-3 text-xs uppercase tracking-wider">{t("swapCard.form.cashPayLabel")}</label>
              <div className="flex gap-2">
                <AmountInput value={counterCash}
                  onValueChange={v => setCounterCash(v ?? 0)}
                  allowNegative
                  wrapperClassName="flex-1"
                  className="w-full bg-cz-subtle border border-cz-border rounded-cz px-3 py-2 text-cz-1 font-mono focus:outline-none focus:border-cz-accent" />
                <button onClick={() => doAction("counter", { counter_cash: counterCash })}
                  disabled={loading}
                  className="min-h-[44px] px-4 py-2 bg-cz-accent text-cz-on-accent font-bold rounded-cz text-sm hover:brightness-110 disabled:opacity-50">
                  {t("swapCard.buttons.send")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isAwaiting && (
        <div className="flex flex-col gap-2">
          {(isProposing ? swap.proposing_confirmed : swap.receiving_confirmed) ? (
            <div className="bg-cz-info-bg border border-cz-info/20 rounded-cz px-4 py-3 text-center">
              <p className="text-cz-info text-sm font-medium">{t("swapCard.awaiting.selfConfirmed")}</p>
            </div>
          ) : (
            <button onClick={() => doAction("confirm")} disabled={loading}
              className="min-h-[44px] w-full py-2 bg-cz-info-bg text-cz-info border border-cz-info/25 rounded-cz text-sm font-medium hover:bg-cz-info/15 disabled:opacity-50">
              {t("swapCard.buttons.confirmSwap")}
            </button>
          )}
          <button onClick={() => doAction("cancel")} disabled={loading}
            className="min-h-[44px] w-full py-2 bg-cz-danger-bg text-cz-danger/70 border border-cz-danger/15 rounded-cz text-sm
              hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30 transition-all disabled:opacity-50">
            {t("swapCard.buttons.cancelSwap")}
          </button>
        </div>
      )}

      {canArchive && (
        <Button variant="secondary" size="sm" fullWidth className="mt-3"
          onClick={() => doAction("archive")} disabled={loading}>
          {t("swapCard.buttons.archive")}
        </Button>
      )}
    </Section>
  );
}

// ── Egne listings: redigér pris + fjern (#1185) ──────────────────────────────
// Fjern-flowet bruger in-app confirm i stedet for window.confirm — native
// confirm-dialoger undertrykkes i visse mobile in-app-browsere/PWA-kontekster,
// så knappen virkede ikke for alle på mobil. Eneste player-facing window.confirm
// i appen lå her.
function OwnListingActions({ listing, riderName, onRemove, onUpdatePrice }) {
  const { t } = useTranslation("transfers");
  const [mode, setMode] = useState(null); // null | "edit" | "confirmRemove"
  const [price, setPrice] = useState(listing.asking_price || 0);
  const [busy, setBusy] = useState(false);

  const priceInvalid = !Number.isInteger(price) || price <= 0;
  // #3012: knappen var disabled uden nogen synlig grund — spilleren kunne ikke
  // se HVAD der gjorde prisen ugyldig.
  const priceBlock = useBlockedAction(!busy && priceInvalid ? t("transferCard.priceInvalid") : null);

  async function savePrice() {
    setBusy(true);
    try {
      // Luk kun edit-formen ved succes — ved fejl (toast vises af parent)
      // beholder vi formen åben så prisen kan rettes uden at genåbne.
      const ok = await onUpdatePrice(listing.id, price);
      if (ok) setMode(null);
    } finally {
      setBusy(false);
    }
  }

  async function performRemove() {
    setBusy(true);
    try {
      await onRemove(listing.id, riderName);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "edit") {
    return (
      <div className="bg-cz-subtle rounded-cz p-3 flex flex-col gap-2">
        <label className="text-cz-3 text-xs uppercase tracking-wider">{t("transferCard.editPriceLabel")}</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <AmountInput value={price}
            onValueChange={v => setPrice(v)}
            data-testid="transfer-edit-price-input"
            wrapperClassName="min-w-0 flex-1"
            className="w-full min-h-[44px] bg-cz-card border border-cz-border rounded-cz px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none focus:border-cz-accent" />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" className="flex-1 sm:flex-none"
              onClick={priceBlock.guard(savePrice)} loading={busy}
              disabled={busy} {...priceBlock.blockedProps}>
              {t("transferCard.savePrice")}
            </Button>
            <Button variant="secondary" size="sm" className="flex-1 sm:flex-none"
              onClick={() => { setMode(null); setPrice(listing.asking_price || 0); }} disabled={busy}>
              {t("transferCard.cancel")}
            </Button>
          </div>
        </div>
        {priceBlock.blocked && (
          <BlockedNote id={priceBlock.reasonId} pulseKey={priceBlock.pulseKey} className="text-2xs">
            {priceBlock.reason}
          </BlockedNote>
        )}
      </div>
    );
  }

  if (mode === "confirmRemove") {
    return (
      <div className="bg-cz-subtle rounded-cz p-3 flex flex-col gap-2">
        <p className="text-cz-2 text-sm">{t("transferCard.removeConfirm", { riderName })}</p>
        <div className="flex gap-2">
          <button onClick={performRemove} disabled={busy}
            className="flex-1 min-h-[44px] py-2 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-cz text-sm font-medium hover:bg-cz-danger-bg disabled:opacity-50 transition-all">
            {busy ? t("transferCard.removing") : t("transferCard.confirmRemoveButton")}
          </button>
          <Button variant="secondary" size="sm" className="flex-1"
            onClick={() => setMode(null)} disabled={busy}>
            {t("transferCard.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <Button variant="secondary" size="sm"
        aria-label={t("transferCard.editPriceAria", { riderName })}
        onClick={() => { setPrice(listing.asking_price || 0); setMode("edit"); }}>
        {t("transferCard.editPrice")}
      </Button>
      <Button variant="secondary" size="sm"
        aria-label={t("transferCard.removeAria", { riderName })}
        className="hover:bg-cz-danger-bg hover:text-cz-danger hover:border-cz-danger/30"
        onClick={() => setMode("confirmRemove")}>
        {t("transferCard.removeListing")}
      </Button>
    </div>
  );
}

// ── Market række-layout (#1523) ──────────────────────────────────────────────
// Transferlistens market-fane vises nu som rækker på linje med ryttersiden
// (RidersPage), så stats kan sammenlignes på tværs af rytteroversigterne.
// Samme byggeklodser (NationCell/RiderNameCell/TeamCell + statStyle-badges) +
// samme tabel-struktur (sticky navn-kolonne, evne-kolonner). Den transferliste-
// specifikke funktionalitet (pris, status, bud, redigér/fjern) bor i en
// expander-række under selve rytterrækken, så tabel-overblikket bevares.

function MarketStatBar({ value }) {
  return (
    <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded-cz" style={statStyle(value ?? 0)}>
      {value ?? "—"}
    </span>
  );
}

// Bud-form (ikke-egen listing) — samme felter/validering som TransferCard.
function MarketOfferForm({ listing, onOffer, seasonYear }) {
  const { t } = useTranslation("transfers");
  const [offerAmt, setOfferAmt] = useState(listing.asking_price || 0);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const riderName = listing.rider ? `${listing.rider.firstname} ${listing.rider.lastname}` : t("transferCard.ridersForSale");

  async function performSendOffer() {
    setLoading(true);
    try {
      await onOffer(listing.rider?.id, offerAmt, msg);
      setConfirmOpen(false);
    } finally {
      setLoading(false);
    }
  }

  // #3012: knappen var disabled ved offerAmt<=0 uden nogen synlig grund.
  const offerBlock = useBlockedAction(!loading && offerAmt <= 0 ? t("offerCard.form.offerAmountBlocked") : null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <AmountInput value={offerAmt}
          onValueChange={v => setOfferAmt(v ?? 0)}
          aria-label={t("offerCard.form.newOfferLabel")}
          wrapperClassName="min-w-0 flex-1"
          className="w-full min-h-[44px] bg-cz-card border border-cz-border rounded-cz px-3 py-2 text-cz-1 font-mono text-sm focus:outline-none focus:border-cz-accent" />
        <Button variant="primary" size="sm"
          onClick={offerBlock.guard(() => setConfirmOpen(true))}
          loading={loading} disabled={loading} {...offerBlock.blockedProps}>
          {t("transferCard.send")}
        </Button>
      </div>
      {offerBlock.blocked && (
        <BlockedNote id={offerBlock.reasonId} pulseKey={offerBlock.pulseKey} className="text-2xs">
          {offerBlock.reason}
        </BlockedNote>
      )}
      <input type="text" value={msg} onChange={e => setMsg(e.target.value)}
        placeholder={t("transferCard.messagePlaceholder")}
        className="bg-cz-card border border-cz-border rounded-cz px-3 py-2 text-cz-1 text-xs focus:outline-none focus:border-cz-accent" />
      <BidConfirmModal
        show={confirmOpen}
        mode="transfer"
        riderName={riderName}
        amount={offerAmt}
        retirementTier={retirementBidWarningTier(listing.rider?.birthdate, seasonYear)}
        busy={loading}
        onCancel={() => { if (!loading) setConfirmOpen(false); }}
        onConfirm={performSendOffer}
      />
    </div>
  );
}

// Én listing = én rytterrække (+ optionel action-expander-række under).
function MarketRow({
  listing, myTeamId, statCols, expanded, onToggleExpand, onOffer, onRemove, onUpdatePrice,
  selected, onToggleSelect, seasonYear,
}) {
  const { t } = useTranslation("transfers");
  const rider = listing.rider;
  const isOwn = listing.seller?.id === myTeamId;
  const riderName = rider ? `${rider.firstname} ${rider.lastname}` : t("transferCard.ridersForSale");
  // #3191: samme "X% under/over vurdering"-indikator som Auktioner (#2464), her
  // mod listing.asking_price i stedet for auktionens current_price — paritet
  // mellem de to sider af samme marked.
  const valueDelta = computeBidValueDelta(listing.asking_price, rider);

  return (
    <>
      <tr className={`border-b border-cz-border transition-colors ${expanded || selected ? "bg-cz-subtle" : "hover:bg-cz-subtle"}`}>
        <td className="px-2 py-2.5 w-12 hidden sm:table-cell">
          <NationCell code={rider?.nationality_code} />
        </td>
        {/* #2849 bølge 2: rå box-shadow fjernet — .sticky-name-cell (index.css)
            giver allerede opak cellebund; border-r er den ene hairline-rule
            (cz-table-recipen), samme fix som AuctionsPage bølge 1. */}
        <td className="px-3 py-2.5 sticky-name-cell sticky left-0 z-table-col border-r border-cz-border">
          <div className="flex items-center gap-2">
            {/* #2451: markering til bulk-prisredigering — kun egne listinger kan
                bulk-redigeres, så checkboxen findes kun for dem. Ligger i selve
                den sticky navne-celle (ikke en ny kolonne) så den forbliver synlig
                på mobil uden at forstyrre den eksisterende sticky-antagelse (én
                synlig venstre-kolonne). */}
            {isOwn && (
              <input
                type="checkbox"
                data-testid={`bulk-select-${listing.id}`}
                aria-label={t("marketRow.selectAria", { riderName })}
                checked={!!selected}
                onChange={() => onToggleSelect(listing.id)}
                className="min-w-[18px] min-h-[18px] w-[18px] h-[18px] cursor-pointer accent-cz-accent"
              />
            )}
            <RiderNameCell id={rider?.id} firstname={rider?.firstname} lastname={rider?.lastname} />
          </div>
        </td>
        <td className="px-3 py-2.5 hidden sm:table-cell">
          <TeamCell team={listing.seller} freeLabel="—" />
        </td>
        <td className="px-2 py-2.5 text-center hidden md:table-cell">
          <span className="text-cz-2 font-mono text-xs">{getRiderAge(rider?.birthdate, seasonYear) ?? "—"}</span>
        </td>
        <td className="px-3 py-2.5 hidden md:table-cell">
          <span className="text-cz-3 text-xs whitespace-nowrap">
            {listing.created_at ? formatDate(listing.created_at, null, { day: "numeric", month: "short" }) : "—"}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right">
          <span className="text-cz-2 font-mono text-sm">{formatCz(getRiderMarketValue(rider))}</span>
        </td>
        <td className="px-3 py-2.5 text-right hidden sm:table-cell">
          <span className="text-cz-2 font-mono text-sm">{formatCz(getRiderSalary(rider))}</span>
        </td>
        <td className="px-3 py-2.5 text-right">
          <span className="text-cz-accent-t font-mono text-sm font-bold whitespace-nowrap">
            {formatNumber(listing.asking_price)} CZ$
          </span>
          {/* #3191: udbudspris vs. estimeret markedsværdi — paritet med Auktioners
              bud-vs-vurdering-indikator (#2464), delt via ValueDeltaBadge. */}
          <ValueDeltaBadge valueDelta={valueDelta} ns="transfers" as="p" className="text-3xs mt-0.5" />
        </td>
        {statCols.map(({ key }) => (
          <td key={key} className="px-1.5 py-2.5 w-14 text-center">
            <MarketStatBar value={rider?.[key]} />
          </td>
        ))}
        <td className="px-3 py-2.5 text-right w-28">
          {/* #2849 bølge 2: T2-kontrakten forbyder gold i rækker — dette er en
              sekundær expand/collapse-toggle, aldrig sidens primary. */}
          <Button
            variant="secondary" size="sm"
            onClick={() => onToggleExpand(listing.id)}
            aria-expanded={expanded}
            aria-label={isOwn ? t("marketRow.manageAria", { riderName }) : t("marketRow.offerAria", { riderName })}
            className={expanded ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/25" : ""}>
            {expanded ? t("marketRow.close") : isOwn ? t("marketRow.manage") : t("marketRow.offer")}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-cz-border bg-cz-subtle">
          <td colSpan={8 + statCols.length + 1} className="px-3 pb-4 pt-1">
            <div className="max-w-xl rounded-cz border border-cz-border bg-cz-card p-3">
              {isOwn ? (
                <OwnListingActions
                  listing={listing}
                  riderName={riderName}
                  onRemove={onRemove}
                  onUpdatePrice={onUpdatePrice}
                />
              ) : (
                <MarketOfferForm listing={listing} onOffer={onOffer} seasonYear={seasonYear} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Bulk-prisredigering (#2451) ──────────────────────────────────────────────
// Football Manager-inspireret liste-redigering: markér flere EGNE listinger
// (checkboxes i tabellen) og anvend én pris-justering på dem alle i ét klik —
// i stedet for redigér-pris-dialogen pr. rytter (OwnListingActions). Den
// relative justering ("+10% på alle markerede") er dét der gør bulk hurtigere
// end at redigere sekventielt (ejer-direktiv, #2451). Kun synlig når mindst én
// egen listing er markeret — resten af tiden er tabellen uændret.
const BULK_MODES = ["percent", "amount", "set"];
const BULK_PREVIEW_VISIBLE = 5;

function BulkPriceEditor({ selectedListings, onApply, onClear, busy }) {
  const { t } = useTranslation("transfers");
  const [mode, setMode] = useState("percent");
  const [rawValue, setRawValue] = useState("");

  // #3495: parseFloat("150.000", "set") ville have samme faktor-1000-fejl
  // som transferlistens pris-felt — parseAdjustmentValue er mode-bevidst
  // (set/amount = heltals-CZ$ med tusind-normalisering, percent = decimal).
  const parsedValue = parseAdjustmentValue(rawValue, mode);
  const hasValue = rawValue.trim() !== "" && parsedValue.valid;
  const value = parsedValue.valid ? parsedValue.value : null;
  const preview = hasValue
    ? previewBulkPriceAdjust(selectedListings, { mode, value })
    : [];
  const changedCount = preview.filter(p => p.changed).length;
  const showInvalid = rawValue.trim() !== "" && !parsedValue.valid;

  // Rytternavn pr. listing-id til preview-rækkerne (selectedListings bærer
  // rider-objektet, previewBulkPriceAdjust kender kun id/from/to).
  const riderNameById = new Map(
    selectedListings.map(l => [l.id, l.rider ? `${l.rider.firstname} ${l.rider.lastname}` : "—"]),
  );

  return (
    <Section data-testid="bulk-price-editor" borderClass="border-cz-accent/30" className="mb-3 flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <span className="text-cz-1 text-sm font-semibold">
          {t("bulkPrice.selected", { count: selectedListings.length })}
        </span>
        <Button variant="ghost" size="sm" className="self-start sm:self-auto"
          onClick={onClear} disabled={busy}>
          {t("bulkPrice.clear")}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex gap-1 flex-wrap">
          {BULK_MODES.map(m => (
            <Button key={m} variant="secondary" size="sm" disabled={busy}
              onClick={() => setMode(m)}
              className={mode === m ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : ""}>
              {t(`bulkPrice.mode.${m}`)}
            </Button>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <input
            type="text"
            inputMode={mode === "percent" ? "decimal" : "numeric"}
            data-testid="bulk-price-value"
            value={rawValue}
            onChange={e => setRawValue(e.target.value)}
            placeholder={t(`bulkPrice.valuePlaceholder.${mode}`)}
            aria-label={t("bulkPrice.valueLabel")}
            aria-invalid={showInvalid || undefined}
            className={`w-full min-h-[44px] bg-cz-subtle border rounded-cz px-3 py-2
              text-cz-1 font-mono text-sm focus:outline-none
              ${showInvalid ? "border-cz-danger focus:border-cz-danger" : "border-cz-border focus:border-cz-accent"}`}
          />
          {showInvalid && (
            <p className="text-2xs text-cz-danger mt-1">{t("common:amountInput.invalid")}</p>
          )}
          {!showInvalid && hasValue && mode !== "percent" && (
            <p className="text-2xs text-cz-3 mt-1 tabular-nums">
              {t("common:amountInput.parsedPreview", { amount: formatNumber(value) })}
            </p>
          )}
        </div>
      </div>

      {/* Preview: rytter + nuværende pris → ny pris, så justeringen aldrig er en
          overraskelse efter "Anvend". */}
      <div className="bg-cz-subtle rounded-cz p-3">
        <p className="text-cz-3 text-3xs uppercase tracking-wider mb-2">{t("bulkPrice.previewTitle")}</p>
        {preview.length === 0 ? (
          <p className="text-cz-3 text-xs">{t("bulkPrice.previewEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {preview.slice(0, BULK_PREVIEW_VISIBLE).map(p => (
              <li key={p.id} className="flex items-center justify-between text-xs gap-2">
                <span className="text-cz-2 truncate">{riderNameById.get(p.id)}</span>
                <span className="font-mono whitespace-nowrap">
                  <span className="text-cz-3">{formatNumber(p.from)}</span>
                  <span className="text-cz-3 mx-1">→</span>
                  <span className={p.changed ? "text-cz-accent-t font-bold" : "text-cz-3"}>{formatNumber(p.to)}</span>
                  <span className="text-cz-3"> CZ$</span>
                </span>
              </li>
            ))}
            {preview.length > BULK_PREVIEW_VISIBLE && (
              <li className="text-cz-3 text-3xs">{t("bulkPrice.previewMore", { count: preview.length - BULK_PREVIEW_VISIBLE })}</li>
            )}
          </ul>
        )}
      </div>

      <Button
        variant="primary" size="sm" className="w-full sm:w-auto sm:self-end"
        data-testid="bulk-price-apply"
        onClick={() => onApply({ mode, value })}
        disabled={busy || !hasValue || changedCount === 0}>
        {busy ? t("bulkPrice.applying") : t("bulkPrice.apply", { count: changedCount })}
      </Button>
    </Section>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function TransfersPage() {
  const { t } = useTranslation("transfers");
  const { t: tCommon } = useTranslation("common");
  const navigate = useNavigate();
  // #3071: sæson-referenceår til alders-visning/filtre (se riderAge.js).
  const seasonYear = useActiveSeasonYear();
  // #987: aktiv fane lever i URL'en (?tab=) så nav-genvejen "Transferliste"
  // (/transfers?tab=market) og delte links lander på den rigtige fane.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = VALID_TABS.includes(tabParam) ? tabParam : DEFAULT_TAB;
  function setTab(key) {
    setSearchParams(key === DEFAULT_TAB ? {} : { tab: key }, { replace: true });
  }
  // #1569: en ny spiller har ALLE handels-faner tomme (ingen tilbud/swaps/
  // archive), så default-fanen 'received' var en tom blindgyde. Når data er loadet
  // og alle handels-faner er tomme — og manageren ikke selv har deep-linket en
  // fane — defaulter vi ÉN gang til 'market'-fanen, hvor der faktisk er ryttere.
  const didDefaultTabRef = useRef(false);
  const [listings, setListings] = useState([]);
  const [sentOffers, setSentOffers] = useState([]);
  const [receivedOffers, setReceivedOffers] = useState([]);
  const [archivedSentOffers, setArchivedSentOffers] = useState([]);
  const [archivedReceivedOffers, setArchivedReceivedOffers] = useState([]);
  const [sentSwaps, setSentSwaps] = useState([]);
  const [receivedSwaps, setReceivedSwaps] = useState([]);
  const [archivedSentSwaps, setArchivedSentSwaps] = useState([]);
  const [archivedReceivedSwaps, setArchivedReceivedSwaps] = useState([]);
  const [myTeamId, setMyTeamId] = useState(null);
  const [myBalance, setMyBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [celebration, setCelebration] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "success" });
  // #2329: markedstabellens ÉN kanoniske sort-state — delt af header-klik
  // (klik = cycleSortState, samme klik-cyklus som resten af siden via
  // useSortState) OG de gamle knapper/evne-dropdown (klik = præcis
  // sort+retning). Samme { sort, dir } uanset indgang, så de aldrig kan
  // komme i konflikt.
  const [marketSortState, setMarketSortState] = useState({ sort: "listed", dir: "desc" });
  const marketSort = marketSortState.sort;
  const marketSortDir = marketSortState.dir;
  function handleMarketSort(key) {
    setMarketSortState((cur) => cycleSortState(cur, key, MARKET_SORT_DESC_FIRST_KEYS));
  }
  const [expandedListingId, setExpandedListingId] = useState(null); // #1523: åben action-række i market-tabellen

  function toggleExpandedListing(id) {
    setExpandedListingId(prev => (prev === id ? null : id));
  }

  // #2451: bulk-prisredigering — markering af FLERE egne listinger til én samlet
  // pris-justering ("+10% på alle markerede"), i stedet for redigér-pris-dialogen
  // pr. rytter (OwnListingActions). Selection lever på id — filtreres/sorteres
  // listen om, forbliver markeringen intakt (kun rensning ved eksplicit "ryd").
  const [selectedListingIds, setSelectedListingIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  function toggleListingSelection(id) {
    setSelectedListingIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clearListingSelection() {
    setSelectedListingIds(new Set());
  }

  async function loadAll() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // #1792: udløbet/ugyldig session → user=null; stop før user.id (finally rydder loading)
      if (!user) return;
      const { data: team } = await supabase.from("teams").select("id, balance").eq("user_id", user.id).single();
      if (!team) return;
      setMyTeamId(team.id);
      setMyBalance(team.balance);

      const { data: { session } } = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session.access_token}` };

      const [listingsRes, offersRes, swapsRes] = await Promise.all([
        fetch(`${API}/api/transfers`, { headers }).then(r => r.json()),
        fetch(`${API}/api/transfers/my-offers`, { headers }).then(r => r.json()),
        fetch(`${API}/api/transfers/swaps`, { headers }).then(r => r.json()),
      ]);

      // #1529: backend leverer rider.rider_derived_abilities (nested) — flad evnerne op
      // på rytter-objektet så ${key}-opslag i kortene virker som med de gamle stat_*.
      const flatRider = (o) => (o && o.rider ? { ...o, rider: flattenAbilities(o.rider) } : o);
      const flatSwap = (s) => (s ? { ...s, offered: flattenAbilities(s.offered), requested: flattenAbilities(s.requested) } : s);
      setListings(Array.isArray(listingsRes) ? listingsRes.map(flatRider) : []);
      setSentOffers((offersRes.sent || []).map(flatRider));
      setReceivedOffers((offersRes.received || []).map(flatRider));
      setArchivedSentOffers((offersRes.archivedSent || []).map(flatRider));
      setArchivedReceivedOffers((offersRes.archivedReceived || []).map(flatRider));
      setSentSwaps((swapsRes.sent || []).map(flatSwap));
      setReceivedSwaps((swapsRes.received || []).map(flatSwap));
      setArchivedSentSwaps((swapsRes.archivedSent || []).map(flatSwap));
      setArchivedReceivedSwaps((swapsRes.archivedReceived || []).map(flatSwap));
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- loadAll er lokal funktion (ny ref hver render) — kun mount-fetch

  // #1569: én-skuds default-til-'market' når alle handels-faner er tomme.
  // Gates på: data loadet, intet eksplicit ?tab= i URL'en, og alle handels-
  // arrays tomme. Ref'en sikrer at vi kun gør det én gang.
  useEffect(() => {
    if (loading || didDefaultTabRef.current || tabParam) return;
    const allTradeTabsEmpty =
      receivedOffers.length === 0 &&
      sentOffers.length === 0 &&
      archivedReceivedOffers.length === 0 &&
      archivedSentOffers.length === 0 &&
      receivedSwaps.length === 0 &&
      sentSwaps.length === 0 &&
      archivedReceivedSwaps.length === 0 &&
      archivedSentSwaps.length === 0;
    didDefaultTabRef.current = true;
    if (allTradeTabsEmpty) setTab("market");
  }, [loading, tabParam, receivedOffers, sentOffers, archivedReceivedOffers, archivedSentOffers, receivedSwaps, sentSwaps, archivedReceivedSwaps, archivedSentSwaps]); // eslint-disable-line react-hooks/exhaustive-deps -- setTab er en lokal funktion, ikke en useState-setter; effekten er én-skuds via didDefaultTabRef

  async function getHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
  }

  function showMsg(text, type = "success") {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: "" }), 4000);
  }

  async function handleOffer(riderId, amount, message) {
    try {
      const res = await fetch(`${API}/api/transfers/offer`, {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({ rider_id: riderId, offer_amount: amount, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { showMsg(t("toast.offerSent")); loadAll(); setTab("sent"); }
      else showMsg(resolveApiError(data, t), "error");
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    }
  }

  async function handleRemoveListing(listingId) {
    try {
      const res = await fetch(`${API}/api/transfers/${listingId}`, {
        method: "DELETE",
        headers: await getHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showMsg(t("toast.listingRemoved"));
        loadAll();
      } else {
        showMsg(resolveApiError(data, t, t("toast.listingRemoveFailed")), "error");
      }
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    }
  }

  // #1185: inline pris-redigering — før skulle listingen fjernes + genoprettes.
  // Returnerer true ved succes så OwnListingActions kun lukker edit-formen da.
  async function handleUpdateListingPrice(listingId, askingPrice) {
    try {
      const res = await fetch(`${API}/api/transfers/${listingId}`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({ asking_price: askingPrice }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showMsg(t("toast.priceUpdated"));
        loadAll();
        return true;
      }
      showMsg(resolveApiError(data, t, t("toast.priceUpdateFailed")), "error");
      return false;
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
      return false;
    }
  }

  async function handleOfferAction(offerId, action, extra = {}) {
    try {
      const res = await fetch(`${API}/api/transfers/offers/${offerId}`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (action === "confirm" && data.action === "accepted") {
          setCelebration({
            title: t("celebration.transferDone.title"),
            subtitle: t("celebration.transferDone.subtitle"),
            amount: data.price || 0,
            icon: <ExchangeIcon size={56} className="text-cz-accent-t" aria-hidden="true" />,
          });
          fetch(`${API}/api/achievements/check`, {
            method: "POST",
            headers: await getHeaders(),
            body: JSON.stringify({ context: "transfer_done", data: {} }),
          }).catch(() => {});
        } else {
          const msgs = {
            accept:          t("toast.offerAcceptedBuyer"),
            accept_counter:  t("toast.offerAcceptedSeller"),
            confirm:         t("toast.confirmedAwaiting"),
            cancel:          t("toast.dealCancelled"),
            reject:          t("toast.transferRejected"),
            counter:         t("toast.counterSent"),
            new_offer:       t("toast.newOfferSent"),
            withdraw:        t("toast.offerWithdrawn"),
            archive:         t("toast.offerArchived"),
          };
          showMsg(msgs[action] || t("toast.updated"));
        }
        loadAll();
      } else {
        showMsg(resolveApiError(data, t), "error");
      }
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    }
  }

  async function handleSwapAction(swapId, action, extra = {}) {
    try {
      const res = await fetch(`${API}/api/transfers/swaps/${swapId}`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (action === "confirm" && data.action === "accepted") {
          setCelebration({
            title: t("celebration.swapDone.title"),
            subtitle: t("celebration.swapDone.subtitle"),
            amount: 0,
            icon: <ExchangeIcon size={56} className="text-cz-accent-t" aria-hidden="true" />,
          });
        } else {
          const msgs = {
            accept:         t("toast.swapAccepted"),
            accept_counter: t("toast.swapAccepted"),
            confirm:        t("toast.swapConfirmedAwaiting"),
            cancel:         t("toast.swapCancelled"),
            reject:         t("toast.swapRejected"),
            counter:        t("toast.counterSent"),
            withdraw:       t("toast.proposalWithdrawn"),
            archive:        t("toast.swapArchived"),
          };
          showMsg(msgs[action] || t("toast.updated"));
        }
        loadAll();
      } else {
        showMsg(resolveApiError(data, t), "error");
      }
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    }
  }

  // #2358: swap-fanen er væk — pending swap-tilbud tælles nu med i received/sent-
  // fanens badge (samme fane de nu vises i), i stedet for eget "swaps"-badge.
  const pendingReceived = receivedOffers.filter(o =>
    o.status === "pending" || (o.status === "awaiting_confirmation" && !o.seller_confirmed)
  ).length + receivedSwaps.filter(s =>
    s.status === "pending" || (s.status === "awaiting_confirmation" && !s.receiving_confirmed)
  ).length;
  const pendingSent = sentOffers.filter(o =>
    o.status === "countered" || (o.status === "awaiting_confirmation" && !o.buyer_confirmed)
  ).length + sentSwaps.filter(s =>
    s.status === "countered" || (s.status === "awaiting_confirmation" && !s.proposing_confirmed)
  ).length;

  // #3492: arkiv-tælleren dækker BÅDE tilbud og bytteforslag — de deler fane.
  const archivedCount =
    archivedReceivedOffers.length + archivedSentOffers.length +
    archivedReceivedSwaps.length + archivedSentSwaps.length;

  // #58: pr-fane label + badge, delt af mode-båndet og sub-fane-båndet. Nøglerne
  // matcher VALID_TABS; rækkefølgen styres af TAB_MODES.
  const tabMeta = {
    received: { label: t("tabs.received"), badge: pendingReceived },
    sent:     { label: t("tabs.sent"),     badge: pendingSent },
    archive:  { label: t("tabs.archive",  { count: archivedCount }) },
    market:   { label: t("tabs.market",   { count: listings.length }) },
  };
  // #58: aktivt mode udledes af den aktive fane (som stadig lever i ?tab=). Klik på
  // et mode åbner modets FØRSTE fane; er man allerede i modet bevares underfanen.
  const activeMode = TAB_TO_MODE[tab] || TAB_MODES[0].key;
  function selectMode(modeKey) {
    const mode = TAB_MODES.find((m) => m.key === modeKey);
    if (!mode) return;
    if (mode.tabs.includes(tab)) return; // allerede i modet — bevar underfane
    setTab(mode.tabs[0]);
  }
  // Sum af pending-badges pr. mode → tydelig "handling påkrævet"-markør på mode-niveau.
  const modeBadge = Object.fromEntries(
    TAB_MODES.map((m) => [m.key, m.tabs.reduce((sum, k) => sum + (tabMeta[k]?.badge || 0), 0)]),
  );
  // Underfaner vises kun for modes med >1 fane (i praksis "Forhandlinger").
  const activeModeTabs = (TAB_MODES.find((m) => m.key === activeMode)?.tabs) || [];
  const showSubTabs = activeModeTabs.length > 1;

  const riderFilters = useClientRiderFilters(listings.map(l => l.rider).filter(Boolean), seasonYear);
  const filteredIds = new Set(riderFilters.filtered.map(r => r.id));
  // #2522: min/max_asking_price filtrerer på listing.asking_price — IKKE et
  // rytter-felt, så useClientRiderFilters (som kun kender rytter-objektet) kan
  // ikke anvende det. Samme mønster som AuctionsPage.passesAuctionPriceFilter:
  // filtreres her på selve listingen, uden om rytter-filter-hooket.
  function passesAskingPriceFilter(listing) {
    const price = listing.asking_price ?? 0;
    // #3495: parseInt("150.000") → 150 ramte filter-feltet ligesom
    // listepris-felterne — samme normaliserede parser her.
    const minP = parseAmountInput(riderFilters.filters.min_asking_price);
    const maxP = parseAmountInput(riderFilters.filters.max_asking_price);
    if (minP.valid && price < minP.value) return false;
    if (maxP.valid && price > maxP.value) return false;
    return true;
  }
  // #3191: samme mønster som passesAskingPriceFilter ovenfor — %-afvigelsen er
  // et forhold mellem listing.asking_price og rytterens vurdering, ikke et rent
  // rytter-felt, så useClientRiderFilters kan ikke anvende det. Signeret pct
  // (computeValueDeviationPct): negativ = under vurdering, positiv = over.
  // Kan ikke beregnes (fx rytter ikke loadet) → ekskludér FØRST når filteret
  // rent faktisk er sat, i stedet for at inkludere noget vi ikke kan verificere.
  function passesValueDeviationFilter(listing) {
    const minP = parseFloat(riderFilters.filters.min_value_deviation_pct);
    const maxP = parseFloat(riderFilters.filters.max_value_deviation_pct);
    if (isNaN(minP) && isNaN(maxP)) return true;
    const pct = computeValueDeviationPct(listing.asking_price, listing.rider);
    if (pct == null) return false;
    if (!isNaN(minP) && pct < minP) return false;
    if (!isNaN(maxP) && pct > maxP) return false;
    return true;
  }
  // Rytter-filtrene styrer hvilke listings der vises; rækkefølgen styres af den
  // kanoniske markedstabel-sort-state (#2329, se MARKET_SORT_ACCESSORS ovenfor).
  const filteredListings = sortRows(
    listings.filter(l => (!l.rider || filteredIds.has(l.rider.id)) && passesAskingPriceFilter(l) && passesValueDeviationFilter(l)),
    MARKET_SORT_ACCESSORS[marketSort] ?? null,
    marketSortDir,
  );

  // #2451: bulk-kandidater = egne listinger blandt de FILTREREDE/synlige rækker
  // (samme filter/synlighed som tabellen), så "Markér alle viste" aldrig vælger
  // noget der ikke ses i den aktuelle filtrering.
  const myVisibleListings = filteredListings.filter(l => l.seller?.id === myTeamId);
  const selectedListings = filteredListings.filter(l => selectedListingIds.has(l.id));

  function selectAllVisibleMine() {
    setSelectedListingIds(new Set(myVisibleListings.map(l => l.id)));
  }

  // #2451: ét PATCH-kald for hele batchen (bulk-price-endpointet), i stedet for
  // ét kald pr. rytter — undgår at ramme marketWriteLimiter (30/min) ved store
  // markeringer og giver ét samlet svar (updated/failed) til toasten.
  async function handleBulkApply(adjustment) {
    const preview = previewBulkPriceAdjust(selectedListings, adjustment).filter(p => p.changed);
    if (preview.length === 0) {
      showMsg(t("bulkPrice.toastNoChange"), "error");
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch(`${API}/api/transfers/bulk-price`, {
        method: "PATCH",
        headers: await getHeaders(),
        body: JSON.stringify({ updates: preview.map(p => ({ id: p.id, asking_price: p.to })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const updatedCount = data.updated?.length || 0;
        const failedCount = data.failed?.length || 0;
        if (failedCount > 0 && updatedCount > 0) {
          showMsg(t("bulkPrice.toastPartial", { updated: updatedCount, failed: failedCount }), "error");
        } else if (failedCount > 0 && updatedCount === 0) {
          showMsg(t("bulkPrice.toastFailed"), "error");
        } else {
          showMsg(t("bulkPrice.toastSuccess", { count: updatedCount }));
        }
        clearListingSelection();
        loadAll();
      } else {
        showMsg(resolveApiError(data, t, t("bulkPrice.toastFailed")), "error");
      }
    } catch {
      showMsg(t("auth:error.connectionFailed"), "error");
    } finally {
      setBulkBusy(false);
    }
  }

  // #1675: market-fanen viser en bred evne-tabel (15 kolonner) og bruger fuld
  // content-bredde (Layout's WIDE_CONTENT_ROUTES giver /transfers T2's 1600px-
  // cap). De kort-baserede faner (modtaget/sendt/arkiv) begrænser kun deres eget
  // kortindhold til en læsbar kolonne (se max-w-3xl-wrapperne nedenfor) — header/
  // tabs/toast forbliver i den konstante T2-container (#2849 bølge 2).
  return (
    // #2849 bølge 2: T2 wide-data-container (docs/design/PAGE_TEMPLATES.md) —
    // KONSTANT uanset fane (afløser den fane-betingede max-w-full/max-w-4xl-
    // ternary, som fik header/tabs/toast til at skifte bredde ved fane-skift).
    // Kort-fanerne (received/sent/archive) begrænser selv deres indhold til en
    // læsbar kolonne (samme princip som RacesPage's kalender-fane), markeds-
    // fanens tabel bruger den fulde 1600px-cap.
    <div className="max-w-[1600px] mx-auto">
      <ConfettiModal
        show={!!celebration}
        onClose={() => setCelebration(null)}
        title={celebration?.title || ""}
        subtitle={celebration?.subtitle}
        amount={celebration?.amount}
        icon={celebration?.icon}
      />

      {/* #4628 (slice 6 af #4622): balancen stod som et loesrevet stat-kort mellem
          sidehovedet og fanerne — 1 tal i ~90 px chrome foer data (audit 2026-09).
          Den bor nu i sidehovedets meta-linje (samme ét-tals-recipe som Ryttere's
          "463 riders"), saa foerste listing rykker over folden. */}
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitleWithBalance", { balance: formatNumber(myBalance) })}
      />

      {msg.text && (
        <div className={`mb-4 px-4 py-3 rounded-cz text-sm border
          ${msg.type === "error"
            ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
            : "bg-cz-success-bg text-cz-success border-cz-success/30"}`}>
          {msg.text}
        </div>
      )}

      {/* #58: primær navigation = 3 handlingsorienterede modes (Skal handles /
          Forhandlinger / Marked). Modet er den øverste beslutning ("hvad skal jeg
          handle på nu?"); de gamle faner lever videre som underfaner i modet.
          #2849 bølge 2: delt Tabs-mønster (RacesPage) i stedet for håndrullede
          rounded-pill-knapper — badge-tallet bæres videre som Tab-children. */}
      <Tabs value={activeMode} onChange={selectMode} className="mb-3">
        <TabList label={t("page.title")}>
          {TAB_MODES.map(m => (
            <Tab key={m.key} value={m.key}>
              {t(`modes.${m.key}`)}
              {modeBadge[m.key] > 0 && (
                <span className="ms-2 bg-cz-accent text-cz-on-accent text-3xs font-black px-1.5 py-0.5 rounded-full">
                  {modeBadge[m.key]}
                </span>
              )}
            </Tab>
          ))}
        </TabList>
      </Tabs>

      {/* #58: sekundært underfane-bånd — kun for modes med flere faner (Forhandlinger).
          "Skal handles" og "Marked" har hver kun én fane, så de skjuler dette bånd. */}
      {showSubTabs && (
        <Tabs value={tab} onChange={setTab} className="mb-5">
          <TabList label={t(`modes.${activeMode}`)}>
            {activeModeTabs.map(key => {
              const meta = tabMeta[key];
              return (
                <Tab key={key} value={key}>
                  {meta.label}
                  {meta.badge > 0 && (
                    <span className="ms-2 bg-cz-accent text-cz-on-accent text-3xs font-black px-1.5 py-0.5 rounded-full">
                      {meta.badge}
                    </span>
                  )}
                </Tab>
              );
            })}
          </TabList>
        </Tabs>
      )}

      {loading ? (
        <PageLoader />
      ) : (
        <div>
          {tab === "received" && (
            // #2849 bølge 2: kort-baserede faner beholder en læsbar kolonne (T1-
            // bredde) INDE i den konstante T2-container — bredden er nu FAST
            // (ikke betinget af hvilken fane der er aktiv), så header/tabs/toast
            // ikke længere skifter bredde ved fane-skift.
            <div className="flex flex-col gap-3 max-w-3xl">
              {receivedOffers.length === 0 && receivedSwaps.length === 0 ? (
                <Section>
                  {/* #4628 (TASTE fork 4): titlen er en handling, ikke en beskrivelse
                      af hvad der mangler, og der er én knap der foerer derhen. */}
                  <EmptyState
                    icon={<ExchangeIcon size={26} aria-hidden="true" />}
                    title={t("empty.received")}
                    description={t("empty.receivedHint")}
                    action={
                      <Button variant="secondary" size="sm" onClick={() => selectMode("market")}>
                        {t("empty.ctaBrowseMarket")}
                      </Button>
                    }
                  />
                </Section>
              ) : (
                receivedOffers.map(o => (
                  <ReceivedOfferCard key={o.id} offer={o} onAction={handleOfferAction} />
                ))
              )}
              {/* #2358: swap-fanen er fjernet — modtagne bytteforslag vises her, så de
                  fortsat kan ses/besvares (nye forslag foreslås fra rytterprofilen). */}
              {receivedSwaps.length > 0 && (
                <div>
                  <p className="text-cz-3 text-xs uppercase tracking-wider mb-2 mt-2">{t("sections.receivedProposals")}</p>
                  <div className="flex flex-col gap-3">
                    {receivedSwaps.map(s => (
                      <SwapCard key={s.id} swap={s} myTeamId={myTeamId} onAction={handleSwapAction} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "sent" && (
            <div className="flex flex-col gap-3 max-w-3xl">
              {sentOffers.length === 0 && sentSwaps.length === 0 ? (
                <Section>
                  <EmptyState
                    icon={<ExchangeIcon size={26} aria-hidden="true" />}
                    title={t("empty.sent")}
                    description={t("empty.sentHint")}
                    action={
                      <Button variant="secondary" size="sm" onClick={() => selectMode("market")}>
                        {t("empty.ctaBrowseMarket")}
                      </Button>
                    }
                  />
                </Section>
              ) : (
                sentOffers.map(o => (
                  <SentOfferCard key={o.id} offer={o} onAction={handleOfferAction} />
                ))
              )}
              {/* #2358: sendte bytteforslag (proposeret fra rytterprofilen) vises her. */}
              {sentSwaps.length > 0 && (
                <div>
                  <p className="text-cz-3 text-xs uppercase tracking-wider mb-2 mt-2">{t("sections.sentProposals")}</p>
                  <div className="flex flex-col gap-3">
                    {sentSwaps.map(s => (
                      <SwapCard key={s.id} swap={s} myTeamId={myTeamId} onAction={handleSwapAction} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "archive" && (
            <div className="flex flex-col gap-4 max-w-3xl">
              {archivedCount === 0 ? (
                <Section>
                  <EmptyState
                    icon={<InboxIcon size={26} aria-hidden="true" />}
                    title={t("empty.archive")}
                    description={t("empty.archiveHint")}
                    action={
                      <Button variant="secondary" size="sm" onClick={() => setTab("sent")}>
                        {t("empty.ctaSeeSent")}
                      </Button>
                    }
                  />
                </Section>
              ) : (
                <>
                  {archivedReceivedOffers.length > 0 && (
                    <div>
                      <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("sections.archivedReceived")}</p>
                      <div className="flex flex-col gap-3">
                        {archivedReceivedOffers.map(o => (
                          <ReceivedOfferCard key={o.id} offer={o} onAction={handleOfferAction} showArchive={false} />
                        ))}
                      </div>
                    </div>
                  )}
                  {archivedSentOffers.length > 0 && (
                    <div>
                      <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("sections.archivedSent")}</p>
                      <div className="flex flex-col gap-3">
                        {archivedSentOffers.map(o => (
                          <SentOfferCard key={o.id} offer={o} onAction={handleOfferAction} showArchive={false} />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* #3492: arkiverede bytteforslag bor i samme fane som de
                      arkiverede tilbud — de vises også sammen i received/sent. */}
                  {archivedReceivedSwaps.length > 0 && (
                    <div>
                      <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("sections.archivedReceivedProposals")}</p>
                      <div className="flex flex-col gap-3">
                        {archivedReceivedSwaps.map(s => (
                          <SwapCard key={s.id} swap={s} myTeamId={myTeamId} onAction={handleSwapAction} showArchive={false} />
                        ))}
                      </div>
                    </div>
                  )}
                  {archivedSentSwaps.length > 0 && (
                    <div>
                      <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">{t("sections.archivedSentProposals")}</p>
                      <div className="flex flex-col gap-3">
                        {archivedSentSwaps.map(s => (
                          <SwapCard key={s.id} swap={s} myTeamId={myTeamId} onAction={handleSwapAction} showArchive={false} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "market" && (
            <div>
              {/* #4628: introteksten ("Transfermarkedet er hvor managers…") er
                  flyttet til Hjaelp (help.json, "What is the transfer system?" +
                  "Sell via the transfer list"), hvor manualen hoerer hjemme —
                  TASTE P9 "kort paa fladen, manualer i Hjaelp". */}
              {/* #2849 bølge 2: den ekstra max-w-[1600px]-wrapper er fjernet — siden
                  er allerede capped på 1600px (T2-containeren), så en indre kopi af
                  samme bredde var et no-op (den flagede "redundante indre max-w"). */}
              <RiderFilters
                layout="bar"
                filters={riderFilters.filters}
                onChange={riderFilters.onChange}
                onReset={riderFilters.onReset}
                showTeamFilter={false}
                showAskingPriceFilter={true}
                showValueDeviationFilter={true}
                nationalities={riderFilters.nationalities}
              />
              {/* #4628: de otte sorterings-chips + evne-dropdownen er vaek. Tabellen
                  har allerede sorterbare kolonneoverskrifter (SortableTh) paa
                  nøjagtig de samme nøgler, så fladen havde TO sorterings-idiomer
                  for én state (audit 2026-09, hovedfund paa /transfers). Desktop
                  sorterer nu KUN via headerne; paa mobil er de fleste headers
                  skjult, saa MarketSortControl (sm:hidden) eksponerer de samme
                  nøgler — samme moenster som RidersPage's MobileSortControl (#9). */}
              <MarketSortControl
                sort={marketSort}
                sortDir={marketSortDir}
                onSort={handleMarketSort}
                statCols={LISTING_STATS}
                t={t}
              />
              {/* #2451: bulk-prisredigering — "Markér alle" er kun synlig når manageren
                  faktisk har egne listinger blandt de viste, og selve editoren kun når
                  noget er markeret. Ellers uændret tabel. */}
              {selectedListingIds.size === 0 && myVisibleListings.length > 0 && (
                <Button variant="secondary" size="sm" className="mb-3" onClick={selectAllVisibleMine}>
                  {t("bulkPrice.selectAllVisible", { count: myVisibleListings.length })}
                </Button>
              )}
              {selectedListingIds.size > 0 && (
                <BulkPriceEditor
                  selectedListings={selectedListings}
                  onApply={handleBulkApply}
                  onClear={clearListingSelection}
                  busy={bulkBusy}
                />
              )}
              {filteredListings.length === 0 ? (
                <Section>
                  {/* #4628: to forskellige tomme tilstande, to forskellige veje
                      videre — et tomt marked loeses ved selv at saette en rytter til
                      salg, et tomt filter ved at nulstille det. */}
                  {listings.length === 0 ? (
                    <EmptyState
                      icon={<BikeIcon size={26} aria-hidden="true" />}
                      title={t("empty.marketNoListings")}
                      description={t("empty.marketNoListingsHint")}
                      action={
                        <Button variant="secondary" size="sm" onClick={() => navigate("/team")}>
                          {t("empty.ctaListRider")}
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={<ExchangeIcon size={26} aria-hidden="true" />}
                      title={t("empty.marketNoMatches")}
                      description={t("empty.marketNoMatchesHint")}
                      action={
                        <Button variant="secondary" size="sm" onClick={riderFilters.onReset}>
                          {tCommon("controls.clearFilters")}
                        </Button>
                      }
                    />
                  )}
                </Section>
              ) : (
                /* #1523: rækkelayout på linje med ryttersiden (RidersPage) — bedre
                   overblik + samme evne-kolonner. Sticky navn-kolonne + vandret
                   scroll til evnerne; pris/status/bud i en expander-række.
                   #2849 bølge 2: konverteres IKKE til <DataTable> — bulk-select-
                   checkbokse i sticky-cellen + en expander-handlingsrække pr.
                   listing ligger uden for DataTable's API (samme begrundelse som
                   AuctionsPage's sticky bud-kolonne i bølge 1). Wrap-chromet deles
                   via dataTableStyles' WRAP (samme konstant som AuctionsPage bruger
                   for sin håndrullede tabel); header-typografien deler MARKET_TH_BASE
                   med cz-table-recipen. */
                <div className={WRAP}>
                  <div className="overflow-auto max-h-[calc(100vh-260px)]">
                    <table data-sortable className="w-full text-xs">
                      <thead className="sticky top-0 z-table-head bg-cz-card">
                        <tr className="border-b border-cz-border">
                          {/* Nation-kolonnen er bevidst ikke sorterbar (rent visuelt flag, ingen
                              entydig "bedste" nation) — resten af kolonnerne er via SortableTh. */}
                          <th className={`px-2 py-3 text-left text-cz-3 w-12 hidden sm:table-cell ${MARKET_TH_BASE}`}>{t("marketRow.nation")}</th>
                          <SortableTh sortKey="rider" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className={`px-3 py-3 text-left w-40 sticky left-0 z-table-head bg-cz-card border-r border-cz-border ${MARKET_TH_BASE}`}>
                            {t("marketRow.rider")}
                          </SortableTh>
                          <SortableTh sortKey="seller" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className={`px-3 py-3 text-left hidden sm:table-cell ${MARKET_TH_BASE}`}>
                            {t("marketRow.seller")}
                          </SortableTh>
                          <SortableTh sortKey="age" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className={`px-2 py-3 text-center w-12 hidden md:table-cell ${MARKET_TH_BASE}`}>
                            {t("marketRow.age")}
                          </SortableTh>
                          <SortableTh sortKey="listed" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className={`px-3 py-3 text-left hidden md:table-cell ${MARKET_TH_BASE}`}>
                            {t("marketRow.listed")}
                          </SortableTh>
                          <SortableTh sortKey="value" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className={`px-3 py-3 text-right w-20 ${MARKET_TH_BASE}`}>
                            {t("marketRow.value")}
                          </SortableTh>
                          <SortableTh sortKey="salary" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className={`px-3 py-3 text-right w-20 hidden sm:table-cell ${MARKET_TH_BASE}`}>
                            {t("marketRow.salary")}
                          </SortableTh>
                          <SortableTh sortKey="price" sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                            className={`px-3 py-3 text-right w-32 ${MARKET_TH_BASE}`}>
                            {t("marketRow.price")}
                          </SortableTh>
                          {LISTING_STATS.map(({ key, label }) => (
                            <SortableTh key={key} sortKey={key} sort={marketSort} sortDir={marketSortDir} onSort={handleMarketSort}
                              className={`px-1.5 py-3 text-center w-14 ${MARKET_TH_BASE}`}>
                              {label}
                            </SortableTh>
                          ))}
                          <th className={`px-3 py-3 text-right text-cz-3 w-28 ${MARKET_TH_BASE}`}>{t("marketRow.action")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredListings.map(l => (
                          <MarketRow
                            key={l.id}
                            listing={l}
                            myTeamId={myTeamId}
                            statCols={LISTING_STATS}
                            expanded={expandedListingId === l.id}
                            onToggleExpand={toggleExpandedListing}
                            onOffer={(riderId, amt, msg) => handleOffer(riderId, amt, msg)}
                            onRemove={handleRemoveListing}
                            onUpdatePrice={handleUpdateListingPrice}
                            seasonYear={seasonYear}
                            selected={selectedListingIds.has(l.id)}
                            onToggleSelect={toggleListingSelection}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {/* #2849 T2-kontrakt: count-linje under markeds-tabellen (docs/design/PAGE_TEMPLATES.md). */}
              {filteredListings.length > 0 && (
                <p className="mt-2 text-cz-3 text-xs font-data">
                  {t("marketRow.countLine", { shown: filteredListings.length, total: listings.length })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
