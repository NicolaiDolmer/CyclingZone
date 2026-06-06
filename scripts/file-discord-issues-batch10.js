#!/usr/bin/env node
/**
 * Batch 10 — create GitHub issues from NEW Discord feedback
 * (#samlet-feedback-features-og-bugs, tråde 2026-06-03 aften → 2026-06-05;
 *  alle med thread-ID > batch 9's top 1511748952079339520).
 *
 * Krydstjekket mod 285 åbne issues. Dups håndteret som KOMMENTARER (ikke nye issues):
 *   - Auktions-sortering efter udløbstid (1511982828462542918 + 1511832852512247881)
 *     → komment på #259 ([feature] Mobil auktion: tilføj sortering på 'Alle'-fanen)
 *   - Fremtidig indtægt / løbende præmiepenge i næste-sæsons-forecast (1511803871062655048)
 *     → komment på #981 (Økonomi: præmiepenge-prognose lavere end indtjent)
 *
 * Code-pointers lokaliseret via Explore-agent (sandsynlige steder, IKKE verificeret rod-årsag).
 *
 * Idempotent-ish: skips hvis et issue med samme titel allerede findes (open eller closed).
 *
 * Usage:
 *   node scripts/file-discord-issues-batch10.js            # dry-run (issues + comments)
 *   node scripts/file-discord-issues-batch10.js --apply    # opret issues + post kommentarer
 */
import { execSync } from 'node:child_process';

const REPO = 'NicolaiDolmer/CyclingZone';
const GUILD = '474142653529849886';
const link = (id) => `https://discord.com/channels/${GUILD}/${id}`;

function body({ date, author, text, threadId, code, refs, extraSource }) {
  return `**Fra Discord-feedback (${date}, @${author})**

${text}
${code ? `\n**Sandsynlige kode-steder** (lokaliseret via Explore, ikke verificeret rod-årsag):\n${code}\n` : ''}${refs ? `\n**Relateret:** ${refs}\n` : ''}
**Kilde:** Discord-tråd ${link(threadId)}${extraSource ? `\n${extraSource}` : ''}

---
_Filed automatisk fra Discord-feedback-triage (batch 10)._`;
}

