// #3401 · Post-hammerslag-reveal af budkrigen. Kun for AFSLUTTEDE auktioner
// (kaldes udelukkende fra AuctionHistoryPage, som kun lister status="completed").
//
// Fair-play-grænse (regelændring ejer-godkendt 5/8): viser KUN REALISEREDE bud
// (auction_bids — team_id, amount, bid_time), aldrig proxy-lofter eller aktive
// strategier (auction_proxy_bids). Denne komponent modtager kun den allerede-
// hentede bid-liste som prop og forespørger ALDRIG selv auction_proxy_bids.
import { useTranslation } from "react-i18next";
import Modal from "./ui/Modal.jsx";
import TeamLink from "./TeamLink";
import { formatNumber, formatDateTime } from "../lib/intl";
import { GavelIcon, TrophyIcon } from "./ui/icons/index.jsx";
import { EmptyState, SkeletonLines } from "./ui";
import { sortBidsChronologically, isWinningBid } from "../lib/auctionBidWar.js";

export default function AuctionBidWarModal({ open, onClose, riderName, finalPrice, winnerId, bids, loading }) {
  const { t } = useTranslation(["auctions", "common"]);
  const ordered = sortBidsChronologically(bids);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={t("auctions:bidWar.title", { rider: riderName || t("auctions:fallback.rider") })}
      description={t("auctions:bidWar.subtitle", { price: formatNumber(finalPrice ?? 0) })}
      closeLabel={t("common:actions.close")}
      ariaLabelledby="auction-bid-war-title"
    >
      {loading ? (
        <SkeletonLines lines={4} />
      ) : ordered.length === 0 ? (
        <EmptyState icon={<GavelIcon size={24} aria-hidden="true" />} title={t("auctions:bidWar.empty")} />
      ) : (
        <ol className="space-y-1.5">
          {ordered.map((bid, i) => {
            const isWinning = isWinningBid({ bid, index: i, orderedBids: ordered, winnerId });
            return (
              <li
                key={bid.id}
                className={`flex items-center justify-between gap-3 rounded-cz border px-3 py-2 ${
                  isWinning
                    ? "border-cz-success/40 bg-cz-success-bg"
                    : "border-cz-border bg-cz-subtle"
                }`}
              >
                <div className="min-w-0 flex items-center gap-2">
                  {isWinning && (
                    <TrophyIcon
                      size={15}
                      className="flex-shrink-0 text-cz-success"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0">
                    <TeamLink id={bid.team_id} stopPropagation className="text-cz-1 font-medium truncate block hover:text-cz-accent-t transition-colors">
                      {bid.team_name || t("auctions:fallback.team")}
                    </TeamLink>
                    <p className="text-cz-3 text-3xs mt-0.5">
                      {isWinning && (
                        <span className="text-cz-success font-medium">{t("auctions:bidWar.winningBid")} · </span>
                      )}
                      {formatDateTime(bid.bid_time)}
                    </p>
                  </div>
                </div>
                <span
                  className={`font-mono text-sm whitespace-nowrap ${
                    isWinning ? "text-cz-success font-bold" : "text-cz-2"
                  }`}
                >
                  {formatNumber(bid.amount)} CZ$
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-4 text-3xs text-cz-3">{t("auctions:bidWar.fairPlayNote")}</p>
    </Modal>
  );
}
