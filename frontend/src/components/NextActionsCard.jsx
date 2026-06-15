import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, ExchangeIcon, ClockIcon, TagIcon, CheckIcon } from "./ui";

/**
 * "Næste træk" — prioriteret liste over hvad der venter på manageren, samlet
 * øverst på Dashboard (#271 Slice B). Besvarer "hvor skal jeg handle nu?" ét sted.
 *
 * Pending beslutninger kommer fra den kanoniske `useActionSummary`-hook (samme
 * tal som Indbakke "Skal handles"). Tids-pres-auktioner (<1t, hvor jeg deltager)
 * udledes af kalderen og sendes ind, da auktioner bevidst ikke er en del af
 * action-summary'en (se inboxPending.js / useActionSummary.js).
 *
 * Økonomisk risiko og Deadline Day har egne dedikerede bannere på Dashboard og
 * gentages bevidst ikke her.
 *
 * @param {{ counts: { transfer_offers: number, swap_offers: number, loan_offers: number, total: number } }} pending
 * @param {number} urgentAuctionCount
 * @param {boolean} loading
 */
export default function NextActionsCard({ pending, urgentAuctionCount = 0, loading = false }) {
  const { t } = useTranslation("dashboard");
  const counts = pending?.counts || { transfer_offers: 0, swap_offers: 0, loan_offers: 0, total: 0 };

  const items = [];
  if (counts.transfer_offers > 0)
    items.push({ key: "transfers", Icon: ExchangeIcon, label: t("nextActions.transferOffers", { count: counts.transfer_offers }), to: "/transfers" });
  if (counts.swap_offers > 0)
    items.push({ key: "swaps", Icon: ExchangeIcon, label: t("nextActions.swapOffers", { count: counts.swap_offers }), to: "/transfers" });
  if (counts.loan_offers > 0)
    items.push({ key: "loans", Icon: ClockIcon, label: t("nextActions.loanRequests", { count: counts.loan_offers }), to: "/transfers" });
  if (urgentAuctionCount > 0)
    items.push({ key: "auctions", Icon: TagIcon, label: t("nextActions.urgentAuctions", { count: urgentAuctionCount }), to: "/auctions" });

  return (
    <Card className="mb-4 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-cz-1 text-sm">{t("nextActions.title")}</h2>
        {items.length > 0 && (
          <span className="text-[10px] font-mono bg-cz-accent/15 text-cz-accent-t rounded-full px-2 py-0.5 leading-5">
            {items.length}
          </span>
        )}
      </div>

      {loading && items.length === 0 ? (
        <p className="text-cz-3 text-sm">{t("nextActions.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-cz-3 text-sm flex items-center gap-2">
          <CheckIcon size={14} className="text-cz-success" />
          {t("nextActions.allClear")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map(item => (
            <li key={item.key}>
              <Link
                to={item.to}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-cz-subtle border border-cz-border
                  hover:bg-cz-accent/10 hover:border-cz-accent/30 transition-colors group">
                <item.Icon size={16} className="flex-shrink-0 text-cz-2" />
                <span className="text-cz-1 text-sm flex-1">{item.label}</span>
                <span className="text-cz-3 group-hover:text-cz-accent-t transition-colors flex-shrink-0">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
