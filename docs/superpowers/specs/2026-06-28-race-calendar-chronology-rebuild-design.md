# Kalender-kronologi-rebuild — adskil game-dag fra IRL-dag (design)

> Status: **design låst med ejeren (Nicolai) 2026-06-28**, build i gang samme dag.
> Afløser kalender-*formen* fra `2026-06-27-calendar-prestige-stage-spread-design.md` (prestige-udvælgelse + tæthed + 28-dages-cap bevares; kun selve pakningen/kronologien bygges om).
> Destruktiv prod-rebuild — rører **ikke** prod før ejeren har set simuleringen og givet eksplicit go (owner-reviews-live-reglen). Motoren genstarter man 29/6 08:00; 0 etaper afviklet endnu.

## Problem (verificeret mod prod 2026-06-28)

Kalenderen sætter `game_day = real_day` i pakkeren (`raceCalendarLanePacker.js`, `game_day: c.day`). Det kollapser kronologien:

- **Division 1 — Vuelta Ibérica (21 etaper):** kører 4 etaper på samme IRL-dag, men alle 4 får **samme** `game_day` (gd 2, 3, 4 …). De 21 etaper er presset ned i **kun 6 game-dage**. Et etapeløb må gerne køre flere etaper/IRL-dag — men de skal ligge på **hver sin game-dag**.
- **Division 3 (46 løb, 84 løbsdage):** etapeløb spredes 1 etape/IRL-dag (ingen komprimering). For at nå 3 etaper/dag fyldes dagen med **3 forskellige løb** → og fordi `game_day = real_day` lander alle 3 på samme game-dag → **alle 28 in-game-dage har overlap = 3** (målt: tvunget 3-vejs trup-valg hver dag).

Målt binding-samtidighed (forskellige løb pr. game-dag) i dag: Div 1 = 2–4 (15/8/5 dage), Div 2 = ~4 (26 dage), Div 3 = **3 (alle 28 dage)**.

Rod-årsag: tætheden (etaper/IRL-dag) kommer i Div 3 fra *forskellige* løb i stedet for fra at komprimere etapeløb. Og kronologien (`game_day`) er bundet til IRL-dagen i stedet for at være et per-etape-ordinal.

## Låst model (ejer-beslutninger 2026-06-28)

1. **Hver etape = sin egen game-dag.** 1 etape = 1 game-dag, altid. Et 5-etapers løb spænder 5 game-dage; en 21-etapers Grand Tour spænder **21 game-dage** (fuldt commitment — "en GT er en stor beslutning"; binder truppen ~30% af in-game-sæsonen). Et etapeløb må køre flere etaper/IRL-dag (komprimering = pacing), men aldrig 2 etaper på samme game-dag.
2. **Game-dag-tidslinjen bærer binding/overlap.** Løb lægges på en game-dag-tidslinje med styret overlap. Binding (`raceBinding.js`) nøgler allerede på `game_day` → **ingen binding-kode-ændring**, kun kalender-data.
3. **Overlap-cap (forskellige løb der binder en rytter samtidig):**

   | Division | Overlap-cap | Tæthed (etaper/IRL-dag) | Løbsdage (etaper) |
   |---|---|---|---|
   | Div 1 | **max 3** | 5 | 140 |
   | Div 2 | **max 3** | 4 | 112 |
   | Div 3 | **max 2** | 3 | 84 |
   | Div 4 | **max 2** | 2 | 56 |

4. **IRL-komprimering = pacing.** Tidslinjen komprimeres til præcis **28 IRL-dage**, density etaper/IRL-dag. Flere etaper (også af samme løb) må dele en IRL-dag; klassikere fylder de resterende slots. Ingen tomme IRL-dage.
5. **Samme model i alle divisioner** — kun tæthed + overlap-cap skifter.
6. **Bevaret fra forrige spec:** prestige-rang-udvælgelse, cross-division dedup, præcise løbsdage-kvoter, 28-dages-hard-cap, monumenter binding-fri (eget højt game-dag-bånd), etape-tids-slots pr. division (Div 3 = 12/15/18), klikbar per-etape-kalender-UI.

## Matematisk sammenhæng (gælder pr. division)

- `N` = løbsdage = Σ etaper (Div 3 = 84). `tæthed = N / 28` (Div 3 = 3). ✓ 5/4/3/2.
- Hver game-dag `g` har `overlap(g)` = antal løb hvis span dækker `g`. `Σ overlap(g) = N`.
- Tidslinje-længde `T = max game_day`. Med `overlap ≤ cap`: `T ≥ N / cap`. Div 3: `T ≥ 42`. Div 1: `T ≥ 47`.
- IRL-komprimering: `T` game-dage → 28 IRL-dage = `T/28` game-dage/IRL-dag, hver IRL-dag med `density` etaper. Identiteten `(T/28) × (N/T) = N/28 = density` holder for **alle** `T` → `T` er en *shaping*-parameter (kort `T` = altid-cap overlap; lang `T` = mix af 1..cap + flere solo-stræk). Cap'en er det hårde loft; `T`/mixet vises i simulering og godkendes af ejeren.
- **GT-feasibility (Div 1):** 3 Grand Tours (21 game-dage hver) lægges spredt og **ikke** overlappende hinanden (GT-rygrad). Med cap 3 kører hver GT med op til 2 samtidige andre løb. `T` vælges så GT'erne kan spredes med ikke-GT-stræk imellem (ingen "altid-GT"-sæson). Verificeres i simulering mod det faktiske katalog.