// Each: { threadId, title, type, priority, body }
const ISSUES = [
  {
    threadId: '1512432688265564242',
    title: '[bug] Byttehandel: rytter kan tilbydes i bytte mens han er på aktiv auktion',
    type: 'bug',
    priority: 'high',
    body: body({
      date: '2026-06-05', author: 'jeppek', threadId: '1512432688265564242',
      text: 'Det er lige nu muligt at tilbyde en rytter i bytte, som man har på en aktiv auktion. Dette bør ikke være muligt før auktionen på rytteren er afsluttet (og kun hvis ingen har købt ham). Ellers kan samme rytter både sælges på auktion og indgå i en byttehandel.',
      code: '- `backend/routes/api.js:2063-2124` — `POST /api/transfers/swaps` validerer `offered_rider`, men tjekker IKKE om rytteren er på en aktiv auktion\n- `backend/routes/api.js:2073-2088` — rytter-validering uden auction-status-check\n- `backend/lib/auctionEngine.js` — mangler swap-guard mod aktive auktioner',
      refs: '#822 (rytter fjernes ikke fra transferlisten ved auktionssalg)',
    }),
  },
  {
    threadId: '1512431876395237597',
    title: '[bug] Dashboard: trupstørrelse-advarsel opdateres ikke ift. ind-/udgående ryttere til næste sæson',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-06-05', author: 'jeppek', threadId: '1512431876395237597',
      text: 'Advarslen om trupstørrelse på dashboardet opdateres ikke ift. de ryttere der kommer ind til næste sæson. Den bør tage højde for ryttere ind OG ud — også når ryttere er på vej ud af holdet — hvis advarslen gælder den kommende sæson.',
      code: '- `frontend/src/lib/dashboardSquadStats.js:26-73` — `computeDashboardSquadStats()` beregner `futureRiderCount`\n- `frontend/src/lib/dashboardSquadStats.js:38-39` — `futureRiderCount = ownedNow - outgoingCount + pendingIncomingCount + activeLoanCount` (mangler næste-sæson-kontekst)\n- `frontend/src/pages/DashboardPage.jsx:328-335` — `squadStats` bruges til warning-visning uden sæson-status',
    }),
  },
  {
    threadId: '1512117590607134771',
    title: '[bug] Autobud: ved identisk bud bør auktionsføreren (med autobud) beholde føringen',
    type: 'bug',
    priority: 'high',
    body: body({
      date: '2026-06-04', author: 'jeppek', threadId: '1512117590607134771',
      text: 'Når man har et autobud (fx 1.000.000) og fører en auktion, bør man fortsat føre, hvis en anden byder præcis det eksakte beløb — føreren har fordelen ved allerede at føre og have meldt sit loft. Lige nu overtager den NYE byder føringen ved et identisk bud, hvilket er forkert.',
      code: '- `backend/lib/proxyBidding.js:100-165` — `resolveProxyBids()` cascade-logik\n- `backend/lib/proxyBidding.js:142-147` — `effectiveWinnerProxy.max_amount >= getMinimumAuctionBid(topChallenger.max_amount)` (mangler tie-break til fordel for nuværende fører)\n- `backend/lib/auctionEngine.js` — høj-pris-sammenligning uden fører-fortrin ved lighed',
      refs: '#230 (auto-cancel proxy-bud over loft), #265 (fjern-autobud-kryds)',
    }),
  },
  {
    threadId: '1512022257986310174',
    title: '[bug] Værdisortering virker ikke på Liga→Hold→Trup (virker på "Mit Hold")',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-06-04', author: 'stephoslash', threadId: '1512022257986310174',
      text: 'Når der sorteres efter værdi, er rækkefølgen ikke korrekt på Liga→Hold→Trup. Det virker korrekt på "Mit Hold"-siden, men ikke når man ser et andet holds trup. Der er et screenshot i tråden.',
      code: '- `frontend/src/pages/TeamProfilePage.jsx:99-112` — `displayRiders`-sortering efter `tableSort.key`; linje 109-110 bruger nøglen direkte\n- `frontend/src/pages/TeamProfilePage.jsx:232-233` — `SortTh` med `sortKey="uci_points"` for værdi-kolonnen\n- `frontend/src/pages/TeamPage.jsx:164-190,250` — "Mit Hold"-trup sort-logik der VIRKER (sammenlign de to)',
    }),
  },
  {
    threadId: '1512395255058665634',
    title: '[bug] Podier tildeles ikke i ranglisten (top-3-resultater tæller ikke som podie)',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-06-05', author: 'jeppek', threadId: '1512395255058665634',
      text: 'Der er ikke tildelt nogen podier i ranglisten. Podie-tallet bør opdateres ift. top-3-resultater (rank ≤ 3 = podie). Der er et screenshot i tråden.',
      code: '- `frontend/src/pages/StandingsPage.jsx:106-114` — `podiums` beregnes fra `race_results` (rank ≤ 3) men opdateres ikke korrekt i visningen\n- `frontend/src/pages/StandingsPage.jsx:258` — `thPodiums`-kolonne viser `s.podiums` (forbliver 0)\n- `backend/lib/` — race-result-aggregering tæller ikke rank ≤ 3 som podium for standings',
      refs: '#924 (rangliste bør indeholde podier + flere kolonner)',
    }),
  },
  {
    threadId: '1512392284325412904',
    title: '[bug] Uønsket prik udfor alle stats i rytter-fanen (mulig regression fra #1087)',
    type: 'bug',
    priority: 'high',
    body: body({
      date: '2026-06-05', author: 'jeppek', threadId: '1512392284325412904',
      text: 'I rytter-fanen (rytterdatabasen) er der pludselig en prik udfor alle stats på rytterne. Den skal ikke være der. Der er et screenshot i tråden (bredt billede, hele stats-rækken).\n\n**Mistanke:** muligvis en regression fra #1072/#1087 ("fix(profiles): synlig offline-prik — `bg-cz-subtle0` → `bg-cz-border`"), hvor en prik-baggrund blev gjort synlig og nu også slår igennem i stats-visningen. Skal verificeres mod commit-timingen.',
      code: '- `frontend/src/pages/RidersPage.jsx:75-86` — `StatBar`-komponent renderer stat-værdier\n- `frontend/src/pages/RidersPage.jsx:129-133` — map over `STATS`\n- `frontend/src/components/OnlineBadge.jsx` — offline-prik bruger `bg-cz-border` (mulig CSS-regression-kilde)',
      refs: '#1072 / #1087 (synlig offline-prik — mulig regressions-kilde)',
    }),
  },
  {
    threadId: '1512504377917833346',
    title: 'Holdvisning: vis nuværende + kommende hold (forvirrende at se hold fra sæson 1)',
    type: 'feature',
    priority: 'low',
    body: body({
      date: '2026-06-05', author: '.sredna + bobby2106', threadId: '1512504377917833346',
      text: 'En holdvisning viser en rytters/spillers hold fra sæson 1, hvilket ser forvirrende ud ("giver ikke rigtig mening"). @bobby2106: der bør stå nuværende + kommende hold på en eller anden måde på sådan en side. (Sekundært nævnt i tråden: en solgt rytter forsvinder ikke automatisk fra sælgers transferliste — dækket af #822, "det kommer".)',
      code: '- `frontend/src/pages/ManagerProfilePage.jsx:244-272` — "sæson"-tab viser `season_history` uden at fremhæve nuværende/kommende\n- `frontend/src/pages/TeamProfilePage.jsx:54-68` — `season_standings`-query uden aktiv-vs-afsluttet-kontekst\n- `backend/routes/api.js:~3093` — `/api/managers/{teamId}` henter season_history (mangler nuværende/kommende-markering)',
      refs: '#950 (ryttersiden: nuværende + kommende hold-badge), #822 (transferliste-oprydning)',
    }),
  },
  {
    threadId: '1512448285124722749',
    title: 'Bestyrelse: balance/tuning af plan-krav (U25-antal, 3-årsplanens trupstørrelse, U25-statgevinst)',
    type: 'feature',
    priority: 'med',
    body: body({
      date: '2026-06-05', author: 'stephoslash', threadId: '1512448285124722749',
      text: `Tuning-feedback til bestyrelsens plan-krav (efter #955-rework, board plan-faner):
- **U25-antal:** "7 U25" er forhandlet ned fra 8, men det opleves stadig for højt — ~50% af truppen burde være maks. Tærsklen virker for stram.
- **3-årsplanens trupstørrelse:** krav om 22 ryttere i 3-årsplanen er måske for højt.
- **U25-statgevinst:** kravets format/betydning er uklart i den nuværende plan-visning ("ved ikke lige hvad det er i dette format").
- (Danske stavefejl i EN-versionen — dækket af #917.)`,
      code: '- `backend/lib/boardConstants.js:1-37` — `DIVISION_SQUAD_LIMITS` (min/max per division), `PLAN_PENALTY_MODIFIERS`\n- `backend/lib/boardGoals.js:118-124` — `getDynamicU25Target()` (`youthU25Target`)\n- `backend/lib/boardGoals.js:155-160` — `min_u25_riders`-mål (`target: youthU25Target`)\n- `backend/lib/boardGoals.js:219-226` — `min_riders`-mål for star_signing-plan (`starMinRidersTarget`, ~22)\n- `frontend/src/pages/BoardPage.jsx:2159-2209` — board plan-faner visning',
      refs: '#955 (Epic: Bestyrelse UI/UX-rework — plan-faner), #989 (forklar 3-årsplanens evaluering), #917 (DA-tekst i EN-version), #109 (U25-kategorisering)',
    }),
  },
];

