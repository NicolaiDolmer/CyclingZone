# Race-motorens regler — SSOT

> **Læs denne FØR enhver opgave der rører motoren, ruter, taktik eller resultater.** Ejer-direktiv 25/8 2026 ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)): *"Det må ALDRIG NOGENSINDE ske, at du ikke bruger et SSOT-dokument, når vi rent faktisk har lavet et."*

Reglerne lå spredt over **25 design-dokumenter**. Denne fil er nu kilden. Ændrer du en værdi, ændrer du den i den fil tabellen peger på — og opdaterer denne i samme PR.

---

## 0. De to kontrakter (den hyppigste fejlkilde)

Motoren har to frosne grænseflader. De må ikke forveksles, og ingen af dem må udvides uden ejer-go.

| Kontrakt | Hvad den er | Hvor den bor |
|---|---|---|
| **`StageInput` / `StageOutput`** | Motorens rene ind/ud. Én deterministisk funktion: `simulateStageV4(input) → output` | `types.ts` i engine-pakken — **den fil er kontraktens SSOT** |
| **`TeamOrder`** | Hvad spilleren har bedt om. Snapshotes ved lock og stemples ind i `StageInput.orders` | [`2026-08-21-race-tactics-orders-v1-design.md`](superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md) §Ordre-kontrakten |

**Kernen kræver aldrig ordrer.** Adapteren oversætter fravær til neutrale defaults. AI-hold genererer `TeamOrder` gennem præcis samme type — ingen side-kanaler.

---

## 1. Rolle-vokabularet (kanonisk, ikke til forhandling)

Fem værdier. De er defineret i den frosne kontrakt — `backend/lib/engine/v4/types.ts:35`:

```ts
export type RiderRole = "captain" | "sprint_captain" | "helper" | "hunter" | "free_role";
```

Samme fem står i `race_entries.race_role` og `race_stage_roles.race_role`, skrevet 69.962 gange i prod.

| Værdi | Spiller-facing EN | Hvad den gør |
|---|---|---|
| `captain` | Captain | Holdets beskyttede rytter |
| `sprint_captain` | Sprint captain | Leadout-toget arbejder for ham (M6) |
| `hunter` | Breakaway hunter | Prioriterer udbrud |
| `helper` | Domestique | Arbejder for kaptajnen |
| `free_role` | Free role | Ingen bundet opgave |

**Enhver flade der viser eller sætter en rolle bruger disse fem.** Opfind aldrig et sjette ord, og oversæt aldrig til et andet sæt i en ny flade. `race_stage_roles` udfases efter v4-flippet; `race_entries.race_role` består.

---

## 2. Mekanik-kataloget (ejer-godkendt 20/8)

Scope er lukket. En mekanik uden for listen kræver ejer-go, ikke en PR.

| # | Mekanik | Fase |
|---|---|---|
| M1 | Gruppedannelse + gruppe-tider + finale-opgør | F2 ✅ |
| M2 | Stignings-selektion | F2 ✅ |
| M3 | Nedkørsel v2 — monotoni-garanti, descent attack, risiko-koblet | F2 ✅ |
| M4 | Punch-finale — forspring bæres ind i finalen | F2 ✅ |
| M5 | Udbrud v2 + spiller-ordre, bounded bidrag | F3 |
| M6 | Sprint-tog, leadout-roller | F3 |
| M7 | Distance-slid: monument-effekt + dag-til-dag | F3 |
| M8 | Brosten-sektorer | F3 |
| M9 | Bonussekunder — bounded så bjerg dominerer GC | F3 |
| M10 | Incidents + 3 km-reglen | F3 |
| M11 | Vejr-lag pr. etape, seeded | F3 |
| M12 | Effort pr. rytter (`protect`/`normal`/`save`) | F3 |
| M14 | AI-holds ordrer gennem samme type | F3 |

Tre nye stats er ejer-valgt ind (20/8) og fødes skjulte først: dagsform-stabilitet · vejr-teknik · højde-tolerance.

