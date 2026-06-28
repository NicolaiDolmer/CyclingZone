# Seed deterministiske generatorer på entitetens stabile identitet, ikke rækkens instans-id

**Dato:** 2026-06-28 · **Type:** bugfix + feature · **PR:** [#1962](https://github.com/NicolaiDolmer/CyclingZone/pull/1962), [#1963](https://github.com/NicolaiDolmer/CyclingZone/pull/1963)

## Symptom
Division 2 og 3 kører de SAMME løb parallelt i deres puljer (grupper), men parcours
(stage-profiler) afveg mellem puljerne: Div 2 89/112 etape-slots, Div 3 78/84. Samme
rigtige løb havde forskelligt terræn i hver gruppe → urimeligt for kryds-pulje-oprykning.

## Rod-årsag
`raceStageProfileGenerator.js` (#1102) var deterministisk, men seedet på `race.id` —
den **per-pulje/per-sæson UUID**. Hver pulje får sin egen `races`-række (egen UUID) for
samme rigtige løb, så den deterministiske generator producerede et forskelligt (men
reproducerbart) parcours pr. pulje. Determinismen var ægte, men nøglen var forkert.

## Princip (generaliserbart)
**Når en deterministisk generator skal give IDENTISK output for logisk-ens instanser,
skal den seedes på instansernes DELTE virkelige identitet, ikke den per-instans PK.**
Her: seed på `external_id` (race_pool-import-nøglen) i stedet for `races.id`. Alle puljers
kopier af samme løb deler `external_id` → identisk parcours.

## Tre yderligere learnings
1. **Determinisme-scope er et bevidst valg.** Cross-pulje-konsistens *inden for* en sæson
   + variation *mellem* sæsoner = seed på `external_id + season_id`. Vælg seed-nøglen så
   den matcher den EKSAKTE determinisme-kontrakt (hvem skal være ens, hvem skal variere).
2. **"Konsistent" og "realistisk" er ortogonale.** At fikse kryds-pulje-divergens gjorde
   IKKE parcours tro mod virkeligheden (generatoren var tilfældig ift. løbets karakter).
   Realisme krævede et separat lag: `terrain_archetype` pr. katalog-løb der driver
   fordelingen. Skel de to problemer — løs dem hver for sig.
3. **Tilføj ikke vægtet variation på en FAST karakteristik.** Endagsløbs-arketyper havde
   først 10% "off"-terræn for variation → en brosten-klassiker (Paris-Roubaix) kunne lande
   på flad. Et endagsløbs karakter er fast (variation-pr-sæson gælder kun etapeløbs-ruter).
   Gjort deterministisk på kerneterrænet ([#1963](https://github.com/NicolaiDolmer/CyclingZone/pull/1963)).

## Hvad fangede det
- Empirisk diagnostik mod ægte prod-data (`checkStageProfileSeedDivergence.js`, før/efter).
- Adversarisk review-workflow før prod-skrivning (fandt non-transaktionel backfill + test-gap).
- **Domæne-verifikation med ejeren:** at vise genererede ruter vs. ægte løb fangede både
  realisme-gappet og brosten→flad-flippet. Vis konkrete data tidligt; lad ekspert-ejeren
  definere grænserne (arketype pr. løb).

## Forward-guard
- Materializer-integrationstest pinner nu kryds-pulje-identitet + at `external_id`+arketype
  ER seed-kilden (en revert af threading står ikke længere grøn).
- Diagnostikken logger arketype-dækning + advarer ved løb uden delt seed-nøgle.
