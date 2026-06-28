# Kalender: game_day = real_day kollapsede kronologien → trippel-overlap (2026-06-28)

**Slice:** kalender-kronologi-rebuild · **Spec:** `docs/superpowers/specs/2026-06-28-race-calendar-chronology-rebuild-design.md` · **Branch:** `feat/calendar-chronology-rebuild`

## Symptom
Ejeren: "der må ikke være 3 løb der køres på samme tid (ingame) i 3. division." Målt mod prod: **alle 28 in-game-dage i Division 3 havde overlap = 3** — en rytter blev tvunget til et 3-vejs trup-valg hver eneste dag.

## Rod-årsag
Pakkeren (`raceCalendarLanePacker.js`) satte `game_day = real_day` (lane-gitter, `game_day: c.day`). Det koblede to begreber der skal være adskilte:
- **real_day** (IRL): hvornår en etape simuleres (pacing/komprimering).
- **game_day** (in-game): binding-nøglen — "én rytter, ét løb pr. in-game-dag".

Konsekvenser af koblingen: (1) i Division 3 kom de 3 etaper/IRL-dag fra **3 forskellige løb** der alle fik samme game_day → x3 binding. (2) Et 21-etapers Grand Tour der kørte 4 etaper/IRL-dag fik **alle 4 etaper på samme game_day** → 21 etaper presset ned i kun 6 game-dage (commitment for kort). Begge brød ejerens regel: "flere etaper/IRL-dag er fint, men ikke flere etaper/game-dag."

## Fix
Hver etape får sin EGEN game-dag (game_day = tidslinje-ordinal, afkoblet fra real_day). To layouts:
- **Banded** (Div 2/3/4): B baseline-spor + overlay; hele game-dage pr. IRL-dag → går præcist op i density UDEN straddle, giver en bevidst blanding (Div 3 = solo+2). Cap-styret via `TIER_OVERLAP_CAP` (Div 1/2=3, Div 3/4=2).
- **Stream** (Div 1): least-loaded på cap spor + game-dag-ordnet komprimering; håndterer Grand Tour-rygrad + binding-fri monumenter. Bruges når banded ikke kan realiseres (monumenter til stede / for få endagsløb).
- **Binding-koden (`raceBinding.js`) var allerede korrekt** (nøgler på game_day) — kun kalender-DATA + pakker ændret.

## Meta-lektioner
1. **Mål rod-årsagen mod prod FØR du designer.** En read-only sweep-query (`overlap pr. game-dag`) viste entydigt "3 på alle 28 dage" og "21 etaper → 6 game-dage" — det ledte direkte til den rigtige model. Antagelser ud fra koden alene havde misset at kronologien var kollapset. ([[feedback_runtime_verify_first]])
2. **To begreber der ligner hinanden skal holdes adskilt i data, ikke kun i hovedet.** `game_day = real_day` så "rigtigt nok" ud (og en test asserterede det), men koblingen var hele fejlen. Skeln pacing (real_day) fra spil-regel (game_day) eksplicit.
3. **Simulér-før-ship + ejer-godkend formen.** En read-only sim (`sim-calendar-chronology.mjs`) mod ægte katalog viste overlap-fordeling/straddle pr. division; ejeren valgte "blanding (solo+2)" frem for "altid 2" og "lad Div 1 stå" FØR den destruktive apply. ([[feedback_simulate_before_ship_balance]], [[feedback_owner_reviews_live_before_destructive_ops]])

## Follow-on: UI-binding antog "samme IRL-dag = overlap" (fanget af ejeren)
Efter prod-applyen syntes ejeren det stadig "lignede x3" i Division 3. Data var korrekt (≤2 binder), men trup-board'et (`raceHubLogic.draftBindingMap` + `AvailableRidersPool` pulje-lås + `AddRiderPopover`) antog at ALLE kolonner på den valgte IRL-dag overlapper (#1823 dag-granulær binding). Med kronologi-rebuilden kan samme-IRL-dag-løb ligge på forskellige in-game-dage → board'et over-blokerede: en rytter i ét løb blev låst fra dagens øvrige løb, så et lille hold fik INGEN aflastning fra fixet (stadig x3-tryk i praksis). **Lektion: en data-model-ændring (game_day ≠ real_day) har downstream-antagelser i UI'et — backend-binding nøglede korrekt på game_day, men frontendens kladde-binding gjorde ikke.** Fix: `windowsOverlap` på hver kolonnes `bindingWindow` i draft-binding, pulje-lås, popover OG add/move-beslutningen. Verificeret i browser-preview (rytter i gd12-14-løb er fri til gd15-løb samme IRL-dag). Forward-guard: `raceHubLogic.test.js` — samme-IRL-dag/forskellig-game-dag → ikke bundet.

## Forward-guard
- `raceCalendarLanePacker.test.js`: HARD-assert `maxOverlap ≤ cap` (uafhængigt fra game_day-spans), kronologi (N-etapers løb = N unikke sammenhængende game-dage), Div 3 banded + 0 straddle + blanding, Div 1 stream-fallback.
- `tierCalendarMaterializer.test.js`: overlap-cap pr. tier (3/3/2), GT = 21 game-dage men IRL-komprimeret.
- Verifikation efter prod-apply: sweep-query bekræftede Div 3 max 2, tæthed præcis, 0 tomme dage, prod = sim.
