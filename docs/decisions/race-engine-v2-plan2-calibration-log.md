# Race-engine v2 — Plan 2 kalibrerings-log (#1122) — WIP (sess 15/6, pauset)

> Plan: [`docs/superpowers/plans/2026-06-15-race-engine-v2-plan2-physiology-foundation.md`](../superpowers/plans/2026-06-15-race-engine-v2-plan2-physiology-foundation.md).
> **Status: PAUSET ved Phase C (tuning). Phase A + B er committet + grønne på egne tests. C1 cross-seed-tuning er IKKE løst — afventer ejer-beslutning om specialiserings-mekanik (se nederst).** Fortsætter 16/6 med en kollaborativ session: forstå motoren + grund kalibreringen i virkelige cykel-data.

## Hvad er bygget (committet på `feat/1102-race-engine-v2-plan2`)

- **A1** migration (`database/2026-06-15-physiology-foundation-v2.sql`): +3 metrics (power_2m_wkg/power_10m_wkg/aero, nullable), deprecér prolog + power_5m (ingen drop), source-constraint +`seeded_archetype`. Reversibel.
- **A2** `archetypePhysiology.js`: ren `seedArchetypePhysiology` — fysiologi = `lerp(elite-range, tierLevel + arketype-skew + gaussian-støj)` pr. metric, monoton power-kurve. 6/6 tests grønne.
- **A3** generator hænger `_meta.physiology` på hver rytter (arketype-skæv, tier-niveau). riders-payload uændret. Tests grønne.
- **B1** `abilityDerivation.js` v3 (`FORMULA_VERSION=3`): fysiske evner ← fysiologi-bøtter; tekniske/mentale ← skill-stats; `prolog` merged i `time_trial` (15 synlige); PCM-fallback. Review-fix: `hasPhysiology` kræver komplet v2-profil (`aero`) ellers fallback (v1-profiler underestimerede ellers tt/punch). 21/21 tests grønne.
- **B2** dry-run fodrer `_meta.physiology` ind i `deriveAbilities`.

## Phase C-tuning (WIP — IKKE committet som endelig; seed 2026 grøn, 7/42 røde)

7 tuning-runder mod born-as-scorecardet. Tuning-flader: `PHYSIOLOGY_ARCHETYPES`-skew (archetypePhysiology.js) + fysiske derivations-vægte + `PHYS_ANCHORS` (abilityDerivation.js). Motoren + demand-vektorer **urørt** (Plan 1-frosset).

**Resultat pr. variant (efter round 7):**

| Variant | flat | itt | itt_tempo | hilly | mountain | hi_mtn | exit |
|---------|-----:|----:|----------:|------:|---------:|-------:|------|
| seed 2026 | 97 | 61 | 98 | 37 | 94 | 98 | **0 ✓** |
| seed 7 | 94 | 42 | 58 | 47 | 85 | 83 | 1 |
| seed 42 | 73 | 50 | 61 | 12 | 84 | 84 | 1 |
| condition | (2026) | | | 34 | | | 1 |
| roles | (2026) | | | 35 | | | 1 |

(Mål: flat ≥90 · itt ≥60 · itt_tempo ≥95 · hilly ≥35 · mountain/hi_mtn ≥85. Strukturelle oracles + liveness + udbruds-bånd: GRØNNE på alle varianter — kun born-as-kalibreringen fejler cross-seed.)

## ROD-ÅRSAG (den vigtige finding — simulér-før-ship)

Fysiologien seedes additivt: `frac = clamp01(tierLevel + arketype-skew + støj)`. Ved **toppen** (de 12 superstars, der vinder de fleste løb) dominerer `tierLevel ≈ 0.92` den lille skew → en klatrer med `aero`-skew −0.10 får stadig aero ≈ 0.82 → høj `time_trial`. **Superstars bliver gode til alt.** Derfor afhænger hvilken *born-as*-type der vinder af det tilfældige arketype-lotteri blandt de 12 superstars pr. seed → stor seed-varians (især `itt_tempo`: 98% seed 2026 vs 58% seed 7, mens *afledt* type er 99-100% — vinderne har den rigtige evne men er født som forkert type).

Dette er **§1.1's oprindelige problem** ("stærke ryttere høje i alt") genopstået i toppen. Skarpere skews (round 7) hjalp knap — modellen kæmper mod sig selv fordi skew er additiv og mætter ved toppen.

**Empirisk modsiger dette §0.1 Beslutning 4's "(B) per-rytter kontrast-forstærkning ikke nødvendig for sæson 1".** Designets §5 forudså netop dette og navngav remedien (B).

## ÅBEN EJER-BESLUTNING (forken der pausede sessionen)

Hvordan opnår vi robust top-tier-specialisering?
1. **(Anbefalet) Kontrast-forstærkning (§5 option B):** efter rå evne-derivation, skub hver rytters evner væk fra deres egen evne-median. Tier-uafhængig specialisering — selv superstars tydeligt svage off-disciplin (= §0.1 Beslutning 2's mål). Renest, mest robust. Kræver nyt derivations-trin + re-tune.
2. Meget større skew-magnituder (~−0.5/−0.6) — ingen ny mekanik, men risikerer karikatur i bunden + mætter stadig ved aller-toppen.
3. Slæk interim itt/hilly-mål pr. seed — skjuler problemet, sænker kvalitets-baren.

**Ejer 15/6:** vil tage et skridt tilbage 16/6 — forstå motoren + holde kalibreringen op mod VIRKELIGE cykel-resultater, så specialiseringen føles realistisk, før vi vælger mekanik.

## Agenda 16/6 (kollaborativ)

1. Walk-through af v2-kæden i klar tekst: fysiologi-metrics → derivations-bøtter → evner → demand-vektor-scoring → born-as-resultat. Lær ejeren hvor hver knap sidder.
2. Grund mod virkeligheden: ægte power-profiler (sprinter vs klatrer vs TT), reelle terræn-vinder-fordelinger, reelle specialiserings-gaps (sprinter climbing ~32, klatrer sprint ~28 jf. §0.1). Definér mål-ankre fra data, ikke gæt.
3. Beslut specialiserings-mekanik (A+B / B / større skews) på det grundlag.
4. Genoptag C1-tuning mod alle seeds (NB: `npm run race:gate` kører KUN seed 2026 — verificér 7/42 + condition + roles manuelt; cross-seed-robusthed er den egentlige bar).

## Note til genoptagelse

Round-1-7 tuning-koefficienterne er committet som WIP-checkpoint (seed 2026 grøn). De er sandsynligvis stilladser — option B vil ændre dynamikken og kræve re-tune. Den endelige GRØN-tabel + konstanter skrives her når gaten er grøn på alle varianter.
