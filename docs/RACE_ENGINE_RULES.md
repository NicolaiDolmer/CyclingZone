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
| M5 | Udbrud v2 + spiller-ordre, bounded bidrag | F3 ✅ wiret 3/9 |
| M6 | Sprint-tog, leadout-roller | F3 ✅ wiret 3/9 |
| M7 | Distance-slid: monument-effekt + dag-til-dag | F3 |
| M8 | Brosten-sektorer | F3 |
| M9 | Bonussekunder — bounded så bjerg dominerer GC | F3 |
| M10 | Incidents + 3 km-reglen | F3 |
| M11 | Vejr-lag pr. etape, seeded | F3 |
| M12 | Effort pr. rytter (`protect`/`normal`/`save`) | F3 |
| M14 | AI-holds ordrer gennem samme type | F3 ✅ wiret 3/9 (harness) |

Tre nye stats er ejer-valgt ind (20/8) og fødes skjulte først: dagsform-stabilitet · vejr-teknik · højde-tolerance.

**Stående ordre (ejer 20/8):** foreslå løbende nye stats når motor- eller rutearbejdet gør dem meningsfulde.

---

## 2b. Etapetyper (`profile_type`) — motorens terræn-vokabular

Elleve værdier. De er defineret i `PROFILE_TYPES` (`backend/lib/raceStageProfileGenerator.js`)
og håndhævet af CHECK'en på `race_stage_profiles.profile_type`. Hver type har ÉN
`demand_vector` (hvilke evner dagen belønner) og ÉT sæt finale-vægte (hvordan den slutter)
— begge samme sted i samme fil, så de er ét sted at tune.

`flat` · `rolling` · `hilly` · `mountain` · `high_mountain` · `itt` · `itt_hilly` · `ttt` ·
`cobbles` · **`gravel`** · `classic`

Hvornår hver type opstår, og hvilken terræn-familie den tælles i, står i
[`CALENDAR_RULES.md`](CALENDAR_RULES.md) §5-§7b. Denne fil ejer hvad typen GØR ved løbet.

### Grus (`gravel`) — ejer-direktiv 21/8, ramme 3/9 ([#4105](https://github.com/NicolaiDolmer/CyclingZone/issues/4105))

Ordret 21/8: *"Terre di Toscana skal blive et grusvejs løb og ikke et brostensløb"*.
Ordret 3/9: *"det skal være næsten samme type der er god til den slags løb"* og
*"brostensevnen tæller kun på etaper med brosten/grus"*.

**Grus er sin egen type, ikke en etikette på brosten.** Det er dét der gør det muligt at
tælle den i brostensfamilien i kalenderens dækning uden at spillet holder op med at kunne
skelne de to. Fire ting definerer den:

| | Hvad der gælder | Hvorfor |
|---|---|---|
| **Rytterprofil** | brostensevnen er den tungeste dimension, som på brosten. Vægten der er taget fra den ligger på udholdenhed, punch/klatring og tilfældighed | ejer-rammen: næsten samme rytter skal vinde. Grusklassikeren er længere, mere nedslidende og mere lotteri-agtig, og den afgøres oftere på en kort stejl rampe |
| **Sektorer** | en grus-etape har **altid** mindst én sektor, og sektorerne er flere og længere end brostenens. `sectors[].kind = "gravel"` | ejer-reglen "brostensevnen tæller kun på etaper med brosten/grus" — en grus-etape uden sektorer ville lade den dominerende vægt hvile på ingenting |
| **Segmenter** | en grus-sektor bliver et **`cobbles`-segment** i v4. Segment-modellen er uændret | segmentet beskriver FYSIKKEN (løst/ujævnt underlag: lav læsgevinst, høj styrtrisiko, høj work-cost), og den er den samme. Underlaget står i `profile_type` og i `sectors[].kind` |
| **Finaler** | udbrud er det hyppigste udfald, rampe-finale det næsthyppigste, samlet gruppe mindretallet | grus bryder feltet tidligere end brosten, og den toscanske type afgøres på en rampe |

**Grus er RAPPORTERET men ikke bånd-gatet** i `stageFinaleMetrics.js` — samme status som
`classic`. #4272's finale-bånd blev godkendt tal for tal 26/8, og grus fandtes ikke
dengang; et bånd for den kræver derfor en ejer-beslutning, ikke en PR.

