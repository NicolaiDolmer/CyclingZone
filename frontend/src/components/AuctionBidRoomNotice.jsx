// #2701/#3066: delt UI-mirror af backends bud-plads-gate (getAuctionBidRoomBlock
// i backend/lib/auctionRules.js). Udtrukket fra AuctionsPage så samme forklaring
// (og samme auctions:bidGate.*-tekst) vises uanset hvilket flow spilleren byder
// fra — AuctionsPage-tabellen/kortet OG rytterprofilens bud-panel (#3066: kun
// AuctionsPage havde denne spærre; profilen lod bud der er GARANTERET afvist
// af serveren sendes uden forklaring).
export function BidRoomBlockNotice({ reason, t }) {
  return (
    <div className="text-2xs text-cz-warning bg-cz-warning-bg rounded-cz px-2 py-1 leading-snug">
      {t(reason === "both_full" ? "auctions:bidGate.bothFull" : "auctions:bidGate.seniorFull")}
    </div>
  );
}

// #2701: hint på ungdomsauktioner om hvor rytteren lander (senior-først).
export function BidDestinationHint({ destination, t }) {
  return (
    <span className="text-3xs text-cz-accent-t whitespace-nowrap">
      {t(destination === "academy" ? "auctions:bidGate.toAcademy" : "auctions:bidGate.toSenior")}
    </span>
  );
}
