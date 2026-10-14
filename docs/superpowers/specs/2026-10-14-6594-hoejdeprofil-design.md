# #6594 Rigtig højdeprofil pr. etape: design + målt baseline (14/10)

Issue **#6594** (Refs #6574 #6570 #6366 #6367 #6565). Ejer 14/10: med FØR S5-generering, byg torsdag 16/10, med i tørkørslen gennem gaten #6367. Fallback (ejerens): bliver den ikke grøn i gaten, genereres S5 uden serien og opgraderes senere.

Billede: [`pr-screens/6594/hoejdeprofil-prototype.png`](../../../pr-screens/6594/hoejdeprofil-prototype.png) (S5-højbjergetape med HC-mål + kuperet etape med nedkørsel, tegnet med prototypen nedenfor; stiplet blå = det road book kan tegne i dag).

## 0. Problemet, bekræftet

- `race_stage_profiles` (schema-snapshot) har `distance_km, elevation_gain_m, climbs, sprints, sectors, segments, weather`; ingen højde pr. km. `segments[].top_elevation_m` findes, men er "plausibelt kumuleret" (`routeSegments.js` l.129-134) og ikke en profil.
- `elevation_gain_m` og stigningerne er **to kilder**. Målt på prod, S4, 448 unikke parcours (SELECT, §3.2): forskellen er PRÆCIS v5's `BASE_ELEVATION` pr. type (højbjerg +1.100 m, bjerg +900, kuperet +700, flad +200 ...). Den del af tallet har ingen placering på ruten, derfor kan ingen flade tegne den. S5 (generator v6) erstatter grundtallet med `8 m/km × distance` (#6366), men det er stadig et tal uden placering.
- Road book (`frontend/api/og/_lib/terrain.ts` på `feat/6574-roadbook-og`) tegner derfor kun stigningernes ramper, vandret imellem, og skriver selv: "kurven påstår ikke at summere til [elevation_gain_m]".

## 1. Datamodel

