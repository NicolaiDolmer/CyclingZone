# Drift-audit del B - RACE_ENGINE, PLANNING_CENTER, DASHBOARD, FORUM

> **Måle-rapport, ikke en revision.** Ingen af de fire SSOT-dokumenter er ændret. Hver linje herunder er enten et tal jeg har set i koden, et tal jeg har målt i prod-databasen, eller en eksplicit markeret "ikke verificeret".

Målt 31/8 2026 (Europe/Copenhagen) mod `main` i `C:\Dev\CyclingZone`. Prod-tal via Supabase read-only SELECT, projekt `ghwvkxzhsbbltzfnuhhz`.

Reglen der auditeres imod: `AGENTS.md` hard rule 30, led **(c)**: *"ændrer arbejdet en regel, en konstant eller en kontrakt, opdateres SSOT'en i SAMME PR som ændringen."*

**Dækning.** `CALENDAR_RULES.md` er sprunget over efter aftale (andet spor). `ECONOMY_RULES.md`, `SPONSOR_RULES.md`, `BOARD_RULES.md`, `PROGRESSION_RULES.md`, `RIDER_GENERATION.md`, `GUARDRAILS_CORE.md`, `GAME_INVARIANTS.md` er ikke i denne rapports scope.

---

## 0. Prioriteret: hvad kan føre til en forkert beslutning

Fire fund. Resten af rapporten er linjenummer-støj og forældede måletal, som ikke ændrer nogens valg.

