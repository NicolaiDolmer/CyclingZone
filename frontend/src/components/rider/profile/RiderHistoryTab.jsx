// RiderHistoryTab — Historik-fanen (#2000): kompakt tabel over rytterens
// offentlige handelshistorik: Dato | Type-chip | Begivenhed | Beløb.
//
// Datalag: buildRiderHistory-events (auction/transfer/swap/loan — allerede
// hentet af siden via loadHistory) + auktionsbud fra bid-timelinen (seneste
// auktion). Række-normalisering + sortering i lib/riderHistoryTable.js.
// Afviste/pending forhandlinger er private og findes bevidst ikke i laget.
//
// Token-only. Grid-kolonner spejler handoff-prototypen (84/88/1fr/116 desktop,
// smallere på mobil); type-chippens farve følger prototypens histType-map
// (auktion/transfer = accent, bud/bytte = info, leje = neutral).

import { useTranslation } from "react-i18next";
import { buildHistoryRows, historyRowAmount } from "../../../lib/riderHistoryTable.js";
import { formatDate, formatNumber } from "../../../lib/intl.js";
import TeamLink from "../../TeamLink";

const GRID = "grid grid-cols-[58px_64px_minmax(0,1fr)_78px] sm:grid-cols-[84px_88px_minmax(0,1fr)_116px] gap-2.5 px-4 items-center";

const CHIP_TONE = {
  auction: "text-cz-accent-t",
  auction_no_sale: "text-cz-3",
  bid: "text-cz-info",
  transfer: "text-cz-accent-t",
  swap: "text-cz-info",
  loan: "text-cz-2",
};

function chipLabel(kind, row, t) {
  switch (kind) {
    case "auction":
    case "auction_no_sale":
      return row.is_ai_sale ? t("history.auction.labelAi")
        : row.is_guaranteed_sale ? t("history.auction.labelGuaranteed")
        : t("history.auction.labelDefault");
    case "bid": return t("profile.history.chipBid");
    case "transfer": return t("history.transfer.label");
    case "swap": return t("history.swap.label");
    case "loan": return t("history.loan.label");
    default: return kind;
  }
}

const AMOUNT_TONE = {
  auction: "text-cz-accent-t",
  bid: "text-cz-2",
  transfer: "text-cz-1",
  swap: "text-cz-2",
  loan: "text-cz-2",
};

// Begivenheds-cellen — genbruger de eksisterende history.*-sætningsfragmenter
// så EN/DA-copy er identisk med den gamle liste (ingen ny tone at reviewe).
function EventCell({ row, t }) {
  const link = (team, fallback) => (
    <TeamLink id={team?.id} className="font-medium text-cz-1 hover:text-cz-accent-t transition-colors">
      {team?.name || fallback}
    </TeamLink>
  );
  switch (row.kind) {
    case "auction":
      return (
        <>
          {link(row.buyer, t("history.auction.buyerFallback"))}
          <span className="text-cz-3"> {t("history.auction.wonBy")} </span>
          {link(row.seller, row.is_ai_sale ? t("history.auction.sellerFallbackAi") : t("history.auction.sellerFallback"))}
        </>
      );
    case "auction_no_sale":
      return (
        <>
          {link(row.seller, t("history.auction.sellerFallback"))}
          <span className="text-cz-3"> {t("history.auction.noSaleBody")}</span>
        </>
      );
    case "bid":
      return (
        <>
          {link({ id: row.team_id, name: row.team_name }, t("bids.row.teamFallback"))}
          <span className="text-cz-3"> {t("profile.history.bidBy")}</span>
          {row.is_proxy && <span className="text-cz-3 text-[10px]"> · {t("bids.row.autoBidTag")}</span>}
        </>
      );
    case "transfer":
      return (
        <>
          {link(row.buyer, t("history.transfer.buyerFallback"))}
          <span className="text-cz-3"> {t("history.transfer.buys")} </span>
          {link(row.seller, t("history.transfer.sellerFallback"))}
        </>
      );
    case "swap":
      return (
        <>
          {link(row.proposing_team, t("history.swap.teamFallback"))}
          <span className="text-cz-3"> ⇄ </span>
          {link(row.receiving_team, t("history.swap.teamFallback"))}
        </>
      );
    case "loan": {
      const status = row.status ? t(`history.loan.status.${row.status}`, { defaultValue: row.status }) : null;
      return (
        <>
          {link(row.to_team, t("history.loan.toFallback"))}
          <span className="text-cz-3"> {t("history.loan.borrows")} </span>
          {link(row.from_team, t("history.loan.fromFallback"))}
          <span className="text-cz-3 text-[11px]"> · {t("history.loan.seasonRange", { start: row.start_season, end: row.end_season })}{status ? ` · ${status}` : ""}</span>
        </>
      );
    }
    default:
      return null;
  }
}

export default function RiderHistoryTab({ events, bidTimeline }) {
  const { t } = useTranslation("rider");

  // null = fetch undervejs (samme loading-gate som Udvikling-fanen).
  // role="status" gør aria-label gyldig (div uden role er generic, hvor
  // aria-label er prohibited) og annoncerer load-tilstanden for skærmlæsere.
  if (events == null) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5 flex items-center justify-center py-10">
        <div role="status" className="w-5 h-5 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" aria-label={t("profile.history.loading")} />
      </div>
    );
  }

  // Fetch-fejl må ikke ligne "ingen handelshistorik" (#1338-princippet).
  if (events?.error) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <p className="text-cz-3 text-center py-8">{t("profile.history.loadError")}</p>
      </div>
    );
  }

  const rows = buildHistoryRows({ events, bidTimeline });
  if (rows.length === 0) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <p className="text-cz-3 text-center py-8">{t("history.empty")}</p>
      </div>
    );
  }

  const th = "font-mono text-[9px] font-semibold uppercase tracking-[0.05em] text-cz-3";
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      <div className={`${GRID} py-2 border-b border-cz-border`}>
        <span className={th}>{t("profile.history.table.date")}</span>
        <span className={th}>{t("profile.history.table.type")}</span>
        <span className={th}>{t("profile.history.table.event")}</span>
        <span className={`${th} text-right`}>{t("profile.history.table.amount")}</span>
      </div>
      {rows.map((row, i) => {
        const amount = historyRowAmount(row);
        return (
          <div key={`${row.kind}-${row.date}-${i}`} className={`${GRID} py-2.5 ${i > 0 ? "border-t border-cz-border" : ""}`}>
            <span className="font-mono tabular-nums text-[11px] text-cz-3 whitespace-nowrap">
              {row.date ? formatDate(row.date, null, { day: "2-digit", month: "2-digit", year: "2-digit" }) : t("history.fallbackDash")}
            </span>
            <span className={`inline-flex justify-self-start font-mono text-[9px] font-bold uppercase tracking-[0.04em] px-1.5 py-[2px] rounded bg-cz-subtle border border-cz-border whitespace-nowrap ${CHIP_TONE[row.kind] ?? "text-cz-2"}`}>
              {chipLabel(row.kind, row, t)}
            </span>
            <span className="text-[12.5px] leading-snug min-w-0 truncate">
              <EventCell row={row} t={t} />
            </span>
            <span className={`font-mono tabular-nums text-xs font-semibold text-right whitespace-nowrap ${amount == null ? "text-cz-3" : AMOUNT_TONE[row.kind] ?? "text-cz-2"}`}>
              {amount == null
                ? t("history.fallbackDash")
                : `${row.kind === "swap" && amount > 0 ? "+" : ""}${formatNumber(amount)} CZ$`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
