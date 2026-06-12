# No-bid-auktioner lignede "salg til ingen" — current_price er aldrig 0 (#785)

## Symptom
Rytter-profilens Historik viste "Ukendt vandt af {hold} — 106.000 CZ$" for en
salgsauktion der udløb uden bud. Holdets transferhistorik viste samme event som
"Salg" med beløb og modpart "—". Spillere troede rytteren var solgt til ingen.

## Rod-årsag
En auktion uden bud lukkes med `status: "completed"` og `current_bidder_id: null`
(backend/lib/auctionFinalization.js), men `current_price` forbliver = startprisen
fra oprettelsen — den nulstilles ALDRIG. To historik-buildere
(`backend/lib/riderHistory.js`, `backend/lib/teamTransferHistory.js`) antog at
"completed = handlet" og sendte events med buyer=null + den umødte startpris som
beløb. Frontend faldt tilbage til "Ukendt" som købernavn.

Følgefejl: `frontend/src/lib/transferProfit.js` antog i en kommentar at no-bid-
auktioner har `amount 0` — men amount var startprisen (>0), så et "Solgt"-ben
med fantom-salgspris kunne indgå i profit-panelet.

## Fix
Backend markerer auction-events med `no_sale: true` når `current_bidder_id` er
null OG `is_guaranteed_sale` er false (garanteret AI-salg gennemføres også uden
bidder, men ER et salg). Beløb sendes som null. Frontend viser "Intet salg /
modtog ingen bud" i begge historikker; transferProfit skipper no_sale-events
eksplicit.

## Læring
- "completed"-status på auctions betyder "afsluttet", IKKE "handlet". Skeln via
  `current_bidder_id` + `is_guaranteed_sale` — aldrig via pris > 0.
- `current_price` på en no-bid-auktion er den umødte startpris. Enhver consumer
  der summerer/viser auktionspriser skal filtrere no-sales først
  (AuctionHistoryPage gjorde det allerede via `.not("current_bidder_id", "is", null)`).
- Forward-guard: `no_sale`-flaget er nu kontrakten — nye historik-consumers skal
  bruge det i stedet for at genopfinde klassifikationen.
