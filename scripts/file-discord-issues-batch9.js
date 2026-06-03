#!/usr/bin/env node
/**
 * Batch 9 — create GitHub issues from NEW Discord feedback (2026-06-03 triage).
 * Covers the 2026-06-03 feedback wave + two cross-channel recurring themes
 * (attribut-farver, lån/gældsloft-UX) raised in #cycling-zone og #spørgsmål-og-svar.
 *
 * Skipped as duplicates/handled (NOT re-filed here). Thread-permalinks listed
 * so dedupe-feedback.mjs (matcher channels/<guild>/<id>) ikke re-flagger dem NEW:
 *   - Navnesøgning mellemrum              → dup #47 (open)
 *     https://discord.com/channels/474142653529849886/1504223818036805642
 *   - Min managerprofil viser forkert navn → dup #224 (open)
 *     https://discord.com/channels/474142653529849886/1502731709366538482
 *   - Managernavn ændret (tom tråd)        → dup #224 (open)
 *     https://discord.com/channels/474142653529849886/1502258493418246154
 *   - Kan ikke lukke onboarding           → dup #225 (open)
 *     https://discord.com/channels/474142653529849886/1501675887530217522
 *   - Sæsonskifte/oprykninger (05-21)     → dækket af #533/#534 + #962
 *     https://discord.com/channels/474142653529849886/1506925075876548690
 *   - Mistede overskrifter                → løst i tråden selv
 *     https://discord.com/channels/474142653529849886/1505629552020291675
 *   - Vil du hjælpe med at teste (auktion)→ ejer-test-prompt
 *     https://discord.com/channels/474142653529849886/1502277902841155594
 *   - Fans-Merchandise-feedback-tråd      → ejer-placeholder ("ikke udviklet"), epic #957
 *     https://discord.com/channels/474142653529849886/1501508000039436338
 *
 * Code-pointers er lokaliseret via Explore-agent (sandsynlige steder, IKKE
 * verificeret rod-årsag).
 *
 * Idempotent-ish: skips if an issue with the same title already exists (open or closed).
 *
 * Usage:
 *   node scripts/file-discord-issues-batch9.js          # dry-run
 *   node scripts/file-discord-issues-batch9.js --apply  # actually create issues
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
_Filed automatisk fra Discord-feedback-triage (batch 9)._`;
}

// Each: { threadId, title, type, priority, body }
const ISSUES = [
  {
    threadId: '1511657603183415316',
    title: 'Rytterrangliste: filter på konkret hold (se egne ryttere samlet)',
    type: 'feature',
    priority: 'high',
    body: body({
      date: '2026-06-03', author: 'bobby2106', threadId: '1511657603183415316',
      text: 'Ønske: kunne filtrere rytterranglisten på ét konkret hold, så man fx kun ser ryttere fra ét hold og kan se hvor alle ens egne ryttere er placeret. (@bobby2106 markerede tråden "P1".)',
      code: '- `frontend/src/pages/RiderRankingsPage.jsx:23-28` — `OWNER_FILTERS` (kun ejerskab: manager/ai/free)\n- `frontend/src/pages/RiderRankingsPage.jsx:144-173` — eksisterende filter-UI + filter-logik (mangler hold-vælger)\n- `frontend/src/pages/RiderRankingsPage.jsx:39` — `setSearch()` (navn-baseret, ikke hold)',
      refs: '#924 (rangliste-kolonner), #802 (nation-kolonne)',
    }),
  },
  {
    threadId: '1511659383694819421',
    title: 'Dashboard: customize-knap (vælg moduler) + "seneste resultater"- og rangliste-modul',
    type: 'feature',
    priority: 'med',
    body: body({
      date: '2026-06-03', author: 'bobby2106', threadId: '1511659383694819421',
      text: `Ønske til dashboardet:
- En "customize"-knap (evt. også i indstillinger) hvor man vælger præcist hvilke moduler/bokse der vises.
- Et "seneste resultater"-modul (fx de seneste 5 løbsdage + vigtigste resultater).
- Et rytterrangliste-modul med de vigtigste nedslag.

Bekræftet i #cycling-zone: flere spillere oplever nuværende bokse som redundante ("de 4 bokse kan jeg finde andre steder på dashboardet").`,
      code: '- `frontend/src/pages/DashboardPage.jsx:57-86` — hardcodede moduler/state, ingen visibility-toggle eller localStorage-persistens\n- `frontend/src/pages/DashboardPage.jsx:10+` — modul-imports (StatCard, MiniBar, boards, auctions …)',
      refs: '#62 (dashboard næste-bedste-handling-panel)',
      extraSource: '**Tværkanal:** også #cycling-zone (cybersimon, 31/5) + ejer-poll om mest/mindst brugte dashboard-moduler.',
    }),
  },
  {
    threadId: '1511732272871772190',
    title: 'Rytter-visninger: skjul/vis specifikke stats-kolonner (som auktions-toggle, omvendt)',
    type: 'feature',
    priority: 'med',
    body: body({
      date: '2026-06-03', author: '.sredna', threadId: '1511732272871772190',
      text: 'Ønske: kunne skjule/vise specifikke stats når man kigger på ryttere — fx fjerne fighter, nedkørsel, sprint mfl. fra visningen for en bjergrytter. Næsten præcis som "vis stats"-knappen på auktionssiden, men når man søger på ryttere, og helst "omvendt" (man klikker stats FRA).',
      code: '- `frontend/src/lib/useStatsToggle.js` + `frontend/src/components/StatsToggle.jsx` — eksisterende toggle-mønster\n- `frontend/src/pages/AuctionsPage.jsx` — hvor toggle bruges i dag\n- `frontend/src/pages/RidersPage.jsx` — mangler stats-toggle helt (skal tilføjes)\n- `frontend/src/pages/RiderRankingsPage.jsx` — har separat "Kolonner"-menu (kan evt. genbruges/forenes)',
    }),
  },
  {
    threadId: '1511698543931293748',
    title: '[bug] Mobil: bjælke følger med op ved scroll (skal ikke være sticky)',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-06-03', author: 'jeppek', threadId: '1511698543931293748',
      text: 'På mobilversion følger en bjælke med op når man scroller ned — det skal den ikke. Der er et screenshot i Discord-tråden.',
      code: '- `frontend/src/components/MobileQuickNav.jsx:76-78` — `fixed left-0 right-0 z-30 md:hidden`, dynamisk `bottom` afh. af `tickerActive`\n- Verificér også fixed/sticky headers/bannere på DashboardPage/FinancePage på mobil (kan overlappe browser-chrome)',
      refs: '#797 (langsigtet mobil-visning af brede tabeller)',
    }),
  },
  {
    threadId: '1511734208199000164',
    title: 'Achievements: vis progress mod mål (fx "vind 50 auktioner: 40/50")',
    type: 'feature',
    priority: 'low',
    body: body({
      date: '2026-06-03', author: 'liam_99520', threadId: '1511734208199000164',
      text: 'Ønske (+1 fra .sredna): kunne se hvor meget man mangler for at fuldføre en achievement — fx "vind 50 auktioner i alt" → "du mangler 10". Altså en progress-indikator pr. achievement.',
      code: '- `backend/lib/achievementEngine.js:69-87` — unlock-logik + `achievements`-tabel; har registrering, men ingen progress/“mangler N”-tæller\n- Frontend achievement-visning mangler (ingen søgeresultat) — progress-bar-komponent + backend-query for mål-tæller vs. current skal tilføjes',
      refs: '#817 (manglende "første resultat"-achievement)',
    }),
  },
  {
    threadId: '1511735787408855230',
    title: 'Ryttere: sortér efter samlet rating (ikke kun værdi)',
    type: 'feature',
    priority: 'low',
    body: body({
      date: '2026-06-03', author: 'liam_99520', threadId: '1511735787408855230',
      text: 'Ønske: kunne sortere ryttere efter en samlet "rating", fordi værdi-intervallet ikke afspejler kvalitet (på billedet er værdi 200.000-300.000, men der dukker stadig "dårligere" ryttere op). Der er et screenshot i tråden. NB: hænger sammen med det kommende 1-100-evnesystem.',
      code: '- `frontend/src/pages/RiderRankingsPage.jsx:13-21` — `SORT_COLS` (points/total_wins/stage_wins/…); ingen `rating`/`overall`-kolonne\n- `frontend/src/pages/RiderRankingsPage.jsx:36-37,114-117` — sort-state + sort-logik (default `points`)',
      refs: '#918 (Udvikling-fane), kommende 1-100-evnesystem',
    }),
  },
  {
    threadId: '1511737196435214376',
    title: 'Sæsonoverblik: vis rute-/etapeprofiler for kommende løb',
    type: 'feature',
    priority: 'low',
    body: body({
      date: '2026-06-03', author: 'soren1207', threadId: '1511737196435214376',
      text: 'Ønske: kunne indlæse stages, så man under sæsonoverblikket kan se ruteprofilerne (højdeprofiler) for de løb der skal køres. Forslag i tråden: en feature til at uploade stages fra PCM.',
      code: '- `frontend/src/pages/SeasonPreviewPage.jsx:1-80` — viser kun hold-værdier + avg-stats; ingen rute/etape-profil-data\n- Race-model: verificér om `races` har et `elevation_profile`/profil-felt; ellers kræver det import (PCM) + SVG/canvas-rendering',
      refs: '#959 (etape-resultater-epic), #242 (race-import)',
    }),
  },
  {
    threadId: '1511748952079339520',
    title: 'Attribut-farver: darkmode-læsbarhed + toggle mellem farve-versioner',
    type: 'feature',
    priority: 'low',
    body: body({
      date: '2026-06-03', author: 'stephoslash', threadId: '1511748952079339520',
      text: `Rytter-attributternes farve-gradient er svær at læse — særligt i dark mode. Ønske: enten bedre kontrast eller en toggle mellem "gammel" og "ny" farve-version. Bekræftet af flere (soren1207 i #cycling-zone: "meget uoverskueligt med så mange forskellige farver"; tojosular: det andet tema er nemmere at se). NB: @bobby2106 itererer aktivt på farverne ("intet final endnu") — dette issue er en åben tracker, da #855 (farve-gradient) er lukket.`,
      code: '- `frontend/src/lib/statColor.js:11-22` — `KNOTS` gradient-ankre (71→grøn, 77→gul, 84→pink), tema-uafhængige\n- `frontend/src/lib/statColor.js:57-67` — `statTextColor()` luma-kontrast (sort/hvid på varierende baggrund)\n- `frontend/src/lib/theme.jsx` — tema-detektion (til evt. light/dark KNOTS-sæt)',
      refs: '#855 (ensartet evne-farve-gradient, lukket)',
      extraSource: '**Tværkanal:** også #cycling-zone (soren1207/tojosular/jeppek, 3/6).',
    }),
  },
  {
    threadId: '1501502756077178911',
    title: 'Lån/gældsloft-UX: vis max lånbart beløb (gebyr-inkl.) + mere transparens',
    type: 'feature',
    priority: 'med',
    body: body({
      date: '2026-05-06 → 2026-06-01', author: 'bobby2106 + .sredna + flere', threadId: '1501502756077178911',
      text: `Tilbagevendende UX-forvirring om lån/gældsloft (5-6 spillere har spurgt; @bobby2106 enig i at det skal være mere transparent/fleksibelt):
- Gældsloftet er fx 600.000, men man kan ikke anmode om et lån på 600.000, fordi gebyret inkluderes i lånet. Det er uintuitivt — brugeren prøver bare at låne loftet og får fejl.
- Ønske: UI viser det maksimale lånbare beløb (gebyr-inkluderet) og generelt gør lån/gældsloft mere gennemskueligt.
- Åbent design-spørgsmål fra ejer (oprindelig "Gældsloft"-tråd): hvordan bør gældsloftet sættes — fast %, pr. division, samme på tværs af sæsoner?`,
      code: '- `frontend/src/pages/FinancePage.jsx:88-102` — `loanAmount`-input tager principal; viser ikke max lånbar efter gebyr\n- `backend/lib/loanEngine.js:69-77` — gebyr-beregning (`origination_fee_pct`); lånet medregner gebyr i loft-tjek\n- Forslag: backend returnér `{principalAllowed, fee, totalDebt}`; frontend vis "max lånbar: X (inkl. gebyr)"',
      refs: '#17 (renter/gebyr-design), #45 (mange små lån over loft), #97 (hard-enforcement debt-ceiling)',
      extraSource: '**Tværkanal:** recurring i #spørgsmål-og-svar (rasmusandreasen/_chriskp_/.sredna, 1/6).',
    }),
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
let created = 0, skipped = 0;

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

console.log(`\nDONE apply=${APPLY} created=${created} skipped=${skipped} total=${ISSUES.length}`);