| # | Fund | Dokument | Hvorfor det kan koste |
|---|---|---|---|
| **A** | Rolle-vokabularets prod-volumen er angivet til **69.962**; målt i dag er det **107.731** | `RACE_ENGINE_RULES.md` §1 | Tallet ER argumentet for at vokabularet ikke kan ændres. Et 54 % for lavt tal gør en migration til at se billigere ud, end den er |
| **B** | §4 regel 5 låser **tre** spiller-indgange til auto-udfyld; koden har **fire** kaldsteder, og den ene af de tre navngivne (`PlannerAssistantCard`) kalder intet | `PLANNING_CENTER_RULES.md` §4 | Reglen lyder "en fjerde indgang må ikke opstå". Den findes allerede. En læser der stoler på reglen vil overse `StrategyPage`, som er sæson-bred og ikke dag-scopet |
| **C** | "Alt kan slås fra" + "23 moduler i alt" - men kun **13** moduler er registreret i `DASHBOARD_MODULES` | `DASHBOARD_RULES.md` §3 + §4 | §5's tjekliste punkt 3 ("Er det registreret i `DashboardCustomizeMenu`?") beskrives som gældende praksis. For 10 af 23 moduler er den ikke fulgt i dag |
| **D** | `HeroAgonyCard` (`heroAgony`, #3397) renderer i fuld bredde umiddelbart over to-kolonne-gridet og står **ingen steder** i §4's rækkefølge | `DASHBOARD_RULES.md` §4 | §4 præsenteres som den fulde rækkefølge efter omlægningen. Et modul der ikke er i listen kan flyttes af næste PR uden at nogen opdager det, og §0 regel 1 (fuld bredde kræver nedskrevet grund) er ikke opfyldt for det |

---

## 1. `RACE_ENGINE_RULES.md` (142 linjer)

### 1a. Verificeret korrekt

| Påstand i doc | Kontrol | Resultat |
|---|---|---|
| §1: rolle-typen bor på `backend/lib/engine/v4/types.ts:35` | `sed -n '30,40p' backend/lib/engine/v4/types.ts` | **Præcis.** Linje 35 er `export type RiderRole = "captain" \| "sprint_captain" \| "helper" \| "hunter" \| "free_role";` - ordret som citeret, inkl. rækkefølge |
| §1: samme fem i backend-lib'en | `backend/lib/raceRoles.js:213-215` | **Præcis.** `VALID_RACE_ROLES` = samme fem, samme rækkefølge. `types.ts` kalder sig selv "kopi af raceRoles.js VALID_RACE_ROLES" i kommentaren linje 34 |
| §0: `simulateStageV4(input) → output` | `backend/lib/engine/v4/fixtures.test.ts:23,51` | **Findes.** Eksporteret fra `backend/lib/engine/v4/index.ts`, testet mod frosne fixtures |
| §6: fog-gaten testes "samme testmønster som `raceTimeline.test.js`" | `find` | **Filen findes:** `backend/lib/raceTimeline.test.js` |
| §8: syv spec-links | Alle syv slået op i `docs/superpowers/specs/` | **Alle syv opløses.** Ingen døde links |
| §8: naboområder `CALENDAR_RULES.md`, `PROGRESSION_RULES.md`, `GAME_INVARIANTS.md` | `ls docs/` | Alle tre findes |
| §2: `EffortLevel` = `protect`/`normal`/`save` (M12) | `types.ts:38` | **Præcis**, og spejlet i `raceRoles.js:216` (`VALID_EFFORTS`) |

### 1b. Drift

| Doc-påstand | Faktisk værdi | Kilde | Klasse |
|---|---|---|---|
| §1: *"skrevet **69.962** gange i prod"* om `race_entries.race_role` + `race_stage_roles.race_role` | **107.731** i alt pr. 31/8: `race_entries` 99.458 · `race_stage_roles` 8.273 | SQL nedenfor | **Materiel (fund A)** |

Målekommandoen, så tallet kan efterprøves:

```sql
select 'race_entries' as src, race_role, count(*) from race_entries group by 1,2
union all
select 'race_stage_roles', race_role, count(*) from race_stage_roles group by 1,2
order by 1,3 desc;
```

Resultat 31/8 2026:

| Tabel | `helper` | `captain` | `sprint_captain` | `hunter` | `free_role` | I alt |
|---|---|---|---|---|---|---|
| `race_entries` | 74.714 | 16.827 | 6.037 | 1.653 | 227 | **99.458** |
| `race_stage_roles` | 4.570 | 1.137 | 954 | 913 | 699 | **8.273** |

Doc'en daterer ikke sit 69.962-tal, så jeg kan ikke afgøre om det var korrekt da det blev skrevet (25/8) eller allerede forkert. Uanset hvad er det ikke fulgt med.

### 1c. Om `hunter` og `free_role` (opfølgning på nat-fundet)

Nat-fundet var, at rollevokabularet indeholder `hunter` og `free_role`, som *assistenten* aldrig sætter. Hvad jeg kan bekræfte med tal:

- **Rollerne bruges i data.** `race_entries` har 1.653 `hunter`-rækker og 227 `free_role`-rækker. De er altså ikke tomme enum-værdier.
- **Auto-udfyld skriver `helper`.** `backend/lib/raceEntryGenerator.js:470` mapper picks til `race_role: "helper"`, og `:575` opdaterer degraderede roller til `"helper"`.
- **`hunter` har databasegaranti, `free_role` har ikke.** `raceEntryGenerator.js:80`: `SPECIAL_ROLES = new Set(["captain", "sprint_captain", "hunter"])`, koblet til unique-constraints `uq_race_entries_captain/_sprint_captain/_hunter` (`database/2026-06-12-race-entries-roles.sql`, citeret i kodekommentaren linje 78). `free_role` er ikke i det sæt.

**Ikke fastlagt - kræver ejer-beslutning:** doc §1 giver alle fem roller samme status i tabellen, men koden behandler dem i tre klasser (unik-begrænset special: captain/sprint_captain/hunter · autofill-default: helper · uden begrænsning: free_role). Skal §1's tabel have en kolonne for den forskel? Jeg har ikke sporet hele skrivevejen og gætter ikke.

### 1d. Ikke verificeret inden for tidsbudgettet

§3's fem invarianter, §5's fase-status, §7's syv modsigelser (hvoraf 4-7 refererer til gate-kørsler og issue-tilstande) samt §2's mekanik-katalog M1-M14 er ikke efterprøvet. Ingen af dem er stikprøvet, så rapportér dem ikke som grønne.

---

## 2. `PLANNING_CENTER_RULES.md` (136 linjer)

### 2a. Verificeret korrekt

| Doc-påstand | Kontrol | Resultat |
|---|---|---|
| §1: `marketWriteLimiter` = **30 pr. 60 sek**, `backend/lib/rateLimiters.js:64` | `grep -n "export const" backend/lib/rateLimiters.js` | **Præcis på både værdi og linjenummer.** Linje 64 er `export const marketWriteLimiter = buildLimiter({`, med `windowMs: 60_000` og `max: 30` |
| §4 regel 2: implementeret i `fillMissingTeamEntries` | `backend/lib/raceRunner.js:812` | **Findes**, eksporteret. Kaldes fra `raceRunner.js:1128` |
| §4 regel 2: *"fyldes præcis op til 6"* | `backend/lib/raceAutopick.js:47` | **Præcis.** `export const MIN_RACE_ENTRIES = 6;` med kommentar `:41`: *"raceRunner.fillMissingTeamEntries fylder først op til netop dette tal"* |
| §5: *"`peak_planner_enabled` er `on` i prod (koden defaulter off)"* | `select key, value from app_config where key='peak_planner_enabled'` → `on`; `backend/lib/raceEngineFlag.js:41-46` bekræfter default-off | **Præcis, begge led** |
| §6: otte komponenter findes | `ls` på alle otte stier | **Alle otte findes.** `SeasonView.jsx`, `SeasonDayToggle.jsx`, `SeasonPicker.jsx`, `seasonTimeline.js`, `suitability.js`, `FitBar.jsx`, `MobileLanes.jsx`, `PlannerAssistantCard.jsx` |
| §6: *"`lib/seasonTimeline.js` - **11** rene funktioner"* | `grep -c "^export " frontend/src/lib/seasonTimeline.js` → `11` | **Præcis på tallet.** `nextFocusDayIso` findes (`:128`) som beskrevet |
| §7 fund 5: `BoardPage.jsx:2288` mangler token-gren | `sed -n '2288p'` → `if (!token) { setLoading(false); return; }` | **Præcis på linje og indhold** |
| §1: alle fire endpoints findes | `grep` i `backend/routes/api.js` | `POST /races/:raceId/selection/auto` på `api.js:5302`; bulk-ruten har egen registreringsorden-test i `backend/routes/raceSelectionBulk.routes.test.js:124` |
| §2: rolle-vokabularet ejes af motoren | Samme fem som `RACE_ENGINE_RULES.md` §1 | **Konsistent** mellem de to dokumenter |

### 2b. Drift - materiel (fund B)

**§4 regel 5:** *"Spiller-initieret udfyld er lovligt via de **tre** eksisterende indgange (dagsboardet, `PlannerAssistantCard` for peaks, `/selection/auto`). En fjerde indgang må ikke opstå."*

Målt i koden i dag:

| # | Kaldsted | Kald | `day`-parameter | Navngivet i §4 regel 5? |
|---|---|---|---|---|
| 1 | `frontend/src/components/racehub/AvailableRidersPool.jsx:39` | knap → `onRegenerate("missing")` (UI-indgang, fetch sker i #2) | via #2 | ja ("dagsboardet") |
| 2 | `frontend/src/components/racehub/RaceHubBoard.jsx:476` | `POST /api/races/distribution/regenerate?day=${day}&mode=${mode}` | **ja** | ja ("dagsboardet") |
| 3 | `frontend/src/components/race/RaceSelectionPanel.jsx:354` | `POST /api/races/${raceId}/selection/auto` | n/a (løbs-scopet) | ja ("`/selection/auto`") |
| 4 | `frontend/src/pages/StrategyPage.jsx:148` | `POST /api/races/distribution/regenerate?mode=missing` | **nej** | **nej** |

To præciseringer oven på nat-fundet:

1. **Nr. 4 er sæson-bred, ikke dag-scopet.** `StrategyPage.jsx:143-153` er en selvstændig `regenerate()` uden `day`. `RaceHubBoard`s variant sender altid `day`. De to indgange har derfor ikke samme rækkevidde, og §4 regel 5 beskriver kun den ene.
2. **`PlannerAssistantCard` kalder ingenting.** `grep "fetch(" frontend/src/components/planner/PlannerAssistantCard.jsx` giver **nul** hits. Komponenten er præsentations-laget ("Accept all", jf. §6), og skrivningen sker et andet sted. §4 regel 5 navngiver den altså som en af tre "indgange", men den er ikke et kaldsted.

Nettoresultat: reglen tæller tre, koden har fire kaldsteder, og de tre navngivne dækker ikke de fire faktiske. §8 modsigelse 3 (*"Tre indgange til auto-udfyld"*) arver samme fejl.

### 2c. Drift - linjenummer-støj

Alle substans-påstandene herunder holder stadig. Kun linjehenvisningerne er skredet, konsistent 2-7 linjer, hvilket tyder på at filerne er vokset uden at §7 fulgte med.

| Doc-reference | Faktisk linje | Substansen holder? |
|---|---|---|
| §7 fund 1: `StrategyPage.jsx:68` (*"kun `saved=false`"*) | `const [saved, setSaved] = useState(false);` står på **:28**. Linje 68 er `setLoadError({ kind: "parse", ... })` - urelateret | **Ja.** Ingen `beforeunload`/`boardDirty`-vagt i `StrategyPage.jsx` (grep giver nul hits); `RaceHubBoard.jsx:143-153` har begge dele, som doc'en sammenligner med |
| §7 fund 2: `CalendarPage.jsx:49-62` (`tab`/`division`/`pool` ren `useState`) | `tab` **:55**, `division` **:56**, `pool` **:61** - inden for det angivne spænd | **Ja.** Ingen `useSearchParams` i filen |
| §7 fund 3: `RaceColumn.jsx:100` (tilbage-navigation) | Linje 100 er `computeColumnStatus(...)`. Navigationen er `RaceLink` på **:139** (import `:14`) | Ikke efterprøvet - kun linjen er tjekket |
| §7 fund 5: `RaceSelectionPanel.jsx:126+129` | **:124** (`if (!headers) return;`) + **:127** (`if (!res.ok) return;`) | **Ja**, begge tavse grene findes |
| §7 fund 5: `StageRoleMatrix.jsx:87+90` | **:84** + **:87** | **Ja** |
| §7 fund 5: `useTraining.js:41+44` | **:34** (`if (!headers) { setLoading(false); return; }`) + **:37** (`if (res.ok) {`) | **Ja**, men mønstret er `if (res.ok)` uden else-gren, ikke `if (!res.ok)`. Filen ligger i `frontend/src/lib/`, ikke `hooks/` - doc'en angiver ingen sti |
| §7 fund 5: `useScouting.js:77+80` | **:70** + **:73**, samme mønster, samme mappe | **Ja** |
| §8 modsigelse 4: *"`?view=`-parameteren slettes af `SeasonView.jsx:202`"* | `p.delete("view")` står på **:235**. Ingen `p.set("view"` nogen steder i filen | **Ja**, den slettes og sættes aldrig |

### 2d. Ikke verificeret

§0 (IA-status pr. zoom-niveau), §3 (akse-reglen - ligger i `CALENDAR_RULES.md`, andet spor), §5's tal for belastnings-linsen (`load.raceDays` mod `race_stage_schedule.game_day`), §7 fund 4 og 6, §8 modsigelse 2 og 5. Ikke stikprøvet.

---

## 3. `DASHBOARD_RULES.md` (71 linjer)

### 3a. Verificeret korrekt

| Doc-påstand | Kontrol | Resultat |
|---|---|---|
| §3: guld-knappen styres af `computeDashboardGoldCta` | `DashboardPage.jsx:64` (import fra `../lib/dashboardGoldCta.js`), brugt `:944` | **Præcis** |
| §3: registrering i `DashboardCustomizeMenu` | `DashboardPage.jsx:55` importerer den, render `:1002`; menuen læser `DASHBOARD_MODULES` fra `frontend/src/lib/useDashboardLayout.js:8` | **Mekanikken findes** (men se fund C) |
| §4: to-kolonne-gridets **rækkefølge** | `DashboardPage.jsx:1279` og frem | **Præcis, par for par:** Auktioner \| Transfers · Løb \| From the forum (`ForumHighlightsCard`, `:1445`) · Stilling/pulje \| Økonomi-prognose · Seneste resultater \| Rytter-rangliste · Bestyrelse \| Global Rank. Doc'ens "…" i sidste par er `globalRank` (#2453) |
| §3: betingede par må ikke efterlade tomme celler | `DashboardPage.jsx:1074-1092` og `:1101-1115` | **Implementeret.** Begge par bruger `className={partnerVisible ? undefined : "lg:col-span-2"}` og kollapser som beskrevet |
| §4 øvre del: `[Seneste resultat \| Næste træk]` derefter `[Holdudtagelse \| Sæsonstatus]` | `:1074` hhv. `:1101`, begge med kodekommentaren `#dashboard-layout-25/8 (docs/DASHBOARD_RULES.md §4)` | **Præcis**, og kodekommentarerne citerer SSOT'en - hard rule 30 (b) er efterlevet her |

### 3b. Drift - materiel

**Fund C - "23 moduler" mod 13 registrerede.**

§4 siger *"23 moduler i alt"*. §3 siger *"**Alt** kan slås fra. Nye moduler registreres i `DashboardCustomizeMenu`"*, og §5 punkt 3 gør det til et tjekliste-krav.

Målt: `frontend/src/lib/useDashboardLayout.js:8-32` indeholder **13** poster:

`nextActions` · `forecast` · `myLatestResult` · `heroAgony` · `auctions` · `transfers` · `races` · `divStandings` · `board` · `recentResults` · `riderRanking` · `globalRank` · `forumHighlights`

`grep -o 'isVisible("[a-zA-Z]*")' frontend/src/pages/DashboardPage.jsx | sort -u` giver de samme 13 id'er - ingen kaldes uden at være registreret, og ingen registreret er ubrugt. Sættet er internt konsistent; det er bare 13, ikke 23.

De 10 øvrige (advarsler, `TodayStagesStrip`, `OnboardingProgressCard`, `SeasonWrapNudgeCard`, `SeasonStartGuideCard`, `MaidenWinMomentCard`, Discord-nudgen m.fl.) renderer på egne betingelser og kan ikke slås fra.

**Ikke fastlagt - kræver ejer-beslutning:** skal §3's "alt kan slås fra" læses som *alle valgfrie* moduler (og de 10 betingede er bevidst undtaget), eller er de 10 en efterslæb-gæld? Jeg gætter ikke - det er ét ja/nej, og §3's ordlyd tillader begge læsninger.

**Fund D - `HeroAgonyCard` findes ikke i §4.**

Faktisk rækkefølge lige før to-kolonne-gridet, målt i `DashboardPage.jsx`:

| Linje | Modul | I §4's rækkefølge? |
|---|---|---|
| 1236 | Discord-nudge-banner (`showDiscordNudgeBanner`) | ja, sidst blandt "betingede engangskort" |
| 1273 | `MaidenWinMomentCard` (#3398, "Første sejr") | ja, men §4 placerer den **før** Discord-nudgen |
| 1276 | `HeroAgonyCard` (#3397, fuld bredde, `isVisible("heroAgony")`) | **nej - står ingen steder i doc'en** |
| 1279 | `<div className="grid grid-cols-1 lg:grid-cols-2 gap-[14px]">` | ja |

To ting: rækkefølgen af "Første sejr" og Discord-nudgen er byttet om i forhold til §4, og `HeroAgonyCard` er helt fraværende. Kortet er et registreret modul (#3397), så det er ikke en skjult detalje - det er en manglende linje i den fil der påstår at være rækkefølgens kilde.

### 3c. Drift - støj

| Doc-påstand | Faktisk | Klasse |
|---|---|---|
| §0 regel 1: gitteret citeres som `grid lg:grid-cols-2 gap-[14px]` | Klassen er `grid grid-cols-1 lg:grid-cols-2 gap-[14px]` (`:1074`, `:1101`, `:1279`) - `grid-cols-1` mangler i citatet | Støj. Ændrer intet ved reglen |

### 3d. Ikke verificeret

**Hele §1 (Clarity-tallene).** 94,65 % scroll-dybde · 150/131/83/48 klik · 470 døde klik mod 123 virksomme · 959 sessions på `/board` mod 5.955 på Mit Hold. Jeg har ikke forespurgt Clarity inden for tidsbudgettet. Tallene er **ikke** efterprøvet og må ikke rapporteres som bekræftede - de bærer §4's begrundelse for at Bestyrelsen mistede sin `lg:col-span-2`.

Heller ikke verificeret: §2's seks ejer-historik-placeringer (kræver issue-opslag), §4's *"9 flyttede plads, 6 gik fra fuld til halv bredde"*, §5 punkt 6 (Playwright-snapshots).

---

## 4. `FORUM_RULES.md` (67 linjer)

Det mest præcise af de fire. Ingen materielle fejl fundet.

### 4a. Verificeret korrekt

| Doc-påstand | Kontrol | Resultat |
|---|---|---|
| §2: syv tabeller | `database/schema-snapshot.json` → `relations` | **Alle syv findes**, ingen navnefejl: `forum_posts`, `forum_replies`, `forum_thread_reads`, `forum_reactions`, `forum_poll_options`, `forum_poll_votes`, `forum_reports` |
| §2: notifikationstypen er `forum_thread_reply` i `notificationTypes.js` | `backend/lib/notificationTypes.js:70` | **Præcis.** Paritets-testen `notificationTypes.test.js` findes som beskrevet |
| §1: *"Trådlisten sorterer efter seneste aktivitet - `coalesce(last_reply_at, created_at) desc`, pins øverst"* | `backend/lib/forum.js:24` og `:241` | **Præcis**, ordret samme udtryk i kodekommentaren |
| §2: soft delete via `deleted_at` | Feltet findes og bruges i mine tællinger | **Bekræftet** |
| Rate limiting (implicit) | `backend/lib/rateLimiters.js:120` `forumWriteLimiter` | Findes (ikke nævnt i doc'en - ikke en fejl, blot ikke dokumenteret) |

### 4b. Forældede måletal (ikke fejl - doc'en daterer dem selv til 25/8)

§0's tabel er eksplicit mærket *"Målt 25/8, 19 dage efter lancering"*. Genmålt 31/8, seks dage senere:

```sql
select
 (select count(*) from forum_posts where deleted_at is null) as posts,
 (select count(*) from forum_replies where deleted_at is null) as replies,
 (select count(distinct user_id) from (select user_id from forum_posts where deleted_at is null
   union all select user_id from forum_replies where deleted_at is null) u) as writers,
 (select count(*) from forum_thread_reads) as thread_reads,
 (select count(*) from forum_reactions) as reactions;
```

| Måling | Doc (25/8) | Målt 31/8 | Note |
|---|---|---|---|
| Opslag | 12 | **13** | +1 |
| Svar | 75 | **108** | **+44 %** på seks dage |
| Skribenter | 15 (30-dages vindue) | **17** (all-time) | Vinduerne er ikke ens; forummet er kun 25 dage gammelt, så tallene er tæt på sammenlignelige, men ikke identisk definerede |
| Tråde uden svar | 2 af 12 | **2** af 13 | Uændret |
| `forum_thread_reads` | ikke angivet | **379** rækker | Nyt måletal |
| `forum_reactions` | ikke angivet | **3** rækker | Nyt måletal |

To konsekvenser værd at kende, uden at jeg vurderer dem:

- §3 begrunder *"Søgning er udskudt"* med *"Med 12 tråde er der ikke noget at søge i"*. Trådtallet er nu 13. Svartallet er vokset 44 % på seks dage.
- §1 låser *"Opbakning er én tæller, ikke en emoji-palet"*. `forum_reactions` indeholder **3** rækker i alt. Tælleren bruges stort set ikke. Det er et input til #4235-aflæsningen 15/9, ikke et argument imod beslutningen.

### 4c. Ikke verificeret

§2's RLS-påstande (`user_id = auth.uid()` på `forum_thread_reads` og `forum_reactions`, backend-only skrivning på `forum_posts`/`forum_replies`) er **ikke** efterprøvet mod de faktiske policies. §1's dedupe-adfærd (PR #4238) og rapporterings-kravet (#3452) er ikke testet. §0's benchmark-tal (1-9 % normal) og §4's forbehold er ikke-verificerbare påstande om eksterne kilder.

---

## 5. Hard rule 30 (c) - hvor fulgte SSOT'en ikke med

Reglen kræver at en ændret regel/konstant/kontrakt opdaterer SSOT'en i **samme PR**. Fire steder hvor det målbart ikke skete:

| # | Hvad der ændrede sig | SSOT der ikke fulgte med |
|---|---|---|
| 1 | `race_role`-volumen voksede fra 69.962 til 107.731 | `RACE_ENGINE_RULES.md` §1 |
| 2 | Et fjerde auto-udfyld-kaldsted (`StrategyPage.jsx:148`) eksisterer | `PLANNING_CENTER_RULES.md` §4 regel 5 + §8 modsigelse 3 |
| 3 | `HeroAgonyCard` (#3397) placeret fuld bredde over gridet | `DASHBOARD_RULES.md` §4 |
| 4 | Otte linjehenvisninger i `PLANNING_CENTER_RULES.md` §7/§8 er skredet 2-33 linjer | `PLANNING_CENTER_RULES.md` §7 fund 1+5, §8 modsigelse 4 |

**PR-attribution er ikke lavet.** Jeg har ikke kørt git-arkæologi for at fastslå *hvilken* PR der i hvert tilfælde skulle have opdateret SSOT'en. Det kræver `git log -S` pr. symbol og lå uden for tidsbudgettet. Rapportér derfor fundene som "SSOT fulgte ikke med", ikke som "PR #N brød hard rule 30".

---

## 6. Hvad ejeren skal afgøre

Fire ting, hver med de målte tal indbygget. Ingen af dem er noget jeg kan afgøre fra koden.

1. **Skal `RACE_ENGINE_RULES.md` §1's volumen-tal rettes til 107.731, eller skal det have en dato på og stå som et 25/8-øjebliksbillede?** (De to andre SSOT'er, `DASHBOARD_RULES.md` §1 og `FORUM_RULES.md` §0, daterer deres måletal; `RACE_ENGINE_RULES.md` §1 gør ikke.)
2. **Er `StrategyPage.jsx:148` en lovlig fjerde indgang der skal skrives ind i §4 regel 5, eller en indgang der skal fjernes?** Den er sæson-bred (ingen `day`-parameter), hvor de tre navngivne er dag- eller løbs-scopede.
3. **Betyder `DASHBOARD_RULES.md` §3's "alt kan slås fra" alle 23 moduler eller kun de 13 registrerede?** I dag kan 13 slås fra.
4. **Skal `HeroAgonyCard` (fuld bredde, `DashboardPage.jsx:1276`) blive i fuld bredde?** §0 regel 1 kræver en nedskrevet grund til fuld bredde; der står ingen i hverken §4 eller kodekommentaren på `:1275`.

---

## 7. Sammenfatning i tal

| Dokument | Påstande stikprøvet | Verificeret korrekt | Materiel drift | Linjenummer-støj | Ikke verificeret |
|---|---|---|---|---|---|
| `RACE_ENGINE_RULES.md` | 8 | 7 | 1 | 0 | §2, §3, §5, §7 |
| `PLANNING_CENTER_RULES.md` | 17 | 9 | 1 | 8 | §0, §3, §5-tal, §7 fund 4+6 |
| `DASHBOARD_RULES.md` | 8 | 5 | 2 | 1 | hele §1, §2, §5.6 |
| `FORUM_RULES.md` | 5 | 5 | 0 | 0 | RLS-policies, §0-benchmark |

`FORUM_RULES.md` er præcis på alt jeg kunne måle. `DASHBOARD_RULES.md` har den højeste andel uverificérbart indhold, fordi §1 hviler helt på Clarity-tal der ikke ligger i repoet.
