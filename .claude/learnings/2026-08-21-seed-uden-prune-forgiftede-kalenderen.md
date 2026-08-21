# Seed uden --prune forgiftede S3-kalenderen (dublet-GT'er, 82 % GT-andel)

**Dato:** 2026-08-21 · **Refs:** #4075, #3547, PR #4077/#4078/#4079

## Hvad skete der

S3-kalenderen (materialiseret 20/8) havde alle 3 Grand Tours liggende DOBBELT i D1
(gammel 21-etapers + ny 17-18-etapers version af samme løb), en forældet Tour de
Bretagne i D1 og 12 forældede løbsversioner i D2. GT-andelen var 82 % af D1's etaper
mod reglernes mål på 37 % (PR #3862). #4075 antog først at opdelingen var tilsigtet
og kun navnet var fejlen — ejeren afviste det ("der må kun være 3 GT'er").

## Rod-årsagskæden (tre led, alle nødvendige)

1. `external_id = sha256(navn|date_text)`. Da #3862 ændrede GT'ernes længder og
   datoer i CSV'en, fik rækkerne NYE external_ids → upsert INDSATTE nye rækker i
   stedet for at opdatere.
2. Seedningen 20/8 kørte uden `--prune` → de gamle rækker blev stående (158 rækker
   mod CSV'ens 140).
3. `race_pool_archetypes.json` var keyet på de GAMLE external_ids → de nye GT-rækker
   fik `terrain_archetype = NULL` og blev genereret som almindelige etapeløb (ingen
   åbnings-ITT, ingen GT-finale-regel).

Selektionen dedupliker kun på id (ikke navn), så begge versioner blev valgt.

## Fixes (forward-guards, alle shippet 21/8)

- Within-tier navne-dedup i `selectTierRaceSet` + invariant 4 i
  `detectCalendarViolations` (samme navn to gange i én tier = apply-refusal).
- Invariant 5: GT-klasser SKAL bære `grand_tour`-arketypen (apply-refusal).
- `race_pool.retired_at`: forældede-men-FK-refererede rækker kan ikke slettes
  (historiske sæsoners races peger på dem) — de PENSIONERES af `--prune` og alle
  selektions-loadere filtrerer `retired_at IS NULL`. Upsert nulstiller (revival).
- Arketype-JSON genbygget keyet på CSV'ens aktuelle ids.

## Sekundære lærdomme

1. **Regen-scriptets dry-run dækkede ikke coverage-gaten.** Plan-funktionen
   (`buildTierMaterializationPlan`) evaluerer IKKE #3327-dæknings-garantierne —
   det gør kun `materializeTierCalendars` (dry-run og apply). Apply blev derfor
   afvist midtvejs (D2-cobbles 5 < 6) efter et grønt dry-run. Nyt script
   `scripts/dev/dryRunMaterializeCoverage4075.mjs` kører materialize-dry-run med
   FULD apply-paritet — brug det FØR enhver regen-apply.
2. **Arketype-reservationer kan sulte nedstrøms-tiers.** Tier 1's
   `cobbled_tour: 1` støvsugede Danmark Rundt (eneste cobbled_tour tier 1-3 kan
   nå), og tier 1's `cobbled_classic: 2` blev opfyldt af de to brostens-MONUMENTER
   selv (prestige-først-walk). Reservations-tal skal tage højde for at monumenter
   selv opfylder reservationer, og for arketyper med 1-2 rækker i kataloget.
3. **Bånd-usynlige løb er død forsyning.** 4 ProSeries-løb lå uden for klassens
   etapebånd [3,5] og var usynlige for selektionen — D3 manglede 21 løbsdage da
   de forældede rækker forsvandt. Skjult forsyning fra forældede rækker kan maskere
   katalog-huller i årevis.
4. **`race_days_total` ændrede sig ved regen (27→28)** fordi den nye kalender
   udfylder alle 28 datoer. Kalender-mutationer skal altid følges af et blik på
   race_days-forbrugerne (løn-sweep, cutover-gates) — drejebogen er opdateret.

## Detektion fremover

- `detectCalendarViolations` invariant 4+5 gør begge fejlklasser til apply-refusals.
- `checkStageProfileSeedDivergence` rapporterer allerede NULL-arketyper — læg mærke
  til den ved katalog-ændringer.
- Kør ALTID `seedRacePool --dry-run --prune` efter CSV-ændringer og kig på
  "forældreløse"-listen FØR apply.
