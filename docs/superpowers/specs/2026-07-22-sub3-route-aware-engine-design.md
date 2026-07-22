# Løbsform-kobling — Sub-3: gap-model læser ruten, distance→fatigue, udbruds-forfining, prolog, tekniske finaler

**Status:** Design-spec til ejer-review — INTET er implementeret.
**Dato:** 2026-07-22
**Epic:** [#2768](https://github.com/NicolaiDolmer/CyclingZone/issues/2768). **Dette issue:** [#2771](https://github.com/NicolaiDolmer/CyclingZone/issues/2771) (Sub-3).
**Fundament:** Sub-1-rutedata (live). Sub-2 (#2770) er uafhængig (passage-lag); Sub-3 kan landes efter Sub-2.

**Ejer-beslutning (22/7):** Gap-model = **ankret modifier-model** bag én grænseflade (`stageGapModel(stageProfile) → {bunch, spread}`), så en fuld kontinuerlig model senere er et drop-in-replacement bag samme interface.

**⚠️ Dette sub ÆNDRER den gate-kalibrerede motors output** for etaper med rutedata. Simulér-før-ship mod ægte population + fuld scorecard er obligatorisk FØR merge; alle eksisterende gate-bånd skal forblive grønne (re-verificeret, ikke antaget).

---

## 1. Bundlinje

Motoren er parcours-blind hvor det gør ondt: en "mountain"-etape gapper ens uanset summit- eller dal-finish; en 240 km kongeetape simuleres som en 120 km etape; udbruds-overlevelse kender hverken distance eller feltets sammensætning; prolog findes ikke; tekniske finaler er underudnyttede. Sub-3 lader Sub-1's rutedata drive simulationen — som **additive, data-gatede lag**: etaper uden rutedata er bit-identiske med i dag.

---

## 2. Scope

**I scope:** gap-model-modifiers (summit/dal/kategori/ITT-distance) · distance→fatigue + endurance-fordel på lange dage · udbruds-forfining (distance + felt) · prolog-arketype · tekniske finaler (afledt, ikke persisteret) · rekalibrerings-harness.

**IKKE i scope:** sidevind/vifter (Sub-5 #2476) · UI/graf (Sub-4) · rytter-dybde (dagsform/peaks er race-v3-sporet) · nye konkurrencer (Sub-2).

---

## 3. Gap-model — ankret modifier-model

### 3.1 Grænseflade

`GAP_MODEL`-tabellen består som **anker** (gate-kalibreret). Ny ren funktion i `raceSimulator.js` (eller `raceGapModel.js` hvis den vokser):

```
stageGapModel(stageProfile) → { bunch, spread }
```

`gapFor(profileType, deficit)` → `gapFor(stageProfile, deficit)` internt; alle modifiers er faktorer på ankerets `spread`. Uden rutedata: alle faktorer = 1.0 → bit-identisk.

### 3.2 Modifiers (kandidat-værdier — låses i kalibrering)

| Rute-signal | Betingelse | Faktor på spread |
|---|---|---|
| Summit-finish | `climbs[last].summit_finish` | ×1.3 (bånd 1.2–1.4), bunch → 0 |
| Dal-finish | mountain/high_mountain og `distance_km − climbs[last].crest_km ≥ 10` | ×0.6 (bånd 0.5–0.75) — feltet samles på nedkørslen |
| Sidste stignings kategori | mountain/high_mountain/hilly | HC ×1.25 · 1 ×1.10 · 2 ×1.00 · 3 ×0.85 · 4 ×0.70 |
| ITT-distance | itt/ttt | spread = anker × (distance_km / 30), clamp [150, 900] — en prolog giver naturligt små gab |

Faktorer multipliceres; samlet clamp på spread [40, 1000] + eksisterende `MAX_STAGE_GAP_SECONDS`-loft består.

---

## 4. Distance → fatigue + endurance

Kun når `distance_km` findes. `distFactor = clamp(distance_km / bandMid(profile_type), 0.85, 1.2)` (bandMid = midtpunkt af Sub-1's `DISTANCE_BANDS`).

1. **Fatigue-skalering:** `fatigueComponent × distFactor` — lange dage slider mere; durability-dæmpningen (eksisterende) betyder mere på lange dage.
2. **Endurance-term (score-space):** `(distFactor − 1) × LONG_DAY_ENDURANCE_WEIGHT × ((endurance − 50) / 49)` — kandidat-vægt 0.05 → maks ~±0.01 på score (~1.5 % af typisk terræn) ved 20 % over-distance. Udholdenhedsryttere vinder kongeetaper; kortdistance-punchere favoriseres på korte etaper.

---

## 5. Udbruds-forfining

`breakawayMaxBonus(profileType, finaleType)` får to bounded faktorer (kontrakten — én skalar — består):

- **Distance:** × `sqrt(distFactor)` — lange etaper favoriserer udbruddet let (mere kontrol-arbejde for feltet).
- **Sprinter-tæthed (kun flat/rolling):** antal hold med `sprint_captain` blandt entrants; høj tæthed → faktor ned mod ×0.85 (flere hold jagter), lav tæthed → op mod ×1.15. Deterministisk fra entrants, ingen rng.

Bånd-lofterne fra kalibrerings-loggen (fx flat ≤ 0.30) gælder EFTER faktorer — clamp sikrer det.

---

## 6. Prolog

- **Generator:** ny arketype `prolog` (spec'et i Sub-1 §4.2 men aldrig implementeret — samles op her): kort åbnings-ITT, `profile_type = "itt"`, distance-bånd **5–8 km** (ingen ny profile_type — ITT-distance-skaleringen i §3.2 håndterer gab-realismen automatisk, og ingen switch på profile_type skal udvides).
- GT-/større etapeløbs-arketyper får seeded sandsynlighed for prolog som etape 1. Hjælper #2177-familien (flere ITT-varianter i kalenderen).
- Kræver profil-regenerering for kommende sæson-løb for at slå igennem (samme backfill-script som Sub-1; kun løb uden `race_entries`).

---

## 7. Tekniske finaler

**Afledes af rutedata — persisteres IKKE** (ingen skema-ændring, ingen regen):

```
isTechnicalFinale(stageProfile) =
  finale_type === "descent"
  || (climbs[last] && distance_km − climbs[last].crest_km ∈ [3, 12])   // nedkørsel tæt på mål
  || sectors.some(s => s.start_km + s.length_km ≥ distance_km − 10)    // brosten i finalen
```

Effekt: eksisterende `finaleModifier` udvides — på tekniske finaler vægtes `descending` OG `positioning` (kandidat ±0.06 samlet, centreret om 50). Bredde-builds (#2527): tekniske ryttere får reelle dage.

---

## 8. Rekalibrering + verifikation (OBLIGATORISK før merge)

Protokol (simulér-før-ship, ejer-accepteret arbejdsform):

1. **Harness-udvidelse:** dry-run mod ægte S2-population, 3 gate-seeds, med/uden Sub-3-lag (A/B).
2. **Eksisterende bånd:** ALLE race-gate-bånd (sprinter-vinderrater, udbruds-bånd, kaptajn-delta, type-integritet) skal være grønne med Sub-3 aktiv. Rød → tun modifier-konstanter, ikke ankre.
3. **Nye realisme-bånd:**

| Metrik | Målbånd |
|---|---|
| p90 GC-gab summit-etaper vs dal-etaper (samme profil) | ratio ≥ 1.5 |
| Prolog p90 etape-gab | ≤ 25 s |
| 40 km ITT p90 gab vs 15 km ITT | ratio ≥ 2 |
| Endurance-top-kvartil vinderandel på etaper >110 % af bånd-mid | målbart løft (>+3 pp) mod baseline |
| Udbruds-sejrrate | inden for eksisterende kalibrerings-bånd pr. profil |
| Teknisk-finale-dage: descending/positioning-top-kvartil løft | positivt, bounded |

4. **Determinisme:** etaper UDEN rutedata deep-equal bit-identiske med main (testen der beviser data-gatingen).
5. Scorecard-resultater i PR-beskrivelsen; merge først når ejeren har set dem.

**Rollout-note:** Sub-3 ændrer adfærd for S2-løb midt i sæsonen fra merge-dagen (balance-patch, ikke re-run af kørte løb — kørte resultater er persisterede og urørlige). Patch notes forklarer. Prolog-arketypen kræver regen af kommende løbs profiler (ejer ser dry-run-tal først, jf. destruktiv-ops-reglen).

---

## 9. Filer

| Fil | Ændring |
|---|---|
| `backend/lib/raceSimulator.js` | `stageGapModel` + distance-fatigue + endurance-term + teknisk-finale-modifier + udbruds-faktorer (alle data-gatede) |
| `backend/lib/raceStageProfileGenerator.js` | `prolog`-arketype |
| `backend/lib/raceRouteGenerator.js` | prolog-distance-bånd (5–8 km) |
| `backend/lib/raceRunner.js` | send rutedata-felter med i `stageProfile` til motoren |
| harness-scripts | A/B-scorecard + nye bånd |
| `*.test.js` | data-gating-deep-equal, modifier-matematik, prolog-generator |
| `PatchNotesPage.jsx` + `help.json` | spillervendt forklaring (mere realistiske tidsforskelle) |

Ingen migration (tekniske finaler afledes; prolog bruger eksisterende kolonner). Regen-script genbruges fra Sub-1.

---

## 10. Risici

| Risiko | Mitigering |
|---|---|
| Gate-bånd knækker ved rekalibrering | ankret model → små deltas; tun modifiers, aldrig ankre; 3-seed A/B før merge |
| Dobbelt-effekt (kategori-faktor + summit-faktor stakker for hårdt) | samlet spread-clamp + scorecard-ratio-bånd |
| Mid-sæson adfærdsskifte forvirrer spillere | patch notes + help; kørte resultater urørte |
| Prolog-regen rammer aktive løb | kun løb uden `race_entries`; dry-run-tal til ejer først |
| Endurance-term for svag til at mærkes ("reelt usynlig", jf. form-vægt-læringen fra v3 S2) | bånd kræver målbart løft (>+3 pp) — tunes OP indtil målbar, ikke ned til usynlig |