## Arkitektur — genbrug af pipelinen, byg pakkeren om

Pipelinen er rene, testbare funktioner. Udvælgelse + materializer-I/O genbruges; pakker + scheduling bygges om.

### Uændret
- `tierRaceSelection.js` (`selectTierRaceSet`): prestige-rang + præcis kvote. Uændret.
- `tierCalendarMaterializer.js`: cross-tier dedup, fan-out til puljer, I/O-wrapper. Uændret bortset fra at den sender `overlapCap` pr. tier ind i pakkeren.
- `raceBinding.js`: nøgler allerede på `game_day`. **Uændret.**

### Bygges om
- **`raceCalendarLanePacker.js` → game-dag-tidslinje-pakker.** Erstat (density × days)-lane-gitteret med en **2-trins** model:
  1. **Game-dag-layout:** placér etapeløb (sammenhængende game-dag-blokke = etape-antal) + klassikere (1 game-dag) på en tidslinje, så `overlap(g) ≤ cap` overalt; GT-rygrad spredt + ikke-GT-overlappende; klassikere spredt; bevidst mix (nogle solo, resten ≤ cap). Monumenter → højt game-dag-bånd (binding-fri). Output: pr. etape `{ race_id, stage_number, game_day }`. **Ren + deterministisk** (seed, ingen Date/random).
  2. (kompressionen flyttes til scheduling — se nedenfor.)
- **`raceCalendarScheduling.js` → IRL-komprimering.** Tag de game-dag-ordnede etaper og fordel dem på 28 IRL-dage, `density` etaper/IRL-dag, i game-dag-rækkefølge (et løbs etaper bevarer stigende IRL-rækkefølge; flere etaper/IRL-dag tilladt). Tildel tids-slot pr. etape fra `TIER_STAGE_SLOTS` (2 etaper af samme løb samme IRL-dag → forskellige slots). `races.scheduled_for` = løbets første etape. `game_day` = tidslinje-ordinalet (IKKE real_day).

### Read-model + UI
- Uændret fra `2026-06-27`-spec'en (per-etape-kalender, klikbar). Verificér at den stadig grupperer korrekt når flere etaper af samme løb ligger på samme IRL-dag på forskellige slots.

## Proces (destruktiv prod-op — memory-regler)

1. **Byg + TDD** alle rene funktioner (`node --test` i `backend/`): game-dag-layout (cap-invariant, GT-spredning, determinisme, monument-bånd), IRL-komprimering (28 dage, density, ingen tom dag, etape-rækkefølge), end-to-end materializer-plan.
2. **Simulér** mod ægte katalog/puljer (dryRun, read-only) → scorecard pr. division: løbsdage = kvote præcist, tæthed/dag, **overlap-fordeling (cap aldrig overskredet)**, GT-spredning + commitment-længde, eksempel-uge. **Vis ejeren visuelt; ejer godkender simuleringen** før apply.
3. **Backup** `races` + `race_stage_schedule` (+ `race_stage_profiles`, `race_entries`) → `backup_chronrebuild_20260628_*`.
4. **Apply** (kun ejer-go): verificér 0 afviklede etaper → slet sæson-1-løb → re-materialisér via `materializeTierCalendars`. Verificér prod = simulering (overlap-cap-query pr. division).
5. **UI**-verifikation (build + `node --test` frontend + alle 3 playwright-projekter).
6. Patch notes + `help.json` (en+da) + FEATURE_STATUS + NOW.md.

## Verifikation (gates)

- Pr. division: `Σ etaper = kvote` præcist; tæthed/IRL-dag matcher density; 0 tomme IRL-dage i de 28.
- **Overlap-cap aldrig overskredet:** max forskellige løb pr. game-dag ≤ cap (3/3/2/2). Re-kør prod-sweep-queryen efter apply.
- **Kronologi:** intet løb har 2 etaper på samme game-dag; et N-etapers løb spænder N game-dage.
- Monumenter: binding-window overlapper intet andet løb.
- Motor-genstart 29/6 08:00 kører rent på den nye kalender.

## Risici

- **Prod-data-mutation:** ikke schema, men muterer `races`/`race_stage_schedule`. Mitigering: 0 afviklet, idempotent delete+insert, dry-run-først, ejer-go, backup + PITR.
- **Manuelle lineups går tabt ved rebuild** (entries slettes) — måles før apply, kommunikeres; motor ikke startet → kan sættes igen.
- **GT-feasibility:** verificér i simulering at 3 GT'er kan spredes inden for `T`/28-dage uden cap-brud (Div 1).
- **Loop-guard:** 2 CI-fails / 2 sim-afvigelser på samme symptom → STOP + spørg.

## Eksplicit ikke i scope
- Op/nedrykning (#1152). Race-runner/scheduler-cron. Div 4-løb (0 hold). Selve binding-koden (uændret).
