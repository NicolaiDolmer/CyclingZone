# Cutover S1→S2: URL-klippen bed 2× til, én audit-FK stoppede 24 sletninger, og pensions-alder var to-sæsons-tvetydig

**Dato:** 2026-07-26 (cutover-vagten, ~19:35-22:30) · **Issues:** #2851 #2846 #3030 #3037 #3038 #3039

## Hændelse 1: `.in()`-URL-klippen ramte 2 NYE call-sites — samme dag som #3030-postmortemet blev skrevet

`compressPyramid --execute` døde i AI-reconcile: `snapshotRaceResultNamesForTeams` sendte ~600 rytter-UUID'er i én `.in()` (22.614 tegn URL → HeadersOverflowError). Efter fix døde NÆSTE call-site: `notifyAndClearWatchlistForRiders` (lookup + delete på samme ubundne liste). Begge fixet med chunkning.

**Læring:** Et postmortem om en fejlkLASSE lukker ikke klassen — #3030's follow-up-audit af ubundne `.in()`-sites var åben, og cutoveren ramte to af dem timer senere. Når en fejlklasse er identificeret og en stor operation forestår samme dag: kør auditten på operationens kodesti FØRST (grep `.in(` + bounds-vurdering tog 5 min, da den først blev gjort).

**Bonusfælde samme familie:** et engangs-script chunkede løb-id'er (100 pr. chunk) men glemte 1000-RÆKKERS-loftet pr. svar — 8.000 entries/chunk trunkeret tavst til 15 af 93 kendte rækker. Kun fordi SQL-facit var målt først, blev det opdaget. Chunk-størrelse skal vælges efter BEGGE lofter (URL ind, 1000 rækker ud).

## Hændelse 2: audit-FK'er uden ON DELETE-regel = tidsindstillet blokade af enhver oprydning

Rytter-sletning fejlede på `admin_log_target_rider_id_fkey` (NO ACTION) — én `auction_cancel`-række fra 29/6 pegede på en AI-rytter. Audit-tabeller skal have `ON DELETE SET NULL` (som activity_feed/race_results): rækken overlever, referencen nulles. Migration applied + verificeret; `loans`/`transfer_offers` har stadig NO ACTION-FK'er (0 blokerende rækker i aften — men samme latente klasse).

**Læring:** Før en operation der SLETTER entiteter i skala: kør FK-census (`pg_constraint` på confrelid + confdeltype) og tæl blokerende rækker for HELE mængden — én query afslører alle vægge på forhånd, i stedet for crash-for-crash.

## Hændelse 3: "alder" var to-sæsons-tvetydig — ejer-regel indført midt i kørslen

Drejebogens auktions-risiko-query brugte S2-alder (`ageForSeason(bd, 2)`), så en spiller-synligt 35-årig (Charpentier, f. 1991) optrådte som pensions-kandidat. Ejeren ruled: spillerne er lovet pension 36-40 — en rytter de har set som 35 hele sæsonen må ikke pensioneres minutter efter sæsonslut. Fix: `retirementDecision(age − 1)` — rullet måles på den AFSLUTTEDE sæsons alder. Konsekvens: ingen pension under synlig 36, garanti efter sæsonen som synlig 40-årig, aldrig en 41-sæson. 61 ryttere (1991-årgangen) fritaget i dette skifte; 35 pensioneret i alt.

**Læring:** Sæson-drevne aldre har ALTID to fortolkninger ved et skifte (fra-sæson vs til-sæson). Enhver regel der kommunikeres til spillere i alders-termer skal eksplicit vælge den SPILLER-SYNLIGE alder — og koden skal dokumentere valget dér hvor rullet sker.

## Proces-noter

- Endpoint-spejling til season-end (`endSeason-2026-07-26-s1.mjs`) var det rigtige kald: UI-knappens egen pending-check har rå `.in(423 løbs-id'er)` ≈ 98 % af URL-klippen — ejer-klik havde formentlig fejlet.
- Drejebogens window-wrap-UPDATE manglede `squad_enforcement_started_at` (check-constraint kræver started før completed) — generalprøven havde aldrig EKSEKVERET wrap'et, kun læst det.
- Reconcile af "dormant" puljer BETYDER tømning (tier 3/4 uden ægte managere → 0 AI) — drejebogens "forbliver dormant" var en misforståelse; kalender-løb i tømte puljer skippes af schedulerens P0 2/7-filter, men #2805-spærren kender ikke undtagelsen (#3038).

## Token-tag

`#in-list-url-cliff` `#fk-census-before-mass-delete` `#season-age-ambiguity` `#cutover`