// Kommentarer på eksisterende issues (dups). Each: { issue, body }
const COMMENTS = [
  {
    issue: 259,
    body: `**Ny Discord-feedback (2026-06-03/04, @jeppek) — auktions-sortering efter udløbstid**

To nye tråde efterspørger specifikt at kunne sortere auktioner efter "hvad der udløber næst" (tid som sort-key), hvilket dette issue allerede dækker ("Tid, pris og evne ville være nyttige sort-keys"). Tilføjer kontekst:
- Ønsket placeret enten under filtrering eller ved siden af "Vis stats"-knappen.
- @bobby2106 prioriterede mobil-varianten: **M1 eller M2 / P0 eller P1**, og bemærkede at det primært er et problem på **mobilversionen**.

**Kilder:** ${link('1511982828462542918')} · ${link('1511832852512247881')}`,
  },
  {
    issue: 981,
    body: `**Ny Discord-feedback (2026-06-03, @stephoslash) — mulig rod-årsag / beslægtet vinkel**

Når præmiepenge udbetales løbende, kan det se misvisende ud at de stadig regnes med i NÆSTE sæsons forecast. Dette kan være samme rod som det her beskrevne (forecast medregner ikke korrekt realiseret vs. fremtidig præmieindtægt — \`backend/lib/financeForecast.js\`). Værd at se de to symptomer under ét: (a) prognose lavere end indtjent (dette issue), (b) løbende-udbetalte præmiepenge allokeret til forkert sæson.

**Kilde:** ${link('1511803871062655048')}`,
  },
];

function ghTitleExists(title) {
  try {
    const out = execSync(
      `gh issue list --repo ${REPO} --state all --search ${JSON.stringify(`"${title}" in:title`)} --json title`,
      { encoding: 'utf8' }
    );
    const arr = JSON.parse(out);
    return arr.some((i) => i.title.trim() === title.trim());
  } catch {
    return false;
  }
}

const APPLY = process.argv.includes('--apply');
let created = 0, skipped = 0, commented = 0;

console.log('--- ISSUES ---');
for (const iss of ISSUES) {
  const labels = ['claude:todo', `type:${iss.type}`, `priority:${iss.priority}`].join(',');
  if (ghTitleExists(iss.title)) {
    console.log(`SKIP (exists): ${iss.title}`);
    skipped++;
    continue;
  }
  if (!APPLY) {
    console.log(`DRY  : ${iss.title}  [${labels}]`);
    continue;
  }
  const args = [
    'issue', 'create',
    '--repo', REPO,
    '--title', iss.title,
    '--body', iss.body,
    '--label', labels,
  ];
  const r = execSync(`gh ${args.map((a) => JSON.stringify(a)).join(' ')}`, { encoding: 'utf8' });
  console.log(`CREATED: ${iss.title}\n  ${r.trim()}`);
  created++;
}

console.log('\n--- COMMENTS ---');
for (const c of COMMENTS) {
  if (!APPLY) {
    console.log(`DRY  comment → #${c.issue}`);
    continue;
  }
  execSync(`gh issue comment ${c.issue} --repo ${REPO} --body ${JSON.stringify(c.body)}`, { encoding: 'utf8' });
  console.log(`COMMENTED: #${c.issue}`);
  commented++;
}

console.log(`\nDONE apply=${APPLY} created=${created} skipped=${skipped} commented=${commented} issues=${ISSUES.length} comments=${COMMENTS.length}`);
