# Realistic Routes — Sub-1 (fundament): rute-datamodel + generator

**Status:** Design-spec til ejer-review — INTET er implementeret, ingen migrationer anvendt.
**Dato:** 2026-07-21
**Epic:** [#2768](https://github.com/NicolaiDolmer/CyclingZone/issues/2768) (Verdensklasse løbsmotor). **Dette issue:** [#2769](https://github.com/NicolaiDolmer/CyclingZone/issues/2769) (Sub-1).
**Løser samtidig:** #2755 (D3-kalender skæv), #2527 (etape-diversitet/brosten), #2177 (0 fritstående ITT).
**Fundament:** `backend/lib/raceStageProfileGenerator.js` (nuværende generator, GENERATOR_VERSION 3) · `backend/lib/tierCalendarMaterializer.js` (persistens) · `backend/lib/raceSimulator.js` (frossen kerne) · `backend/lib/raceClassifications.js`.

---

## 1. Bundlinje

Løbsmotoren er korrekt men **parcours-blind**: en etape har i dag kun `profile_type`, `finale_type` og en `demand_vector` — ingen længde, ingen kategoriserede stigninger, ingen mellemsprints, ingen brosten-sektorer inde i etapeløb. Uden den rute-detalje kan konkurrencerne ikke afgøres undervejs, gap-modellen kan ikke skelne summit- fra dal-finish, og der findes intet visuelt rute-udtryk før løbet.

Sub-1 leverer **fundamentet**: en additiv rute-datamodel + en generator-opgradering der udsender en realistisk-generativ rute pr. etape (distance, stigninger, mellemsprints, sektorer), kalibreret mod WorldTour-virkeligheden og tier-mål-båndene fra #2755. Alt andet i epic'en (dybe konkurrencer, løbsform-kobling, præsentation) bygger på denne model.

**Afgørende egenskab:** Sub-1 ændrer **ikke** motorens adfærd. Rute-data persisteres og vises; den *konsumeres* først af Sub-2/Sub-3. Den gate-kalibrerede kerne kører bit-identisk.

---

## 2. Scope

**I scope (Sub-1):**
- Additive kolonner/jsonb på `race_stage_profiles`: `distance_km`, `climbs`, `sprints`, `sectors`, `elevation_gain_m`.
- Generator-opgradering: realistisk km-sekvens pr. arketype (distance + stigninger + sprints + sektorer), deterministisk, bagudkompatibel.
- Stignings-navne-generator (region-flavoured, deterministisk).
- Rute-realisme-scorecard i dry-run-harnesset (verifikation FØR ship).
- Migration (.sql, idempotent) + regenererings-script for eksisterende sæsoner.

**IKKE i scope (senere subs):**
- Passage-ordener / KOM-point / grøn-point / bonussekunder → **Sub-2** (#2770).
- Gap-model der læser stigninger · distance→fatigue · udbruds-forfining · prolog-simulering · tekniske finaler i motoren → **Sub-3** (#2771).
- Etapeprofil-graf / UI → **Sub-4** (#2448).
- Sidevind/vifter → **Sub-5** (#2476).

> Rytter-niveau-realisme (dominans, roller, dagsform, jour sans, styrt, peaks) hører til race-engine v3-depth-specen (`2026-07-11-race-engine-depth-credibility-design.md`) — ikke denne epic.

---

## 3. Datamodel (Sektion A — ejer-godkendt)

**Valg:** jsonb på den eksisterende `race_stage_profiles`-række (én pr. etape) + `distance_km` som ægte kolonne. IKKE en normaliseret `route_segments`-tabel — motoren/konkurrencerne læser hele etapen ind i hukommelsen og regner i kode; de laver aldrig relationelle queries på tværs af stigninger i en hot path. jsonb spejler den eksisterende `demand_vector jsonb`-pattern og gør migrationen additiv.

```sql
-- Additive kolonner (alt eksisterende urørt). Migration committes som .sql, applies post-merge.
ALTER TABLE race_stage_profiles
  ADD COLUMN IF NOT EXISTS distance_km        integer,
  ADD COLUMN IF NOT EXISTS elevation_gain_m   integer,
  ADD COLUMN IF NOT EXISTS climbs             jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sprints            jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sectors            jsonb NOT NULL DEFAULT '[]'::jsonb;
```

**jsonb-former (kontrakt — valideret i generator-tests):**
```
climbs[]  = { name: string,            -- "Alto de Peña Blanca"
              category: "HC"|"1"|"2"|"3"|"4",
              crest_km: number,        -- position (km fra start) hvor toppen ligger
              length_km: number,
              avg_gradient: number,    -- procent
              summit_finish: boolean } -- toppen = mål?
sprints[] = { name: string, km: number, kind: "intermediate"|"finish" }
sectors[] = { kind: "cobbles"|"gravel", start_km: number, length_km: number, name?: string }
```

- `climbs[]` er ÉN kilde der driver bjergkonkurrencen (Sub-2), gap-modellen (Sub-3) og profil-grafen (Sub-4).
- Sorteret efter `crest_km` (resp. `km`, `start_km`) stigende.
- Endagsløb + ITT/prolog: `climbs`/`sprints`/`sectors` kan være tomme (fx ren flad ITT); `sprints` for et endagsløb har typisk kun `{kind:"finish"}`.

---

## 4. Generator (Sektion B — ejer-godkendt)

`generateRaceStageProfiles(race)` bevarer sin nuværende kontrakt og tilføjer et **andet pass** der beriger hver allerede-valgte etape med en rute. Struktur:

1. **Pass 1 (uændret):** vælg `profile_type` + `finale_type` + `demand_vector` pr. etape via hoved-rng'en — bit-identisk med i dag.
2. **Pass 2 (nyt):** `attachRoute(stage, race)` bruger en **dedikeret rng-strøm** (`makeRng(stableSeed(seedKeyFor(race) + ":route:" + stage_number))`) til at udlede `distance_km`, `climbs`, `sprints`, `sectors`, `elevation_gain_m` — konsistent med etapens allerede-valgte `profile_type`/`finale_type`.

### 4.1 Realisme-bånd pr. etapetype (WT-kalibreret)

| Etapetype (`profile_type`/finale) | distance_km | climbs | sprints | sektorer | finish |
|---|---|---|---|---|---|
| flat / bunch_sprint | 150–200 | 0–1 × cat 4 | 1 intermediate + finish | — | massespurt |
| rolling | 150–190 | 1–3 × cat 3-4 | 1 intermediate + finish | — | reduceret/udbrud |
| hilly / punch | 160–210 | 2–4 × cat 2-3 | 1 intermediate + finish | — | opad/reduceret |
| mountain (mellembjerg) | 150–190 | 3–5 × cat 1-3 | 1 intermediate + finish | — | dal/nedkørsel |
| high_mountain (summit) | 140–180 | 2–4 incl. HC/cat 1 | (0-1) + finish | — | summit_finish=true |
| itt | 15–40 | — | finish | — | solo |
| prolog (ny) | 5–8 | — | finish | — | solo |
| cobbles | 150–170 | 0–2 × cat 3-4 | 1 intermediate + finish | 3–6 brosten | reduceret |
| classic | 200–260 | 2–5 (arketype-afhængig) | finish | 0–4 (Roubaix-type) | arketype |

- **Total for et 21-etapers løb** lander ~3200–3500 km (GT-realisme) — verificeres i scorecardet.
- **Stignings-placering:** stigninger fordeles langs ruten med den sværeste sidst når `finale_type` er `long_climb`/summit; ved dal/descent-finish ligger sidste stigning før mål med en nedkørsel til stregen. Konsistent med den eksisterende "bygger mod klimaks"-form.
- **Mellemsprint:** typisk 1 pr. etape (før finalen) + målspurt. Flere på lange flade dage.
- **Brosten i etapeløb:** en `cobbles`-etape kan nu optræde INDE i et etapeløb (lukker #2527/#2755-brosten-hullet — i dag 0 i alle tiers).

### 4.2 Nye arketyper / justeringer

For at ramme tier-mål-båndene (#2755) uden at røre den ejer-låste prestige-kaskade tilføjes/justeres arketyper i `ARCHETYPE_PROFILES` + katalog-tags:
- **`prolog`** (kort åbnings-ITT) — hjælper #2177.
- **`itt_classic`** (fritstående enkeltstart-endagsløb) — #2177 (0 fritstående ITT i dag).
- **`summit_tour`** (etapeløb m. garanteret high_mountain) — hæver tier 3/4 summit-finishes.
- **`mountain_classic`** som endagsløb i lavere klasser — summit-endagsløb i tier 3/4.
- Brosten-sektorer tilføjes som mulighed i udvalgte etapeløbs-arketyper.

> Katalog-re-tagging (`race_pool.terrain_archetype`) af en håndfuld ProSeries/Class1/Class2-løb er en del af Sub-1's leverance, så tier-båndene rammes. Detaljeret liste låses i implementeringsplanen mod live-kataloget.

### 4.3 Stignings-navne

Deterministisk navne-generator: region/land udledes af løbets navn/identitet → plausibelt navn ("Alto de …", "Col de …", "Passo di …", "… Climb"). Gemmes som `climbs[].name`. Giver verdensklasse-følelse + råstof til Sub-2's prikkede-trøje-story-tags.

### 4.4 Determinisme

- Rute-features fra dedikeret rng-strøm → **eksisterende `profile_type`/`finale_type`/`demand_vector` for et givet seed er bit-identiske** (den frosne fordeling + S1's profiler forstyrres ikke).
- Samme seed → samme rute; en divisions parallelle puljer får IDENTISK rute (som i dag, via `seedIdentityFor`).
- Ingen `Math.random`/`Date`. `GENERATOR_VERSION` 3 → 4.

---

## 5. Bagudkompatibilitet + motor-feed (Sektion C — ejer-godkendt)

- **Motoren er urørt i Sub-1.** `demand_vector`/`profile_type`/`finale_type` uændret → terræn-scoring + hele den gate-kalibrerede kerne bit-identisk. Ingen re-kalibrering.
- Rute-data er rent persisteret + vist i Sub-1; konsumeres af Sub-2/Sub-3.
- `race_stage_profiles`-læsere der ikke kender de nye felter degraderer gracefully (default `[]` / null).
- `getSelectionContext` (holdudtagelse) kan senere vise ruten, men Sub-1 kræver ingen ændring der.

---

## 6. Verifikation — rute-realisme-scorecard (Sektion D)

Udvid dry-run-harnesset (`backend/scripts/simulateSeasonDryRun.js`-familien / et nyt `raceRouteRealismMetrics.js`) med et scorecard der måler den genererede kalender mod referencebånd:

**WT-realisme-bånd:**
| Metrik | Målbånd |
|---|---|
| Distance pr. flad etape | 150–200 km |
| Distance pr. bjergetape | 140–190 km |
| Distance pr. ITT | 15–40 km (prolog 5–8) |
| Total-km pr. 21-etapers løb | 3200–3500 km |
| Stigninger pr. GT (kategoriserede) | ≥ 25 |
| HC-stigninger pr. GT | 3–8 |

**Tier-mål-bånd (#2755, pr. gruppe):**
| Metrik | Tier 3 nu | Mål | Tier 4 nu | Mål |
|---|---|---|---|---|
| Summit finishes | 4 | ≥8 | 4 | ≥4 |
| Fritstående ITT | 0 | ≥1 | 0 | ≥1 |
| Brosten-etaper i etapeløb | 0 | ≥1 | 0 | ≥1 |
| M-Down-andel af bjergfinaler | 79% | ≤55% | 75% | ≤60% |

Kør mod den ægte S2-kalender (regenerér profiler in-memory, tæl) FØR apply. Alle eksisterende race-gate-bånd (type-integritet, udbruds-bånd) skal forblive grønne (motoren er urørt → de er det pr. konstruktion, men verificeres).

---

## 7. Migration + udrulning (Sektion D)

- Migration = additive kolonner (§3), committet som `.sql` (idempotent), Claude applier post-merge + post-verify (jf. #2642-rammer).
- Regenererings-script: `backend/scripts/backfillRouteProfiles.js` — regenererer `race_stage_profiles`-rute-felterne (+ `distance_km`) for en sæsons løb via den nye generator. Idempotent (delete-then-set pr. `(race_id, stage_number)` felter). Rører ikke race-rækker, scheduling eller game_day.
- For S2 (upcoming, 0 `race_entries`): sikkert at regenerere → fikser #2755-skævheden som sideeffekt.

**27/7-beslutning (åben — ejer):**
- **(a, anbefalet):** sigt efter at lande Sub-1 + harness-grønt + review før ~26/7 → regenerér S2 → lanceres med ægte ruter + fikset mix.
- **(b):** ryk S2-cutoveren — fravalgt (sæsonmaskineri + #2742 hænger på datoen).
- **(c, fallback):** S2 lanceres som den er; Sub-1 applyer fra S3 (eller mid-S2-regen hvis sikkert).

---

## 8. Filer

| Fil | Ændring |
|---|---|
| `database/2026-07-XX-race-route-model.sql` | NY — additive kolonner (§3) |
| `backend/lib/raceStageProfileGenerator.js` | Pass 2 (`attachRoute`) + arketype-tilføjelser + navne-generator + GENERATOR_VERSION 4 |
| `backend/lib/raceRouteGenerator.js` | NY (valgfri split) — km-sekvens/stigning/sprint/sektor-logik hvis generator-filen bliver for stor |
| `backend/lib/tierCalendarMaterializer.js` | Persistér nye rute-felter i `race_stage_profiles`-insert |
| `backend/lib/raceRouteRealismMetrics.js` | NY — scorecard |
| `backend/scripts/backfillRouteProfiles.js` | NY — regenererings-script |
| `*.test.js` | Generator-determinisme + kontrakt-form + realisme-bånd |

---

## 9. Risici

| Risiko | Mitigering |
|---|---|
| Pass 2 forstyrrer eksisterende profil-fordeling | Dedikeret rng-strøm → bit-identiske eksisterende profiler; deep-equal-test på pass 1-output |
| Genererede ruter rammer ikke WT-realisme | Scorecard-gate mod referencebånd FØR apply |
| Tier-bånd (#2755) rammes ikke af mix alene | Katalog-re-tagging + nye arketyper; verificér i scorecard mod ægte S2 |
| Generator-filen bliver for stor | Split rute-logik til `raceRouteGenerator.js` |
| S2 når ikke 27/7 | Fallback (c): regenerér til S3; ingen cutover-udskydelse |

---

## 10. Åbne beslutninger

1. **27/7-udrulning:** (a)/(b)/(c) — anbefaling (a) med (c) som fallback. **← ejer.**
2. Præcis katalog-re-tag-liste (låses i implementeringsplanen mod live-kataloget).
