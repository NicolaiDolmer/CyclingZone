# 2026-07-10 — Div 4 fik Div 1's Monuments/OtherWorldTourA (#2276)

## Root cause
`#2251` lukkede kun ét hul i `tierRaceSelection.selectTierRaceSet`: en **etape-baseret**
Grand Tour-gate (`allowGrandTours`, ≥15 etaper only tier 1). Monuments og OtherWorldTourA er
**1-etapes** løb med høj prestige — de blev aldrig fanget af den gate, fordi der ikke fandtes
nogen **klasse**-whitelist overhovedet.

Samtidig var cross-tier-dedup i `buildTierMaterializationPlan` kun et in-memory `Set` for ÉT
kald til funktionen. `reconcilePoolCalendarOnActivation` materialiserer typisk KUN én
aktiveret pulje/tier ad gangen (`tiers: [division.tier]`) — uden tier 1-3's valgte løb i
hukommelsen kunne tier 4 (aktiveret ugevis senere) frit vælge blandt HELE kataloget,
prestige-først = Monuments/OWT-A.

## Fix
1. `TIER_CLASS_WHITELIST` (tierRaceSelection.js) — data-drevet whitelist pr. tier, eksporteret
   ét sted. `selectTierRaceSet` filtrerer nu på `allowedClasses` FØR prestige-walket.
2. `usedRaceNames` seedes i `materializeTierCalendars` fra EKSISTERENDE races i andre tiers
   samme sæson (DB-læsning), ikke kun in-memory fra selve kaldet — lukker hullet for
   enkelt-tier-reconcile-kald.
3. `detectCalendarViolations` udvidet med klasse- og dedup-checks; ny
   `detectPoolSignatureMismatch` verificerer at alle puljer i en division får identisk
   kalender.

## Læring
En invariant-gate der kun dækker ÉT symptom (etape-antal) af en bredere klasse af fejl
(prestige-kaskade generelt) er skrøbelig — næste instans af samme fejlklasse (klasse i
stedet for etape-antal) rammer igennem. Design gates ud fra INVARIANTEN ("kun tier 1 kører
de øverste prestige-klasser"), ikke det specifikke symptom der udløste den forrige bug.
Se også #2251-postmortem (samme rodfejlklasse: reconcile-kald uden søster-tiers i
hukommelsen).
