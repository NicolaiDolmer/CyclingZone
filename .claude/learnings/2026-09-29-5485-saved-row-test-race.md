# Postmortem · 2026-09-29 · #5485 Saved-rækkens test-race

## Hvad skete der?
Dependabot-PR #5705 fejlede `mobile-webkit-2of3` den 29/9. Testen i
`5485-training-overview-tabs.spec.ts` fandt ikke checkboxen i rytter A's række,
selv om den forudgående kontrol havde set `Saved` og `Apply to 2`.

## Årsag
Produktionskoden beholder en gemt række i filteret `Needs a day` i cirka to
sekunder og fjerner den derefter. Testen læste checkboxen efter flere asynkrone
assertions. På den belastede CI-runner forsvandt rækken, før den læsning blev
udført. Fejlen afhænger af testens timing, ikke af `intl-messageformat`.

## Rettelse og bevis
Playwrights ur startes med en eksplicit dato før navigation og pauses før
rytterens dag gemmes. Dermed kan testen stadig kontrollere både `Saved`, den
synligt afmarkerede checkbox og `Apply to 2`. Uret fremføres derefter to
sekunder, hvorefter testen kræver to rækker og at bulk-API-kaldet kun
indeholder B og C. Lokal main-baseline: 20 målrettede Playwright-tests
bestod; den rettede test blev kørt 3 gange i hvert browserprojekt.
CI-run med oprindelig fejl: 36560770214.

## Læring
Når UI bevidst fjerner et element efter en timer, skal testen styre uret for
at kunne kontrollere både den kortvarige tilstand og sluttilstanden stabilt.
