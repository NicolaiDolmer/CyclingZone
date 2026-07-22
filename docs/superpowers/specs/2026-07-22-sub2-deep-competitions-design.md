# Dybe konkurrencer — Sub-2: passage-ordener, KOM/grøn-point, bonussekunder

**Status:** Design-spec til ejer-review — INTET er implementeret, ingen migrationer anvendt.
**Dato:** 2026-07-22
**Epic:** [#2768](https://github.com/NicolaiDolmer/CyclingZone/issues/2768). **Dette issue:** [#2770](https://github.com/NicolaiDolmer/CyclingZone/issues/2770) (Sub-2).
**Fundament:** Sub-1 (#2769, live 22/7) — `race_stage_profiles` bærer `distance_km`, `climbs[]`, `sprints[]`, `sectors[]`. Motor-kernen (`raceSimulator.js`) er FROSSEN og røres ikke i Sub-2.

**Ejer-beslutninger (22/7):** Ægte Tour-pointskalaer · bonussekunder 10/6/4 + 3/2/1 · mellemsprint-beslutningen er rolle-drevet (ingen ny UI i Sub-2) · udbruds-bevidst passage-model.

---

## 1. Bundlinje

I dag er pointkonkurrencen ren målplacering på hver etape (samme skala uanset etapetype), og bjergkonkurrencen er målplacering filtreret til klatre-etaper. Mellemsprints og stigningstoppe i Sub-1's rutedata uddeler intet. Sub-2 bygger et **deterministisk passage-lag OVEN PÅ den frosne motor**: ved hvert mellemsprint og hver stigningstop beregnes en passage-rækkefølge, som uddeler grøn-point, KOM-point og bonussekunder. En udbryder kan tage bjergtrøjen ved at føre over dagens stigninger uden at vinde etapen.

**Afgørende egenskab:** `simulateStage` og dens rng-sekvenser er urørte — passage-laget er ren efterbehandling af motorens output med dedikerede rng-strømme. Alle eksisterende race-gate-bånd er grønne pr. konstruktion (verificeres).

---

## 2. Scope

**I scope (Sub-2):**
- Ny ren modul `backend/lib/racePassages.js`: passage-ordener pr. waypoint (stigningstop / mellemsprint / mål).
- Tour-ægte pointskalaer: grøn (type-vægtet mål + mellemsprint) og KOM (pr. kategori, dobbelt ved summit-finish).
- Bonussekunder: 10/6/4 (etapemål, kun fællesstart) + 3/2/1 (mellemsprint) → trækkes fra GC-tid.
- Persistens (SSOT): aggregat-kolonner på `race_results`-etaperækker + ny `race_stage_passages`-tabel til passage-detaljen.
- Klassements-rework: `accumulateStageRows` læser de nye kolonner; legacy-fallback for løb uden rutedata.
- Lean API + simpel passage-liste på etape-/løbssiden (så mekanikken er synlig; grafisk profil er Sub-4).
- Balance-scorecard i dry-run-harnesset FØR ship.
- Patch notes + help.json (en+da).

**IKKE i scope:**
- Motor-ændringer (gap-model, fatigue, udbrud i selve simulationen) → **Sub-3** (#2771).
- Etapeprofil-graf / rig UI → **Sub-4** (#2448).
- Dedikeret "gå efter mellemsprinten"-tactic-felt → senere slice hvis konkurrencen bærer det (ejer-valgt 22/7).
- Endagsløb: har ingen trøjekonkurrencer (som i dag) — passage-laget kører kun for etapeløb.

---

## 3. Passage-modellen (arkitektur)

### 3.1 Modul + kontrakt

```
computePassages({ ranked, stageProfile, entrants, seed })
  → { passages: [ { kind: "kom"|"sprint"|"finish", index, name, km, category?,
                    results: [ { rider_id, passage_rank, points, bonus_seconds } ] } ],
      perRider: Map(rider_id → { kom_points, sprint_points, bonus_seconds }) }
```

Ren funktion, ingen DB. Kaldes af `raceRunner` EFTER `simulateStage`, FØR række-bygning. Waypoints = `stageProfile.climbs[]` (crest) + `sprints[]` (intermediate) + mål. Ingen rutedata (`climbs`/`sprints` tomme + `distance_km` null) → tomt resultat → legacy-adfærd (data-gating, §6).

### 3.2 Udbruds-tilstand (gør udbryder-KOM muligt)

Motoren ved allerede hvem der var i udbrud: `components.breakaway > 0`, og `deriveBreakawayStatus` giver `in_breakaway`/`breakaway_caught` pr. rytter. Passage-laget genbruger det:

- **Overlevende escapees** (ikke indhentet): fører feltet ved ALLE waypoints.
- **Indhentede escapees**: fører indtil et seeded catch-punkt `catch_km` ∈ [0.55, 0.92] · distance (dedikeret rng-strøm `stableSeed(seed + ":catch")`); derefter i feltet.
- Waypoints før catch-punktet: udbruddet passerer først (indbyrdes orden efter waypoint-score, §3.3), feltet bagefter. Efter: alle i én gruppe.

Det er Virenque-modellen: udbruddet støvsuger KOM-point og mellemsprint-point tidligt på etapen, favoritterne tager kun de tunge point i finalen.

### 3.3 Waypoint-score (indbyrdes orden i en gruppe)

Deterministisk pr. waypoint med dedikeret rng-strøm `stableSeed(seed + ":wp:" + kind + ":" + index)` — main-rng røres aldrig:

| Waypoint | Evne-blanding | Noter |
|---|---|---|
| Stigningstop HC/1/2 | climbing 0.75 · endurance 0.25 | |
| Stigningstop 3/4 | climbing 0.50 · punch 0.35 · acceleration 0.15 | korte stigninger = punchere |
| Mellemsprint | sprint 0.60 · acceleration 0.25 · positioning 0.15 | + rolle-vægt: `sprint_captain` ×1.15 (kontesterer aktivt — ejer-valgt spiller-beslutning) |
| Mål | — | målorden ER motorens etape-rangering; genberegnes ALDRIG |

- Score = evne-blanding (0-1-normaliseret) + gaussian(rng, 0, 0.03). Tiebreak: rider_id.
- Kun top-N får point (N = pointskalaens længde); passage-rækker persisteres kun for point-/bonus-modtagere.
- **Summit-finish** (`climbs[last].summit_finish`): KOM-point uddeles efter MÅLORDENEN (toppen er stregen) med dobbelt skala (§4.2).

---

## 4. Pointskalaer (Tour-ægte, ejer-valgt)

### 4.1 Grøn trøje

| Kilde | Skala (1. → n.) |
|---|---|
| Etapemål, flat/cobbles | 50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2 |
| Etapemål, rolling/hilly | 30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2 |
| Etapemål, mountain/high_mountain/itt/ttt | 20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 |
| Mellemsprint (alle etapetyper) | 20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 |

Grøn bliver dermed en ægte sprinter-konkurrence hvor bjergetaper næsten intet giver — og en puncheur kan jage den via mellemsprints i kuperet terræn (niche-strategi som i virkeligheden).

### 4.2 Bjergtrøje (KOM pr. kategoriseret stigning)

| Kategori | Skala (1. → n.) |
|---|---|
| HC | 20, 15, 12, 10, 8, 6, 4, 2 |
| 1 | 10, 8, 6, 4, 2, 1 |
| 2 | 5, 3, 2, 1 |
| 3 | 2, 1 |
| 4 | 1 |
| Summit-finish (HC/1) | dobbelt point (Tour-regel) |

### 4.3 Bonussekunder (→ GC)

- Etapemål: **10/6/4** til top-3 — kun fællesstart-etaper (ikke itt/ttt/prolog).
- Mellemsprint: **3/2/1** til de tre første passager.
- Kun etapeløb. Trækkes fra kumulativ GC-tid ved akkumulering (§5). GC-countback-tiebreak uændret.

---

## 5. Persistens + SSOT

SSOT-princippet (#2072) består: klassementer akkumuleres fra persisterede rækker, re-simuleres aldrig.

**Additive kolonner på `race_results`** (kun 'stage'-rækker udfyldes; null = legacy):
```sql
ALTER TABLE race_results
  ADD COLUMN IF NOT EXISTS sprint_points  integer,
  ADD COLUMN IF NOT EXISTS kom_points     integer,
  ADD COLUMN IF NOT EXISTS bonus_seconds  integer;
```

**Ny tabel `race_stage_passages`** (detaljen — UI/story-råstof, Sub-4 konsumerer):
```sql
CREATE TABLE IF NOT EXISTS race_stage_passages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  stage_number integer NOT NULL DEFAULT 1,
  waypoint_kind text NOT NULL CHECK (waypoint_kind IN ('kom','sprint','finish')),
  waypoint_index integer NOT NULL,
  waypoint_name text,
  waypoint_km numeric,
  climb_category text,
  rider_id uuid,
  rider_name text,
  team_id uuid,
  passage_rank integer NOT NULL,
  points integer NOT NULL DEFAULT 0,
  bonus_seconds integer NOT NULL DEFAULT 0
);
-- RLS: public read (spejler race_results); skrivning kun service_role.
```
Kun rækker med `points > 0` eller `bonus_seconds > 0` persisteres (bounded størrelse). Delete-then-insert pr. `(race_id, stage_number)` i samme atomære flow som `race_results` (#1598-mønstret).

**Akkumulering (`accumulateStageRows`):** pr. etaperække —
- Kolonner udfyldt: `pointsComp += sprint_points`, `komComp += kom_points`, `cumTime += parseGapSeconds(finish_time) − bonus_seconds`.
- Kolonner null (legacy/PCM-import): nuværende adfærd uændret (`classPointsForRank` + `CLIMB_PROFILES`).
- Et løb er altid ensartet (alle etaper med eller uden rutedata) — blandede tilfælde kan ikke opstå pr. konstruktion (profiler genereres samlet).

Trøje-præmiepoint (`race_points` via rank) er uændrede — kun ordnings-inputtet skifter.

---

## 6. Data-gating + bagudkompatibilitet

- **Intet nyt feature-flag.** Passage-laget aktiveres af rutedata-tilstedeværelse: S1-løb (ingen ruter) → bit-identisk legacy; S2+-løb → nye konkurrencer. Matcher ejer-politik (ingen beta-gates); `race_engine_v2/v3`-kill-switches består urørt.
- Læsere der ikke kender de nye kolonner/tabellen degraderer gracefully.
- PCM-importerede løb: kolonner null → legacy-sti.

---

## 7. Synlighed (lean — grafik er Sub-4)

- `GET`-endpoint (eksisterende løbs-API udvides): passage-resultater pr. etape fra `race_stage_passages`.
- Etapesiden: simpel liste pr. waypoint ("Col de Portet (HC) — 1. X 20p, 2. Y 15p …" / "Mellemsprint km 84 — … +3/2/1s"). EN først, DA under.
- GC-/trøje-visninger uændrede (de læser klassements-output, som nu blot er rigtigere).
- Patch notes + help.json (en+da): nye konkurrence-regler forklares (skalaer + bonussekunder).

---

## 8. Verifikation — balance-scorecard FØR ship

Udvid dry-run-harnesset med et konkurrence-scorecard mod den ægte S2-population:

| Metrik | Målbånd |
|---|---|
| Grøn-vinder er sprinter-arketype (flad-tunge etapeløb) | ≥ 60 % |
| Udbryder-andel af KOM-point på bjergetaper (ikke-summit) | 25–60 % |
| KOM-vinder er klatre-/udbryder-profil | ≥ 70 % |
| Bonussekunders median-effekt på GC top-3-marginer | mærkbar men bounded (≤ 45 s ændring; ingen systematisk GC-vinder-flip i >15 % af løb) |
| Eksisterende race-gate-bånd | ALLE grønne (motor urørt — verificeres eksplicit) |
| Determinisme | samme seed → samme passager (deep-equal-test) |

Konstanter der må tunes mod båndene: sprint_captain-kontest-vægt, waypoint-noise-sd, catch-km-interval. Pointskalaerne (§4) er ejer-låste og tunes IKKE.

---

## 9. Filer

| Fil | Ændring |
|---|---|
| `database/2026-07-XX-race-passages.sql` | NY — kolonner + tabel + RLS (idempotent; Claude applier post-merge, #2642-rammer) |
| `backend/lib/racePassages.js` | NY — passage-modul (ren) |
| `backend/lib/raceClassifications.js` | akkumulering læser nye kolonner m. legacy-fallback |
| `backend/lib/raceRunner.js` | kald passage-laget, persistér aggregater + passage-rækker |
| `backend/routes/...` (løbs-API) | passage-endpoint |
| `frontend/...` (etapeside) | simpel passage-liste (en+da i18n-keys) |
| `backend/scripts/...` (harness) | konkurrence-scorecard |
| `*.test.js` | determinisme, skalaer, SSOT-akkumulering, legacy-fallback |
| `PatchNotesPage.jsx` + `help.json` | spillervendt dokumentation |

---

## 10. Risici

| Risiko | Mitigering |
|---|---|
| Grøn/KOM-vindere føles forkerte (arketype-mismatch) | scorecard-bånd (§8) gate'r FØR ship |
| Bonussekunder forvrider GC | bounded bånd + kun 10/6/4-niveau (Tour-realisme) |
| Passage-lag rører motorens rng | pr. konstruktion umuligt (efterbehandling, dedikerede streams) — deep-equal-test på `ranked` før/efter |
| Tabel vokser ukontrolleret | kun point-/bonus-rækker; CASCADE-delete med løbet |
| Legacy-løb knækker | null-kolonne-fallback + tests på PCM-import-form |
