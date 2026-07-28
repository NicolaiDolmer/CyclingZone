# Previewet modellerede en tilstand transitionen selv ophæver undervejs (#2926)

**Dato:** 2026-07-25 · **Issue:** [#2926](https://github.com/NicolaiDolmer/CyclingZone/issues/2926) · **PR:** [#2984](https://github.com/NicolaiDolmer/CyclingZone/pull/2984)

## Symptom

Sæson-transitionens dry-run printede `Sponsor base total: 66,03M` (23/7) og `68,59M` (25/7). Det tal stod i drejebogen som beslutningsgrundlag for cutoveren 26.–27. juli. Det faktiske beløb `processSeasonStart` ville udbetale var **55,57M** — 13,02 mio. (23,4 %) lavere.

## Rodårsag

`buildTransitionPlan` kaldte `computeSponsorForSeason()` **uden** `activeContract`. Uden en kontrakt falder funktionen tilbage til den gamle model (division-base + variabel pulje op til 150k). Men `transitionToNextSeason` kører selv `expireAndRenewContracts` (fase 5b) **før** sponsor-payouten (fase 6), så på udbetalingstidspunktet har hvert menneskehold præcis én aktiv kontrakt, og `computeSponsorForSeason` returnerer `mode: "contract"` med kontraktens `guaranteed_base`.

Previewet modellerede altså en tilstand som transitionen selv ophæver to faser før den udbetaler. Kontrakt-baserne er systematisk lavere end den kontraktfri model, fordi `guaranteed_fraction` < 1 (safe 0,92 · loyal 0,78 · ambition 0,70 · results 0,55 · racing 0,50) — resten kommer som per-etape-indkomst hen over sæsonen.

## Hvorfor det ikke blev fanget

- Kontrakt-stien (`#1663`, juni) blev tilføjet i `processSeasonStart`, men previewet blev ikke fulgt med. Ingen test bandt de to sammen.
- Testen `buildTransitionPlan — sæson 1 → 2 preview viser variabel sponsor` **låste den forkerte adfærd fast** (`sponsor_mode === "variable"`). En grøn test på den forkerte model er værre end ingen test.
- S1 udbetalte aldrig sponsor (`SEASON1_SKIP_SPONSOR_IF_STARTING_CAPITAL` ramte alle hold på uberørt startkapital), så der fandtes ingen `finance_transactions`-rækker at afstemme previewet mod. S2 er den første sponsor-udbetaling nogensinde.

## Fix

`resolveContractForNewSeason` i `sponsorContractsService.js` er nu den **eneste** regel for "hvilken kontrakt bærer basen i sæson N" (låst / pending valg / auto-default `safe`). Previewet kalder den; fornyelsen bruger den samme eksporterede `DEFAULT_RENEW_VARIANT`. Motorens eksekverende kode er urørt.

Previewet rapporterer nu tre adskilte tal i stedet for ét sammenblandet: garanteret base (udbetales nu), signing-bonusser (engangs ved aktivering), og den variable pulje (optjenes pr. etape hen over sæsonen). Samme rettelse i `compressPyramid.js`' økonomi-sim, som er den anden ejer-gate på cutover-dagen.

## Læring

**Et preview skal modellere tilstanden på det tidspunkt handlingen sker — ikke tilstanden når previewet køres.** Når en orkestrator muterer forudsætningerne for sit eget senere trin (her: fase 5b ændrer input til fase 6), skal previewet simulere de mellemliggende faser eller kalde den samme beslutningsfunktion. Konkret guard: når en engine-sti får en ny gren (`activeContract`), så søg efter ALLE kaldere af den funktion og verificér at preview-/forecast-/scorecard-stierne fodrer den samme gren.

**Sekundært:** en test der asserterer et `mode`-felt låser en model fast. Skriv i stedet tests der binder preview og udførelse til den samme kilde, så en ny gren i motoren tvinger previewet med.