**Stående ordre (ejer 20/8):** foreslå løbende nye stats når motor- eller rutearbejdet gør dem meningsfulde.

---

## 3. Invarianter (property-testede, må aldrig brydes)

1. **Determinisme.** Samme input ⇒ byte-identisk output. Per-rytter-hash, så én ekstra tilmelding ikke flytter andres relative udfald.
2. **Gruppe-tid.** Alle i samme mål-gruppe har identisk `time_seconds`.
3. **Monotoni.** Inden for samme gruppe kan lavere testet evne aldrig give bedre tid. Støj skalerer magnitude, aldrig fortegn.
4. **Km-dækning.** `0 ≤ km ≤ distance_km`, monotont ordnet, #2410-taksonomien håndhævet.
5. **Fog-gate ([#1791](https://github.com/NicolaiDolmer/CyclingZone/issues/1791)).** Ingen rå komponenter, vægte eller sandsynligheder i `events[].params`.

Invariant 3 er den dyre. Den er hele grunden til at støj må skaleres, men aldrig vendes.

---

## 4. Doktrin

**Simulér før ship.** Intet balance-følsomt shippes uden dry-run-harness mod ægte population plus scorecard med ejer-go. v4's scorecard ankres i virkelighedens tal som primær kilde; de eksisterende gate-bånd er regressionsvagt, ikke mål.

**Et gulv er ikke et mål.** Rapporteres et tal som OK, skal det stå hvilken regel det måles mod, og om det er ejer-godkendt mål eller regressionsvagt ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)).

**Styrke straffes aldrig.** Den bedste skal kunne vinde. Balance sikres via fordeling og struktur, ikke via handicap (ejer 4/8).

