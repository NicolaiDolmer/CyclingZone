# Postmortem · 2026-08-18 · Bonus-tilbud accept ikke atomart (#3578)

## Hvad skete der?
Mindst 4 hold accepterede bestyrelsens bonus-tilbud (`POST /board/bonus-offer/accept`), men fik aldrig de 200.000 krediteret, intet ekstra-mål blev tilføjet, og tilbuddet forsvandt fra UI'et uden mulighed for at forsøge igen. Fejlen lå usynlig i 3 dage — ingen Sentry-issue, fordi routens catch-blok manglede `captureException`.

## Root cause
`acceptBonusOffer` (backend/lib/boardConsequences.js) flippede `board_consequences`-rowet til `status='accepted'` FØR api.js krediterede beløbet via `incrementBalanceWithAudit`. For de 4 ramte hold fejlede krediteringen med unique_violation (23505) på `uniq_bonus_per_team_season` — et indeks skrevet til sæson-sponsorbonussen, som utilsigtet også rammer et 2. bestyrelses-bonus-tilbud i samme sæson. Fordi status allerede var flippet, kunne holdet ikke forsøge igen (`acceptBonusOffer` kræver `status='active'` → 404 ved retry).

## Fix
Splittede accept-flowet i to funktioner (`boardConsequences.js`): `loadActiveBonusOffer` (read-only) og `finalizeBonusOfferAccept` (flip, betinget på `status='active'`). Route-handleren (`api.js:/board/bonus-offer/accept`) krediterer nu FØRST, flipper status BAGEFTER — fejler krediteringen, forbliver tilbuddet `active` og retry-bart. Tilføjede `idempotency_key` (`board_bonus_offer:<id>`) + `allowDuplicate:true` på finance-transaktionen, så et samtidigt dobbeltklik/netværks-retry skippes i stedet for at fejle eller dobbelt-kreditere. Tilføjede `captureException` i credit-fejl-grenen. Se PR for fix/3578-bonus-accept-atomar.

Bevidst UDENFOR scope: selve `uniq_bonus_per_team_season`-indekset (hvorfor krediteringen fejlede for de 4 hold) er ejer-gated migrationsbeslutning; kompensation for de 4 ramte hold er #3655.

## Forhindret-fremover
Ny kontrakt i `boardConsequences.js`-docblokken tvinger caller til load → kreditér → finalize-rækkefølgen. Nye tests dækker begge grene (read-only load, idempotent finalize ved samtidigt dobbelt-flip).

## Læring
"Flip status, så gør side-effect" er et generelt anti-mønster for enhver manager-triggeret handling der involverer penge: hvis side-effect'en (kreditering, DB-skrivning der kan unique-violation'e) kan fejle, skal den ske FØR den irreversible status-transition, ikke efter — ellers er handlingen ikke atomar fra brugerens perspektiv, uanset at den underliggende `incrementBalanceWithAudit`-RPC selv er transaktionel. Grep efter andre `.update({ status: ... })`-kald i `boardConsequences.js`/lignende accept/claim-flows der sker FØR en `incrementBalanceWithAudit`-kreditering, er værd at tjekke som backwards-check.
