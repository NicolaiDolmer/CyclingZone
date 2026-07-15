#!/usr/bin/env node
/**
 * Opret GitHub-issues + dedup-kommentarer fra Discord-sweep 2026-07-15
 * (siden sidste sweep 2026-07-12, commit 6d9b7231).
 *
 * @bobby2106 = ejer/dev (ikke tester). Testere: thelamba, zootne, jeppek,
 * friisisch, sheep_boy123, ez4prebren, mbl0776, smukkethomsen, rodgrodmedflode.
 *
 * Dedup (springes over — dækket af eksisterende issues):
 *  #2398 (træner-stats + gebyrer — jeppek "Training coach"-tråd)
 *  #2402 (natte-restitution — friisisch-tråd)
 *  #2405 (flere ryttere i samme rolle — thelamba Q&A)
 *  #2430 (stall-watchdog falsk-alarm), #2436 (entry-generator captain-kollision)
 *  #2389 (season_standings FK + "Team not found" — VERIFICERET løst, PR #2390/#2394)
 *  #2421 (rider_condition float→smallint — verificeret tavs siden 13/7)
 *  #2434/#2435 (AI-trim stale-alarm — verificeret tavs siden 15/7 14:48 UTC)
 *  entry-generator race_entries_pkey 12/7 — VERIFICERET løst af PR #2382
 *
 * Kommentarer i stedet for nye issues: #2260, #1378, #1905, #2176, #1027,
 *  #932, #1341, #2398.
 *
 * UTF-8-sikkert via temp body-filer. Kør IKKE blindt igen — ingen idempotens.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = 'Discord-sweep 2026-07-15';
const G = '1504615050831466669';
const CH = {
  dolmer: `https://discord.com/channels/${G}/1522915781766283296`,
  general: `https://discord.com/channels/${G}/1504952590486474805`,
  dansk: `https://discord.com/channels/${G}/1505478569969582182`,
  ops: `https://discord.com/channels/${G}/1522691580660547635`,
  qa: `https://discord.com/channels/${G}/1521446924975083520`,
};
const T = (id) => `https://discord.com/channels/${G}/${id}`;

const BUG = (p) => ['bug', 'claude:todo', 'type:bug', 'cat:bug', `priority:${p}`];
const FEAT = (p) => ['enhancement', 'claude:todo', 'type:feature', 'cat:user-feature', `priority:${p}`];
const TASK = (p) => ['claude:todo', 'type:task', `priority:${p}`];
const OWNER = '\n\n**Ejer-ønske** (@bobby2106, #feedback-from-dolmer).';

const ISSUES = [
  // ---------- 1. Spiller-rapporterede bugs (verificeret) ----------
  {
    title: '[bug/HØJ] Akademi-træning dør midt i sæsonen: sæson-budgettet er brugt op efter ~10 dage',
    labels: [...BUG('high'), 'needs-decision'],
    body: `To spillere rapporterer uafhængigt at akademi-træning er gået i stå efter #2202 (PR merged 4/7):

- **@zootne** (14/7, #general): "I wish training was like before.... Stijn was increasing massivley. Now he has gained 0 attributes for the whole week"
- **@thelamba** (14/7, #general): "18 year old academy 6 star rider training well before is now max 75 and increasing once per week. 22 year old 4 star rider increases every 2 training"

## Verificeret rod-årsag (kode + prod-data, 15/7)

#2202 (\`cbf7779d\`) indførte tre mekanismer for akademi-alder (16-21 år) — de virker **præcis som specificeret**, så dette er ikke en kode-regression. Problemet er kalibreringen mod en sæson uden slutdato:

- **Sæson-budget-loft** (\`computeAcademySeasonCeiling\`, \`backend/lib/dailyTraining.js:87-97\`): ved sæsonens første tick snapshottes rytterens abilities som \`season_budget_baseline\`. Resten af sæsonen er loftet \`baseline + (livstidsloft − baseline) × frac\`.
- **Aftagende akademi-rate** (\`ACADEMY.SEASON_FRAC_BY_AGE\`, \`backend/lib/academyFlag.js:36-40\`): frac = 0,16 (≤17 år) · 0,11 (18-19) · 0,08 (20-21) — **én gang pr. sæson**, ikke pr. dag.
- **Hård dags-cap** (\`ACADEMY.HARD_DAILY_CAP = 1\`): maks +1 point/dag/evne.

**Prod-måling** (570 akademi-alders ryttere på ægte hold — ikke-AI/test/frosne — via \`rider_derived_ability_history\`):

| | Før (29/6-4/7, 6 dage) | Efter (5/7-15/7, 11 dage) |
|---|---|---|
| Gnsn. samlet gevinst pr. rytter | **24,4 point** | **7,05 point** |
| Gnsn. pt/dag/rytter | ~4,1 | ~0,64 |
| Dage med nogen gevinst | ~74% | ~34% |

**Kernen i problemet:** sæson-budgettet er et **éngangs-beløb pr. sæson, afkoblet fra hvor mange dage der reelt er tilbage**. Sæson 1 har \`end_date = NULL\` og har kørt 23+ dage. Resultatet i prod lige nu:

- Gnsn. resterende hovedrum: **1,76 point pr. evne** (ud af ~2,07 totalt) — budgettet er stort set brugt op efter ~10 dage.
- **18,0%** af alle evne-rækker (1.540/8.535) har **allerede 0 hovedrum tilbage** — låst resten af sæsonen.
- **87,2%** af rytterne (496/569) har mindst én helt låst evne; gnsn. 2,71 låste evner pr. rytter.

Simuleringen bag ejer-godkendelsen (\`backend/scripts/trainingRecalibrationCandidates.js\`) testede sæsonlængder på 28/60/90/120 dage. Prod-sæsonen har ingen slutdato → resten af sæsonen bliver "død tid" for akademi-udvikling. Patch notes 4/7 lovede "steady growth over several seasons" — ikke at væksten går i stå i ugevis midt i én sæson.

**Ejer-beslutning nødvendig** (A/B):
- **A) Tids-proratér budgettet** — hovedrum frigives løbende hen over sæsonen (fx pr. race-day/uge) i stedet for at ligge som ét pulje-beløb fra dag 1. Fjerner "død tid" uden at hæve sæson-totalen.
- **B) Hæv \`SEASON_FRAC_BY_AGE\`** — mere budget, samme éngangs-struktur. Enklere, men genindfører front-loaded burst og løser ikke sæsoner uden slutdato.

Anbefaling: **A** — den rammer rod-årsagen (budget afkoblet fra sæsonlængde) og bevarer den ejer-godkendte sæson-total.

**Accept:**
- [ ] Ejer vælger A eller B.
- [ ] Simulér mod ægte population FØR ship (jf. simulér-før-ship): mål pt/uge for 16/18/20-årige over en 60- og 120-dages sæson + en sæson uden slutdato.
- [ ] Verificér i prod at låste evner (18% i dag) frigives, og at pt/dag ikke hopper tilbage til før-4/7-niveau (~4,1).
- [ ] Patch note + help-tekst matcher den faktiske adfærd.

**Kilde:** ${SRC} — @zootne + @thelamba, [#general](${CH.general}) 14/7 15:49 + 16:44.

**Relateret:** #2202 (PR der indførte cap'en), #2262 (19-20-årige talenter "dødfødte"), #1938 (ungdoms-growth for høj — det oprindelige problem), #2082, #932 (Epic: Ungdomsakademi).`,
  },
  {
    title: '[bug] Ugentlig træningsrutine overtrumfer individuelle rytter-indstillinger (let/hvil ignoreres)',
    labels: BUG('med'),
    body: `**@thelamba** (14/7) satte ugentlige rutiner til **hard**, men flere enkelte ryttere til **light training / rest**. Alle trænede hard. Video vedhæftet i tråden.

Ejeren bekræftede i tråden at de to flader er reelt afkoblede og at UI'et modsiger sig selv:
- @bobby2106: "Ill figure something out in this red area, so it is more consistent and doesnt show 2 different informations"
- @bobby2106: "The only thing i have to do, is that these things talk to each other in a better way"

Forvirringen er konkret: UI'et skriver at rytterne "train their own focus", hvilket @thelamba med rimelighed læste som den intensitet han selv havde valgt pr. rytter. Resultatet: "Now my entire racing team is dead 😆" — han endte med at fjerne den ugentlige rutine helt og gik tilbage til manuel træning. En feature, der skulle spare tid, koster i dag en trup.

**Accept:**
- [ ] Afklar den tilsigtede kontrakt: skal en individuel indstilling overtrumfe den ugentlige rutine (forventeligt), eller omvendt?
- [ ] Implementér den valgte præcedens i backend, så det ikke kun er kosmetik.
- [ ] UI viser ÉN sandhed pr. rytter: hvad kommer rytteren faktisk til at træne i dag, og hvorfra kommer den beslutning (rutine vs. individuel override).
- [ ] Gør det synligt hvilke ryttere der har en individuel override, så en rutine-ændring ikke tavst rammer/ikke-rammer dem.
- [ ] help.json (en+da) opdateres, da "own focus"-teksten er den direkte kilde til misforståelsen.

**Kilde:** ${SRC} — @thelamba, tråd [Training doesn't work](${T('1526482136469868704')}) (#bugs, 14/7 06:55-09:39, video + screenshots).

**Relateret:** #2337 (løbs-bevidst periodisering), #1922 (træningsfokus-rework), #1896 (synliggør hvad det koster ikke at træne selv).`,
  },
  {
    title: '[bug/HØJ] "Kom i gang"-onboarding bliver ved med at dukke op på dashboardet for etablerede spillere',
    labels: BUG('high'),
    body: `Ejeren (@bobby2106, 13/7 17:59): "Den der 'kom i gang' onboarding spammer mig komplet i dashboardet. DEt gider jeg ikke mere. Hvorfor helevde kommer den igen og igen hele tiden?"

Bekræftet af mindst én spiller i #dansk-snak (12/7 20:13): "Den kommer også op konstant for mig lige nu, forstår simpelthen ikke, hvorfor den komme hele tiden".

Onboarding-modulet blev bygget som ny-bruger-hjælp (#2288/#2296), men det persisterer/genopstår for spillere der for længst er i gang. Effekten er det modsatte af hensigten: dashboardets vigtigste flade optages af hjælp, brugeren ikke har brug for.

**Accept:**
- [ ] Reproducér: verificér hvad der styrer synligheden (completion-flag, localStorage, server-state?) og hvorfor den re-triggerer.
- [ ] Rod-årsag, ikke symptom-patch: hvis completion-tilstanden ikke persisteres server-side, er det dér fixet hører hjemme.
- [ ] Én gang afvist/fuldført = væk for den bruger, på tværs af enheder og sessions.
- [ ] Verificér i prod på en etableret konto (ikke kun lokalt).

**Kilde:** ${SRC} — @bobby2106, [#feedback-from-dolmer](${CH.dolmer}) 13/7 17:59 + [#dansk-snak](${CH.dansk}) 12/7 20:13.

**Relateret:** #2288 + #2296 (dashboard ny-bruger-UX-pakke — kilden til modulet), #1140 (onboarding konsolidering), #1569 (ny-spiller onboarding-audit).`,
  },
  {
    title: '[ops] Cron-monitor-alarmer fyrer i klynger ved deploy-storme (13 falske "missed check-in" på ét minut)',
    labels: [...TASK('med'), 'cat:infra'],
    body: `12/7 kl. 20:12-20:47 UTC fyrede **~13 cron-monitorer "A missed check-in was detected"** stort set samtidigt: squad-enforcement, deadline-day, academy-heal, rider-derive-heal, training-sweep, starter-squad-heal, graduation-sweep, discord-dm-outbox-drain, ai-trim-heal, ranking-matview-refresh, board-auto-accept, stall-watchdog, board-mid-season.

## Verificeret (Sentry + Railway, 15/7)

Ikke en enkeltstående hændelse — mønsteret er **gentaget**:
- **12/7:** 6 Railway-deploys på under 30 min (20:06:31, 20:07:35, 20:11:41, 20:17:58, 20:34:48, 20:36:22 UTC) — præcis i alarm-vinduet.
- **13/7:** gentog sig 19:49 UTC (Sentry CYCLINGZONE-2H, 4 hændelser), igen efter en klynge på 4 deploys på 10 min (19:36-19:46 UTC).
- **Ingen recidiv 14-15/7**, hvor deploys er spredt med 10-20+ min imellem.

**Rod-årsag:** hver Railway-redeploy genstarter processen midt i 5-minutters cron-cyklusser og rammer mange samtidige jobs. \`failure_issue_threshold=2\` (PR #2397, merged 12/7 20:32 — midt i selve stormen) dæmper støj fra ÉN redeploy, men absorberer ikke flere i træk.

**Hvorfor det er værd at fikse:** alarm-fatigue. Vi har allerede #2430 åben på præcis det problem (stall-watchdog der kalder legitimt arbejde for hængende). En alarm, der rutinemæssigt lyver under deploys, bliver en alarm ingen reagerer på — og så virker den heller ikke den dag, noget faktisk er galt.

**Accept:**
- [ ] Undertryk cron-check-in-alarmer i et kort vindue efter en deploy (deploy-bevidst grace), eller hæv threshold så en genstart aldrig alene udløser alarm.
- [ ] En reelt død cron skal stadig alarmere inden for rimelig tid — verificér begge retninger (falsk-positiv væk, sand-positiv bevaret).
- [ ] Verificér mod en bevidst deploy-klynge i staging/prod at der ikke kommer alarmer.

**Kilde:** ${SRC} — Sentry-bot i [#ops](${CH.ops}) 12/7 20:12-20:47 UTC + 13/7 19:49 UTC. Verificeret via Sentry CYCLINGZONE-2H + Railway deploy-historik.

**Relateret:** #2430 (stall-watchdog falsk-alarm — samme klasse af problem), PR #2397 (delvis mitigering), #2395, #2096 (Sentry proaktive thresholds).`,
  },
  {
    title: '[discord] Nye medlemmer ser ikke kanalerne — skal selv finde dem manuelt',
    labels: [...TASK('med'), 'epic:discord-community'],
    body: `**@zootne** (14/7): "Didnt even know it was a general chat.... Why do i need to add all the channels myself by randomly finding them somewhere? 😂"

@bobby2106: "I have no idea - if anyone knows how to improve that part of discord modding. Please let me know 😀"

Nye medlemmer lander på serveren uden at se de kanaler, der betyder noget. En aktiv tester var på serveren uden at vide at #general fandtes. Det er direkte tab af community-aktivitet: de folk vi allerede har fået ind, kan ikke finde samtalen.

Sandsynlig årsag: kanalerne ligger bag Channels & Roles / onboarding-opt-in, så de er skjult indtil medlemmet selv tilvælger dem. Serveren har 50+ kanaler, hvoraf mange er bot-feeds (#results-d4-a..h, #auctions, #ci-alerts) — signal-til-støj for en ny bruger er lav.

**Accept:**
- [ ] Verificér den faktiske default-synlighed for @everyone / nye medlemmer (Discord Server Settings → Onboarding + kanal-permissions), ikke antaget.
- [ ] Kerne-kanaler (#start-here, #general, #questions-and-answers, #bugs, #feedback-and-ideas, #patch-notes) er synlige som default — ingen opt-in krævet.
- [ ] Bot-feed-kanaler (resultater pr. division, auktioner, ci-alerts, ops) er opt-in eller skjult som default, så de ikke drukner kerne-kanalerne.
- [ ] Test med en frisk konto uden roller — ikke fra ejerens admin-view.

**Kilde:** ${SRC} — @zootne + @bobby2106, [#general](${CH.general}) 14/7 15:46.

**Relateret:** #415 (Discord community: world-class opsætning — epic), #419 (auto-mod), #2153 (ny server: division-routede resultat-kanaler).`,
  },

  // ---------- 2. Ejer-ønsker: UI/UX + IA ----------
  {
    title: '[feature] Dashboard: lad spilleren selv vælge rækkefølge og placering af modulerne',
    labels: FEAT('med'),
    body: `Ejer (13/7 17:50): "Jeg vil gerne have, at spillerne får muligheden for selv at vælge rækkefølgen og placeringen af elementerne på dashboardet"${OWNER}

Dashboardet har nu nok moduler (onboarding-trin, næste træk, rangliste, kommende løb, seneste resultater, økonomi) til at forskellige managere vil prioritere forskelligt. En rutineret manager vil have holdudtagelse og løb øverst; en ny vil have hjælp.

**Accept:**
- [ ] Manager kan omarrangere (og skjule?) dashboard-moduler.
- [ ] Layoutet persisteres server-side pr. bruger, så det følger med på tværs af enheder.
- [ ] Fungerer på mobil (drag-and-drop er sjældent godt på touch — overvej op/ned-knapper eller en dedikeret "tilpas"-tilstand).
- [ ] Sensibel default + "nulstil til standard".
- [ ] Design-smag: ingen AI-slop. Redigerings-tilstanden skal føles som spillets eget sprog, ikke et generisk widget-board.

**Afklaring til ejer:** skal moduler kunne **skjules** helt, eller kun flyttes? (Skjul + onboarding-modul der bliver væk løser delvist #<KOM_I_GANG>.)

**Relateret:** #2288/#2296 (dashboard-moduler), #2182 (moduler skal vise egen division), #2328 (dashboard-opfølgninger), #62 (Epic: Today/Manager Inbox).`,
  },
  {
    title: '[feature/IA] Menu-rework: side-inventar + kategorisering der matcher de nye undersider',
    labels: [...FEAT('med'), 'needs-decision'],
    body: `Ejer (13/7 17:50): "Jeg vil gerne have lavet om i menuen, sådan den er mere tilsvarende til vores nye undersider og at tingene er langt ind i faner nu, på en måde, som giver mere mening"

Ejer (13/7 18:12): "Jeg vil gerne have en liste over alle undersider og et forslag til hvilken kategori i menuen de skal under"${OWNER}

Menuen er vokset organisk mens undersiderne er blevet fane-baserede. Resultatet er en navigation, der ikke længere afspejler produktets struktur — med kendte symptomer: dublet "Løb"/"Holdudtagelse", manglende "Holdstrategi"-link (#2181), og høj dead-click-tæthed på flere flader (#1919, #2227, #2254).

**Leverance (i denne rækkefølge — inventaret først, så beslutningen er informeret):**
- [ ] **Inventar:** komplet liste over alle undersider/ruter i appen, med nuværende menu-placering og faktisk brug (Clarity/analytics hvor muligt).
- [ ] **Forslag:** kategorisering pr. side + begrundelse. Præsentér som A/B hvor der er et reelt valg, ikke som en åben option-liste.
- [ ] Ejer godkender strukturen FØR implementering.
- [ ] Implementér: menu + evt. flytning af sider ind i faner.
- [ ] Verificér: dead clicks på de ramte flader falder (mål før/efter).

**Relateret:** #2181 (venstre-nav oprydning: dublet Løb/Holdudtagelse, holdnavn i logo-hjørne), #1027 (nav-header/IA-restructure), #976 (fold Min Aktivitet ind i Indbakke), #2254 + #1919 + #2227 (dead clicks), #954 (Transparens-hub).`,
  },
  {
    title: '[perf] Dashboard + liga-overblik loader markant for langsomt — audit af langsomme undersider + løbende opdagelse',
    labels: [...TASK('high'), 'cat:infra'],
    body: `Ejer (13/7 17:51): "Jeg vil have, at du selv laver en analyse over undersider på hjemmesiden, som loader for langsomt og du skal forslå løsninger. **Fremadrettet skal du selv opdage, hvis der pludseligt er en underside som er blevet for langsom**"

Ejer (13/7 21:22): "Dashbboardet indlæser alt for langsomt, det skal løses. Overbliks siden under liga og resultater loader også markant for langsomt, skal løses"${OWNER}

To dele — en engangs-oprydning og en varig vagt:

**Del 1 — audit + fix (nu):**
- [ ] Mål faktisk load-tid pr. underside i prod (Speed Insights / Clarity / Sentry performance), ikke lokalt.
- [ ] Konkret bekræftede syndere fra ejeren: **dashboardet** og **liga → overblik/resultater**. Rangér resten efter målt tid × trafik.
- [ ] Rod-årsag pr. side (N+1-queries? manglende index? uparallelliserede kald? for stor payload? manglende cache?) — ikke gæt.
- [ ] Forslag med trade-off (gevinst / omkostning / alternativ) → ejer vælger → implementér.

**Del 2 — løbende opdagelse (det ejeren egentlig beder om):**
- [ ] Automatisk detektion når en underside bliver langsommere end sit eget baseline — ikke en fast tærskel, men drift-detektion.
- [ ] Rapportér som GitHub-issue/kommentar automatisk, som #2196/#2204 gør for rangliste-perf.
- [ ] Skal fange regressionen **når den lander**, ikke når ejeren opdager den uger senere.

**Relateret:** #2096 (Sentry performance-monitorering med proaktive thresholds — del 2 hører hjemme her), #2204/#2196 (matview-freshness-guard: eksisterende mønster for auto-detektion), #1375 (perf-arkitektur eksekverings-tracker), #2230 (CLS), #2233 (perf-inbox), #353 (Speed Insights), #1373/#1374 (frontend query-cache + targeted realtime).`,
  },
  {
    title: '[ux] Responsivt layout: sider udnytter ikke skærmen (sæsonplanlægger, økonomi, bestyrelse, dashboard)',
    labels: FEAT('med'),
    body: `Ejer (14/7 06:51): "Jeg vil gerne have, at flere steder i spillet / flere undersider, er bedre til at tilpasse sig til den skærm der ser den side. f.eks sæsonplanlæggeren skal kunne gå ud til kant. Økonomi. Bestyrelse. Dashboard mv. Se gerne selv efter og kom med forslag til hvordan vi gør det langt bedre og mere optimalt. **Vil gerne undgå for meget ligegyldig whitespace på pc**"${OWNER}

Navngivne sider: **sæsonplanlægger** (skal kunne gå ud til kant), **økonomi**, **bestyrelse**, **dashboard** — plus "se selv efter".

**Accept:**
- [ ] Gennemgå alle hoved-undersider på store skærme (1440p+) og dokumentér hvor der spildes plads.
- [ ] Forslag pr. side FØR implementering (ejer vil se forslaget).
- [ ] Sæsonplanlæggeren går ud til kant.
- [ ] Ingen regression på mobil — verificér begge breakpoints (jf. #1602).
- [ ] Vis ejeren resultatet visuelt undervejs (screenshots/preview), ikke "test selv til sidst".

**Relateret:** #1027 (whitespace/density + IA — den eksisterende paraply; denne konkretiserer den), #1602 (Epic: mobil-optimering), #481 (brand/design-manual).`,
  },
  {
    title: '[bug/ux] Daglig træning: kolonner afskåret i højre side samtidig med spildt whitespace',
    labels: BUG('med'),
    body: `Ejer (14/7 06:52): "Siden for daglig træning er også dårligt optimeret. Der er whitespace men ikke alle kollonerne bliver vist ude til højre. **Det er for dårligt**"${OWNER}

Konkret layout-bug, ikke kun æstetik: information, manageren skal bruge for at træne, er utilgængelig — mens der samtidig er plads til overs på siden.

**Accept:**
- [ ] Reproducér på PC-bredde: hvilke kolonner falder ud, og hvorfor (fast bredde? overflow-hidden? tabel-container?).
- [ ] Alle kolonner er synlige eller nåbare (horisontal scroll med sticky rytter-kolonne er et acceptabelt fallback, jf. #226).
- [ ] Whitespace udnyttes.
- [ ] Verificér på mobil + PC.

**Relateret:** #<RESPONSIVT> (responsivt layout — samme klasse), #226 (sticky rytter-kolonne ved horisontal scroll), #1970 (/training dead clicks).`,
  },
  {
    title: '[ux] Sæsonplanlægger: rating + nationalitet vises anderledes end resten af spillet, og farverne er ulæselige i dark mode',
    labels: FEAT('med'),
    body: `Ejer (13/7 19:19): "Under sæsonplanlægningen, så skal rytternes ratings vises på en mere ensartet måde af hvad de gør andre steder. Og i nogle farver der er bedre at læse i dark mode. **Farverne ser forkerte ud i dark mode.** Den måde landene vises er heller ikke ensartet herinde som det er andre steder på siden, nationaliteterne skal præsenteres som andre steder på siden."

Ejer (13/7 19:20, med screenshot): "Her vil jeg kunne se rating og ryttertype"${OWNER}

Tre ting i sæsonplanlæggeren:
1. **Rating** vises ikke som andre steder → gør ensartet (genbrug komponenten, lav ikke en ny).
2. **Nationalitet** vises ikke som andre steder → gør ensartet.
3. **Dark mode-farver** på attributter er ulæselige/forkerte.
4. Ejer vil **også kunne se ryttertype** i planlæggeren (jf. screenshot).

**Accept:**
- [ ] Find den kanoniske rating- + nationalitets-visning og genbrug den — dette er en konsistens-opgave, ikke en ny komponent.
- [ ] Dark mode-kontrast verificeret visuelt (screenshot til ejer), ikke kun i kode.
- [ ] Ryttertype tilføjet i planlæggerens rytter-visning.
- [ ] Backwards-check: findes samme inkonsistens andre steder? Fix dem i samme PR.

**Relateret:** #1011 (attribut-farver: darkmode-læsbarhed + toggle), #2006 (overall 1-99 rating), #2000 (Epic: rytter-side-rework), #2014 (ryttertype: utypet-tilstand).`,
  },
  {
    title: '[ux] Rework af ruteprofilerne — ikke præsenteret godt eller ensartet nok',
    labels: FEAT('med'),
    body: `Ejer (13/7 19:20): "Vi har brug for et rework af ruteprofilerne. Jeg synes ikke det er præsenteret på en god nok og ensartet måde"${OWNER}

Ruteprofilen er et af de steder, hvor spillet skal føles som ægte cykelsport — det er den flade, en manager kigger på, når han beslutter hvem der skal køre. I dag lever den ikke op til det.

**Accept:**
- [ ] Vis ejeren mockup/preview FØR implementering (jf. vis-visuelt-undervejs).
- [ ] Ensartet præsentation overalt hvor en ruteprofil optræder (løbsside, sæsonoverblik, holdudtagelse, race-hub) — inventér først hvor de findes.
- [ ] Anti-AI-slop: editorial, ægte cykel-data-æstetik. Ingen generiske gradient-blobs.
- [ ] Profilen skal kunne læses på mobil.

**Afklaring til ejer:** hvad mangler mest — **detaljerigdommen** (højdemeter, gradient, kategoriserede stigninger, teknisk profil) eller **konsistensen** (samme visning alle steder)? Svaret afgør om dette er et data- eller et design-projekt.

**Relateret:** #1010 (sæsonoverblik: vis rute-/etapeprofiler for kommende løb), #1979 (omdøb forvirrende 'udbrud'-etapeprofil), #959 (Epic: etape-resultater), #2410 (etape-tidslinje som artefakt).`,
  },

  // ---------- 3. Ejer-ønsker: spil-features ----------
  {
    title: '[feature] Sæson 2: løbsprogrammet planlagt og synligt for alle divisioner',
    labels: FEAT('high'),
    body: `Ejer (13/7 17:52): "Jeg vil have, at vi snart har planlagt løbsprogrammer for hele sæson 2 i alle divisionerne, sådan managers kan se løbene til næste sæson og planlægge efter disse"${OWNER}

Det er en forudsætning for langsigtet manager-tænkning: man kan ikke bygge et hold mod en sæson, man ikke kan se. Lige nu kan managere kun reagere.

**Accept:**
- [ ] Sæson 2-kalender genereret for **alle fire divisioner** (respektér prestige-kaskaden — jf. #2276, som skal være løst/verificeret først).
- [ ] Synlig for managers i UI før sæson 2 starter.
- [ ] Verificér mod invarianterne: ingen ulovlige overlap-brud (1 rytter = 1 løb/dag), korrekt løbs-tier pr. division, race_days konsistent på tværs af forside/division/pulje (jf. #1774).
- [ ] Skal kunne genereres reproducerbart — ikke en engangs-manuel indsats (jf. #1125).

**Afhængighed:** #2276 (prestige-kaskade brudt: Div 4 kører Div 1's monumenter) skal være løst, ellers arver sæson 2 samme fejl.

**Relateret:** #1125 (genbrug tidligere sæsons kalender som skabelon), #1734 (udvid løb-katalog så hver pulje får 8 etapeløb), #1899 (race_days_total per-division?), #2361 (sæsonritual: op/nedrykning + recap), #1146 (Design: shared race calendar).`,
  },
  {
    title: '[feature] Personale-oversigt: se alt personale, hvilke hold de er på, profil og stats',
    labels: FEAT('med'),
    body: `Ejer (13/7 17:54): "Det skal være muligt at se en oversigt over alt personale og hvilke hold de er på, man skal kunne se profil, stats osv. Man skal kunne se ansattes stats før de ansættes. Man skal kunne fyre ansatte igen"${OWNER}

Bekræftet uafhængigt af to spillere:
- **@jeppek** (12/7, #feedback-and-ideas): "It should be possible to click on the training coaches to se what stats they got... I Signed Sofie and can see her stats. Afterwards it isn't possible to fire her. That should be possible, but for a fee."
- **@ez4prebren** (12/7, #dansk-snak): "Hvis man nu har været en tumpe og valgt forkert træner - er der mulighed for at skifte? 😂" — @bobby2106: "Det tror jeg faktisk ikke, at der er her og nu, men jeg tænker, at jeg får det med."

**Delvist dækket:** #2398 dækker allerede *stats før ansættelse* + *sign-on/release-gebyr*. **Dette issue dækker resten:** en personale-oversigt på tværs af holdene — hvem er ansat hvor, med profil og stats. Det gør staff til en synlig del af verdenen (og et transfer-marked på sigt) i stedet for en dropdown.

**Accept:**
- [ ] Personale-oversigt: alt personale i spillet, med hold-tilknytning, rolle og stats.
- [ ] Klikbar personale-profil (genbrug rytterprofilens sprog, lav ikke en ny visuel dialekt).
- [ ] Filtrering/søgning (rolle, hold, kvalitet).
- [ ] Koordinér med #2398, så vi ikke bygger to konkurrerende staff-visninger.

**Kilde:** ${SRC} — @bobby2106 [#feedback-from-dolmer](${CH.dolmer}) 13/7 17:54; @jeppek tråd [Training coach](${T('1525754249881845941')}); @ez4prebren [#dansk-snak](${CH.dansk}) 12/7 20:13.

**Relateret:** #2398 (træner-stats + sign-on/release-gebyr), #930 (Epic: Staff & manager-rolle som direktør), #2217 (staff-kontrakter + genforhandling), #2218 (pension→staff), #1149 (Epic: club development).`,
  },
  {
    title: '[feature/ux] Bulk-redigering af transferlistepriser — justér mange ryttere hurtigt',
    labels: FEAT('med'),
    body: `Ejer (13/7 17:55): "Vi skal lave en funktion til hurtigt og effektivt at kunne redigere transferlisteprisen på mange ryttere hurtigt efter hinanden eller på samme tid. **Fantastisk ux oplevelse skal opfindes** til håndteringen af, at man kan sætte ryttere til salg. Skal fungere meget godt og effektivt, at man hurtigt kan justere priserne på sine ryttere til salg"${OWNER}

En manager der rydder op i truppen sætter 5-10 ryttere til salg ad gangen. I dag er det én rytter ad gangen gennem en dialog. Det er den slags friktion, der gør at folk lader være.

Ejeren beder eksplicit om at UX'en **opfindes**, ikke bare bygges — dette er en design-opgave først. Se på hvordan andre spil løser masse-prissætning (Football Manager's transfer-liste, Vman).

**Accept:**
- [ ] Design-forslag FØR kode (mockup til ejer — jf. vis-visuelt-undervejs).
- [ ] Sæt/justér pris på flere ryttere i én flade uden dialog pr. rytter.
- [ ] Vis relevant kontekst inline: rytterens værdi, nuværende pris, evt. aktive bud/auktioner.
- [ ] Overvej relative justeringer ("+10% på alle markerede") — det er dét, der gør bulk reelt hurtigere end sekventielt.
- [ ] Fungerer på mobil.

**Relateret:** #450 (minimumspris på egne ryttere), #1977 (kommentar/note på rytter til salg), #2176 (transferliste → auto-auktion), #2183 (vis aktive auktioner på egen holdside), #26 (transfer war-room).`,
  },
  {
    title: '[feature/design] Auktions-gebyr: gratis ved udbudspris ≤50% af værdi, gebyr over',
    labels: [...FEAT('med'), 'needs-decision'],
    body: `Ejer (13/7 21:18): "Jeg vil gerne have, at det er gratis at starte auktioner på ryttere, hvis man starter en auktion på 50% af deres værdi eller mindre. Men hvis man sætter en rytter til salg for over 50% af deres værdi, så skal der være en udgift ved dette. **Kom gerne med forslag og tænk gerne over hvordan andre spil gør det**"${OWNER}

**Formålet** (som jeg læser det — bekræft gerne): gøre det gratis at sælge realistisk og dyrt at spærre markedet med urealistiske udbudspriser. I dag er der ingen omkostning ved at liste alt til fantasipriser, hvilket støjer markedet til — jf. #2400 (transferhistorik fyldt med "ingen salg"-auktioner) og #2208 (auktions-støj).

**Design-arbejde der skal ske FØR kode:**
- [ ] Undersøg hvordan sammenlignelige spil gør (Football Manager, Vman, Hattrick, PCM-ligaer) — hvad er standarden for listing-fees?
- [ ] Foreslå gebyr-kurven: fast beløb? Procent af udbudsprisen? Progressiv over 50%? Præsentér A/B med trade-off, ikke en option-liste.
- [ ] Økonomisk sanity: gebyret skal være en reel gold sink (jf. #1441 anti-inflation), men ikke så hårdt at nye/fattige hold ikke kan sælge sig ud af problemer.
- [ ] Interaktion med værdimodel v4 (#2428): "50% af værdi" afhænger af **hvilken** værdi. Skal låses til den samme værdi, spilleren ser.

**Accept:**
- [ ] Ejer godkender gebyr-model.
- [ ] Simulér mod ægte population før ship (balance-følsomt system): hvor mange nuværende listings ville koste gebyr, og hvad ville det trække ud af økonomien?
- [ ] Gebyret er synligt og forklaret i UI'et FØR man bekræfter auktionen.
- [ ] Patch note + help.

**Relateret:** #2428 (værdimodel v4 — definerer "værdi"), #1441 (Epic: anti-inflation + gold sinks), #2400 ("ingen salg"-auktioner), #450 (minimumspris), #2176 (transferliste → auto-auktion), #1189 (auktions-timing-policy).`,
  },
  {
    title: '[feature] Global rank: rangliste på tværs af alle managers over en rullende periode',
    labels: FEAT('med'),
    body: `Ejer (13/7 21:20): "Jeg vil have, at vi opfinder et 'global rank' system for en rangliste som alle managers i spillet er på, som går over en periode på x antal måneder/sæsoner, **som vi aftaler**"${OWNER}

I dag måles en manager kun inden for sin egen division/pulje. En global rank giver et mål, der overlever op- og nedrykning — og en grund til at blive ved efter sæsonen er afgjort.

**Ejer-beslutninger der skal træffes først:**
- **Periode:** rullende X måneder, eller vægtede sæsoner (nuværende sæson tæller mest, ældre falder af)? Rullende vindue belønner aktivitet; sæson-vægtning belønner præstation.
- **Point-kilde:** UCI-lignende point fra resultater? Divisions-vægtet (en Div 4-sejr ≠ en Div 1-sejr)? Kombination?
- **Nye managers:** hvordan undgår vi at ranglisten bare måler anciennitet? (Fx point pr. sæson, eller separat "rookie"-visning.)

Min anbefaling: **divisions-vægtede point over de seneste 2 sæsoner, med nuværende sæson vægtet højest.** Det gør op/nedrykning meningsfuld i ranglisten og lader nye managere komme med hurtigt.

**Accept:**
- [ ] Ejer beslutter periode + point-kilde (A/B ovenfor).
- [ ] Rangliste-side: alle managers, egen placering fremhævet, filtrér til division.
- [ ] Performance: rangliste-beregning har allerede bidt os (#2196/#2204/#2206) — brug matview + freshness-guard fra start, ikke live-beregning.
- [ ] Vis manageren sin egen placering + bevægelse (op/ned siden sidst) — det er dét, der skaber tilbagevenden.

**Relateret:** #94 (manager cross-season statistik), #1112 (manager-omdømme/renown), #2206 (rangliste-pagination), #2196/#2204 (rangliste-perf + matview), #1106 (multi-sæson visning), #1099 (Epic: renown-system), #954 (transparens-hub).`,
  },
  {
    title: '[design] Potentiale: skift skala fra 1-6 til 1-99 så den matcher resten af spillet',
    labels: [...FEAT('med'), 'needs-decision'],
    body: `Ejer (13/7 20:50): "Jeg vil gerne have, at potentiale laves om fra 1-6 til at det bliver 1-99, som de andre tal i spillet."${OWNER}

Spillet bruger 1-99 til evner. Potentiale bruger 1-6 (stjerner). To skalaer for samme mentale model ("hvor god kan han blive?") tvinger manageren til at oversætte i hovedet.

**Vigtig spænding der skal afklares FØR build:** #1138 (progression L1: scouting & skjult potentiale) er bygget på **usikkerhed** — stjerne-*ranges* frem for et eksakt tal, netop fordi potentiale ikke skal være aflæseligt. Og backend har i dag en hård regel: "Rå potentiale/ability_caps forlader ALDRIG serveren" (\`backend/routes/api.js:1404,1478\`) — Udviklings-fanen viser bevidst en **fuzzy ceiling-range**, aldrig et tal.

Så: en 1-99-skala må ikke blive en bagdør til at aflæse det eksakte loft. To måder at få begge dele:
- **A) 1-99-range i stedet for stjerne-range** — vis fx "72-81" med spejder-usikkerhed der snævrer ind. Samme skala som evner, usikkerheden bevaret.
- **B) Eksakt 1-99-potentiale** — enkelt og læsbart, men aflyser #1138's scouting-værdi og bryder den nuværende server-regel.

Anbefaling: **A** — den giver ejeren det, han beder om (samme skala som resten af spillet), uden at smide den skjulte-potentiale-mekanik væk, vi lige har bygget.

**Accept:**
- [ ] Ejer vælger A eller B (dette afgør om #1138 overlever).
- [ ] Migrationsvej for eksisterende potentiale-data (1-6 → 1-99) — bundlet, ejer merger.
- [ ] Backwards-check: alle steder potentiale/stjerner vises (rytterside, akademi, scouting, transferliste, hover-kort) opdateres i samme PR.
- [ ] Serverside-reglen om rå caps overholdes fortsat.
- [ ] Patch note + help (skala-skift er en brugerrettet ændring).

**Relateret:** #1138 (progression L1: scouting & skjult potentiale — direkte spænding), #2006 (overall 1-99 rating), #2000 (Epic: rytter-side-rework), #1137 (progression L0: potentiale-loft), #932 (akademi).`,
  },
  {
    title: '[feature] Sæsonplanlægger: assistenten udfylder formprogrammerne som forslag fra start',
    labels: FEAT('med'),
    body: `Ejer (13/7 19:50): "Under sæsonplanlægningen vil jeg gerne have, at alle managers har fået et forslag af assistenten til planlægningen af formprogrammerne. De skal altså være **udfyldt fra start af**, sådan at managers selv kan vælge at starte forfra, eller kunne lave enkelte ændringer."${OWNER}

En tom planlægger er en barriere: den nye manager ved ikke hvad han skal, og den erfarne gider ikke starte fra bunden. Et kvalificeret udgangspunkt gør featuren brugbar for begge.

**Accept:**
- [ ] Assistenten genererer et fornuftigt form-program pr. rytter ved sæsonstart (baseret på rytterens løbsprogram + type + alder).
- [ ] Manageren kan acceptere, justere enkelt-peaks, eller nulstille til blank.
- [ ] Det skal være tydeligt at det ER et forslag, ikke noget manageren selv har valgt — ellers opdager han aldrig featuren.
- [ ] Gælder også ryttere/managers der kommer til midt i sæsonen.

**Afhængighed:** #2354/#2426 (Race v3 S5: form-peaks planner-cockpit) er merged, men \`peak_planner_enabled\` er **ikke flippet endnu** — dette bygger ovenpå og bør først bygges når planneren er verificeret live.

**Relateret:** #2354 (Race v3 S5: form-peaks), #2426 (planner-cockpit, merged — afventer flip), #1896 (synliggør hvad det koster ikke at træne selv — samme assistent-tanke), #2337 (løbs-bevidst periodisering).`,
  },
  {
    title: '[design] Fjern frie ungdomsryttere fra akademiet — talenter skal komme til ens eget akademi, ikke købes',
    labels: [...FEAT('med'), 'needs-decision'],
    body: `Ejer (13/7 21:24): "De frie ungdomsryttere under akademiet skal ikke være der længere. **Det er selve funktionen der skal fjernes**, der skal ikke købes ryttere på frie transfer inde i akademiet, det føles ikke rigtigt. **Stil spørgsmål hvis du er i tvivl.** Der skal stadig komme løbende talenter ind til en selv på eget akademi"${OWNER}

Begrundelsen er en design-følelse, og den er rigtig: et akademi, du kan shoppe i, er ikke et akademi — det er et transfer-marked med en anden etiket. Talentudvikling skal være noget, du bygger, ikke noget, du køber.

**Ejeren beder eksplicit om spørgsmål ved tvivl. Mine (samlet, ikke drypvis):**
1. **Hvad sker der med de frie ungdomsryttere, der ligger i systemet lige nu?** Slettes de, eller får de lov at blive indtil de er væk? (Sletning af eksisterende ryttere = destruktivt prod-indgreb → kræver at du har set tilstanden live først.)
2. **Rammer det ryttere, en manager allerede har signeret** fra den frie akademi-liste? (Antagelse: nej — de er hans nu.)
3. **Erstatter intake-raten det tabte?** Hvis den frie liste i dag er en reel kilde til akademi-talent, skal den løbende intake sandsynligvis op, ellers bliver akademiet tomt. Skal jeg måle den nuværende fordeling (intake vs. frit signeret) først?

**Accept:**
- [ ] Ejer svarer på de tre spørgsmål ovenfor.
- [ ] Fjern fri-agent/køb-flowet i akademiet (funktionen, ikke bare knappen).
- [ ] Løbende talent-intake til eget akademi bevares/kalibreres, så akademiet stadig lever.
- [ ] Ryd op i efterladt kode + data (jf. #2257: ex-akademiryttere hænger allerede i en mærkelig fri-agent/auktions-tilstand — den bug forsvinder muligvis med funktionen).
- [ ] Patch note + help (brugerrettet fjernelse).

**Relateret:** #2257 (ex-akademiryttere i mærkelig fri-agent/auktions-tilstand), #2064 (design ongoing new-rider influx mechanic), #932 (Epic: ungdomsakademi), #2179 (hurtige handlinger på akademi-ryttere), #1799 (akademi-signering lægger rytter på senior-holdet).`,
  },
  {
    title: '[balance] AI-holdenes rytter-kvalitet skal matche deres division (div 1-4)',
    labels: [...FEAT('med'), 'needs-ai-triage'],
    body: `Ejer (13/7 21:26): "Jeg vil gerne have gennemgået kvaliteten af de ryttere der er på ai holdene i 1. division, 2. division. 3. division og 4. division. **Jeg ønsker at holdene har realistiske kvaliteter for deres divisioner**"${OWNER}

AI-holdene udgør størstedelen af feltet i alle divisioner. Hvis deres kvalitet ikke er kalibreret pr. division, er hele progressions-oplevelsen forkert: at rykke op skal føles som at møde bedre modstand.

Spiller-evidens der peger samme vej — **@sheep_boy123** (12/7, #general) om Div 4: "Turns out this is a bit OP in Div 4 🤣 ... won a flat stage by just riding away 💀 ... remco in CT type stuff". @friisisch: "He would do well in Div 3 as well 😄".

**Accept:**
- [ ] **Mål først:** rytter-kvalitets-fordeling (overall/evner) pr. division på AI-hold vs. ægte hold — konkrete tal, ikke fornemmelse. Brug samme UI-filter som spillet (ikke-AI/test/frosne skal skelnes korrekt).
- [ ] Definér mål-bånd pr. division (hvad ER en realistisk Div 4-rytter vs. Div 1?).
- [ ] Rekalibrér AI-truppernes sammensætning mod båndene.
- [ ] Simulér mod ægte population før ship (balance-følsomt): rykker resultat-fordelingen i den ønskede retning uden at gøre Div 4 uvindbar for nye managere?
- [ ] Interagerer med #2407 (AI-trim kollapser Div 4 B/C) og #2377 (24-holds-invariant) — kvalitet er ligegyldig hvis antallet af hold skrider. Koordinér.

**Kilde:** ${SRC} — @bobby2106 [#feedback-from-dolmer](${CH.dolmer}) 13/7 21:26; @sheep_boy123 + @friisisch [#general](${CH.general}) 12/7 20:40-21:19.

**Relateret:** #677 (fiktive ryttere V2: stats via ny ability-model), #1775 (AI-fyld-holdnavne), #2407 (AI-trim kollapser Div 4), #2377 (24-holds-invariant), #2224 (race-balance: samme hold dominerer), #2260 (udbrud holder hjem i lave divisioner).`,
  },
  {
    title: '[balance] Talentspejder: gennemgå hvor lang tid missionerne tager',
    labels: FEAT('med'),
    body: `Ejer (13/7 21:23): "Talentspejder opgaverne skal vi gennemgå hvor lang tid de opgaver tager"${OWNER}

Talentspejderen gik live i flip-bølgen (#2357/#2244). Mission-varigheden er den knap, der afgør om featuren føles som en levende del af klubben eller som en timer, man glemmer.

**Accept:**
- [ ] Mål de nuværende varigheder pr. mission-type (kode + faktiske missioner i prod).
- [ ] Vurdér mod spillets rytme: en manager logger typisk ind 1-2 gange dagligt. En mission, der tager 6 timer, ses; en der tager 5 dage, glemmes.
- [ ] Forslag med trade-off (kortere = mere engagement, men flere talenter = inflation i talent-poolen → koordinér med #2064/#932).
- [ ] Ejer godkender før ændring.

**Relateret:** #2244 (talentspejder fase 3 — spejder-systemet), #2357 (flip-bølge: talentspejder live), #1138 (progression L1: scouting), #1543 (talentspejder-funktion), #2064 (ongoing new-rider influx).`,
  },
  {
    title: '[investigation] Verificér at rytterværdier faktisk opdaterer sig i prod',
    labels: ['claude:todo', 'type:investigation', 'priority:high', 'cat:user-feature', 'needs-ai-triage'],
    body: `Ejer (13/7 17:56): "Det er vigtigt at vi meget snart laver forbedringer til værdi motoren, **jeg synes ikke det ligner, at værdierne opdatere sig som tiltænkt lige nu**"${OWNER}

Dette er en observation om at noget muligvis **ikke virker**, ikke kun et ønske om forbedring — og det er værd at skille ad, før vi bygger v4 ovenpå:

- **#1364** ("Værdimodel: rytterværdi skal stige når evner udvikles") er markeret \`claude:done\`. Hvis ejeren ikke kan se værdier bevæge sig, er der enten (a) en regression, (b) en for langsom/sjælden opdaterings-cadence, eller (c) værdierne opdaterer korrekt, men bevægelsen er usynlig i UI'et.
- **#2428** (værdimodel v4) er shadow-live og ændrer ikke økonomi endnu — så den forklarer ikke observationen.

**Verificér FØR vi bygger (ingen antagelser):**
- [ ] Hvornår og hvordan genberegnes \`base_value\` i dag? Cron, trigger, on-read? Hvor ofte?
- [ ] Mål i prod: har rytteres værdi faktisk bevæget sig de seneste 14 dage for ryttere, hvis evner ER steget? Konkrete tal, ægte hold.
- [ ] Er der en sti hvor værdien er frosset (fx cached kolonne der ikke opdateres, eller en GENERATED-kolonne der ikke re-evalueres)?
- [ ] Hvis værdierne ER korrekte: er problemet at manageren ikke kan SE ændringen (ingen historik/trend på rytterprofilen)? Så er fixet #99/#1281, ikke motoren.

**Bemærk:** #2262 rapporterer at akademi-træning er gået i stå (verificeret — se #<AKADEMI_TRAENING>). Hvis evner ikke stiger, stiger værdier heller ikke. **Tjek den kausalitet først** — det kan være samme rod-årsag.

**Relateret:** #1364 (værdi stiger når evner udvikles — claude:done, mulig regression), #2428 (værdimodel v4 fase 2), #1281 (base_value glider mod handelspris), #99 (tooltip/inline forklaring af rytter-værdi), #1101 (værdimodel).`,
  },

  // ---------- 4. Ejer-ønsker: ops + arbejdsform ----------
  {
    title: '[ops] Fjern setup-forhindringer én gang for alle + løbende proaktiv ops-audit',
    labels: [...TASK('high'), 'cat:ai-ops'],
    body: `Ejer (13/7 17:57): "Jeg er voldsomt træt af, at du ind i mellem siger du mangler opsætning i sentry, railway eller supabase osv. **Jeg vil ikke have, at der er forhindrer i vores setup mere.** Det er simpelthen for vigtigt at tingene glider godt. **Kom proaktivt og fortæl mig, hvis noget skal forbedres i vores opsætning**, for at dette kan køre verdensklasse på langt sigt. Ting der giver og god langsigtet værdi skal prioriteres, sådan at alt arbejde er bedre, bedre kvalitet, hurtige, mere effektivt osv. Det skal prioriteres, hvis det forbedres alt arbejde vi laver."${OWNER}

Klagen er berettiget og målbar. Kendte, åbne setup-blokeringer der koster tid i hver session:
- **#2409** — Railway-MCP kræver interaktiv login → agenter kan ikke tilgå Railway headless.
- **#2228** — Sentry-connector ikke autoriseret → automatisk triage kan ikke hente Sentry-data.
- **Infisical** — \`infisical run\` fejler med "Unable to parse domain url / Failed to automatically trigger login flow" på denne PC (ramt igen 15/7 under Discord-sweep; workaround var user-env-token).
- **#2423** — Vercel-opsætning (CSP, skew-protection, Speed Insights, cache, preview-beskyttelse).
- **#691 / #929 / #2258** — key-rotation, leaked-password-beskyttelse, OTP-expiry.

**To leverancer:**

**1) Luk hullerne (én gang):**
- [ ] Gennemgå ALLE eksterne integrationer (Sentry, Railway, Supabase, Vercel, Infisical, Discord, GitHub) og verificér at hver enkelt kan tilgås **non-interaktivt fra en frisk session på begge PC'er**.
- [ ] Ét samlet verify-script med grøn/gul/rød verdikt (jf. #724) der siger præcis hvad der mangler, i stedet for at det opdages midt i en opgave.
- [ ] Hver blokering: enten fix, eller ét konkret klik til ejeren — ikke et vagt "jeg mangler adgang".

**2) Proaktiv audit (løbende — det ejeren beder om):**
- [ ] Fast rytme (fx månedligt) hvor jeg selv gennemgår opsætningen og **kommer med forslag uopfordret**, med begrundelse i langsigtet værdi.
- [ ] Kriteriet ejeren giver: prioritér det, der gør **alt** fremtidigt arbejde bedre/hurtigere/mere effektivt — ikke kun det, der løser dagens opgave.

**Relateret:** #2409 (headless Railway-MCP), #2228 (genautorisér Sentry), #2423 (Vercel verdensklasse-opsætning), #724 (ét verify-setup.ps1 med samlet verdikt), #722 (Discord-MCP non-interaktivt), #1450 (Vercel secret sync via Infisical), #725 (kanonisk secret-sti), #323 (Epic: verdensklasse AI/Ops), #605 (token-friendly agent setup).`,
  },
  {
    title: '[task] Ubesvarede Discord-spørgsmål: find dem + udkast til svar i ejerens tone of voice',
    labels: [...TASK('med'), 'cat:community'],
    body: `Ejer (13/7 18:21): "Jeg vil gerne have, at du hjælper mig med at finde svar i discorden fra vores brugere som ikke har fået et svar endnu og hjælper mig med at give et forslag til et svar jeg kan give dem i **min tone of voice**"${OWNER}

Spørgsmål der ligger ubesvarede er dyrere end de ser ud: testeren, der ikke får svar, holder op med at rapportere. Dette skal være en **tilbagevendende rutine**, ikke en engangsopgave — den hører naturligt sammen med Discord-sweepen, der allerede kører.

**Åbne, ubesvarede lige nu (fundet i ${SRC}):**
- **@thelamba** ([#questions-and-answers](${CH.qa}), 12/7 19:10): "Is it intentional, that I can set multiple riders in same role (breakaway hunter) in the new patch?" — ubesvaret på Discord. Sporet som #2405, men spilleren ved det ikke.
- **@friisisch** (tråd [Riders not recovering during the night](${T('1525756511836700734')}), 12/7): dokumenterede med to screenshots at fatigue ikke faldt natten over, og pegede præcist på FAQ-teksten. Fik ingen konklusion — kun en afklaring af hvad "rest" betyder. Sporet som #2402.

**Vigtigt (ejer-regel):** jeg poster **ikke** på ejerens vegne. Jeg leverer den præcise tekst, ejeren godkender/retter, og ejeren poster — eller giver eksplicit go til at poste den ordret.

**Accept:**
- [ ] Tilføj "find ubesvarede spørgsmål" som fast trin i Discord-sweep-rutinen (\`scripts/discord/\`).
- [ ] Pr. sweep: liste over ubesvarede spørgsmål + udkast til svar i ejerens ToV, klar til copy-paste.
- [ ] Svar skal referere til, hvad der faktisk sker med sagen (issue-nummer/status), ikke bare anerkende spørgsmålet.
- [ ] **Blokering:** ToV er ikke defineret formelt endnu (#1283). Indtil da skriver jeg udkast ud fra ejerens faktiske Discord-stemme (kort, uformel, ærlig om hvad der ikke virker, ingen corporate-glasur) — og ejeren retter.

**Relateret:** #1283 (ToV-session: definér founder-stemmen — forudsætning), #2405 + #2402 (de to konkrete ubesvarede), #961 (kontekstuel hjælp), #415 (Discord community).`,
  },
  {
    title: '[admin] Ryd op i forældede admin-funktioner + forslag til nye langsigtede',
    labels: ['claude:todo', 'type:refactor', 'priority:med', 'cat:infra'],
    body: `Ejer (13/7 21:10): "Hjælp mig med at rydde op i admin funktioner der ikke er tiltænkt at blive brugt igen, fordi de er rester fra tidligere der ikke er ryddet op i. **Forslå nye langsigtede admin funktioner der er vigtige, at jeg får**"${OWNER}

Admin-panelet har samlet engangs-værktøjer fra relaunches, resets og migrationer. Farligt, ikke bare rodet: et forældet destruktivt værktøj, der stadig kan trykkes på, er en fælde — især nu hvor der er ægte spillere i systemet.

**To dele:**

**1) Oprydning:**
- [ ] Inventér alle admin-funktioner + verificér mod runtime hvilke der reelt bruges (ikke antag ud fra navnet).
- [ ] Klassificér: aktiv / engangs-rest / farlig-og-forældet.
- [ ] Fjern resterne. Destruktive værktøjer, der stadig skal findes, skal kræve eksplicit bekræftelse.

**2) Forslag til nye:**
- [ ] Foreslå de admin-funktioner, ejeren mangler til langsigtet drift. Kandidater fra de sidste ugers hændelser: hold-tilstand/pending_removal-overblik (jf. #2407), cron/stall-status ét sted (jf. #2430), sæson-tilstand og manuelle overrides (#543), NPS-overblik (#2089).
- [ ] Præsentér som prioriteret liste med begrundelse — ejer vælger.

**Relateret:** #50 (mere inddeling i admin-UI — flere menupunkter), #543 (season_transition_paused admin-håndsving), #2089 (NPS-overblik i admin), #520 (split AdminPage/RacesPage), #2407 + #2430 (hændelser der afslørede manglende admin-indsigt).`,
  },
];

const COMMENTS = [
  {
    n: 2260,
    body: `**Ny spiller-evidens fra ${SRC}** (understøtter denne rapport):

**@sheep_boy123** ([#general](${CH.general}), 12/7 20:40, screenshot): "Turns out this is a bit OP in Div 4 🤣" — fulgt op 21:19: "won a flat stage by just riding away 💀 ... remco in CT type stuff".

**@friisisch** (21:13): "He would do well in Div 3 as well 😄"

Bemærk at dette er en **flad etape**, ikke en nedkørsels-bjergetape som i den oprindelige rapport. Det udvider symptomet: en enkelt stærk rytter kan køre fra feltet og holde hjem på terræn, hvor et samlet felt realistisk burde køre ham ind. Peger på at feltets jagt-respons er for svag i lave divisioner uanset profil — jf. #2416 (jagt-interesse-model), der netop skal erstatte terning-baseret udbruds-skæbne med feltets motivation.

Relateret til #<AI_KVALITET> (AI-holdenes rytter-kvalitet pr. division), som er filed fra samme sweep — hvis Div 4's AI-felt er for svagt, forstærkes dette symptom.`,
  },
  {
    n: 1378,
    body: `**Ejer-prioritering fra ${SRC}:**

@bobby2106 ([#feedback-from-dolmer](${CH.dolmer}), 13/7 21:17): "Vi skal gennemgå ryttertyperne grundigt inde i spillet. **Jeg føler fordelingen er skæv/dårlig.**"

Ejeren efterspørger eksplicit den gennemgang, dette issue dækker — med et konkret symptom: **fordelingen** af ryttertyper opleves som skæv. Det er mere specifikt end den oprindelige "kalibrér vs. det gamle PCM-system": det peger på hvor mange ryttere der havner i hver type, ikke kun hvor godt typerne er defineret.

Foreslået første skridt (mål før vi tuner): fordelings-måling af ryttertyper på tværs af hele populationen + pr. division, ægte hold vs. AI-hold. Så vi ved om skævheden er i generatoren (#677), i type-klassifikationen, eller i hvad spilleren kan se (#2014: 'utypet'-tilstand).

Relateret fra samme sweep: #<AI_KVALITET> (AI-holdenes rytter-kvalitet pr. division) — samme population, overlappende måling. Overvej at måle begge dele i én omgang.`,
  },
  {
    n: 1905,
    body: `**Ejer har nu specificeret featuren** (${SRC}, [#feedback-from-dolmer](${CH.dolmer}) 13/7 21:28):

> "Jeg vil have gjort sådan, at man selv kan vælge tidspunktet en auktion slutter, når man starter en auktion for at sælge en af ens egne ryttere. **Fra mellem 1 time til 48 timer.** Så skal man bare kunne vælge/trykke på et sluttidspunkt, når man starter en auktion. **De kan stadig ikke slutte mellem 24-8 om natten**"

Konkret kontrakt:
- Varighed vælges af sælger: **1-48 timer**.
- Nat-reglen består: auktioner må **ikke slutte mellem 00:00 og 08:00**.
- Valget sker ved oprettelse af auktionen.

Dermed er dette ikke længere et løst ønske — det er specificeret og klar til build. Foreslår at hæve fra \`priority:low\`.

**Åbent spørgsmål til ejer:** hvis en valgt varighed lander sluttidspunktet i nat-vinduet (fx start 22:00 + 4 timer = 02:00) — skal UI'et forhindre valget, eller skubbe slut til 08:00? Anbefaling: forhindre valget i UI, så sælgeren ved præcis hvornår det slutter.

Interagerer med #2176 (transferliste → auto-auktion, 30 min ved auto-accept) — de to auktions-varigheder skal hænge sammen. Se også #<AUKTIONS_GEBYR> (gebyr ved udbudspris >50% af værdi) fra samme sweep.`,
  },
  {
    n: 2176,
    body: `**Ejer-beslutning fra ${SRC}** — dette burde løse \`needs-decision\` (${CH.dolmer}, 13/7 21:30):

> "Jeg vil gerne have, at når man sætter en rytter på transferlisten, så kan man udfylde to ting. En **'udbudspris'** på transferlisten, som henviser til hvad andre kan byde for denne rytter/hvad rytteren er til salg for. Og så kan man sætte **en pris der bliver auto accepteret. Når dette bud bliver accepteret, så starter der en auktion på rytteren, som varer 30 minutter.**"

Ændring i forhold til issue-titlen: auktionen varer **30 minutter**, ikke 1 time.

Modellen som ejeren beskriver den:
1. Sælger sætter en **udbudspris** (hvad rytteren er til salg for / hvad andre kan byde).
2. Sælger sætter en **auto-accept-pris**.
3. Byder nogen auto-accept-prisen → der starter automatisk en **30-minutters auktion** på rytteren.

Det bevarer issuets oprindelige pointe (afskaf tavse hold-til-hold-handler — alt går gennem markedet), men giver sælgeren to håndtag i stedet for ét.

**Spørgsmål til ejer før build:** hvad er forholdet mellem de to priser? Er udbudsprisen et **minimum** for bud (auktionens startpris), og auto-accept-prisen et højere "køb nu"-niveau? Så giver de to tal mening sammen. Bekræft gerne.

Relateret fra samme sweep: #<AUKTIONS_GEBYR> (gratis auktion ≤50% af værdi, gebyr over) og #1905 (sælger vælger auktions-varighed 1-48t) — alle tre rører samme flade og bør designes sammen, ikke som tre løsrevne PR'er.`,
  },
  {
    n: 1027,
    body: `**Ejer har konkretiseret whitespace-delen** (${SRC}, [#feedback-from-dolmer](${CH.dolmer}) 14/7 06:51):

> "Jeg vil gerne have, at flere steder i spillet / flere undersider, er bedre til at tilpasse sig til den skærm der ser den side. f.eks **sæsonplanlæggeren skal kunne gå ud til kant. Økonomi. Bestyrelse. Dashboard** mv. Se gerne selv efter og kom med forslag til hvordan vi gør det langt bedre og mere optimalt. **Vil gerne undgå for meget ligegyldig whitespace på pc**"

Plus en konkret bug (14/7 06:52): "Siden for daglig træning er også dårligt optimeret. Der er whitespace men ikke alle kollonerne bliver vist ude til højre."

Da dette issue er bredt (whitespace/density **+** nav-header/IA-restructure, #481 Phase 4), har jeg splittet ejerens input i to selvstændige, handlingsbare issues fra denne sweep:
- #<RESPONSIVT> — responsivt layout på de navngivne sider (sæsonplanlægger/økonomi/bestyrelse/dashboard).
- #<TRAENING_KOLONNER> — daglig træning: afskårne kolonner (konkret bug).
- #<MENU_IA> — menu-rework + side-inventar (IA-delen, som ejeren også bad om separat 13/7 18:12).

Foreslår at dette issue enten lukkes som paraply, eller reduceres til det, der ikke er dækket af de tre ovenfor. Sig til hvis du hellere vil holde det samlet her.`,
  },
  {
    n: 932,
    body: `**Ejer-prioritering fra ${SRC}** ([#feedback-from-dolmer](${CH.dolmer}), 13/7 17:53):

> "Det er vigtigt, at nogle af de kommende features kommer til akademiet også, da **brugerne meget gerne vil have forbedringer til akademierne nu og nye features til ungdomsudvikling**"

Ejeren melder at akademi-forbedringer er efterspurgt af brugerne **nu** — ikke som post-launch-arbejde.

Kontekst fra samme sweep der rører dette epic:
- #<AKADEMI_TRAENING> — **verificeret bug (høj):** akademi-træningens sæson-budget er reelt brugt op efter ~10 dage; 18% af evne-rækkerne er allerede låst resten af sæsonen, 87% af akademi-rytterne har mindst én låst evne. To spillere klager. Det bør sandsynligvis løses FØR nye akademi-features, ellers bygger vi ovenpå et akademi, hvor ryttere ikke udvikler sig.
- #<AKADEMI_FRIE> — ejer vil have **fjernet** de frie ungdomsryttere i akademiet (talenter skal komme til eget akademi, ikke købes).
- #<POTENTIALE_1_99> — potentiale-skalaen 1-6 → 1-99.

Rækkefølge-forslag: fix træningen først (den er brudt), fjern så fri-agent-flowet (den er forkert), byg derefter nyt ovenpå.`,
  },
  {
    n: 1341,
    body: `**Ejer-ønske fra ${SRC}** ([#feedback-from-dolmer](${CH.dolmer}), 14/7 15:43):

> "Jeg vil gerne have, at du har en **fast vane** om at anbefale mig hvilken model en opgave skal laves med. Fable, opus, sonnet, haiku osv."

Det hører direkte hjemme i dette issues kanal/model/redskabs-matrix (\`docs/AI_CHANNEL_ROUTING.md\`): matricen skal ikke kun sige **hvilken kanal** (Claude Code / chat / Cowork / mobil), men også **hvilken model** — og anbefalingen skal gives proaktivt ved hver opgave, ikke kun når der spørges.

Kendt ejer-præference at bygge på: Fable som arkitekt, udførende subagenter på sonnet (ejer 10/7, jf. \`docs/NOW.md\`). Det er allerede halvdelen af en matrix — den mangler bare at blive skrevet ned og anvendt konsekvent.

Foreslået tilføjelse til matricen: opgavetype → kanal → model → begrundelse. Fx: arkitektur/design → chat/Code → Fable; mekanisk implementering i worktree → subagent → sonnet; triviel oprydning → haiku; dyb debugging/review → opus.

Noteret som fast vane i min memory, så anbefalingen kommer af sig selv fremover.`,
  },
  {
    n: 2398,
    body: `**Ny evidens fra ${SRC}** — @jeppek fulgte selv op i tråden (12/7 06:56 + 07:11):

> "Maybe the should be a cost to hire the coach too. Then you can't hire a staff and fire them again afterwards, if they don't have what you want"

> "I Signed Sofie and can see her stats. **Afterwards it isn't possible to fire her.** That should be possible, but for a fee. So overall: It should be possible to se the stats on the coaches, there should be a **sign on fee**, and ther should be a **release fee**."

Bekræfter alle tre dele af dette issue og tilføjer en vigtig detalje: **man kan i dag slet ikke fyre en ansat** — ikke bare "det koster ikke noget". Det er en blind vej: vælger man forkert træner, sidder man fast.

Uafhængig bekræftelse fra en anden spiller — **@ez4prebren** ([#dansk-snak](${CH.dansk}), 12/7 20:13): "Hvis man nu har været en tumpe og valgt forkert træner - er der mulighed for at skifte? 😂" → @bobby2106: "Det tror jeg faktisk ikke, at der er her og nu, men jeg tænker, at jeg får det med.. Indenfor nogle dage".

Ejeren gentog det selv 13/7 17:54: "Man skal kunne se ansattes stats før de ansættes. Man skal kunne fyre ansatte igen."

Bemærk også @jeppek's oprindelige pointe: uden stats **før** ansættelse er sign-on-gebyret nødvendigt for at forhindre hire/fire-fisketure — de tre dele hænger sammen som ét design, ikke tre separate fixes.

Relateret fra samme sweep: #<PERSONALE_OVERSIGT> (personale-oversigt på tværs af hold + profil/stats) — bør koordineres, så vi ikke bygger to konkurrerende staff-visninger.`,
  },
];

// --- kør ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'czissues-'));
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const created = {};

// Placeholder-nøgler → issue-index, så cross-refs kan opløses efter oprettelse
const KEY = {
  AKADEMI_TRAENING: 0,
  KOM_I_GANG: 2,
  RESPONSIVT: 9,
  TRAENING_KOLONNER: 10,
  MENU_IA: 7,
  AI_KVALITET: 20,
  AUKTIONS_GEBYR: 16,
  PERSONALE_OVERSIGT: 14,
  AKADEMI_FRIE: 19,
  POTENTIALE_1_99: 17,
};

function resolve(text) {
  return text.replace(/#<([A-Z_0-9]+)>/g, (m, k) => {
    const idx = KEY[k];
    const num = idx !== undefined ? created[idx] : undefined;
    return num ? `#${num}` : m;
  });
}

console.log(`Opretter ${ISSUES.length} issues...\n`);
ISSUES.forEach((iss, i) => {
  const f = path.join(tmp, `body-${i}.md`);
  fs.writeFileSync(f, iss.body, 'utf8');
  const args = ['issue', 'create', '--title', iss.title, '--body-file', f];
  for (const l of iss.labels) args.push('--label', l);
  const url = gh(args);
  created[i] = url.split('/').pop();
  console.log(`  #${created[i]}  ${iss.title}`);
});

console.log(`\nOpløser cross-referencer...`);
ISSUES.forEach((iss, i) => {
  if (!/#<[A-Z_0-9]+>/.test(iss.body)) return;
  const f = path.join(tmp, `fix-${i}.md`);
  fs.writeFileSync(f, resolve(iss.body), 'utf8');
  gh(['issue', 'edit', String(created[i]), '--body-file', f]);
  console.log(`  #${created[i]} opdateret`);
});

console.log(`\nKommenterer på ${COMMENTS.length} eksisterende issues...`);
for (const c of COMMENTS) {
  const f = path.join(tmp, `c-${c.n}.md`);
  fs.writeFileSync(f, resolve(c.body), 'utf8');
  gh(['issue', 'comment', String(c.n), '--body-file', f]);
  console.log(`  #${c.n} kommenteret`);
}

fs.writeFileSync(
  path.join(process.cwd(), 'scripts', 'discord', '.filed-2026-07-15.json'),
  JSON.stringify({ created, comments: COMMENTS.map((c) => c.n) }, null, 2),
  'utf8'
);
console.log(`\nFÆRDIG. Oprettet: ${Object.values(created).map((n) => '#' + n).join(', ')}`);
