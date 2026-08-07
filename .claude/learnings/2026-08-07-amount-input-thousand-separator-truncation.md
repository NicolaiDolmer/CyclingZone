# Postmortem · 2026-08-07 · Beløbsfelter droppede tusindtalsseparator (150.000 → 150)

## Hvad skete der?
En spiller skrev udbudspris "150.000" (dansk tusindtalsseparator) på transferlisten, mindst 2 gange, og rytteren blev sat til salg for **150** i stedet for 150.000 — en faktor 1000-fejl på rigtige penge. Ejeren måtte rydde op manuelt i prod begge gange (#3495, Discord-sweep 2026-08-07).

## Root cause
Alle ~20 CZ$-beløbsfelter i frontend (auktions-startpris, transferlistens udbudspris, bud, autobud-loft, lån, tilbud, swap-cash) var `<input type="number">` parset med `parseInt(e.target.value, 10)`. HTML's native `type="number"` accepterer `.` som decimal-punktum (locale-uafhængigt) men blokerer `,` og mellemrum som keystrokes helt. Så "150.000" blev en gyldig number-input-streng, og `parseInt("150.000", 10)` stopper ved punktummet → `150`. Ingen af felterne normaliserede eller afviste input — de trunkerede stiltiende.

Sekundært: to server-side huller fandtes i samme klasse — `POST /api/transfers` (listing-oprettelse) havde INGEN validering/coercion af `asking_price` overhovedet, og `POST /api/auctions/:id/bid` validerede `amount` via en lokal `Number()`-kopi men insatte/opdaterede det RÅ `req.body.amount` i stedet for den koercerede værdi.

## Fix
- `frontend/src/lib/amountInput.js` — delt `parseAmountInput()` (+ `parseDecimalInput`/`parseAdjustmentValue`): accepterer "150.000"/"150,000"/"150 000"/"150000", normaliserer til samme heltal, afviser eksplicit tvetydigt input (fx "150.5") med en feltfejl i stedet for at gætte/trunkere. 18 unit-tests (`amountInput.test.js`).
- `frontend/src/components/ui/AmountInput.jsx` — delt komponent: `type="text" inputMode="numeric"` (ikke `number`, som blokerer `,`/mellemrum-tastetryk helt), viser live klartekst-bekræftelse ("= 150.000 CZ$") + feltfejl, genbruger `formatNumber` (lib/intl.js).
- Alle ~20 kald-steder migreret: `RiderStatsPage.jsx`, `TeamPage.jsx`, `TransfersPage.jsx`, `AuctionsPage.jsx`, `FinancePage.jsx`, `RiderFilters.jsx` (filter-chip-visning).
- Backend: `backend/routes/api.js` — `POST /transfers` fik en positiv-heltal-guard før insert; `POST /auctions/:id/bid` bruger nu konsekvent én `numericAmount` (valideret + koerceret) i stedet for det rå `amount` overalt (insert, current_price, notifikationer, response).
- E2e: `frontend/tests/e2e/auction-startprice-typo-guard.spec.js` udvidet med 2 regressionstests (auktions-startpris + transferlistens udbudspris, begge med "150.000" og assertion på det RÅ POST-body-tal). `auction-blocked-actions.spec.js` opdateret (role `spinbutton` → `textbox` efter input-type-skiftet).

## Forhindret-fremover
- Delt parser + komponent betyder ethvert NYT beløbsfelt arver normaliseringen automatisk, i stedet for at hvert sted opfinder sin egen `parseInt`.
- E2e-regressionstests låser den konkrete hændelsesklasse fast (dot-separator → fuldt beløb, ikke trunkeret) for de to felter der faktisk blev ramt i prod.
- Backend-guards lukker "client sender malformed data direkte" som separat angrebsflade, uafhængigt af frontend-fixet.

## Læring
`type="number"` er IKKE et sikkert beløbs-felt bare fordi det "kun tillader tal" — det tillader netop ÉT tegn (`.`) der har forskellig betydning i dansk (tusindtalsseparator) vs. engelsk (decimal) konvention, og blokerer samtidig de andre separator-varianter en spiller intuitivt ville bruge. Ethvert beløbsfelt i et spil med lokalt publikum bør bruge en eksplicit normaliserings-helper, ikke browserens indbyggede number-parsing.
