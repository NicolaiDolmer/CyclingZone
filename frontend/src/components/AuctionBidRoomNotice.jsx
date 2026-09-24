// #2701/#3066: delt UI-mirror af backends bud-plads-gate (getAuctionBidRoomBlock
// i backend/lib/auctionRules.js). Udtrukket fra AuctionsPage så samme forklaring
// (og samme auctions:bidGate.*-tekst) vises uanset hvilket flow spilleren byder
// fra — AuctionsPage-tabellen/kortet OG rytterprofilens bud-panel (#3066: kun
// AuctionsPage havde denne spærre; profilen lod bud der er GARANTERET afvist
// af serveren sendes uden forklaring).
//
// #5568: akademi-delen nævner den ungdomstrup rytteren lander i (U23 eller
// junior) og DENS loft, i stedet for et fladt akademital. `squad`/`max` kommer
// fra computeBidRoom (auctionBidRoom.js); mangler de, bruges den generiske tekst.

const BOTH_FULL_KEY = { u23: "auctions:bidGate.bothFullU23", junior: "auctions:bidGate.bothFullJunior" };
const TO_SQUAD_KEY = { u23: "auctions:bidGate.toU23", junior: "auctions:bidGate.toJunior" };

export function BidRoomBlockNotice({ reason, squad = null, max = null, t }) {
  const key = reason === "both_full"
    ? (BOTH_FULL_KEY[squad] ?? "auctions:bidGate.bothFull")
    : "auctions:bidGate.seniorFull";
  return (
    <div className="text-2xs text-cz-warning bg-cz-warning-bg rounded-cz px-2 py-1 leading-snug">
      {t(key, { max })}
    </div>
  );
}

// #2701: hint på ungdomsauktioner om hvor rytteren lander (senior-først).
export function BidDestinationHint({ destination, squad = null, t }) {
  const key = destination === "academy"
    ? (TO_SQUAD_KEY[squad] ?? "auctions:bidGate.toAcademy")
    : "auctions:bidGate.toSenior";
  return (
    <span className="text-3xs text-cz-accent-t whitespace-nowrap">
      {t(key)}
    </span>
  );
}
