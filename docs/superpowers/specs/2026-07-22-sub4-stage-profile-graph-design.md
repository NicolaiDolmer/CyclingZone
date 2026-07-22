# Etapeprofil-grafen — Sub-4: ruten som spillerne ser den

**Status:** Design-spec, ejer-godkendt 2026-07-22 (retning + flader + race-read + #1484-afløsning valgt på mockup). INTET er implementeret.
**Dato:** 2026-07-22
**Epic:** [#2768](https://github.com/NicolaiDolmer/CyclingZone/issues/2768). **Dette issue:** [#2448](https://github.com/NicolaiDolmer/CyclingZone/issues/2448) (Sub-4).
**Fundament:** Sub-1 (#2769) `race_stage_profiles.distance_km/elevation_gain_m/climbs[]/sprints[]/sectors[]` · Sub-2 (#2770) `race_stage_passages` + point-/bonus-skalaer · Sub-3 (#2771) `stageGapModel`/`isTechnicalFinale`/`distanceFactor`. Alle tre er LIVE, og S2's 455 løb / 1148 etaper har rutedata (regen verificeret 22/7).

---

## 1. Bundlinje

Motoren har siden 22/7 læst en fuld rute pr. etape, men spilleren kan ikke se den. Etapesiden viser stadig #1484's kategori-piktogram — en håndtegnet form der er den samme for hver `high_mountain`-etape i spillet, uanset om den slutter på toppen af en HC-stigning eller 20 km nede ad bakke. Sub-2's passage-liste viser hvad der skete ved hvert waypoint, men ikke hvor på ruten det lå.

Sub-4 leverer **etapeprofil-grafen**: en deterministisk SVG tegnet 1:1 fra `race_stage_profiles`-rækken. Ejer-princippet 22/7: *profilen spillerne ser ER den data motoren bruger* — hvert element på grafen kommer fra et felt motoren konsumerer, og hvert felt motoren konsumerer er aflæseligt på grafen.

---

## 2. Scope

**I scope:**

| # | Flade | Indhold |
|---|---|---|
| 1 | Etapesiden (primær) | Fuld graf: højdeakse, silhuet, kategoriserede stigninger m. navn/længde/gradient/KOM-point, mellemsprints, brosten-sektorer, km-akse, målflag, race-read-chips, waypoint-readout |
| 2 | Etape-fanen efter løb | Samme graf; klik/tap på et waypoint → Sub-2-passageresultat i readout |
| 3 | Holdudtagelse | Kompakt graf over `RaceSelectionPanel` for den valgte etape |
| 4 | Etape-striben | Mini-silhuetter pr. etape med **fælles y-skala** på tværs af løbet |
| 5 | Løbs-oversigt / kalenderkort | Mini-thumbnail pr. løbskort — **gated på målt query-omkostning** (§9) |

**IKKE i scope:**
- Ændringer i motoren, generatoren eller passage-laget. Sub-4 er ren præsentation.
- Punkt-for-punkt-højdedata. Findes ikke; silhuetten syntetiseres (§4) og spec'en dokumenterer metoden.
- Sidevind/vifter → Sub-5 (#2476).
- Backend-ændring til holdudtagelsen: `RaceSelectionPanel` renderes udelukkende fra `RaceDetailPage`, som allerede har hentet profilerne. `getSelectionContext` udvides **ikke** — fladen løses ved at sende profil-objektet ned som prop. (Ejeren nævnte `getSelectionContext`; verificeret at det ikke er nødvendigt, fordi panelet ikke har sin egen side.)

---

## 3. Sandhedsprincippet — felt-for-felt

Hvert felt vises, og intet vises som ikke har en kilde:

| Kilde-felt | Hvor det ses | Hvad motoren gør med det |
|---|---|---|
| `distance_km` | Stat-linje, km-akse, silhuettens bredde | `distanceFactor` → fatigue-skalering + `long_day`-endurance-term |
| `elevation_gain_m` | Stat-linje **og silhuettens samlede stigning** (§4) | (indirekte — karakteriserer etapen) |
| `climbs[].crest_km` | Toppens x-position, markør på aksen | Sidste tops afstand til mål → summit/dal-finale |
| `climbs[].length_km` / `avg_gradient` | Rampens bredde/højde + label + rampens farve-intensitet | Højdemeter; kategorien afledes heraf |
| `climbs[].category` | Kategori-chip + markør-farve | `LAST_CLIMB_CATEGORY_FACTORS` på spredningen · KOM-skala |
| `climbs[].summit_finish` | Målflag placeret på toppen; race-read-chip | `bunch = 0`, spredning ×1,3 |
| `sprints[]` (intermediate) | Grøn markør + stiplet linje + point/bonus-label | Grøn-point 20/17/15… + bonus 3/2/1 |
| `sectors[]` | Skraveret bånd i grafen og på aksen | Sektor der slutter inden for de sidste 10 km → teknisk finale |
| — (afledt) | Race-read-chips | `isTechnicalFinale` · summit vs. dal · lang/kort dag |

**Nul-opfindelse-reglen:** ingen bynavne, ingen feed-zoner, ingen højdemeter-tal pr. stigning, ingen km-to-go-tabeller — intet af det findes i datamodellen. Der tegnes kun det der kan udledes af rækken.

---

## 4. Silhuet-syntesen (metoden, med invariant)

Der findes ingen punkt-for-punkt-højdedata. Silhuetten syntetiseres deterministisk fra rækken. Prototypen er kørt mod fem ægte S2-etaper (bjerg m. dal-finish, summit-finish, brosten, klassiker, 6 km-prolog) med 0,000 m afvigelse på invarianten.

**Trin:**

1. **Knuder.** Start i dal-referencen (180 m). For hver stigning sorteret på `crest_km`: en fod ved `crest_km − length_km` (aldrig bag forrige top; minimum 0,5 km bred) i dal-højde, og en top ved `crest_km` i `dal + gain`, hvor `gain = round(length_km × 1000 × avg_gradient / 100)` — nøjagtig samme formel som generatorens `elevationGain()`. Slutter ruten ikke på en top, føres en knude til dal-højde ved `distance_km`.
2. **Bølgeterræn.** Mellem stigningerne lægges en sum af tre sinus-led. Bølgelængderne skalerer med distancen (`D/14`, `D/6`, `D/26`, clampet), så en 6 km-prolog ikke arver en 160 km-etapes bølger. Faserne kommer fra en FNV-1a-hash af løbsidentitet + etapenummer — ingen `Math.random`, ingen `Date`. Bølgen maskeres til 0 inde i en stignings-rampe (ramperne skal være rene) med en 3 km blød indfasning, og nulstilles ved x = 0 så ruten altid starter i dal-højde.
3. **Amplitude-bisektion (invarianten).** Bølgens amplitude findes ved bisektion, så **kurvens samlede positive stigning er nøjagtig `elevation_gain_m`**. Da stigningernes ramper allerede bidrager med deres egen sum, absorberer bølgen præcis det generatoren lagde oveni som `BASE_ELEVATION[profile_type]`.

**Invariant (test-krav):** `Σ max(0, y[i] − y[i−1]) == elevation_gain_m` inden for 0,5 m for enhver profil-række.
**Determinisme (test-krav):** samme række → bit-identisk `points`-streng.

Metoden er **ikke** en påstand om at ruten fysisk ser sådan ud. Den er en påstand om at *hver aflæselig størrelse på kurven er sand*: en stignings placering, længde, stejlhed og højde, og etapens samlede højdemeter. Bølgeterrænet mellem stigningerne er den eneste frie form, og selv dens samlede stigning er bundet af invarianten.

---

## 5. Visuelt sprog (ejer-godkendt retning: telemetri + roadbook-annotering)

- **Silhuet:** ink-linje (1,2 px) på 9 % ink-fyld. Ingen gradienter, ingen glød, ingen skygger.
- **Stigninger:** lodret bånd bag rampen (KOM-rød, 4,5 % fyld) + rampen selv tegnet i KOM-rød med tre intensiteter efter `avg_gradient` (<6 % / 6–8 % / >8 %). Ét kulørt hue til stigninger — ikke en regnbue.
- **Kategori-chip:** udfyldt rektangel med kategorien, mættet efter hårdhed (HC massiv, cat 4 svag). KOM-pointene står ved chippen (`HC 20p`), ikke på aksen.
- **Mellemsprint:** grøn markør (point-trøjens hue) + stiplet lodret linje + `SPRINT · 20p · +3s`.
- **Brosten:** diagonalt skraveret bånd — samme skravering i grafen og på aksen.
- **Mål:** ternet flag på aksen; ved `summit_finish` sidder flaget på toppen, ellers ved stregen i dal-højde.
- **Typografi:** Bebas Neue til de store tal (KM / M / CLIMBS) og kortets titel; Inter Tight til labels; mono til tal i akser og readout. Radius 5 px (`--radius-sm`), aldrig større. Alle farver fra eksisterende tokens (`--jersey-mountain` som KOM-rød, `--jersey-points` som sprint-grøn, `--accent` kun til mål/aktiv-tilstand).

**Race-read-chips (kvalitativ — ejer-valgt):** korte udsagn om hvad ruten gør ved løbet, **uden** de rå spredningsfaktorer: `Summit finish` / `N km descent to the line` / `Technical finale` / `Long day` / `N cobbled sectors`, hver med en linjes forklaring. Betingelserne er identiske med motorens (§7), men kalibrerings-tallene offentliggøres ikke.

---

## 6. Komponent-arkitektur

Ny, ren logik-fil + tre komponenter. Grænsefladerne er snævre nok til at hver del kan testes for sig.

```
frontend/src/lib/stageRouteProfile.js          NY — ren .js (node --test), ingen React
  hasRouteData(profile) -> boolean             gaten for hele fladen
  buildProfileSeries(profile, {yMax?}) -> {xs, ys, spans, maxY, ascent}
  routeReadKeys(profile) -> [{key, params}]    i18n-nøgler, kvalitativ (§7)
  waypointsFor(profile) -> [{kind, index, name, km, category?, points?, bonus?}]
  komPointsForClimb(climb) -> number           Sub-2-skala, dobbelt ved summit HC/1

frontend/src/components/race/StageProfileGraph.jsx   NY — SVG, tier: "full"|"compact"|"mini"
frontend/src/components/race/StageProfileCard.jsx    NY — header + race-read + graf + readout
frontend/src/components/race/StageWaypointReadout.jsx NY — "AT STAKE" / "RESULT"
```

**Ændrede filer:**

| Fil | Ændring |
|---|---|
| `frontend/src/pages/RaceDetailPage.jsx` | `race_stage_profiles`-select udvides med `distance_km, elevation_gain_m, climbs, sprints, sectors`. Den inline `StageProfileCard`/`StageProfileSilhouette` fjernes og erstattes af den nye komponent. `StageDetailPanel` erstattes på kommende-fladen. Kompakt graf indsættes over `RaceSelectionPanel`. |
| `frontend/src/components/race/StageStripe.jsx` | `MiniSilhouette` skifter fra `profileShape()` til `buildProfileSeries()` **når rutedata findes**, med fælles `yMax` beregnet over løbets etaper; ellers uændret piktogram |
| `frontend/src/components/race/StageDetailPanel.jsx` | Beholder terrain-DNA-baren; silhuet + finale-markør erstattes af grafen når rutedata findes |
| `frontend/src/lib/raceStagePassages.js` | Tilføjer opslag `waypoint_kind + waypoint_index → resultatrækker` til readout'et |
| `frontend/public/locales/{en,da}/races.json` | `detail.route.*` (§8) |
| `frontend/src/preview/seedData.js` | Rutefelter + passage-rækker på seed-profilerne, så preview kan klikkes igennem (§10) |

**#1484-afløsning (ejer-valgt):** har etapen rutedata, vises kun den ægte graf — kategori-piktogrammet siger det samme, bare mindre sandt. Mangler rutedata (S1, PCM-import), står #1484 uændret. `stageProfileConfig.js` slettes **ikke**; den er stadig kilden for den degraderede sti og for `profileLabelKey`/`finaleLabelKey`.

---

## 7. Race-read + drift-guard mod motoren

`routeReadKeys()` spejler motorens betingelser præcist:

| Chip | Betingelse (identisk med backend) |
|---|---|
| `summit` | `climbs[sidste].summit_finish === true` |
| `valley` | `distance_km − sidste crest_km >= VALLEY_MIN_DESCENT_KM` (10) |
| `technical` | `finale_type === "descent"` **eller** sidste crest 3–12 km fra mål **eller** en sektor slutter inden for de sidste 10 km |
| `long` / `short` | `distance_km / DISTANCE_BAND_MIDPOINTS[profile_type]` ≥ 1,06 / ≤ 0,94 |
| `cobbles` | `sectors.length > 0` |

Tærsklerne duplikeres i frontend (backend-kode må ikke bundles ind i browseren), men **driften afskæres af en test**: `stageRouteProfile.test.js` importerer `backend/lib/raceSimulator.js` (`TECHNICAL_DESCENT_WINDOW_KM`, `VALLEY_MIN_DESCENT_KM`, `DISTANCE_BAND_MIDPOINTS`) og `backend/lib/racePassages.js` (`KOM_SCALES`, `GREEN_FINISH_SCALES`, `INTERMEDIATE_SPRINT_SCALE`, `FINISH_BONUS_SECONDS`, `INTERMEDIATE_BONUS_SECONDS`) via relativ sti og asserter lighed. Cross-import er verificeret at virke fra `frontend/` (begge backend-moduler har kun relative imports). Ændrer nogen en motor-konstant uden at rette grafen, bliver testen rød.

`1,06`/`0,94`-tærsklerne for lang/kort dag er Sub-4's egne præsentations-tærskler (motoren clamper `distanceFactor` til [0,85, 1,20] uden en diskret grænse) og dokumenteres som sådan i modulet.

---

## 8. i18n (en primær, da sekundær)

Alle nøgler under `detail.route.*` i `races`-namespacet:

```
detail.route.stats.km / .elevation / .climbs
detail.route.read.summit.label|note        "Summit finish" / "the climb is the line — no bunch finish"
detail.route.read.valley.label|note        "{{km}} km descent to the line" / "chasers can come back"
detail.route.read.technical.label|note     "Technical finale" / "descending & positioning decide it"
detail.route.read.long.label|note          "Long day" / "endurance & fatigue amplified"
detail.route.read.short.label|note         "Short day" / "fatigue damped"
detail.route.read.cobbles.label|note       "{{count}} cobbled sectors" / "positioning & power over pavé"
detail.route.waypoint.climb|sprint|finish  waypoint-titler
detail.route.atStake / detail.route.result readout-overskrifter
detail.route.komPoints / .greenPoints / .bonusSeconds
detail.route.gradient                      "{{length}} km @ {{gradient}}%"
detail.route.a11y.graph                    aria-label for SVG'en
```

Stignings-navne (`climbs[].name`) er data og oversættes ikke.

---

## 9. Kalenderkort-fladen (gated)

Løbs-oversigten (`RacesPage`) henter i dag `races` uden profiler. En thumbnail kræver `race_stage_profiles` for alle synlige løb — med 455 løb i S2 og jsonb-kolonner er det en reel omkostning.

**Gate:** fladen bygges som sidste task med ét bounded kald (`.in("race_id", synligeIds)`, kun `stage_number, profile_type, distance_km, elevation_gain_m, climbs, sectors`) for de løb der faktisk er på skærmen. Query-tid og svar-størrelse måles mod prod. **Holder den sig ikke inden for ~150 ms / ~250 KB, droppes fladen** og boardet beholder sin nuværende visning — ærligt rapporteret frem for at sende en langsom oversigt i produktion.

Visning: endagsløb → én mini-profil. Etapeløb → komprimeret mini-stribe (alle etaper, fælles y-skala), fordi én enkelt etape ville give et falsk indtryk af hele løbet.

---

## 10. Degradering + preview

- **Ingen rutedata** (`distance_km` null): grafen renderes slet ikke; #1484-piktogrammet står uændret. Ingen syntetisk kurve, ingen opfundne stigninger.
- **Delvis data** (rutedata uden `climbs`, fx flad etape eller ITT): grafen renderes — en flad rute *er* profilen. Kun `distance_km` er påkrævet.
- **Manglende passage-rækker** (etape ikke kørt / tabel tom): readout viser "AT STAKE" i stedet for "RESULT". Aldrig en fejl-flade.
- **Preview:** `seedData.js` udvides med rutefelter på alle seed-profiler + passage-rækker på de kørte etaper, så ejeren kan klikke hele fladen igennem på en Vercel-preview — inkl. summit-finish, dal-finish og brosten. Dette er et krav, ikke en bonus (#1834-erfaringen).

---

## 11. Verifikation

| Type | Krav |
|---|---|
| `node --test` (frontend) | Invariant (samlet stigning == `elevation_gain_m` ±0,5 m) på ≥5 ægte S2-rækker · determinisme (bit-identisk output) · `hasRouteData`-gaten · `routeReadKeys` på summit/dal/teknisk/lang/brosten · `komPointsForClimb` inkl. summit-dobling · **drift-guard mod backend-konstanter** (§7) |
| `npm run lint` | Grøn FØR push (verify-local kører ikke eslint) |
| Playwright | Alle 3 projekter (desktop-chromium + mobile-chromium + mobile-webkit) — visuel ændring |
| Preview | Ejeren skal kunne klikke fladen igennem med rutedata FØR merge |
| Bundle | Perf-gaten i CI må ikke brydes; grafen er ren SVG uden nye dependencies |

---

## 12. Risici

| Risiko | Mitigering |
|---|---|
| Silhuetten opfattes som en påstand om ægte højdedata | Metoden dokumenteres (§4) + invarianten gør hver aflæselig størrelse sand; ingen højdemeter-tal pr. stigning |
| Label-kollision ved mange stigninger tæt sammen | To-niveau-labels på desktop; på mobil falder navne væk og readout bærer detaljen ved tap |
| Fælles y-skala gør flade etaper til streger i striben | Det er sandheden og pointen — men mini-silhuetten beholder en synlig minimums-amplitude så etapen ikke ser tom ud |
| Kalenderkort-query for tung | Målt gate (§9), fladen droppes hellere end at gøre boardet langsomt |
| Frontend-tærskler driver fra motoren | Drift-guard-test (§7) |
| Cross-import (frontend-test → backend-lib) knækker i CI | Verificeret lokalt; hvis CI afviser den, flyttes drift-guarden til en backend-test der importerer frontend-modulet (samme assertion, modsat retning) |