> ⚠ **`classic` bærer en brostens-vægt uden garanteret sektor-forsyning.** Grus opfylder
> ejer-reglen ved konstruktion; `classic` gør det ikke — den trækker 0-3 sektorer og får
> altså ingen i cirka en fjerdedel af tilfældene. At rette det er en balance-ændring
> (`classic` er monument-arketypen), ikke en oprydning, og den er ikke lavet.

Invarianterne for typen er property-testet i `backend/lib/gravelStageType.test.js` og
måler RELATIONER mod evne-fordelingen, ikke faste tal — [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604)'s
læring om at et scorecard der hænger på et absolut tal måler feltstørrelsen.

---

## 2c. Incidents — hvad koster hvad (M10)

Et uheld har to akser der afgøres uafhængigt: **arten** (`kind`: styrt eller mekanisk defekt) og **udfaldet** (`outcome`: tabt tid eller udgåelse). De må ikke forveksles.

| | tabt tid | udgåelse (DNF) |
|---|---|---|
| **styrt** | tid lagt til etapetiden | ude af resten af løbet **+ skade i et antal dage** |
| **mekanisk defekt** | tid lagt til etapetiden | ude af resten af løbet, **ingen skade** |

**Reglen ([#4520](https://github.com/NicolaiDolmer/CyclingZone/issues/4520), fastlagt 5/9):** kun et **styrt** kan skade rytteren. En mekanisk udgang koster løbet, ikke kroppen — rytteren er klar til næste løbsdag. Håndhæves to steder: `raceIncidents.rollIncidents` sætter `injury_days` udelukkende på `kind:'crash'`, og `raceRunner.persistIncidents` skriver kun `rider_condition.injured_until`/`injury_cause='race_crash'` for styrt-udgange. Indtil 5/9 gav ALLE udgåelser skade uanset art — spillerne så en mekanisk defekt koste dage på sidelinjen, hvilket ingen doc lovede.

**Ejeren kan omgøre den.** Vil en mekanisk udgang også koste dage (fx som "rytteren kom hjem sent og mistede træning"), er det et bevidst designvalg, ikke en fejl — men så skal det stå her OG i `help.json` (en+da) samtidig, ellers er reglen usynlig for spilleren.

**Tredje art: `kind:'injury'`** ([#4418](https://github.com/NicolaiDolmer/CyclingZone/issues/4418)) er ikke et uheld i løbet. Det er en rytter der var skadet i forvejen og derfor ikke kunne stille til start på en etape. Skaden ejes af `rider_condition` og må aldrig overskrives af løbsmotoren. I UI'en er han en **ikke-starter**, ikke en udgået — en label-mapping der behandler alt ikke-styrt som "mekanisk defekt" er derfor forkert.

---

## 3. Invarianter (property-testede, må aldrig brydes)

1. **Determinisme.** Samme input ⇒ byte-identisk output. Per-rytter-hash, så én ekstra tilmelding ikke flytter andres relative udfald.
2. **Gruppe-tid.** Alle i samme mål-gruppe har identisk `time_seconds`.
3. **Monotoni.** Inden for samme gruppe kan lavere testet evne aldrig give bedre tid. Støj skalerer magnitude, aldrig fortegn.
4. **Km-dækning.** `0 ≤ km ≤ distance_km`, monotont ordnet, #2410-taksonomien håndhævet.
5. **Fog-gate ([#1791](https://github.com/NicolaiDolmer/CyclingZone/issues/1791)).** Ingen rå komponenter, vægte eller sandsynligheder i `events[].params`.
6. **Låst feltstørrelse ([#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615)).** Lige så mange i mål som på startlisten, hver rytter præcis én gang, placeringer = en komplet permutation 1..N. Grupper splittes, smelter sammen og bliver til placerings-tiers hele vejen igennem; hvert skridt kan tabe eller duplikere en rytter, og fejlen ville vise sig som et forskudt anker-tal længe før nogen så årsagen. Feltet er nævneren i felt-sammenhængs-ankeret.
7. **Felt-sammenhæng ([#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615)).** En massefinale afgøres på **placering**, ikke på tid: den ankomne pulje deler vindertiden, og rækkefølgen bæres af `EngineState.finish_order`. Selektive finaler (bjerg, punch, nedkørsel, udbrud, ITT) beholder individuelle tids-tiers — dér er tidsforskellene ægte.

Invariant 6 og 7 er property-testet i `backend/lib/engine/v4/fieldIntegrity.test.ts` over evne-niveauerne 5/11/30/60/99, samme skala-invariant-form som #4604-load-guarden.

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

**F3-noten (målt 2/9, [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604), opdateret 3/9 [#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615)).** "I gang" stod i denne tabel fra 21/8 til 2/9 uden at være efterprøvet. Tilstanden 2/9 var: `index.ts` kaldte **kun M2, M3 og M4** (plus M1, der bor i selve segment-loopet), og M5-M12 var kode uden kaldssted.

**Wiret 3/9 (#4615):** `SegmentHookContext` bærer nu `StageInput.orders` rå videre, `MechanicHooks` har et `breakaway`-felt, og motoren kalder **M5** (udbrud, hvert segment — efter climb/descent, før finale) og **M6** (leadout, inde fra finale-hooket, på den usorterede kontendentliste før sortering). **M14** producerer ordrer opstrøms og når kernen gennem `StageInput.orders` — derfor har den intet hook. Head-to-head-harnessen kan nu bygge realistiske holdplaner (`--orders=ai`) i stedet for at give alle `free_role` og en tom ordre-liste, som gjorde M6/M14 målbart død kode i scorecardet.

`TeamOrder` er **bevidst stadig den åbne `{team_id, kind, params}`-konvolut**, ikke T3-formen: hver mekanik parser sin egen `kind`. Rolle-vs-ordre-modsigelsen (#4246, modsigelse 1-2 i §7) er ejer-gated og må ikke låses ind i en frossen kontrakt som sidegevinst ved en wiring-PR. Når #4246 er afgjort, kollapser wrapperne til identitet, og afgørelsen skal bæres af `scripts/lib/headToHeadOrders.js`'s rolle-/ordre-tildeling. Taktik-kortet (UI) er stadig ikke bygget.

**v3 er låst fallback indtil F6.** Flippet er ejer-only og sker aldrig som sidegevinst ved en anden opgave.

---

## 6. Hvad der håndhæver hvad

| Regel | Håndhæves af |
|---|---|
| Determinisme, gruppe-tid, monotoni, km-dækning | property-tests (`fast-check`) + golden fixtures |
| Låst feltstørrelse + felt-sammenhæng | `fieldIntegrity.test.ts` (5 evne-niveauer) |
| Scorecardets feltstørrelse | `headToHeadV4.js`'s låste default (`--field-size=all` er den eksplicitte vej ud) |
| Fog-gaten | samme testmønster som `raceTimeline.test.js` |
| Type-kontrakten | `tsc`-typegate i CI (Node 24 type stripping) |
| Rolle-vokabularet | intet i dag — se modsigelse 3 |
| Balance-bånd | `race:gate` + `balance:check` (advisory) |

---

## 7. Kendte åbne modsigelser

| # | Modsigelse | Issue |
|---|---|---|
| 1 | `hunter` er en **rolle**, `try_break` er en **ordre** — begge udtrykker "kør efter udbruddet". **Løst (ejer-beslutning 27/8 + 2/9, #4246):** rollen er standardordren for hele løbet, taktik-kortet vinder for den enkelte etape, rollen skrives aldrig om af kortet. `race_role` er dog stadig fejlagtigt et sat-bart felt i selve `TeamOrder`-bodyen (`raceTeamOrdersApi.js`, `teamOrdersAdapter.ts`) — udestående oprydning, se spec §4 | denne fil §1 + tactics-spec + [decision-spec](superpowers/specs/2026-09-03-role-vs-teamorder-decision.md) |
| 2 | `sprint_captain` (rolle) overlapper `leadout_for` (F3-ordre) på samme måde. Samme løsning som #1 gælder generelt (rolle = default, ordre = etape-overlay) — ikke separat afklaret pr. rollepar | samme |
| 3 | Rolle-vokabularet havde ingen gate. **Løst 3/9:** `backend/lib/raceRoles.test.js` låser de fem værdier | denne fil §1 |
| 4 | `race:gate:routes` er permanent rød; `longDayEnduranceLift`-båndet står på middelværdien | [#4197](https://github.com/NicolaiDolmer/CyclingZone/issues/4197) |
| 5 | `balance:check` tæller 98 afvigelser på main, men er advisory | [#4196](https://github.com/NicolaiDolmer/CyclingZone/issues/4196) |
| 6 | v4's head-to-head-gate er fortsat rød, men to af de tre ankre er nu inde. Genmålt 2/9 over 5 seeds efter bjerg-ankeret: **bjerg-top-10-spredning 211 s (177-237) mod båndet 180-240** · **sprinter-vinderrate 99,7 % (99,1-100) mod båndet ≥ 90 %** · nedkørsels-/summit-ratio 1,07 (0,92-1,21) mod båndet ≤ 0,5. Nedkørslen er det sidste af de tre | [#4132](https://github.com/NicolaiDolmer/CyclingZone/issues/4132) · [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 7 | `raceRouteRealismScorecard` måler sin egen plan, ikke basen | [#4219](https://github.com/NicolaiDolmer/CyclingZone/issues/4219) |
| 8 | **Head-to-head-scorecardet er seed-domineret.** Samme kode, samme kalender, fem seeds: sprinter-ankeret svinger ~12 procentpoint til hver side. Etaper med samme etapenummer deler feltsample OG motor-seed, så n=117 flade etaper er reelt ~20 uafhængige træk. Et enkelt-seed-tal kan derfor hverken erklære et anker grønt eller rødt — scorecardet skal aggregere over seeds før det kan gate noget. **Ejer-beslutning 2/9: gaten måles som 5-seed-middel med spænd; fejlrettelser der løfter alle ankre uden regression må merges som fundament (#4606), mens båndkravene forfølges pr. anker** | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 9 | `positioning` og `tactics` står i `AbilityKey` og vægter i finalens demand-vektorer, men **ingen rytter i spillet har dem** (0 af 5.938 i S3-populationen). Vægten falder tavst på gulvet, så bl.a. massespurt-finalen afgøres på en mindre del af sin egen vektor end tabellen antyder | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 10 | **Felt-favoritters win-rate (bånd 25-40 %) var 83,2 % 2/9 fordi mekanikkerne ikke var wiret.** Efter #4615's wiring falder den (målt 3/9 over 5 seeds mod en offline proxy-kalender: 57,7 %) men er stadig rød. Cellen forfølges ved at koble mekanikkerne på, **aldrig ved at straffe styrke** (ejer 4/8). Oprindelig note: Målt 2/9 over 5 seeds: 53,7 % før bjerg-ankeret, 83,2 % efter. Båndet forudsætter at udbrud og holdtaktik af og til vinder — M5 (udbrud), M6 (leadout) og M14 (AI-taktik) er skrevet og testet, men kaldes ikke af `index.ts`, så den stærkeste rytter vinder næsten altid. Cellen skal forfølges ved at koble mekanikkerne på, **aldrig ved at straffe styrke** (ejer 4/8). Jo bedre fysiologien virker, jo højere stiger tallet — det er en måler på manglende mekanik, ikke på balance | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 11 | **Bjerg-top-10-ankeret er kun meningsfuldt ved realistisk feltstørrelse.** Samme kode scorer 211 s ved 180 ryttere og 19 s ved hele populationen (5.938) — målet er sekundbaseret og skalerer med feltet, fordi en stor peloton giver en stor frontgruppe. Kørsel B (180) er gaten, jf. scorecard-metodologien 23/8; kørsel A's tal er ikke et mål for dette anker | [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604) |
| 12 | **App-lag løst 4/9 (#4746), DB-lag stadig åbent:** `EXCLUSIVE_ROLES` (frontend) og backend-guarden (`raceStageRolesApi.validateStageRoleOverrides`) håndhæver nu `hunter` på etape-taktikken (`race_stage_roles`), samme mønster som `captain`/`sprint_captain` — en ny hunter degraderer den forrige i UI'et, og et rå API-kald med 2+ huntere afvises. Holdudtagelsen (`race_entries`) håndhævede allerede `hunter` unikt via DB-constraint. Målt 3/9 (før fixet): 119 af 760 hold-etape-hunter-grupper (15,7 %) havde mere end én hunter, op til 6 samtidig — de RÆKKER er ikke ryddet op (ingen DB-migration i #4746's PR: en unique-constraint på `race_stage_roles` ville fejle mod dem med det samme, og en oprydning er destruktiv/ejer-gated). A/B-forslag + begrundelse i [decision-spec](superpowers/specs/2026-09-03-role-vs-teamorder-decision.md) §5 (denne PR bygger forslag A, kun i app-laget) | [#2405](https://github.com/NicolaiDolmer/CyclingZone/issues/2405) · [#4746](https://github.com/NicolaiDolmer/CyclingZone/issues/4746) |

| 12 | **Sprinter-vinderraten (≥ 90 %) og felt-sammenhængen (80-95 %) trækker mod hinanden når M5 er wiret.** Et udbrud der overlever en flad etape gør begge ting på én gang: vinderen er ikke en sprinter, og kun udbryderne deler vindertiden. Målt 3/9 over 5 seeds efter wiringen: felt-sammenhængen steg fra ~1 % til 17,7 % (bånd 80-95 %), mens sprinter-ankeret faldt fra ~91 % til 85,0 %. Begge tal er styret af den samme størrelse — hvor ofte et udbrud går hele vejen — og på en flad etape går det i dag hele vejen langt oftere end i virkeligheden. Det er en kalibrering af jagt-modellen, ikke en wiring-mangel, og den er ejer-gated | [#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615) |
| 13 | **To led i jagt-modellen er absolutte konstanter målt mod en evne-relativ skala** (samme fejlfamilie som #4604/#4606): sen-etape-uroen og udbruddets størrelses-bonus. Mod den ægte population (median-evne 11/99) er de evne-afledte led en brøkdel af deres tiltænkte størrelse mens konstanterne står uændret. En naiv relativisering af begge led blev prøvet og **målt 3/9: den forværrede bjerg-ankeret** (207 → 247 s mod bånd 180-240) og blev rullet tilbage. Rettelsen kræver sin egen kalibrering med ejer-go, ikke en sidegevinst | [#4615](https://github.com/NicolaiDolmer/CyclingZone/issues/4615) |

**Bjerg-ankerets måleflade (ejer-beslutning 2/9, [#4604](https://github.com/NicolaiDolmer/CyclingZone/issues/4604)).** Bjerg-top-10-spredningen måles **kun på topankomster** — bjergetaper der slutter på toppen. En bjergetape der slutter på en nedkørsel hører til nedkørsels-ankeret, som netop kræver at de etaper er tættere; da begge ankre tidligere midlede over de samme etaper, kunne de to bånd ikke opfyldes samtidigt.

---

## 8. Kildedokumenter

Denne fil er kilden til **reglerne**. Design-rationalet bor stadig i:

[`2026-08-20-race-engine-v4-intra-stage-design.md`](superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md) (vision, mekanik-katalog, beslutningslog) · [`2026-08-21-race-engine-v4-f2-core-design.md`](superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md) (kerne-kontrakten) · [`2026-08-21-race-tactics-orders-v1-design.md`](superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md) (ordre-kontrakten) · [`2026-07-21-realistic-routes-foundation-design.md`](superpowers/specs/2026-07-21-realistic-routes-foundation-design.md) (rutemodellen) · [`2026-07-22-sub2-deep-competitions-design.md`](superpowers/specs/2026-07-22-sub2-deep-competitions-design.md) (passager, pointskalaer) · [`2026-07-22-sub3-route-aware-engine-design.md`](superpowers/specs/2026-07-22-sub3-route-aware-engine-design.md) (gap-model) · [`2026-08-17-race-event-log-stage-timeline-design.md`](superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md) (tidslinje-taksonomi).

Naboområder: [`CALENDAR_RULES.md`](CALENDAR_RULES.md) (hvornår løbene køres) · [`PROGRESSION_RULES.md`](PROGRESSION_RULES.md) (hvilke evner rytterne møder op med) · [`GAME_INVARIANTS.md`](GAME_INVARIANTS.md).
