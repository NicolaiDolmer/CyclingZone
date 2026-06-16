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

## LØST (2026-06-16, branch `feat/1122-ability-contrast`) — A+B implementeret, cross-seed grøn

Ejer-godkendt fork **A+B**: behold arketype-skewen (A) som fundament + tilføj evne-niveau
**kontrast-forstærkning** (B, design §5-B) i `abilityDerivation.js`.

**Nyt trin (`abilityDerivation.js`):** efter de rå fysiske evner skubbes hver rytters 10
fysiske disciplin-evner væk fra rytterens EGEN median: `out = median + k·(raw − median)`,
clamp `[floor, 99]`. TIER-UAFHÆNGIG (afstand fra egen profil, ikke et absolut loft) → bryder
superstar-mætningen. **Kun på fysiologi-stien** — PCM-fallback er en ren lineær remap uden
mætning, og value-modellen er fittet mod den (kontrast dér ville inflatere base_value;
refit hører til Plan 4). Tekniske/mentale evner (descending/cobblestone/positioning/
aggression/tactics/hidden) røres ikke.

**Endelige konstanter:** `CONTRAST.k = 1.52`, `CONTRAST.floor = 8` (abilityDerivation.js).
Re-tunede arketype-skews (archetypePhysiology.js) for at holde absolutte niveauer sunde +
lukke type-lækager efter kontrast: leadout sprint_power 0.10→0.04 (sprintere skal vinde
flade bunch-spurter, men leadouts skal stadig kunne eskapere → flat udbruds-bånd); puncheur
vo2_ceiling 0.16→0.12 + aero −0.06→−0.16 (stop puncheur-læk på itt); brostensrytter aerob
0.08→−0.10 / vo2_ceiling −0.08→−0.22 / aero 0.04→−0.10 / sprint_power −0.12→−0.20 / durability
0.24→0.30 (stop brosten-læk på itt+mountain+flat); climber aero −0.10→−0.20 + baroudeur aerob
0.12→0.10 / aero 0.02→−0.10 (stop klatrer/baroudeur-læk på itt); gc aero 0.00→0.14 (gc skal
vinde itt → itt_tempo).

**Født-som scorecard pr. seed (alle 7 mål ✓ på 2026/7/42):**

| Mål (bånd) | seed 2026 | seed 7 | seed 42 |
|---|---|---|---|
| flat sprinter ≥90 | 100 ✓ | 98 ✓ | 97 ✓ |
| itt tt ≥60 | 61 ✓ | 75 ✓ | 75 ✓ |
| itt_tempo tt+gc ≥95 | 100 ✓ | 99 ✓ | 99 ✓ |
| cobbles brosten ≥80 | 93 ✓ | 93 ✓ | 96 ✓ |
| hilly puncheur ≥35 | 75 ✓ | 73 ✓ | 40 ✓ |
| mountain gc+climber+baroudeur ≥85 | 95 ✓ | 87 ✓ | 97 ✓ |
| high_mountain (samme) ≥85 | 99 ✓ | 87 ✓ | 99 ✓ |

**Fuld håndhævet gate (`--enforce-targets --enforce-liveness`):** GRØN (exit 0) på neutral
2026 + 7 + 42 + roles(2026). Strukturelle oracles + liveness + udbruds-/roles-bånd alle ✓.

**RESTERENDE RØD (1 probe, condition-mode):** `--condition=random --seed=2026` fejler ALENE
på durability-liveness-seamen (`durability high_mountain condition` ⌀rank 0.01 vs gulv 0.02).
Det er en støj-nær placeholder-seam (#1021-fatigue-vægt 0.008); skarpere specialisering gør
off-terræn-durability mindre rang-afgørende på high_mountain. Ingen k/floor/skew-konfiguration
i det udforskede rum holder dén probe over gulvet i condition-mode UDEN at vælte flat-udbruds-
båndet (de er koblede). Born-as-scorecardet (issue-målet) er grønt cross-seed i ALLE modes
inkl. condition. Vurdering: gulvet (0.02) er for stramt for #1021-placeholder-seamen mod den
nye specialiserede fordeling; løses naturligt når #1021 giver fatigue ægte vægt, eller via en
lille gulv-justering på den ene seam-probe (ejer-beslutning — IKKE gjort her for ikke at sænke
baren). `npm run race:gate` (CI, neutral seed 2026) er GRØN.

**Migration/re-seed-impact (ejer kører efter merge):** INGEN ny schema-migration. Kontrasten
er rent et derivations-trin. Lagrede evner i `rider_derived_abilities` for fiktive ryttere
re-deriveres når fysiologi-stien fodres ind (Plan 2's preview/backfill-omskrivning, separat
task). `backfillCores.js` (fodrer ægte profil) anvender kontrasten automatisk. PCM-fallback-
stien (`previewDerivedAbilities`/`fictionalPopulationPreview`/`balanceSnapshot`) er UÆNDRET —
kontrast springes over dér, så value-modellen + balance-baselinen er ikke påvirket.
