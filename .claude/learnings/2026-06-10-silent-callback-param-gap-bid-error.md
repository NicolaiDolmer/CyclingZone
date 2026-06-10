# Stille callback-param-hul: fejlbesked der aldrig kunne vises (#1184)

**Dato:** 2026-06-10 · **Issue:** #1184 · **PR:** #1211

## Symptom
Spiller-rapport: "bud over saldo accepteres uden advarsel eller fejlmeddelelse."

## Rod-årsag (verificeret)
Tre lag, hvor det midterste var kernen:
1. `RiderBidPanel` gav ikke `t` videre til `useAuctionBidding`-hooket → når klient-saldo-gaten fyrede på rytterprofilen, kastede `t("auctions:error.insufficientBalance")` TypeError → **ingen besked vist overhovedet**. Fejlen var usynlig i test fordi ingen test ramte gate-grenen på netop dén flade.
2. Rytterprofilen sendte RÅ saldo (ikke saldo − commitments) til gaten → inkonsistent med auktionssiden og backend.
3. Server-gaten var derimod empirisk tæt: ledger-rekonstruktion (`finance_transactions.after_balance` ved bid_time) viste 0 bud over saldo i hele historikken.

## Lektioner
- **En optional callback-parameter (`t`, `onError`, formatter) der "plejer" at blive givet videre, er en stille fejlkilde.** Hvis hooket KRÆVER den, skal fejl-grenen testes pr. kalder-flade — eller parameteren skal væk (hooket kan selv kalde `useTranslation`).
- **Ledger-rekonstruktion er et stærkt diagnose-værktøj:** `before_balance`/`after_balance` + LATERAL join gav et definitivt "0 overtrædelser nogensinde" på minutter — langt billigere end at jagte repro-stier i kode.
- **"Accepteret uden indsigelse" fra en bruger kan betyde "fejlen blev aldrig renderet"** — ikke at handlingen gik igennem. Tjek fejl-grenens UI-sti før backend-jagt.

## Forward-guards
- Gate-logik samlet i hooket via delte helpers (`computeWorstCaseReservation`/`computeAvailableForBid` i auctionLogic.js) med unit-tests — én kilde til sandhed for alle tre bid-flader.
- i18n lib/components-guard (#1170, `scripts/i18n-check-lib-strings.mjs`) fanger den beslægtede klasse (hardcodet dansk fallback-tekst).
