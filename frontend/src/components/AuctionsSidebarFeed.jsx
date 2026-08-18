// #196: Live bud-feed for auktioner manageren deltager i (manuel bid eller proxy).
// Mobile (#258): rendres nederst under auktion-listen som en almindelig sektion;
// desktop beholder 280px-sidebar via parent-grid layout.
// i18n: Fase 3b — Refs #412.

import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { EmptyState, InboxIcon } from "./ui";

// #3401: teamNamesById er en best-effort snapshot af AuctionsPage's egen
// teamNameCacheRef (ingen ekstra fetch herfra). Bruges KUN til at berige et
// event hvis event's auktion IKKE længere findes i auctionsById — det sker
// netop når auktionen er lukket (completed auctions fjernes fra listen ved
// realtime-update, se AuctionsPage). Mens auktionen stadig kører, matcher
// auctionsById[e.auction_id], og labelen forbliver ubetinget anonym — samme
// proxy-beskyttelse som før, ingen ændring af den logik.
export default function AuctionsSidebarFeed({ events, auctionsById, myTeamId, now, teamNamesById = {} }) {
  const { t } = useTranslation("auctions");
  const visible = events.slice(-30).reverse();

  function formatRelativeTime(ts) {
    const diff = Math.max(0, Math.floor((now - ts) / 1000));
    if (diff < 60) return t("feed.relativeSec", { n: diff });
    const m = Math.floor(diff / 60);
    if (m < 60) return t("feed.relativeMin", { n: m });
    const h = Math.floor(m / 60);
    return t("feed.relativeHour", { n: h });
  }

  return (
    <aside
      data-testid="auctions-sidebar-feed"
      className="flex flex-col bg-cz-card border border-cz-border rounded-cz overflow-hidden mt-4 md:mt-0"
    >
      <div className="px-4 py-3 border-b border-cz-border bg-cz-subtle">
        <h3 className="text-2xs uppercase tracking-widest text-cz-3 font-medium">
          {t("feed.title")}
        </h3>
      </div>
      <div className="overflow-auto max-h-[60vh] md:max-h-[calc(100vh-260px)]">
        {visible.length === 0 ? (
          <EmptyState
            icon={<InboxIcon size={20} aria-hidden="true" />}
            title={t("feed.empty")}
            className="border-0 bg-transparent px-4 py-6"
          />
        ) : (
          <ul className="divide-y divide-cz-border">
            {visible.map(e => {
              const auction = auctionsById[e.auction_id];
              const r = auction?.rider;
              const riderName = r ? `${r.firstname} ${r.lastname}` : t("feed.fallbackRider");
              const isMine = e.team_id === myTeamId;
              // #3401: auktionen findes ikke længere i den aktive liste → den er
              // lukket (post-hammerslag). Reveal ALDRIG mens auktionen kører.
              const isClosed = !auction;
              const counterName = !isMine && isClosed ? teamNamesById[e.team_id] : null;
              return (
                <li key={e.id || `${e.auction_id}-${e.ts}`} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-cz-1 text-xs font-medium truncate">{riderName}</p>
                      <p className="text-cz-3 text-3xs mt-0.5">
                        {isMine
                          ? t("feed.yourBid")
                          : counterName
                            ? t("feed.counterBidNamed", { name: counterName })
                            : t("feed.counterBid")}
                        {" · "}
                        {formatRelativeTime(e.ts)}
                      </p>
                    </div>
                    <span className={`font-mono text-xs whitespace-nowrap ${isMine ? "text-cz-accent-t" : "text-cz-1"}`}>
                      {formatNumber(e.amount || 0)} CZ$
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
