# Fiktiv-generatoren producerede stats uden for den ægte PCM-skala

**Dato:** 2026-06-07
**Symptom:** Evne-systemet v2 (#1122, `abilityDerivation.js`) clampede nogle fiktive rytteres evner til 1/99. Generatoren (`fictionalRiderGenerator.js`) lavede stats helt op til 88 og ned til 40, mens evne-mappingen ankrer PCM 50→spil-1 og 85→spil-99 og clamper udenfor.

## Rod-årsag

`buildStats` clampede til `[40, 88]` — bevidst bredere end den ægte PCM-skala. Verificeret mod prod 2026-06-07: de 8.969 ægte PCM-ryttere har ALLE 14 stats i præcis **[50, 85]** (0 udenfor). De 25 fiktive (pcm_id NULL) havde 41 stat-værdier udenfor (30 <50, 11 >85).

Tre additive kilder gjorde fordelingen for bred (sd 10,4 mod ægtes 5,6):
- tier-spændet var enormt: `statMean` 54→78 (24 point)
- rolle-boosts var store: primary +8-16, secondary +3-8
- `clamp(v, 40, 88)` tillod [40,88]

## Fix

1. **Kilden** (`buildStats` + `TIERS.statMean`): kalibreret mod den ægte poolede PCM-fordeling (mean ~60,5, sd ~5,6, median 60, p99 ~75, max 85). Smalt tier-spænd (56→66) + moderate boosts (primary +6-12, secondary +2-5) + stram gaussian (sd 4) + clamp `[50,85]`. Genereret fordeling matcher nu ægte næsten 1:1 (mean 60,4 / sd 5,7). Specialisering bevaret (sprinter≫klatrer Δ≈9).
2. **Eksisterende data:** `clampFictionalRiderStats.js` bragte de 25 prod-ryttere ind i [50,85] (kun outliers, reversibelt, backup gemt). Ejer-valg: clamp frem for re-derivér, da de erstattes i #677.

## Hvorfor det ikke blev fanget før

- Generatorens test asserterede `[40,88]` — dvs. testen kodificerede den forkerte skala.
- De fiktive er admin-gated (RLS) + evne-systemet er i shadow → nul live-impact, ingen alarm.
- Evne-systemets clamp "dækkede" symptomet (1/99) i stedet for at fejle højlydt.

## Læring (generaliserbar)

**Når data fra to kilder skal dele samme nedstrøms-skala, skal generatoren matche kildens *empiriske* fordeling — ikke en gættet, bredere skala som en clamp så "redder".** En clamp på en for-bred fordeling er symptom-dækning: den producerer klumper ved grænserne i stedet for at fejle. Verificér den ægte fordeling mod prod (percentiler, ikke bare min/max) og kalibrér generatoren mod den.

Forward-guard: ny test `stat-skala holder [50,85] over stor population` genererer 3.000 ryttere og fanger sjældne gaussiske haler som en 100-rytter-batch kan misse.

## Relateret

- #1122 evne-system v2, #669/#677 fiktiv population.
- Samme klasse som `2026-06-02-uci-scraper-touches-fictional-riders.md`: bulk-job med service_role skal eksplicit gentage RLS-diskriminatoren (`pcm_id IS NULL`) — clamp-scriptet gør det i både fetch og update.
