# Undersøgelse #8548: rotation der pauser ved hvile og løb (teknisk design)

Refs #8548, Refs #7456. Undersøgelsesspor (kind: investigate, #5220), 21/11. Kun design, ingen kode.

Rapporten er selve designet. Den er skrevet til stien `docs/superpowers/specs/2026-11-21-7456-rotation-design.md` i briefen, men bølgens leveringsregel (#8233) tillader kun denne ene fil i PR'en. Hovedsessionen kan flytte den uændret til specs-stien, når ejeren har svaret på spørgsmålene nederst.

## 1. Hvad jeg undersøgte

- Issues: #7456 (body + 18 kommentarer: udkast 1/11, Discord-sweep 2/11, ejerens wireframe 17/11, egomadsen 19/11 om lås og træthedsgrænse, ejer 19/11 og 20/11 om Program-fanen og telefon) og #8548.
- Kode (worktree på `f471418de`):
  - `frontend/src/components/training/r5/programR5Model.ts`: `AVAILABLE_KINDS = ["week"]`. Kommentaren siger direkte, at rotation kræver en plads pr. rytter i backend, og at den ikke findes.
  - `database/2026-07-11-training-week-plans.sql`, `2026-09-26-4629-training-programs.sql`, `2026-10-01-training-groups.sql`, `2026-10-01-training-fatigue-rules.sql`, `2026-10-01-training-cells-flag.sql`.
  - `backend/lib/trainingPrograms.js` (`resolveDayProgram`, `sessionForDayEntry`, `programSlotForRaceDay`), `trainingWeekPlanCells.js` (`seedProgramWeekDays`), `trainingGroups.ts` (kopi-modellen og stigen rytter → gruppe → hold), `trainingFatigueRules.ts` (`applyFatigueRules`, `downgradeProgram`) og `dailyTrainingEngine.js` (rytterløkken ved l. 1820-1900, løbsgrenene ved l. 1960-2030, rapportlinjen ved l. 2439-2507).
  - `docs/audits/2026-11-16-7947-traening-kravspec.md` (punkt 5 og spørgsmål 5: brugerprogrammer og rotation som ét objekt).
- Prod, read-only via Supabase MCP `execute_sql` (kun SELECT): optællinger i `training_week_plans`, `training_groups`, `training_group_members`, `team_training_rules`, `training_rider_ticks` (sidste 7 dage), stadie-flag i `app_config` og index på `training_rider_ticks`. Intet skrevet.

## 2. Bekræftet tilstand

1. **Rotation findes ikke i backend.** Motoren læser kun ugedag × slot (`resolveDayProgram({ weekday, slotIndex })`, hvor `slotIndex = programSlotForRaceDay(raceDay, dateGameDays)`). Ingen kolonne, tabel eller rapportfelt gemmer en plads i en rækkefølge. Frontendens vælger tegnes ikke (`AVAILABLE_KINDS.length > 1` er falsk).
2. **Pauserne findes allerede som udfald pr. slot, men de forskyder ingenting.** Rapportlinjen pr. rytter pr. løbsdag (`training_rider_ticks.report`) har `race_day`, `bound_race_day`, `injured`, `status` og `fatigue_rule`. Ugeplanen er låst til ugedag og slot, så et pas, der rammes af et løb eller af træthedsgrænsen, er tabt. Det er præcis det, spillerne klager over i #7456.
3. **Træthedsgrænsen retter aldrig planen.** Den bytter kun det pas, der køres (`downgradeProgram`). Det passer med en rotation: grænsen bestemmer om slottet kører rotationens pas, og rotationen bestemmer hvilket pas.
4. **Planen er en kopi (ejer-valg 1, 26/9), og grupper kopierer ind i hver følgende rytters række.** En rotation kan følge samme model uden et nyt lag i motoren.

## 3. Målt baseline (prod, 21/11, read-only)

Spillertal står ikke i et offentligt repo, så tallene er afrundede andele.

| Mål | Værdi |
|---|---|
| Hold med en ugeplan-række | ca. hvert femte managerhold |
| Rytterrækker i `training_week_plans` med 35 felter (`session`) | langt de fleste (over 95 %) |
| Hold med et katalogprogram (`program_key`) | under halvdelen af holdene med ugeplan |
| Hold med træningsgrupper | en lille håndfuld. Over 90 % af medlemmerne følger gruppen |
| Hold med træthedsgrænse | ca. 2 ud af 3 af holdene med ugeplan |
| Flag | `training_programs`, `training_program_cells`, `training_groups`, `training_fatigue_rules` = on. `training_effort_levels` = off. `training_page_r5` = off |

Hvor tit ville en rotation pause? Ud fra alle rytter-slots de sidste 7 dage (`training_rider_ticks`):

| Udfald pr. slot | Andel |
|---|---|
| Kørte løb (`race_day`) | ca. 15 % |
| Bundet til løb, inkl. GT-hviledag (`bound_race_day`) | ca. 23 % |
| Træthedsgrænsen slog til (`fatigue_rule`) | ca. 1 % |
| Skadet | ca. 1 % |

Det betyder, at **løb er den store årsag til pauser, ikke træthed**: omkring hvert fjerde slot er bundet til et løb. En rotation på N pas varer derfor typisk omkring N/0,75 slots. UI'et skal vise, hvor næste uge starter.

Indeks: `training_rider_ticks_pkey (rider_id, season_id, game_day)` og `training_rider_ticks_team_date (team_id, season_id, tick_date)` findes. Opslaget "rytterens seneste kvittering før datoen" (afsnit 5) kan altså bruge et eksisterende indeks.

## 4. Datamodel (additiv migration)

**Ingen ny tabel.** Rotationen er en del af planen og følger samme kopi-model som felterne:

```sql
-- database/2026-11-2x-8548-training-rotation.sql (ADDITIV + IDEMPOTENT)
ALTER TABLE public.training_week_plans ADD COLUMN IF NOT EXISTS rotation jsonb NULL;
ALTER TABLE public.training_groups     ADD COLUMN IF NOT EXISTS rotation jsonb NULL;
INSERT INTO public.app_config (key, value, description)
VALUES ('training_rotation', '"off"'::jsonb, 'Stage flag (off|beta|on) for rotation plans (#8548) ...')
ON CONFLICT (key) DO NOTHING;
```

Formen af `rotation` valideres i app-kode (samme mønster som `isValidProgramWeekDays`):

```jsonc
{
  "v": 1,
  "active": true,                    // false = planen er Week blocks; days læses som i dag
  "passes": [                        // 2..35 pas i fast rækkefølge
    { "session": "sprint" },
    { "session": "echelon", "effort": "hard" },   // effort kun med training_effort_levels (#7947)
    { "session": "long_ride" }
  ],
  "rev": 3,                          // stiger ved hver ændring af passes, så en gammel plads kan genkendes
  "anchor": { "index": 0, "rev": 3, "season_id": "...", "game_day": 412 }  // "Spring til pas" / start
}
```

- `days` beholdes urørt. Slås rotationen fra (`active: false`, eller flaget off), læser motoren `days` præcis som i dag. Skift tilbage til Week blocks kræver ingen datamigration.
- `program_key` er fortsat kun proveniens.
- **RLS:** ingen ny tabel, så de eksisterende policies på `training_week_plans` og `training_groups` (eget hold, initplan-form) dækker kolonnen. Backend skriver med service-role som i dag.
- **Sammen med #8550 (egne programmer):** gemmer et brugerprogram `mode 'week'|'rotation'`, kopieres dets `passes` ind i `rotation` ved tildeling. Motoren læser kun kopien, så rotationens motor afhænger ikke af #8550.

## 5. Hvor pladsen gemmes, og hvornår den rykker

**Pladsen gemmes ikke som en tæller, der skrives for sig.** Den stemples på kvitteringen. Rapportlinjen (`training_rider_ticks.report`) får et additivt felt, og kun når rotationen var aktiv for rytteren:

```jsonc
"rotation": { "rev": 3, "index": 7, "length": 10, "advanced": true }
```

Pladsen for næste pas regnes sådan (ren funktion `nextRotationIndex`, ny fil `backend/lib/trainingRotation.js`):

1. Er `anchor.rev == rotation.rev`, og ligger ankeret efter rytterens seneste stemplede kvittering med samme `rev`, så start fra `anchor.index`.
2. Ellers tages seneste kvittering med `rotation.rev == rev`. Næste plads er `index + 1 (mod length)`, hvis `advanced`, og ellers `index`.
3. Ingen stemplet kvittering og intet anker: plads 0.
4. Inden for datoen: hvert slot, der **kører rotationens pas**, bruger den næste plads i **afregningsrækkefølge**, altså i den rækkefølge kvitteringerne skrives (datoens tidligere kvitteringer læses allerede som `dateReceipts`). Afregningsrækkefølge i stedet for løbsdagsrækkefølge betyder, at to slots aldrig får samme plads, heller ikke når et løbsslot afregnes for sig (#7982), eller en DNS frigiver et slot senere (#7737).

Fordele: ingen ny muterbar tilstand og intet nyt skrivekald i commit-RPC'en. Pladsen er idempotent sammen med kvitteringen (unik på `(rider_id, season_id, game_day)`). En genkørsel eller recovery giver samme svar, og en tilbagerulning af en kvittering ruller også pladsen tilbage. Ekstra læsning: én forespørgsel pr. hold pr. dato, hvor kun hold med en aktiv rotation spørger: seneste stemplede kvittering pr. rytter før datoen via pkey-indekset.

**Hvornår rykker pladsen (`advanced: true`)?** Kun når rotationens pas faktisk blev kørt:

| Situation | Rykker? | Kilde i motoren |
|---|---|---|
| Almindeligt slot, aftenkørsel | ja | `program.intensity` fra rotationen |
| **Træn nu** (#7737, stemplet rytter) | ja, for hvert frit slot, der afregnes ved trykket, i løbsdagsrækkefølge | samme rytterløkke; `planPressDay` |
| Kørte løb / race-session afregnet ved etapen (#7982) | **nej, venter** | `racedToday` / `raceLoadToday` |
| Bundet, GT-hviledag i etapeløb | **nej, venter** | `boundRestToday` |
| Frit slot på en etapedato (#5267 A) | ja (det er træning) | `freeSlotOnStageDate` |
| Skadet / syg | **nej, venter** | `injuredToday` |
| `unknown_pending` | **nej**, afgøres når slottet afregnes | `unknownSlot` |
| Træthedsgrænsen med erstatning Hvile / Aktiv restitution | **nej, venter** | `fatigueRuleResult.stamp` |
| Træthedsgrænsen med "samme pas på let" (`light`) | se spørgsmål 2 (anbefaling: ja) | `downgradeProgram(..., "light")` |
| "Dagen efter en etape: første felt restitution" | **nej, venter** | stamp `kind: "after_stage"` |

Etapeløb: hele spændet er bundet, så rotationen står stille gennem løbet og fortsætter på første frie slot bagefter. Det er JeppeKs og thelambas "intet pas går tabt".

## 6. Motorens læsesti (ét nyt trin før træthedsreglen)

I rytterløkken (`dailyTrainingEngine.js` ca. l. 1866) bliver rækkefølgen:

1. `resolveDayProgram(...)` som i dag.
2. **Nyt:** findes `rotation.active` på rytterens række (lag 1), eller på holdets række, når rytteren ikke har en egen række (samme stige), og er flaget `training_rotation` on for holdet, så erstattes sessionen af `programForSession(passes[index].session, program.focus, { effort, effortLevels })`. Det er samme skrivesti som felterne, så en rotation aldrig kan træne noget, et felt ikke kan.
3. `applyFatigueRules(...)` uændret. Den kan stadig nedgradere passet, og så sætter stemplet `advanced: false`.
4. Løbsgrenene (`racedToday`, `boundRestToday`, `injuredToday`) uændret. De sætter også `advanced: false`.
5. Rapportlinjen får `rotation` (kun når trin 2 slog til).

Prognosen (`trainingWeekPlanForecast.js`) skal bruge samme rene funktion til at lægge ugen ud: kendte løbsbindinger venter, og træthedsgrænsen forudsiges som i dag. Ellers viser ugegitteret noget andet end motoren gør (#7982-klassen af fejl).

**Let/Mellem/Hård (#7947):** et pas kan have `effort`. Med `training_effort_levels` off ignoreres nøglen bit-identisk, som for `slotEfforts`. Træthedsgrænsens "let" er en erstatning oven på passets niveau, ikke en ændring af rotationen.

## 7. Grupper vs. rytterens egen plan

- En gruppe har én `rotation`. Ved "Save plan" kopieres den ind i hver **følgende** rytters række (`syncGroupsToSquadProgram`-mønstret), med samme `rev`.
- **Pladsen er altid pr. rytter** (wireframe 17/11: "samme rotation, egen plads pr. rytter"), fordi den ligger på rytterens kvitteringer. Ryttere i samme gruppe kører forskellige løb og står derfor forskellige steder.
- Retter spilleren rytterens egen plan, gælder `follows_group = false` som i dag. Rytteren beholder sin kopi og sin plads.
- "Copy to riders" kopierer `passes` og et nyt `rev`. Spilleren vælger i dialogen "Start fra pas 1" eller "Behold pladsen". Behold er kun muligt, når længden er uændret. Ellers sættes `anchor.index = min(gammel plads, ny længde - 1)`.
- Ændrer spilleren rotationens pas, stiger `rev`, og ankeret sættes til den plads, han valgte i UI'et ("Spring til pas …", standard: samme nummer).

## 8. UI-flow (Program-fanen i R5, bag `training_page_r5`)

Wireframet 17/11 (`rotation.webp`) er specifikationen. Afvigelser er billedspørgsmål til ejeren før byg.

**Desktop**
- Vælgeren "Week blocks | Rotation" i sidehovedet. `AVAILABLE_KINDS` bliver `["week", "rotation"]`, når flaget er on for holdet. Visningen husker sidste valg (`PROGRAM_VIEW_STORE`, ejer 19/11), og et nyt program starter i Week blocks.
- Rotation: én liste med pas i fast rækkefølge (2-35, genveje 5/10/35), træk for at flytte, tilføj/fjern. Niveau-chip pr. pas kun med #7947.
- Rytterens uge: 7 × 5-gitter, hvor løbsfelter er grå med flag (R5 efter TASTE, ejer 20/11), og hvert træningsfelt har rotationens nummer i hjørnet ("7/10"). Felter, hvor træthedsgrænsen forventes at slå til, vises som erstatningen uden nummer.
- Tabellen pr. rytter (wireframe): løb i ugen, løbsfelter, kørte pas, overført, hvor næste uge starter.
- "Spring til pas …" pr. rytter skriver `anchor`.
- Sidens eneste guldknap "Save plan" i sidehovedet sammen med "Copy to riders" (ejer 20/11).

**Telefon**
- Ejer 20/11: variant A (én dag ad gangen) med gem-knap fast i bunden og dagene i én linje med pile. Åbent 21/11: skifter mellem A og B (uge-liste, egomadsen). Rotationen bruger samme skal: listen af pas som en lodret liste med træk-håndtag, og rytterens dag/uge med nummer i hjørnet. Telefonvalget afgøres i #7456-tråden, ikke her.

Tekst: EN først, DA under. RD på engelsk og LD på dansk. Ikoner som streg, ingen emoji. Tal med tabular figures.

## 9. OFF bit-identisk bag kontakt

- Nyt stadie-flag `training_rotation` (off|beta|on), oprettet i **off**. Flip er ejer-only.
- Off: motoren læser aldrig `rotation`, rapportlinjen får intet `rotation`-felt, prognosen er uændret, og API'et afviser skrivning af rotation (409/feature_disabled). Vælgeren tegnes ikke.
- Kolonnen er NULL for alle eksisterende rækker. Selv med flaget on er et hold uden `rotation.active` bit-identisk.
- Bevis i test: golden/facit-kørslerne (`trainNowSameResult7982.facit.json`, `trainingEffortLevels7947*.golden`, `trainingSweepMemory6490.golden.json`) skal være uændrede med flaget off **og** med flaget on uden rotationsrækker.

## 10. Testplan

1. **Ren funktion** `trainingRotation.test.js`: `nextRotationIndex` (anker vs. stempel, `rev`-skift, wrap ved N, længde 2 og 35), og `advancesRotation` for hver række i tabellen i afsnit 5.
2. **Motor (enhed)** i `dailyTrainingEngine.test.js`: en rytter med rotation [A, B, C] over en dato med løb på LD 2 skal give A, (løb), B, C, A. Med træthedsgrænse (Hvile) på LD 1-2 skal det give rest, rest, A, B, C. Etapeløb over 2 datoer skal give pause hele spændet og fortsætte bagefter.
3. **Træn nu = aftenkørsel (I1):** udvid `trainNowSameResult7982.harness.js` med en rotationsrytter. Tryk midt på dagen og aftenkørsel skal give samme indeks pr. slot. Tilføj DNS-frigivet slot (#7737) og race-session afregnet ved etapen (#7982).
4. **Idempotens/recovery:** genkør samme `(rider, season, game_day)` og få samme `rotation`-stempel. En tilbagerullet kvittering ruller pladsen tilbage.
5. **Gruppe:** kopi til følgende medlemmer, `follows_group=false` rører ikke, og pladserne er forskellige pr. rytter.
6. **Prognose = motor:** `trainingWeekPlanForecast` lægger samme indeks ud som motoren for en uge uden overraskelser.
7. **Integration (pglite/pg17):** migrationen er idempotent (to kørsler), og RLS: en fremmed bruger kan hverken læse eller skrive kolonnen.
8. **Frontend:** `programR5Model.test.ts`: `AVAILABLE_KINDS` afhænger af flaget, `rememberedKind`, flytning af pas og "Spring til pas". Playwright-snapshot af Rotation på desktop + telefon (alle 3 projekter, #536).
9. **Fable-dom før merge** (motor/træning, AGENTS 36) og kort gentjek ved tænding.

## 11. Rettelsesplan (byggetrin, risiko)

| Trin | Filer | Risiko |
|---|---|---|
| PR 1: migration + validering + API (skriv/læs `rotation`, flag off) | `database/2026-11-2x-8548-training-rotation.sql`, `backend/lib/trainingRotation.js` (ny, ren), `backend/routes/trainingPrograms.js`, `trainingGroups.js`, `trainingGroups.ts` | lav: additiv, off |
| PR 2: motor + rapportstempel + prognose bag flaget | `backend/lib/dailyTrainingEngine.js` (ét trin i rytterløkken + én læsning pr. hold), `trainingWeekPlanForecast.js`, harness/golden | **høj**: motor. Golden off/on-uden-rækker skal være uændret, og Fable-dom før merge |
| PR 3: R5-UI (desktop + telefon) | `programR5Model.ts`, `ProgramR5.tsx`, i18n en/da, `help.json`, patch note | mellem: UI kræver billede og ejer-go på preview |
| Tænding | `training_rotation` → beta → on (ejer-only) | ejer-gated |

Byggerisici at holde øje med: (a) afregningsrækkefølgen ved Træn nu skal være løbsdagsrækkefølge for de frie slots (ellers brydes I1), (b) ekstra læsning pr. hold skal kun ske for hold med en aktiv rotation, (c) prognose og motor skal dele den rene funktion.

## 12. Åbne spørgsmål til ejeren (A/B med anbefaling)

1. **Træthedsgrænsen midt på dagen: resten af dagen eller kun det slot?** A) Kun de slots, hvor grænsen er overskredet (sådan virker reglen i dag), og rotationen venter på dem. B) Resten af datoen er erstatning, når grænsen slår til (wireframe-teksten). **Anbefaling: A**, fordi den bruger den eksisterende regel uændret og giver samme udfald i Week blocks og Rotation. JeppeKs "sidst på dagen → hele næste dag hvile" kan komme som en senere regel.
2. **Rykker rotationen, når grænsen kører "samme pas på let"?** A) Ja, passet blev kørt (bare let). B) Nej, rotationen venter, og passet køres fuldt senere. **Anbefaling: A**, fordi spilleren selv valgte "let" som erstatning, og B kan låse en træt rytter fast på det samme hårde pas dag efter dag.
3. **Hvor gemmes pladsen?** A) Stemplet på kvitteringen og afledt (dette design). B) En egen tæller-tabel pr. rytter. **Anbefaling: A**: ingen ny tilstand, idempotent med kvitteringen, og intet nyt skrivekald i commit-RPC'en.
4. **"Copy to riders" med en ændret rotation: plads?** A) Behold hver rytters nummer, når længden er uændret, ellers start fra 1. B) Altid fra pas 1. **Anbefaling: A**, så en lille rettelse ikke nulstiller hele holdet.
5. **Rotation og #8550 (egne programmer): ét objekt?** A) Ja, programmet har `mode week|rotation` og kopieres ind i planen (kravspec 16/11, spørgsmål 5). B) Rotation kun som plan, ikke som gemt program. **Anbefaling: A**, men motoren læser kun kopien, så #8548 kan bygges før #8550.

---

Dom: problemet er bekræftet. Rotation findes ikke i backend (`AVAILABLE_KINDS = ["week"]`, ingen lagring af en plads), og i dag går et pas tabt ved ca. hvert fjerde slot på grund af løb. Planen for rettelsen er afsnit 4-11 ovenfor.

bekraeftet + fix-plan


## Tilføjet 22/11 efter Codex-review: SSOT og dommer-scenarier (AGENTS regel 30 og 40)

**SSOT.** Designet er afstemt mod [`docs/TRAINING_RULES.md`](../TRAINING_RULES.md) §3 (dagstyper og sessioner), §4 (ugerytme og hvilket lag der vinder), §5 (restitution, træthedsgrænse og skader), §6 (træning og løbsdage), §13 (træning pr. løbsdag, fem felter pr. dato) og [`docs/CALENDAR_RULES.md`](../CALENDAR_RULES.md) §0 (de to akser: dato og løbsdag), §2b (rytterbinding) og §4 (etapeløb og endagsløb). Hvor designet og reglerne er uenige, vinder reglerne, og afvigelsen er et ejer-spørgsmål før byg.

**Dommer-scenarier før kode (AGENTS 40).** Den uafhængige Fable-dommer skriver de forventede scenarier ud fra reglerne ovenfor, FØR der skrives kode til de resterende trin. De står i `docs/audits/7456-program-dommer-scenarier.md` (fælles for #8548, #8549 og #8550), og samme dommer gennemgår hver motor- og data-PR mod dem før merge. **Erklæret afvigelse:** PR 1 for #8548 (#8577) og #8549 (#8578) blev startet 22/11 nat, før scenarierne var skrevet. Det er ikke overholdelse af regel 40; de merges først efter dommerens gennemgang mod scenarierne.
