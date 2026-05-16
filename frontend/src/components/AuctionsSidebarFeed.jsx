// #196: Live bud-feed for auktioner manageren deltager i (manuel bid eller proxy).
// Mobile (#258): rendres nederst under auktion-listen som en almindelig sektion;
// desktop beholder 280px-sidebar via parent-grid layout.

function formatRelativeTime(ts, now) {
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 60) return `${diff}s siden`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m siden`;
  const h = Math.floor(m / 60);
  return `${h}t siden`;
}

export default function AuctionsSidebarFeed({ events, auctionsById, myTeamId, now }) {
  const visible = events.slice(-30).reverse();

  return (
    <aside
      data-testid="auctions-sidebar-feed"
      className="flex flex-col bg-cz-card border border-cz-border rounded-xl overflow-hidden mt-4 md:mt-0"
    >
      <div className="px-4 py-3 border-b border-cz-border bg-cz-subtle">
        <h3 className="text-[11px] uppercase tracking-widest text-cz-3 font-medium">
          Live bud · dine auktioner
        </h3>
      </div>
      <div className="overflow-auto max-h-[60vh] md:max-h-[calc(100vh-260px)]">
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-cz-3 text-xs text-center">
            Ingen aktivitet endnu på dine auktioner.
          </p>
        ) : (
          <ul className="divide-y divide-cz-border">
            {visible.map(e => {
              const auction = auctionsById[e.auction_id];
              const r = auction?.rider;
              const riderName = r ? `${r.firstname} ${r.lastname}` : "Rytter";
              const isMine = e.team_id === myTeamId;
              return (
                <li key={e.id || `${e.auction_id}-${e.ts}`} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-cz-1 text-xs font-medium truncate">{riderName}</p>
                      <p className="text-cz-3 text-[10px] mt-0.5">
                        {isMine ? "Du bød" : "Modbud"}
                        {" · "}
                        {formatRelativeTime(e.ts, now)}
                      </p>
                    </div>
                    <span className={`font-mono text-xs whitespace-nowrap ${isMine ? "text-cz-accent-t" : "text-cz-1"}`}>
                      {(e.amount || 0).toLocaleString("da-DK")} CZ$
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