| Valg | Beslutning | Hvorfor / alternativ |
|---|---|---|
| Placering | **Ny nullable kolonne** `race_stage_profiles.elevation_profile jsonb` | `segments` læses af motoren (`engine/v4/adapters/routeAdapter.ts` l.188); at lægge serien dér ændrer motorens input. Ny kolonne = motoren uberørt. Alternativ (felt i `segments`-JSON) afvist af samme grund. |
| Format | `{"v":1,"step_km":0.5,"h":[512,514,...]}` — heltal meter, ét punkt pr. skridt, `h[0]` = start, `h[n]` = mål | Læsbart i SQL/JSON, ingen dekoder. `step_km = distance_km / round(distance_km/0.5)` så serien dækker [0, D] præcist. |
| Opløsning | 0,5 km | Stigninger (kat. 4 ≥ 1 km) får ≥ 2 punkter; afslutnings-ramper på 0,5-1,4 km får 1-3 punkter. Finere opløsning (0,25 km sidste 3 km) er en mulig v2, ikke nødvendig torsdag. |
| Størrelse (målt) | gns. **1.318 B**, maks 2.311 B pr. etape (JSON-tekst; TOAST komprimerer yderligere) | ~1.316 rækker/sæson (S4 målt) → ~1,7 MB/sæson. S4's hele række er i dag gns. 1.313 B; serien ~fordobler rækken. Ubetydeligt for Postgres. |
| Semantik | `elevation_gain_m === Σ max(0, h[i+1]-h[i])` (**én kilde**) | Generatoren beregner `elevation_gain_m` som i dag og bygger serien, så den summerer præcist dertil. Testen håndhæver lighed. |
| Migration | `alter table public.race_stage_profiles add column if not exists elevation_profile jsonb;` + `comment on column` | Additiv, idempotent, ingen backfill, ingen CHECK (validering i kode + test). Apply post-merge per #2642 (auto-migrate.yml), Claude post-verificerer med `information_schema.columns`. `database/schema-snapshot.json` opdateres i samme PR. |
| Legacy S1-S4 | Ingen backfill. `null` → flader falder tilbage til dagens tegning (`terrain.ts`' afledte profil) | Algoritmen virker også på S4 (budget = `elevation_gain_m − stigninger`), så en senere backfill er mulig uden ny kode, men den er ikke nødvendig for S5. |

## 2. Generator-algoritme

Ny ren funktion `buildElevationProfile(route, seedKey)` i ny fil `backend/lib/routeElevationProfile.js`, kaldt fra `raceStageProfileGenerator.js` lige efter `attachSegmentsAndWeather` i `toStageS5` (l.1423) og kun for S5-stien (generator v6). Prototype: scratch `proto.mjs` (ikke i repoet).

**Determinisme.** Egen rng-strøm `seed + ":elevation:" + etape` (samme mønster som `":segments:"`/`":weather:"` i `routeSegments.js`). Den forbruger intet fra pass 1, `":route:"` eller `":segments:"`, så `profile_type, finale_type, distance_km, climbs, sprints, sectors, segments` og `elevation_gain_m` er **bit-identiske** med v6 uden serien. Kun det nye felt kommer til. Målt: 1.938 etaper × 2 kørsler, 0 afvigelser.

**Input = de samme byggeklodser.** Serien bygges af etapens egne `segments` (som allerede rummer `climbs` som `climb`-segmenter, `descent` efter toppe, `cobbles`, `flat`/`rolling`), `climbs[]` og afslutnings-rampen i `sprints[finish].ramp_km/ramp_gradient`.

Trin (0,5 km-gitter):
1. **Stigninger:** hver stignings gain `round(length_km × 1000 × avg_gradient / 100)` (samme formel som `elevationGainS5`) fordeles på stigningens skridt efter en udglattet random walk (vægt ≥ 0,15 × snit), heltal ved største-rest-fordeling. Procenten varierer inden for stigningen, summen er præcis. Overlappende stigninger (findes på `itt_hilly` via v5's `buildClimbs`, fx Vuelta Ibérica etape 13: kat. 3 top km 14 på 5,9 km + kat. 3 top km 15 på 2,5 km) lægges oven i hinanden, ikke overskrevet.
2. **Afslutnings-rampe** (`uphill_sprint`/`wall_finish`/`punch`): samme fordeling på de sidste `ramp_km`.
3. **Dal + nedkørsler:** dal-niveau seedet pr. terræn (flad 20-250 m ... højbjerg 500-1.100 m) med langsom drift. Efter en top falder vejen 5-8,5 % pr. skridt mod dalen, aldrig under den. Nedkørsler giver ingen gain.
4. **Vejens bølgen (resten):** `budget = elevation_gain_m − stigninger − rampe` (S5: præcis `8 × distance_km`). Lægges på frie flad/bølget/brosten-strækninger som en glat bølge (3 sinusser, bølgelængde 4-14 km, vinduet til 0 i strækningens ender, bølget vægtet 3, flad 1, brosten 0,5). Skaleres med **loft 6 % op / 9 % ned pr. skridt** (en ukategoriseret bakke over 6 % burde være kategoriseret) ved bisektion, rundes til heltal, rest (±få m) lukkes på lokale toppe. Serien løftes så min ≥ 5 m (flytning ændrer ikke gain).

Resultat: `Σ positive deltaer === elevation_gain_m` for 1.938 af 1.938 etaper (målt).

## 3. Målt baseline (read-only, 14/10)

### 3.1 Nuværende generator + prototype, S5-udsnit (offline)

`generateRaceStageProfiles(race, {profileModel:"s5"})` på hele `racePoolCatalog.prod.json` (217 løb) × 3 seeds (`season_id` `s5-proto-1..3`), lokalt, intet skrevet, intet netværk.

| Mål | Værdi |
|---|---|
| Etaper | 1.938 |
| Generator v6 i dag (pass 1+2+segmenter) | 0,05-0,10 ms/etape (100-190 ms i alt) |
| Højdeserie (prototype) | **~1,1 ms/etape** (~2,1 s for 1.938) |
| Rute-JSON i dag (climbs+sprints+sectors+segments) | gns. 949 B |
| Serie-JSON | gns. **1.318 B**, maks 2.311 B |
| `elevation_gain_m` = seriens sum | **1.938 / 1.938** |
| Determinisme (2 kørsler) | 0 afvigelser |
| Negativ højde | 0 |
| Ukategoriseret op-gradient | median pr. etape-maks 6,0 % (loftet), 0,25 % af frie skridt over 6 % (rest-lukningen; strammes i PR'en) |

Tiden er ubetydelig for `buildSeasonCalendar` (S5 ~1.300 rækker ≈ 1,5 s ekstra). Bisektionen er den dyre del og kan gøres analytisk hvis nødvendigt.

### 3.2 S4 (prod): `elevation_gain_m` mod stigningernes sum

SELECT (kolonner fra schema-snapshot), `race_stage_profiles ⨝ races ⨝ seasons`, `seasons.number = 4`, én række pr. unikt parcours (`pool_race_id` + etape), alle `generator_version = 5`:

| Type | n | gns. `elevation_gain_m` | gns. Σ stigninger | forskel (= `BASE_ELEVATION`) | forhold |
|---|---|---|---|---|---|
| high_mountain | 48 | 3.436 | 2.336 | 1.100 | 1,52 |
| mountain | 82 | 2.968 | 2.068 | 900 | 1,53 |
| classic | 8 | 2.218 | 1.318 | 900 | 1,83 |
| hilly | 89 | 1.770 | 1.070 | 700 | 1,76 |
| gravel | 2 | 1.473 | 673 | 800 | 2,72 |
| rolling | 47 | 835 | 335 | 500 | 3,29 |
| cobbles | 25 | 561 | 161 | 400 | 3,63 |
| itt_hilly | 3 | 558 | 208 | 350 | 2,79 |
| flat | 107 | 244 | 44 | 200 | 3,37 |
| itt | 37 | 67 | 0 | 67 (km-sats) | - |
| **alle** | **448** | **1.496** | **924** | **572** | **2,22** |

Forskellen er konstant pr. type (maks = gns.): ikke støj, men et grundtal uden placering. Issue-eksemplet (4.211 mod ~2.700) er en højbjergetape med 1.100 m grundtal + afrunding.

## 4. Hvem læser serien

| Læser | I dag | Med serien |
|---|---|---|
| Road book (#6574, `frontend/api/og/_lib/terrain.ts`) | Stykvis lineær af segments; vandret mellem stigninger; summerer ikke | `buildTerrain` bruger `elevation_profile.h` når den findes (`elevationAt` = lineær interpolation), farvebånd pr. skridt via eksisterende `gradeBand`; `null` → dagens kode uændret. Én ny gren, ingen ny skala. |
| Etapeside (#6570, `frontend/src/lib/stageRouteProfile.js`, `StageProfileGraph.jsx`) | Egen tilnærmelse (65 m/km nedkørsel, dekorativ bølge med `FADE_KM`) | Samme valg: serien hvis findes, ellers i dag. Kræver at frontend-forespørgslen selecter kolonnen. Bygges i #6570's spor, ikke torsdag. |
| Motor v4 | Læser `segments`, `climbs`, `distance_km`; `top_elevation_m` kun i `types.ts` | **Uberørt.** Kolonnen læses ikke af motoren; ingen ændring i `routeAdapter.ts`. Skulle motoren senere bruge gradient pr. km, sker det bag en ny regel-revision (slukket), og tænding er ejer-only. |

## 5. Test- og gate-plan

- **Unit** (`routeElevationProfile.test.js`): (a) `Σ positive deltaer === elevation_gain_m` for alle etaper over N seeds × hele kataloget; (b) determinisme: samme seed → identisk `h`; (c) `h.length === round(D/0.5)+1`, min ≥ 0; (d) hver stignings gain i serien = dens formel-gain (±0) og topper ved `crest_km` (±0,5 km); (e) ukategoriseret op-skridt ≤ 6 % (hård, efter strammet rest-lukning); (f) `descent`-finale: sidste top-til-mål er ikke-stigende.
- **Bit-identitet:** eksisterende `pass1-golden.json` og `raceStageProfileGenerator.test.js` uændrede (kun nyt felt). Testen sammenligner rækker uden `elevation_profile` mod før.
- **Benchmark-gaten #6367:** skal være grøn uændret. Den måler type/B+/matrix/kvoter/finaler, som serien ikke rører. Gaten udvides med én kontrol: "alle S5-etaper har serie og sum = `elevation_gain_m`".
- **Golden diff:** `node backend/scripts/dev/calendarGoldenDiff.mjs` exit 0 (placering uændret).
- **Tørkørsel:** `scripts/dev/s5ProfileDryRun.mjs` får en linje med serie-statistik (tid, bytes, sum-mismatch = 0).
- **Verify:** TIER FULL (`scripts/verify-local.ps1`, delt lib), `pwsh -File scripts/preflight-pr.ps1`.

## 6. Byg-plan torsdag 16/10

| PR | Indhold | Estimat |
|---|---|---|
| **PR 1 (backend, opus)** | `routeElevationProfile.js` + test; kald i `toStageS5`; `toStageProfileRow` skriver `elevation_profile`; migration (additiv, idempotent) + schema-snapshot; gate-kontrol i `s5BenchmarkGate`; tørkørsels-linje | 3-4 t inkl. TIER FULL |
| **PR 2 (frontend, sonnet)** | `terrain.ts` læser serien (oven på #6577) + road book-billede før/efter; ejer-go på preview før merge | 1,5-2 t |

Rækkefølge: PR 1 merges → migration apply post-merge → tørkørsel gennem gaten tor/fre → S5 genereres med serien 18/10 (ejer-go pr. skridt). PR 2 kan merges efter, fordi `null`-fallback gør læseren uafhængig.

**Fallback:** er PR 1 ikke grøn i gaten fredag aften, genereres S5 uden (kolonnen er nullable, generatoren kaldes ikke). Opgradering senere = ren backfill af `elevation_profile` for S5-rækker ud fra deres gemte rute (funktionen er ren og tager kun rækkens egne felter + seed), uden at røre andre felter.

**Risici:** (1) Bølge-budgettet på 8 m/km (#6366, låst) er synligt i serien: på kuperede etaper er den ukategoriserede bølgen større end stigningerne (billedet: 1.600 m bølge mod 414 m kat. 3). Det er ikke en ny beslutning, men ejeren ser det for første gang. (2) Nedkørsels-finalen stopper ved dalen og kan give en flad indkørsel; strammes ved at sætte dalen ved mål lavere for `descent`. (3) Rest-lukningen kan give enkelte skridt over 6 %; skal spredes over flere toppe før test (e) er hård.
