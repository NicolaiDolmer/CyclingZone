# Postmortem · 2026-08-18 · Transferhistorik lækkede interne pladsholdere ("-"/"Unknown")

## Hvad skete der?
To spillere (@thelamba, @knud_r_flink) klagede i Discord over transferhistorikken:
gennemførte auktioner uden bud ("no sale") fyldte listen med rækker hvor "intet
skete", og modpart-kolonnen viste "-" (team-historik) eller "Unknown" (rytter-
historik) i stedet for "AI team" — samme klasse fejl som #161, men på flere
flader.

## Root cause
To separate ting:

1. **No-sale-støj i rytter-historikken:** TeamTransferHistoryTab fik allerede
   en no-sale-filtrering i #2400 (default skjult + toggle). RiderHistoryTab
   (den offentlige "History"-fane på en rytters profil) fik den ALDRIG — den
   viste stadig `auction_no_sale`-rækker med teksten "received no bids".
2. **"-"/"Unknown"-fallback for garanteret AI-salg:** når en auktion afsluttes
   uden bud OG `is_guaranteed_sale` er sat, sætter `auctionFinalization.js`
   ALDRIG `current_bidder_id` (banken/AI'en får rytteren uden om
   bud-feltet). `teamTransferHistory.js`/`riderHistory.js` joiner `winner`/
   `buyer` via `current_bidder_id`, som derfor er `null` — men `no_sale` er
   korrekt `false` (det ER et salg). UI'et havde kun to grene: no_sale-tekst
   eller en generisk "-"/"Unknown"-fallback. Der var allerede en
   `sellerFallbackAi`-tekst for SÆLGER-siden af et AI-salg, men ingen
   symmetrisk `buyerFallbackAi` for KØBER-siden — en ren asymmetri-fejl fra
   dengang #785/#2793 blev bygget.

Bemærk: `is_guaranteed_sale` er `false` for ALLE completed auctions i prod
lige nu (verificeret via SQL), og `is_bank`-teamet findes slet ikke — så denne
gren er teknisk et dødt kodespor i dag. Den er alligevel test-dækket
(`teamTransferHistory.test.js`, `riderHistory.test.js`) og forventes aktiveret
igen når bank-/garanti-mekanikken bruges. Rettelsen er fremadrettet korrekt,
ikke kun kosmetisk for et scenarie der aldrig rammes.

## Fix
- `frontend/src/lib/riderHistoryTable.js`: no_sale-auktioner filtreres helt
  fra (`buildHistoryRows`), ingen `auction_no_sale`-kind længere.
- `frontend/src/components/rider/profile/RiderHistoryTab.jsx`: buyer-fallback
  bruger `history.auction.buyerFallbackAi` ("AI team") når
  `row.is_guaranteed_sale` er sat, i stedet for det generiske "Unknown".
  Dødt `auction_no_sale`-render-case fjernet.
- `frontend/src/components/TeamTransferHistoryTab.jsx`: counterparty-kolonnen
  viser `history.aiTeamFallback` ("AI team") for samme scenarie i stedet for
  "-".
- i18n: `buyerFallbackAi` (rider.json) + `aiTeamFallback` (transfers.json)
  tilføjet EN+DA; døde `noSaleTag`/`noSaleBody`-nøgler fjernet.

## Forhindret-fremover
- `frontend/src/lib/riderHistoryTable.test.js` dækker filtreringen.
- Ny e2e-spec `3708-transfer-history-ai-cleanup.spec.js` dækker begge
  flader (team + rytter) mod en garanteret-salg-fixture, så en fremtidig
  regression i buyer/counterparty-fallback fanges selvom scenariet er
  sjældent i prod-data lige nu.

## Læring
Når ét sted i koden har en "AI-aware" fallback-tekst (her: `sellerFallbackAi`)
og et parallelt sted (buyer/counterparty) IKKE har den samme behandling, er
det næsten altid en glemt spejling — ikke en bevidst asymmetri. Værd at grep'e
efter "Fallback"/"FallbackAi"-par når man rører den slags kode, uanset om
data lige nu rammer stien.
