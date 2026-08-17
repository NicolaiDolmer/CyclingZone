# Event-loggen: etape-tidslinjen som førsteklasses artefakt (#2410) — design-spec

> **Status:** Ejer-besluttet 2026-08-17 (valg 1-3, se beslutningslog) — afventer prototype-gate (§5).
> **Kilde:** race-oplevelses-sessionen 17/8. Grundlag: kodelæsning af raceSimulator.js,
> raceRunner.js, racePassages.js, raceNarrative.js + prod-målinger (queries i denne fil).
> **Regel:** denne spec må aldrig slettes (design-plan-reglen); byg ovenpå.
> **Placering:** fundament for Race Centre/løbsfilm (bølge 2-planen forslag 3+8), recap v2
> (#2356), Discord pr. etape (#1815), OG-kort (#1299). Jf. #2410's stående datakontrakt-krav.

## 1. Hvad motoren FAKTISK emitterer i dag (målt, ikke gættet)

Motoren er en **single-shot scorer** — der findes ingen intra-etape-simulation. `simulateStage`
(backend/lib/raceSimulator.js:599) beregner pr. rytter én `finalScore` af 13 komponenter
(`terrain, noise, form, fatigue, team, breakaway, finale, work_cost, dayform, jour_sans, peak,
long_day, incident`), rangerer, og afleder tids-gab af score-deficit (gapFor:558). Alt
"undervejs" er i dag **baglæns-afledt efterbehandling**:

| Lag | Fil | Persisteres i | Indhold |
|---|---|---|---|
| Reproducerbarhed | raceRunner.js | `race_simulation_runs` (1.929 runs, 766 løb) | seed, engine_version, entrant_snapshot, input_checksum, salt_version |
| Score-dekomposition | raceSimulator.js | `race_simulation_rider_scores` (222.875 rk., 106 MB, admin-RLS) | run_id, rider_id, rank, components |
| Resultat | raceRunner.js | `race_results` (394 MB) | rank, finish_time, in_breakaway, breakaway_caught, sprint/kom_points, bonus_seconds |
| Waypoint-passager | racePassages.js | `race_stage_passages` (26.074 rk., 5,7 MB) | kind (kom/sprint/finish), km, kategori, passage_rank, points, bonus |
| Uheld | raceIncidents.js | `race_incidents` (2.812 rk.) | kind, outcome, time_loss_seconds — **intet km-mærke** |
| Narrative momenter | raceNarrative.js | `race_stage_moments` (42.434 rk., 14 MB, spiller-RLS) | 13 beat-keys + 10 tag-keys, params, significance — **intet km-mærke** |

Nøglefakta for designet:

1. **Catch-punktet findes allerede deterministisk men persisteres ikke:** racePassages.js:76-78
   afleder `catchKm` af en dedikeret rng-strøm (`stableSeed(`${seed}:catch`)`), 55-92 % af
   distancen — indhentede udbrydere er i front FØR dette km i waypoint-ordenen. Tidslinjen kan
   genbruge PRÆCIS denne værdi (bit-identisk) når seed kendes.
2. **Ingen gap-kurve eksisterer.** Udbruddets forspring over dagen er aldrig beregnet — kun
   slut-gabet (race_results) og catch-punktet. En kurve skal SYNTETISERES (valg 2).
3. **Uheld og momenter har ingen position på ruten.** Km-mærker for styrt/crack/attack skal
   syntetiseres deterministisk (seeded, samme mønster som catchKm).
4. **Fuld reproducerbarhed kun for løb med runs:** 766 løb / 1.929 etaper har seed +
   entrant_snapshot. Ældre løb (PCM-import, pre-engine) kan kun få en degraderet tidslinje
   (results + passages + moments uden re-sim).
5. **Fog-gaten (#1791) gælder:** tidslinjen må aldrig eksponere rå komponenter/vægte — kun
   rangeringer, tælletal, allerede-offentlige gaps og km-mærker (raceNarrative.js håndhæver
   dette mønster i dag; tidslinjen arver det).

Skala (prod 17/8): S1 = 1.060 etapedage, S2 = 1.148, S3 = 1.138 planlagt (alle divisioner).
Felt-snit 138 ryttere (S2).

## 2. Kontrakten

### 2.1 Artefaktet

Én deterministisk genereret **etape-tidslinje** pr. (race_id, stage_number): ordnet liste af
events med km-mærke. Genereres i samme rene build-trin som moments/passages (raceRunner.js
buildStageRowsAccumulated/buildRaceResults → nyt felt `timeline`), persisteres med samme
idempotente delete-then-insert-mønster, bag eget flag. **Flag-off ændrer intet i motoren —
tidslinjen er ADDITIV observation** (samme garanti som moments, S6-mønstret).

Lagringsform = **valg 1** (nedenfor). Feltet `timeline_version` (heltal) stemples pr. artefakt;
generator-ændringer bumper versionen, gamle artefakter re-genereres ikke automatisk.

### 2.2 Event-taksonomi v1

Alle events: `{ km, type, params }` — km ∈ [0, distance_km], listen sorteret på km.
**Forankring** = hvor data kommer fra. (S) = syntetiseret km/kurve, deterministisk seeded.

| type | forankring | params (skitse) |
|---|---|---|
| `stage_start` | results (feltstørrelse), profil | field_count, profile_type, distance_km |
| `breakaway_formed` | results.in_breakaway; km (S, tidligt vindue) | rider_ids (1-3) |
| `gap_update` | (S) kurvepunkter — **valg 2** | gap_seconds |
| `kom_passage` | race_stage_passages (km, kategori, top-N) | name, category, top: [{rider_id, points}] |
| `intermediate_sprint` | race_stage_passages | name, top: [{rider_id, points, bonus_seconds}] |
| `breakaway_caught` | results.breakaway_caught; km = catchKm (re-afledt fra seed; degraderet: S) | rider_ids |
| `breakaway_survived` | results/moments; km = sidste kurvepunkt | rider_ids, final_gap |
| `incident` | race_incidents; km (S) | rider_id, kind, outcome, time_loss_seconds |
| `favorite_crack` | moments favorite_off_day/tag_jour_sans; km = sidste stigning/finale | rider_id, reason (jour_sans/incident/helper_work/unexplained) |
| `finale_attack` | moments solo_win/close_win + finale_type; km = finale-vindue | rider_id |
| `sprint_decided` | finalKilometre-afledning (gap < 3 s), fotofinish < 1 s | rider_ids, photo_finish |
| `finish` | race_results top-N + win_type | top: [{rider_id, rank, gap}], win_type |
| `gc_change` | moments gc_takeover (kun etapeløb) | new_leader_id, previous_leader_id |

Taksonomien er ÅBEN for tilføjelser (udbrud v2 #2416, TTT #2412, vejr #939 osv. definerer deres
events som del af deres design — stående krav på #2410). Ukendte event-typer skal ignoreres
tavst af alle aftagere (forward-kompatibilitet).

### 2.3 Konsistensregler (hårde)

1. Tidslinjen må ALDRIG modsige persisterede ranks/gaps/passages/moments — den er en renderer,
   ikke en kilde. Finish-eventens rækkefølge = race_results' rangorden, bit-identisk.
2. Gap-kurvens slutpunkt SKAL matche persisteret virkelighed: caught → kurven rammer 0 ved
   catchKm; survived → kurven ender i vinderens persisterede slut-gab.
3. Alle rider_ids skal findes i etapens race_results (eller race_incidents for abandons).
4. km monotont ikke-faldende; determinisme: samme (seed, input) → samme tidslinje, byte for byte.
5. Ingen rå komponenter, vægte eller sandsynligheder i params (fog-gate #1791).
6. `race_simulation_runs` + `race_simulation_rider_scores` må ALDRIG prunes uden eksplicit
   retention-beslutning (stående krav fra #2410).

### 2.4 Afspilnings-API (skitse)

`GET /api/races/:raceId/timeline?stage=N` → `{ timeline_version, stage_number, events }`.
Spillervendt RLS (samme model som race_stage_moments). Frontend-afspillere (Race Centre,
løbsfilm) scrubber over events; The Final Kilometre forbliver et selvstændigt finale-zoom
(deler ikke kode, deler data).

## 3. Storage-estimat (FØR byg — fuld sæson, alle divisioner)

Målt volumen-anker: 25-40 events/etape á ~200-400 B JSONB.

| Scenarie | Rækker | Størrelse |
|---|---|---|
| JSONB-artefakt pr. etape (valg 1A) | ~1.138 rk./sæson | **~7-17 MB pr. sæson** |
| Række pr. event (valg 1B) | ~35-45.000 rk./sæson | ~15-25 MB pr. sæson inkl. index |
| Backfill S1+S2 (kun løb med runs, 1.929 etaper) | +1.929 rk. | +12-29 MB engangs |

Til sammenligning: race_stage_moments 14 MB, rider_scores 106 MB, race_results 394 MB.
Tidslinjen er i alle scenarier < 5 % af eksisterende race-data-fodaftryk.

## 4. Designvalg — ✅ ALLE TRE EJER-BESLUTTET 17/8

**Beslutningslog 2026-08-17 (ejer i race-oplevelses-sessionen):**
- **Valg 1 → A:** JSONB-artefakt pr. etape (`race_stage_timelines`).
- **Valg 2 → kontrakt først (revideret valg):** ejeren pegede på den ægte intra-etape-motor
  ("beregn etapen undervejs") som slutmålet. Besluttet: artefakt-kontrakten bygges NU med
  syntetisk film som midlertidig udfylder; en ægte intra-etape-motor emitterer SENERE samme
  kontrakt nativt (eget design-issue, højt prioriteret efter cutover, simulér-før-ship-krav).
  Alt UI bygges mod artefaktet og består uændret ved motor-skiftet.
- **Valg 3 → A:** forward-only fra S3 (flag-on før 23/8-sæsonen); backfill af de 1.929
  historiske etaper med runs = opfølgnings-issue, besluttes når filmen har bevist sig.

**Valg 1 — lagringsform.** A: JSONB-artefakt pr. etape i ny tabel `race_stage_timelines`
(race_id, stage_number, timeline_version, events JSONB). B: række-pr-event-tabel.
Anbefaling: **A** — aftagerne (film, recap, Discord, OG-kort) læser altid hele etapen samlet;
én fetch, atomisk erstatning, nem versionering. Tværgående per-rytter-highlights dækkes
allerede af race_stage_moments (som består uændret).

**Valg 2 — syntese-dybde i v1.** A: fuld film inkl. syntetiseret gap-kurve + km-mærker for
uheld/cracks (deterministisk seeded; kurven er bunden af konsistensregel 2). B: kun hårdt
forankrede events (passages, catch, finish, moments-afledninger) — ingen opfunden kurve.
Anbefaling: **A bag prototype-gaten** — kurven ER løbsfilmens puls; om en baglæns-afledt kurve
føles ægte er præcis det prototype-gaten (issue-krav) tester billigt FØR slices.

**Valg 3 — dækning.** A: forward-only fra flag-on (S3-sæsonen fra 23/8 får fuld dækning fra
dag 1). B: A + backfill-script for de 1.929 historiske etaper med runs (ejer-gated batch
post-ship). Anbefaling: **A nu, B som opfølgnings-issue** — S3-starten er den oplevelse der
tæller; backfill er additiv og kan altid køres senere.

## 5. Prototype-gate (issue-krav, FØR slices)

3-4 håndplukkede etaper (bjergetape m. jour sans, massespurt m. styrt, udbrudssejr) renderes
som tidslinje fra ÆGTE persisterede data og ejer-vurderes med egne øjne. Farligste antagelse:
at en film afledt baglæns fra komponent-summen føles ægte. Fejler den, er alternativet et ægte
intra-etape-lag (stor beslutning, eget design — IKKE dette spor).

## 6. Slices

- **S0 prototype (ingen persistens):** ren generator-funktion (backend/lib/raceTimeline.js) +
  kørsel mod 3-4 ægte etaper → ejer-gate.
- **S1 lager + API:** migration (ny tabel, spiller-RLS), generator-hook i raceRunner (bag flag
  `race_stage_timeline`), afspilnings-endpoint, unit-tests (determinisme + konsistensregler),
  dry-run mod ægte etape.
- **S2 UI:** Race Centre/løbsfilm-afspiller — separat design med mockups (godkendt mockup =
  kontrakten), lazy-loaded (bundle-vagt: ~6 KB luft).
- **S3 (option, efter valg 3):** backfill-script for historiske løb med runs.

## 7. Koordinering

Recap v2 (#2356) skal læse momenter/tidslinje herfra i stedet for at opfinde egne (AC på
#2410). Discord pr. etape (#1815) og OG-kort (#1299) er senere aftagere. LLM-narration må KUN
narrere event-loggen (stående krav). Final Kilometre (#3396) er uafhængig af dette spor.
