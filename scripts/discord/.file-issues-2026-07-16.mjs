#!/usr/bin/env node
/**
 * Opret GitHub-issues + dedup-kommentarer fra Discord-sweep 2026-07-16
 * (siden sidste sweep 2026-07-15, commit e88fad0e).
 *
 * @bobby2106 = ejer/dev. Testere: smukkethomsen (ny, 8-punkts feedback),
 * thelamba, knud_r_flink, ez4prebren, cybersimon, friisisch.
 *
 * Dedup (springes over — dækket af eksisterende issues):
 *  #2177/#2449 (for få TT/TTT — smukkethomsen pkt 1) → kommentar på #2177
 *  #2437/#2471/#1791 (talentudvikling 19-23 for langsom — pkt 3) → aktivt spor, ingen ny
 *  #2454 (potentiale-stjerner vs nyt loft "world class ~70" — thelamba) → kommentar
 *  #2444 (langsomme sider — ejer-direktiv 16/7) → kommentar (allerede i masterplan)
 *  #2398 (træner-stats før ansættelse) → dækkes delvist; U23-rework får eget issue
 *  "Can't scroll on auction page" (friisisch) → self-resolved, ingen issue
 *  Sentry race_entries.id 17:55 UTC → fixet af #2517 (merged 18:54 UTC)
 *
 * Alle kandidater kode-verificeret 16/7 (Explore-agent) FØR oprettelse.
 * UTF-8-sikkert via temp body-filer. Kør IKKE blindt igen — ingen idempotens.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = 'Discord-sweep 2026-07-16';
const G = '1504615050831466669';
const CH = {
  dolmer: `https://discord.com/channels/${G}/1522915781766283296`,
  dansk: `https://discord.com/channels/${G}/1505478569969582182`,
};
const T = (id) => `https://discord.com/channels/${G}/${id}`;
const RAW = 'https://raw.githubusercontent.com/NicolaiDolmer/CyclingZone/main/docs/discord-attachments';

const BUG = (p) => ['bug', 'claude:todo', 'type:bug', 'cat:bug', `priority:${p}`];
const FEAT = (p) => ['enhancement', 'claude:todo', 'type:feature', 'cat:user-feature', `priority:${p}`];
const TASK = (p) => ['claude:todo', 'type:task', `priority:${p}`];
const OWNER = `\n\n**Ejer-direktiv** (@bobby2106, [#feedback-from-dolmer](${CH.dolmer}), 16/7).`;

const ISSUES = [
  // ---------- Ejer-direktiver (#feedback-from-dolmer, 16/7) ----------
  {
    title: '[feature] Sæsonplanlægger: skift mellem sæson 1 og sæson 2 — planlæg form/trup mod S2-kalenderen',
    labels: FEAT('high'),
    body: `Ejer (16/7 15:56 UTC): "de skal også kunne hoppe mellem sæson 1 og sæson 2 inde i sæsonplanlæggeren, sådan de snart kan begynde at planlægge form + trupper til ruteprofilerne for sæson 2. Når de nye ryter kommer, så synes jeg i samme omgang at vi skal have styr på, at have bedre ruteprofiler."${OWNER}

## Verificeret kode-tilstand (16/7)
Planner-boardet opløser altid KUN den aktive sæson: \`activePeakSeason()\` i \`backend/routes/api.js:2426\`; planer er scoped \`season_id = season.id\`. Eneste UI-toggle er mine/alle (\`frontend/src/pages/SeasonPlannerPage.jsx:88\`). Der findes ingen sæson-vælger.

## Scope
- Sæson-vælger i /planner (S1/S2) — S2 kræver at S2-kalenderen er materialiseret (#2449).
- Peak-planer pr. sæson (datamodellen er allerede sæson-scoped — CRUD skal tage season-param).
- Ruteprofil-forbedring i samme omgang → koordinér med #2448 (rework af ruteprofilerne).

**Afhængighed:** #2449 (sæson 2-løbsprogram synligt). **Relateret:** #2448, #2455, #2426.`,
  },
  {
    title: '[ux] Sæsonplanlægger: løbsdatoer skal være tydelige — hvilket løb planlægger jeg form til, og hvornår køres det?',
    labels: FEAT('high'),
    body: `Ejer (16/7 16:22 UTC): "I peak planneren, skal det være meget nemmere at finde ud af hvilke løb der sker hvornår. Løbene er meget svære at se hvornår de køres i den skærm og hvilke løb man er ved at planlægge sin form til."${OWNER}

## Verificeret kode-tilstand (16/7)
Master-canvas viser kun måneds-ticks på tidsaksen (\`frontend/src/components/planner/MasterCanvas.jsx:38-68\`) + terræn-glyffer ved løbshoveder. Konkrete datoer/løbsnavne kræver at man åbner drawer pr. løb (\`PlannerDrawer.jsx\`). Boardet returnerer allerede \`date\`, \`gameDayStart/End\`, \`stages\`, \`profileSummary\` pr. løb (\`backend/routes/api.js:2571-2591\`) — data findes, præsentationen mangler.

## Idéer (design-frihed)
- Dato + løbsnavn synligt direkte på canvas (hover/altid ved zoom-niveau), ikke kun i drawer.
- Tydelig markering af "dette løb planlægger du til" når en peak-token er valgt/trækkes.
- Mobil: dato allerede i lanes (\`MobileLanes.jsx:33\`) — desktop skal matche.

**Relateret:** #2426 (planner-cockpit), #2448 (ruteprofiler). Bør løses FØR \`peak_planner_enabled\` flippes beta→on.`,
  },
  {
    title: '[i18n] Discord-webhooks + direkte manager-beskeder skal være på engelsk (er dansk i dag)',
    labels: BUG('medium'),
    body: `Ejer (16/7 16:12 UTC): "Alle webhooks ind i discord serveren skal være på engelsk. Lige nu er de på dansk og det er skidt. Beskeder som managers får direkte skal også være på engelsk på discord."${OWNER}

## Evidens fra sweep 16/7
Alle auto-feeds poster dansk i dag:
- #auctions: "🔨 Ny Auktion: … har sat … på auktion!"
- #transfer-history: "✅ Transfer Gennemført: … er skiftet fra … til …"
- #results-*: "🏁 … afviklet (race-motor V2) — **Etapevindere:** … **DNF:** … (styrt/mekanisk defekt)"

Serveren er engelsksproget (EN-first-politik; dansk hører til i 🇩🇰-kategorien). Find alle webhook-afsendere i backend (auktion, transfer, resultat, evt. notifikations-DM'er) og keyificér/oversæt til EN.

**Relateret:** #2153 (division-routede resultat-kanaler + webhook-migration), #1815 (webhook pr. etape — design).`,
  },
  {
    title: '[bug/design] Bestyrelsestilfredshed låst på 50% i hele sæson 1 (baseline-fase) — ejer: må aldrig være låst',
    labels: [...BUG('high'), 'needs-decision'],
    body: `Ejer (16/7 16:21 UTC): "Sidder bestyrelsestilfredsehden fast på 50% igen? Det skal den ikke. Den skal ikke være låst i sæson 1. Den skal ikke være låst i managers første sæson. Den skal slet ikke være låst til noget, på noget tidspunkt."${OWNER}

## Verificeret rod-årsag (16/7) — det er by-design, ikke en regression
- Sæson 1 opretter en **baseline-bestyrelse**: \`createBaselineProfile\` i \`backend/lib/boardGoals.js:657-677\` → \`satisfaction: 50\`, \`is_baseline: true\`, ingen mål, modifier 1.0. Kommentar i koden: "Bestyrelsen observerer uden mål … processTeamSeasonEnd skipper evaluering for is_baseline=true. Erstattes af 5yr/3yr/1yr-rows … i sæson 2."
- Weekend-opdateringen springer baseline-boards over: \`backend/lib/boardWeekendFinalization.js:190\` — \`if (board.is_baseline || board.plan_type === 'baseline') continue;\` (kræver også \`negotiation_status === 'completed'\`).

Så tilfredsheden STÅR bevidst stille på 50 hele første sæson. Ejer-direktivet ændrer designet: tilfredshed skal leve fra dag 1.

## Design-beslutning nødvendig (A/B)
- **A) Resultatdrevet baseline-tilfredshed:** baseline-boards får ingen mål, men tilfredshed bevæger sig ud fra resultater/økonomi/aktivitet (samme weekend-mekanik med default-forventninger pr. division). Billigst, ingen migration af eksisterende boards nødvendig ud over flag-håndtering.
- **B) Giv baseline-boards rigtige (bløde) mål fra start:** fjern baseline-fasen helt — nye hold forhandler en let 1-års-plan ved oprettelse. Større indgreb; overlapper #2022 (ufuldstændig board-dannelse for nye hold) og #2463-kæden.

Anbefaling: **A** nu (før sæsonskiftet), B vurderes sammen med #955 (board-rework).

**Relateret:** #2022, #165, #2463, #2512.`,
  },

  // ---------- Spiller-rapporteret (verificeret) ----------
  {
    title: '[feature] Transferliste: filtrér på udbudspris (asking price)',
    labels: FEAT('medium'),
    body: `**@cybersimon** ([#feedback-and-ideas-tråd](${T('1527005576163229828')}), 15/7): "Just like you can search in at a maximum or minimum or both it would be nice to be able to search for asking price at the transfterlist."

![screenshot](${RAW}/1527005576163229828-1527005576339656765.jpg)

## Verificeret kode-tilstand (16/7)
- Transfer-markedet bruger \`RiderFilters\` uden \`showAuctionPriceFilter\` (\`frontend/src/pages/TransfersPage.jsx:1347-1353\`) — der FINDES allerede en prisinterval-filter-komponent (\`min_auction_price\`/\`max_auction_price\`, \`RiderFilters.jsx:354-368\`), den er bare ikke slået til her og peger på auktionspris, ikke udbudspris.
- \`asking_price\` kan kun SORTERES (\`price_asc\`/\`price_desc\`, \`TransfersPage.jsx:36-37\`), ikke filtreres.

## Scope
Min/max-filter på \`asking_price\` i transferlistens filterpanel (genbrug dual-slider-mønstret). Husk mobil-layout.

**Relateret:** #2399 (ejer-type/division-filter), #2451 (bulk-priser).`,
  },
  {
    title: '[feature] Etape-notifikationer under etapeløb — i dag får man kun besked efter SIDSTE etape',
    labels: FEAT('medium'),
    body: `**@smukkethomsen** ([#dansk-snak](${CH.dansk}), 16/7, pkt 2): "mangler en mail med opdatering af etape resultater i løbet af etapeløb, ligesom man får på endagsløb"

## Verificeret kode-tilstand (16/7)
Resultat-notifikationer er in-app (\`notifications\`-tabellen via \`emitRaceResultNotifications\`) + Discord-webhooks — ikke e-mail. Trigger-kadencen i \`backend/lib/raceRunner.js\`:
- Endagsløb: notifikation ved afvikling (\`raceRunner.js:1195-1202\`).
- Etapeløb: notifikation KUN på den faktiske final-etape (\`raceRunner.js:1763-1773\`, eksplicit kommentar).

Så under et 2+ dages etapeløb hører manageren ingenting før løbet er slut — spilleren oplever det som "der sker ikke noget".

## Scope
Per-etape in-app-notifikation ("Etape 2 af Tour du Tyrol er kørt — din bedste: X, nr. Y") til deltagende managers. Discord-webhook pr. etape er designet i #1815 — koordinér kanalerne dér.

**Relateret:** #1815, #959 (etape-resultatvisning).`,
  },
  {
    title: '[ux] Ønskelisten: giv besked når en rytter forlader spillet — i dag forsvinder de tavst',
    labels: FEAT('medium'),
    body: `**@smukkethomsen** ([#dansk-snak](${CH.dansk}), 16/7, pkt 4): "Hvor blev Sebastian Olsen [Berg] af? Mit 22 årige talent på ønskelisten er forsvundet, fik han kolde fødder og besluttede sig for en tømrekarriere i stedet?" — og **@knud_r_flink** (16/7): "AV. Hvad blev der af alle de ryttere i akademiet, som jeg kun drømte om … Jeg manglede kun 1.000.000 CZ$"

Konkret anledning: #2456-oprydningen slettede usolgte ungdomsryttere — spillere med dem på ønskelisten opdagede det først ved at rytteren bare var væk. Ejeren måtte forklare det manuelt på Discord.

## Verificeret kode-tilstand (16/7)
- \`rider_watchlist\`-entries orphanes tavst ved rytter-sletning: frontend filtrerer \`.filter(e => e.rider)\` (\`frontend/src/pages/WatchlistPage.jsx:80-82\`, jf. #1918).
- Ingen backend-cleanup rører \`rider_watchlist\`, ingen notifikation sendes.

## Scope
Ved rytter-sletning/udgang: in-app-notifikation til alle med rytteren på ønskelisten ("X har forladt spillet") + ryd watchlist-rækken. Gælder både admin-sletninger, oprydninger og fremtidig pension (#2218).

**Relateret:** #2456, #1918, #2064.`,
  },
  {
    title: '[balance] Massespurt: bunch-tærsklen er for smal i praksis — feltet splittes i 3-6-mands klumper på sekunder',
    labels: TASK('medium'),
    body: `**@smukkethomsen** ([#dansk-snak](${CH.dansk}), 16/7, pkt 5): "på spurt etaperne … rapporten siger udbrud blev hentet og det blev en massespurt, men der er sekunders forskel mellem rytterne, fx 3 ryttere samlet, så 5 ryttere, så 6 osv. Det kunne være fedt hvis det meste af feltet kommer ind med samme tid, og så der var tidsbonus for de 3 første evt 5 3 1 sekunder."

## Verificeret kode-tilstand (16/7) — logikken FINDES, kalibreringen rammer ved siden af
Motoren HAR samme-tid-logik: \`GAP_MODEL\` med per-terræn \`bunch\`-tærskel (\`backend/lib/raceSimulator.js:71-81\`, flat = \`{bunch: 0.06, spread: 40}\`); \`gapFor()\` giver \`stageGap = 0\` for alle inden for tærsklen (\`raceSimulator.js:347-351\`). Spiller-observationen betyder at score-spredningen på flade etaper er større end bunch-båndet, så kun få ryttere lander i samme-tid-gruppen.

## Scope (balance-følsom → sim-gate jf. simulér-før-ship)
- Mål den faktiske fordeling af \`stageGap\` på flade etaper i prod (hvor stor er "hovedfeltet" i dag?).
- Justér \`bunch\`/\`spread\` for flat (evt. hilly) så en ægte massespurt giver 60-80% af feltet samme tid — dry-run-harness mod ægte population + scorecard FØR ship.
- Tidsbonus 10/6/4-style ved etapemål er allerede designet i #2413 — det er den anden halvdel af ønsket.

**Relateret:** #2413 (bonussekunder), #2260 (udbrud holder hjem), #2410 (tidslinje-audit).`,
  },
  {
    title: '[ux] Rytterprofil: resultat-rækker skal linke til løbssiden',
    labels: FEAT('low'),
    body: `**@smukkethomsen** ([#dansk-snak](${CH.dansk}), 16/7, pkt 6): "Under fanen resultater på hver rytter, kunne det være fedt hvis man kunne trykke på pågældende løb og linke til det, så man kan se hvem der har slået én"

## Verificeret kode-tilstand (16/7)
\`frontend/src/components/rider/profile/RiderResultsTab.jsx\`: løbsnavnet er ren tekst (\`:163\`), endagsrækker er en ikke-interaktiv \`<div>\` (\`:186\`), etapeløbsrækker er en knap der kun folder etaper ud (\`:177-184\`). Ingen \`Link\`/\`navigate\`/\`href\` til løbssiden i komponenten.

## Scope
Løbsnavn → link til \`/races/:id\` (etapeløb: behold expand på rækken, gør navnet til link). Samme mønster på holdets palmarès-faner hvis det også mangler dér (#1997).

**Relateret:** #1997, #959.`,
  },
  {
    title: '[feature] Etape-diversitet: teknik-/brostens-etaper og profiler der belønner bredde frem for 1-2 stats',
    labels: FEAT('medium'),
    body: `**@smukkethomsen** ([#dansk-snak](${CH.dansk}), 16/7, pkt 7): "Savner generelt lidt flere forskellige typer etaper og etapeløb, der favoriserer forskellige attributes. Fx etaper hvor teknik stat betyder meget fx brostens etaper, men også bare en alm etape der er teknisk pga afslutningen … Etaper der belønner bredde frem for maksimering af én eller to vigtige stats."

## Kontekst
Terræn-typerne findes (flat/hilly/mountain/itt/ttt/cobbles — cobbles bruges i motoren og planner-glyfferne), men kalender-generatoren og demand-vektorerne udnytter ikke spektret: teknik-stat'en har få etaper hvor den er udslagsgivende, og GC-løb belønner smalle klatre/udholdenheds-builds.

Dette er samme retning som #2448 (ruteprofil-rework) og #2476 (sidevind/vifter) — dette issue dækker SELVE etape-mixet i kalenderen + demand-vektorer der vægter teknik/bredde, så forskellige trup-builds har hver deres jagtmarker.

**Timing:** naturligt sammen med sæson 2-kalenderen (#2449) — nye løbstyper kan debutere dér.

**Relateret:** #2448, #2476, #2449, #2177, #1379.`,
  },
  {
    title: '[needs-decision] Oprykning S1→S2: skal flere aktive spillerhold rykke op nu, mens AI dominerer div 1-2?',
    labels: [...TASK('high'), 'needs-decision'],
    body: `**@smukkethomsen** ([#dansk-snak](${CH.dansk}), 16/7, pkt 8 — "den vigtigste for spillets næste 4-5 sæsoner"): For få spillerhold rykker op, og AI-modstanden i div 1-2 er "laughable" (30-ovr ryttere som de bedste). Hans argumenter:
- Hold der rykker op fra div 3 møder potentielt SVAGERE modstand i div 2 end de forlod — og belønnes økonomisk oveni.
- Med nuværende tempo tager det ~7 sæsoner før div 1 er fyldt med spillerhold; first-movers får en kæmpe kompounding-fordel (økonomi + konkurrence).
- Forslag: ryk flere aktive spillere op ved sæsonskiftet, så div 2 bliver en ægte kamp i S2.

## Hvorfor needs-decision NU
Sæsonskiftet er ~10 løbsdage væk (#2361). Antal oprykkere er en ejer-beslutning der skal træffes FØR op/nedryknings-ritualet køres. De to håndtag er uafhængige:
1. **Oprykningskvote S1→S2** (denne beslutning — kan ikke gøres om efter ritualet).
2. **AI-kvalitet pr. division** (#2457 — allerede i masterplanen, balance-følsom, sim-gated).

## Beslutningsgrundlag der skal på bordet (lille analyse før ejer-valg)
- Hvor mange AKTIVE spillerhold ligger lige under stregen i hver division/gruppe (aktivitets-definition = samme filter som UI'ets "rigtige hold").
- Konsekvens for felt-størrelser/kalender i S2 ved fx 2 vs 3 vs 4 oprykkere pr. gruppe.

**Relateret:** #2457, #1980, #1152, #2361.`,
  },
  {
    title: '[feature] Træner-niveaubånd: youth/junior erstattes af én U23-gruppe + forklar båndene i UI/Hjælp',
    labels: FEAT('medium'),
    body: `**@thelamba** ([#dansk-snak](${CH.dansk}), 16/7): "Jeg savner en forklaring på, hvad 'youth' og 'junior' dækker over … kunne ikke finde det i Hjælp" + "Hvad er det egentlig han er dårlig til (youth)?"

![screenshot](${RAW}/1505478569969582182-1527381514982002990.png)

**Ejer-svar samme aften (retning besluttet):** "junior er en der er god til at træne ryttere mellem 15-19 år og youth er 19-23 ish … Tænker egentlig bare det skal væk for en stor U23 gruppe … De to ting i nævner kan nok lige komme med ind, sammen med, at man kan købe en talentspejder her i næste rul."

## Verificeret kode-tilstand (16/7)
- \`LEVEL_BANDS = ["youth", "junior", "senior"]\` (\`backend/lib/staffAbilityConstants.js:11\`); \`riderLevelBand()\`: akademi/≤21 = youth, 22-25 = junior, 26+ = senior (\`:41-45\`) — bemærk at koden IKKE matcher ejerens egen beskrivelse (15-19 vs 19-23), hvilket bekræfter at båndene er uklare selv internt.
- Specialiserings-multiplier op til +14% (\`facilityConstants.js:81-87\`).
- Kandidater viser overall/topSpecialization/tier/løn før ansættelse (\`staffCandidates.js:49-57\`), men den fulde evne-matrix er kun synlig for EGET staff (\`facilityRoutesHandlers.js:163-201\`) — jf. #2398.

## Scope
1. Kollaps youth+junior → ét \`u23\`-bånd (data + derivation + multiplier + UI); senior uændret. Migration af eksisterende staff-abilities.
2. Forklar båndene i staff-UI (tooltip) + \`help.json\` (EN+DA).
3. Koordinér med #2398 (vis fuld evne-profil før ansættelse) — samme flade.

**Relateret:** #2398, #2450, #2492 (tre-tier: Senior/U23/Junior-KLUBSTRUKTUR er noget andet end træner-bånd — navnesammenfald må ikke forvirre; afstem terminologi med epic'en).`,
  },
];

const COMMENTS = [
  {
    n: 2177,
    body: `Forstærkning fra ${SRC}: **@smukkethomsen** (ny tester, [#dansk-snak](${CH.dansk}) 16/7, pkt 1): "synes der er for få TT og TTT i løbet af sæsonen" — kan se det er nævnt før uden respons. Andet uafhængige spiller-ønske om ITT/TTT-genindførsel. Naturligt at lande sammen med sæson 2-kalenderen (#2449).`,
  },
  {
    n: 2444,
    body: `Ejer-direktiv 16/7 ([#feedback-from-dolmer](${CH.dolmer}) 15:52 UTC): "Der er alt for mange af siderne der er alt for langsomme inde på hjemmesiden. Du skal selv undersøge hastigheden på siderne og komme med forbedringsforslag." — bekræfter dette issues scope og hæver prioriteten: audit'en skal selv MÅLE alle sider (ikke kun dashboard/liga) og levere en prioriteret forslagliste.`,
  },
  {
    n: 2454,
    body: `Spiller-observation fra ${SRC} der skal med i dette rework: **@thelamba** ([#dansk-snak](${CH.dansk}) 16/7): "Ham helt i toppen var en ægte 6-stjernet gut inden der blev ændret potentiale. Nu har han max omkring 70-erne. Ved ikke hvordan det er 'world class potential'." — stjerne-labels ("world class") matcher ikke længere de faktiske lofter efter #2471/#2472-rekalibreringen. 1-99-skalaen med spejder-usikkerhed skal også rette label-skalaen.`,
  },
  {
    n: 2449,
    body: `Ejer-direktiv 16/7 ([#feedback-from-dolmer](${CH.dolmer}) 15:55 UTC): "Jeg vil gerne have meget snart, at vi begynder at have styr på løbskalenderen for sæson 2. Skal være offentlig før sæson 2 går live, managers skal kunne planlægge" — bekræfter og haster dette issue. Sæson-skift i planneren er udskilt som selvstændigt issue (se cross-ref i ${SRC}-batchen).`,
  },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'czissues-'));
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const created = {};

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

console.log(`\nKommenterer på ${COMMENTS.length} eksisterende issues...`);
for (const c of COMMENTS) {
  const f = path.join(tmp, `c-${c.n}.md`);
  fs.writeFileSync(f, c.body, 'utf8');
  gh(['issue', 'comment', String(c.n), '--body-file', f]);
  console.log(`  #${c.n} kommenteret`);
}

fs.writeFileSync(
  path.join(process.cwd(), 'scripts', 'discord', '.filed-2026-07-16.json'),
  JSON.stringify({ created, comments: COMMENTS.map((c) => c.n) }, null, 2),
  'utf8'
);
console.log(`\nFÆRDIG. Oprettet: ${Object.values(created).map((n) => '#' + n).join(', ')}`);