**Offentlighedspolitik ([#3436](https://github.com/NicolaiDolmer/CyclingZone/issues/3436)).** Repoet er offentligt. Kvalitativ omtale er fri; præcise vægte, formler, eksponenter og tærskler hører i private filer og chat — aldrig i issues, PR'er, patch notes eller Discord.

---

## 5. Faser og hvor vi er

| Fase | Indhold | Status |
|---|---|---|
| F0 | Spec ejer-godkendt, 16 valg | ✅ 20/8 |
| F1 | Rute-SSOT: segmentmodel, vejr-lag, generator, legacy-syntese | ✅ PR #4028 |
| F2 | Motor-kerne: segment-loop, M1-M4, tidslinje, golden fixtures | ✅ PR #4072, 21/8 |
| F3 | Mekanik-bølge M5-M12 + taktik-kort | **delvis (2/9)** — se noten |
| F4 | Skygge-mode: runner-hook, sammenlignings-scorecard | ikke startet |
| F5 | Kalibrering i S3 → ejer-gate | ikke startet |
| F6 | Flag-flip i S3 på en hviledag | **ejer-gated** |

**F3-noten (målt 2/9, [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604)).** "I gang" stod i denne tabel fra 21/8 til 2/9 uden at være efterprøvet. Den faktiske tilstand: `index.ts` kalder **kun M2, M3 og M4** (plus M1, der bor i selve segment-loopet). M5-M12 findes som skrevne og testede filer i `mechanics/`, men **ingen af dem kaldes af motoren** — de er kode uden kaldssted, ikke leveret mekanik. Taktik-kortet er ikke bygget; `TeamOrder` er stadig det løse placeholder-udkast i `types.ts`, og kernen læser ingen ordrer. Kontrakten den skal bygges mod blev afgjort 2/9 ([#4246](https://github.com/NicolaiDolmer/CyclingZone/issues/4246)): rollen er standardordren, taktik-kortet vinder for den enkelte etape, og rollen skrives aldrig om af kortet.

**v3 er låst fallback indtil F6.** Flippet er ejer-only og sker aldrig som sidegevinst ved en anden opgave.

---

## 6. Hvad der håndhæver hvad

| Regel | Håndhæves af |
|---|---|
| Determinisme, gruppe-tid, monotoni, km-dækning | property-tests (`fast-check`) + golden fixtures |
| Fog-gaten | samme testmønster som `raceTimeline.test.js` |
| Type-kontrakten | `tsc`-typegate i CI (Node 24 type stripping) |
| Rolle-vokabularet | intet i dag — se modsigelse 3 |
| Balance-bånd | `race:gate` + `balance:check` (advisory) |

---

## 7. Kendte åbne modsigelser

| # | Modsigelse | Issue |
|---|---|---|
| 1 | `hunter` er en **rolle**, `try_break` er en **ordre** — begge udtrykker "kør efter udbruddet", og intet siger hvilken der vinder når begge flader er åbne | denne fil §1 + tactics-spec |
| 2 | `sprint_captain` (rolle) overlapper `leadout_for` (F3-ordre) på samme måde | samme |
| 3 | Rolle-vokabularet har ingen gate — en ny flade kan indføre et sjette ord uden at noget fejler | denne fil §1 |
| 4 | `race:gate:routes` er permanent rød; `longDayEnduranceLift`-båndet står på middelværdien | [#4197](https://github.com/NicolaiDolmer/CyclingZone/issues/4197) |
| 5 | `balance:check` tæller 98 afvigelser på main, men er advisory | [#4196](https://github.com/NicolaiDolmer/CyclingZone/issues/4196) |
| 6 | v4's head-to-head-gate er fortsat rød. Genmålt 2/9 over 5 seeds: sprinter-vinderraten løftet fra 68 % til 85 % i gennemsnit, bjerg-spredningen skåret 36 %, men **ingen af de tre ankre er inden for båndet** | [#4132](https://github.com/NicolaiDolmer/CyclingZone/issues/4132) · [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 7 | `raceRouteRealismScorecard` måler sin egen plan, ikke basen | [#4219](https://github.com/NicolaiDolmer/CyclingZone/issues/4219) |
| 8 | **Head-to-head-scorecardet er seed-domineret.** Samme kode, samme kalender, fem seeds: sprinter-ankeret svinger ~12 procentpoint til hver side. Etaper med samme etapenummer deler feltsample OG motor-seed, så n=117 flade etaper er reelt ~20 uafhængige træk. Et enkelt-seed-tal kan derfor hverken erklære et anker grønt eller rødt — scorecardet skal aggregere over seeds før det kan gate noget | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 9 | `positioning` og `tactics` står i `AbilityKey` og vægter i finalens demand-vektorer, men **ingen rytter i spillet har dem** (0 af 5.938 i S3-populationen). Vægten falder tavst på gulvet, så bl.a. massespurt-finalen afgøres på en mindre del af sin egen vektor end tabellen antyder | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |

---

## 8. Kildedokumenter

Denne fil er kilden til **reglerne**. Design-rationalet bor stadig i:

[`2026-08-20-race-engine-v4-intra-stage-design.md`](superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md) (vision, mekanik-katalog, beslutningslog) · [`2026-08-21-race-engine-v4-f2-core-design.md`](superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md) (kerne-kontrakten) · [`2026-08-21-race-tactics-orders-v1-design.md`](superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md) (ordre-kontrakten) · [`2026-07-21-realistic-routes-foundation-design.md`](superpowers/specs/2026-07-21-realistic-routes-foundation-design.md) (rutemodellen) · [`2026-07-22-sub2-deep-competitions-design.md`](superpowers/specs/2026-07-22-sub2-deep-competitions-design.md) (passager, pointskalaer) · [`2026-07-22-sub3-route-aware-engine-design.md`](superpowers/specs/2026-07-22-sub3-route-aware-engine-design.md) (gap-model) · [`2026-08-17-race-event-log-stage-timeline-design.md`](superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md) (tidslinje-taksonomi).

Naboområder: [`CALENDAR_RULES.md`](CALENDAR_RULES.md) (hvornår løbene køres) · [`PROGRESSION_RULES.md`](PROGRESSION_RULES.md) (hvilke evner rytterne møder op med) · [`GAME_INVARIANTS.md`](GAME_INVARIANTS.md).
