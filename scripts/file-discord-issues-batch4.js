#!/usr/bin/env node
/**
 * File Discord-sourced GitHub issues from batch 4 (2026-05-07 evening).
 * Sources: #samlet-feedback (forum) + #feature-request — primarily jeppek + bobby + cybersimon + soren1207.
 */
const { execSync } = require('child_process');
const fs = require('fs');

const REPO = 'NicolaiDolmer/CyclingZone';
const GUILD = '474142653529849886';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/docs/discord-attachments`;

const issues = [
  // ============ HIGH PRIORITY BUGS (post-v2.64 regressions / regelbrud) ============
  {
    id: 'b4-webhook-autobud',
    threadId: '1502026953992179764',
    title: '[bug] Discord-webhook for autobud (proxy-bidding) sender ingen besked',
    labelType: 'bug',
    priority: 'high',
    author: 'bobby2106',
    threadTitle: 'Webhook i forbindelse med autobud',
    timestamp: '2026-05-07',
    text: '*"Webhooken virker ikke ordentligt sammen med autobud. Der kommer ikke nogen beskeder i kanalen ved brug af autobud."*\n\nEfter v2.64 (proxy-bidding) blev shippet sender Discord-webhook ikke notifikationer når et automatisk bud (proxy) afgives.',
    files: [
      '`backend/lib/proxyBidding.js` — resolver loop afgiver ikke webhook-event ved auto-bid',
      '`backend/lib/discordNotifier.js` — verificér at proxy-bid-events trigger webhook',
      '`backend/lib/auctionFinalization.js` — sammenlign med manuel bid-flow som virker',
    ],
    notes: 'Sandsynligvis manglende `notifyDiscord()`-kald i proxy-bidding resolver-loopet. Se hvordan manuelle bud (PATCH /api/auctions/:id/bid) trigger webhook og spejl flowet.',
    acceptance: [
      'Autobud udløst af proxy-bidding sender Discord-webhook-besked',
      'Webhook-tekst markerer det som autobud (fx "Autobud fra X for Y CZ$")',
      'Test: opsæt 2 proxy-bids på samme auktion, verificér webhook-events i kanalen',
    ],
  },
  {
    id: 'b4-leje-annul',
    threadId: '1502023507628785907',
    title: '[bug] Lejeaftale kan annulleres ensidigt uden modparts accept',
    labelType: 'bug',
    priority: 'high',
    author: 'jeppek',
    threadTitle: 'Skal man kunne annulere uden andet hold er med på den?',
    timestamp: '2026-05-07',
    text: '*"Man kan annullere en lejeaftale, uden modparten giver accept til dette."*\n\nEt aftalt loan_agreement (status `active` eller `pending`) kan annulleres af én part uden den andens accept — bryder kontraktintegritet.',
    images: ['1502023507628785907-1502023517020094574.png'],
    files: [
      '`backend/lib/loanEngine.js` / `backend/lib/loanAgreements.js` — cancel-endpoint',
      'Sammenlign med transfer/swap-cancel-flow (#13 introducerede admin-cancel for window_pending — manager-cancel skal følge samme regel)',
      'Frontend: cancel-knap på loan-aftale',
    ],
    notes: 'Memory: #13 (admin-cancel) målretter `window_pending` deals; manager-side cancel for indgåede loans bør kræve modparts accept eller admin-override. Light konkurs-mekanik (07b lag 1) er ikke relevant her.',
    acceptance: [
      'Manager kan IKKE ensidigt annullere `active` eller `accepted` loan_agreement',
      'Hvis cancel ønskes → kræv modparts accept eller admin-cancel',
      'Audit-log entry ved enhver cancel',
    ],
  },
  {
    id: 'b4-rytter-row-click',
    threadId: '1502021814224949419',
    title: '[bug] Rytter-rækker kan ikke klikkes på /team og /transfers',
    labelType: 'bug',
    priority: 'high',
    author: 'jeppek',
    threadTitle: 'Kan ikke gå ind på rytteren i denne skærm',
    timestamp: '2026-05-07',
    text: '*"Kan ikke trykke på rytterne her."* (gælder både `/team` og `/transfers`)\n\nKlik på en rytter-række åbner ikke rytter-detalje-siden — knapper/links er enten manglende eller blokerede af overlappende elementer.',
    images: ['1502021814224949419-1502021820063420437.png'],
    files: [
      '`frontend/src/pages/MyTeamPage.jsx` (eller tilsvarende `/team`)',
      '`frontend/src/pages/TransfersPage.jsx`',
      'Sammenlign med RidersPage hvor klik virker',
    ],
    notes: 'Sandsynligvis manglende `onClick` / `Link`-wrapper på rider-row-komponent på disse to sider. Andre rider-tables (RidersPage, AuctionsPage) bør være referencepunkt.',
    acceptance: [
      'Klik på rytter-række på `/team` åbner rytter-detalje',
      'Klik på rytter-række på `/transfers` åbner rytter-detalje',
      'Mobile + desktop verificeret',
    ],
  },

  // ============ MEDIUM PRIORITY BUGS ============
  {
    id: 'b4-bytte-leje-rytterside',
    threadId: '1502022740511690955',
    title: '[bug] Kan ikke tilbyde byttehandel/leje fra rytter-profil for andres ryttere',
    labelType: 'bug',
    priority: 'med',
    author: 'jeppek + cybersimon',
    threadTitle: 'Kan kun lave transferbud på andres ryttere',
    timestamp: '2026-05-07',
    text: '*"Det er ikke muligt at spørge om byttehandel eller lejeaftale på rytterprofilerne ved andres ryttere."*\n\nNår man åbner en anden managers rytter-profil, vises kun transferbud-knappen — byttehandel- og leje-tilbud-knapper mangler.\n\nSamme bug rapporteret af cybersimon på mobil ([anden tråd](https://discord.com/channels/' + GUILD + '/1502023057454141710)).',
    images: [
      '1502022740511690955-1502022747197538415.png',
      '1502023057454141710-1502023086843629641.jpg',
    ],
    files: [
      '`frontend/src/pages/RiderProfilePage.jsx` — action-knapper for andres ryttere',
      'Sammenlign med TransfersPage hvor alle 3 typer (transfer/swap/loan) er tilgængelige',
    ],
    acceptance: [
      'Rytter-profil for anden managers rytter viser: Transferbud + Byttehandel + Leje',
      'Knapper åbner samme dialog/flow som fra TransfersPage',
      'Mobile + desktop',
    ],
  },
  {
    id: 'b4-modbud-modbud',
    threadId: '1502022537310371871',
    title: '[bug] Modbud kan ikke afgives på byttehandel efter modparten har modbudt',
    labelType: 'bug',
    priority: 'med',
    author: 'jeppek',
    threadTitle: 'Ingen modbyd efter modbyd',
    timestamp: '2026-05-07',
    text: '*"Det er ikke muligt at lave et modbud på en byttehandel, efter en anden har lavet et modbud til dig."*\n\nForhandlings-loop på swap_offers stopper efter første counter — man kan ikke counter-counter.',
    images: ['1502022537310371871-1502022542112723234.png'],
    files: [
      '`backend/routes/api.js` — swap-offer counter-endpoint',
      '`backend/lib/swapEngine.js` (hvis eksisterer)',
      'Frontend swap-dialog: counter-knap state-håndtering',
    ],
    notes: 'Sandsynligvis state-machine der låser swap til `countered`-status uden at tillade nye counters. Skal være: counter → counter → counter → accept/reject.',
    acceptance: [
      'Byttehandel tillader ubegrænset modbud-cyklus indtil accept eller reject',
      'UI viser tydelig forhandlings-historik',
    ],
  },
  {
    id: 'b4-leje-over-1-saeson',
    threadId: '1502019650131726356',
    title: '[bug] Lejeaftale kan oprettes med over 1 sæsons varighed (regelbrud)',
    labelType: 'bug',
    priority: 'med',
    author: 'jeppek',
    threadTitle: 'Muligt at leje i over 1 sæson',
    timestamp: '2026-05-07',
    text: 'Lejeaftale kan oprettes med varighed > 1 sæson. Spillereglen tillader maks 1 sæson per lejeaftale.',
    images: ['1502019650131726356-1502019655202770964.png'],
    files: [
      '`backend/lib/loanEngine.js` / `backend/lib/loanAgreements.js` — validering ved create',
      'Frontend loan-create-form — duration-input',
      'Skema: hvor håndhæves `duration_seasons <= 1`?',
    ],
    acceptance: [
      'Backend afviser loan-create med duration > 1 sæson (400 + dansk fejlbesked)',
      'Frontend disabler/clamper duration-input til max 1',
      'Test: forsøg på 2-sæsons-lejeaftale → afvist',
    ],
  },
  {
    id: 'b4-undefined-holdnavn',
    threadId: '1502018453358248127',
    title: '[bug] "Undefined" holdnavn vises i transferhistorik (i stedet for AI/fri transfer)',
    labelType: 'bug',
    priority: 'low',
    author: 'jeppek',
    threadTitle: '"Undefined" holdnavn i stedet for AI eller fri transfer under transferhistorik',
    timestamp: '2026-05-07',
    text: 'Transferhistorik viser holdnavnet som "Undefined" i stedet for at vise AI-hold eller markere det som fri transfer.',
    images: ['1502018453358248127-1502018459427536966.png'],
    files: [
      'Frontend transferhistorik-komponent — fallback-logik for null/missing team',
      'Backend public-history endpoint — verificér at AI-team og free-agent får eksplicit label',
    ],
    notes: 'Klassisk JS-bug: `team?.name` resolves til `undefined` og rendres som string. Skal have eksplicit fallback: AI → "AI-hold", null → "Fri transfer".',
    acceptance: [
      'Transferhistorik viser aldrig literal "Undefined"',
      'AI-hold vises som fx "AI-hold" eller specifikt AI-team-navn',
      'Free-agent / unsigned vises som "Fri transfer"',
    ],
  },
  {
    id: 'b4-alder-mangler',
    threadId: '1502016899024687104',
    title: '[bug] Alder-felt mangler på rytterside (regression efter #108)',
    labelType: 'bug',
    priority: 'med',
    author: 'bobby2106',
    threadTitle: 'Alder er væk fra ryttersiden. Skal tilbage',
    timestamp: '2026-05-07',
    text: '*"Alder er væk fra ryttersiden. Skal tilbage."*\n\nEfter #108 fix (alder-visning rettet til racing-age) er alder-feltet helt forsvundet fra `RiderStatsPage` / rytter-profil.',
    files: [
      '`frontend/src/pages/RiderStatsPage.jsx` — verificér alder-felt i rendering',
      '#108-fix commit `470383a` — kig efter utilsigtet fjernelse af visning',
    ],
    notes: 'Memory note: #108 ændrede formel fra eksakt fødselsdato til `CURRENT_YEAR - birth_year`. Hvis felt-renderingen blev fjernet ved et uheld, skal den tilbage med ny formel.',
    acceptance: [
      'Alder vises på rytter-profil',
      'Alder bruger racing-age-formel (samme som filter, U23, U25)',
      'Verificér efter v2.58-fix at den kun blev midlertidigt skjult, ikke fjernet',
    ],
  },
  {
    id: 'b4-rytterside-mobil',
    threadId: '1502000571127697458',
    title: '[ux/bug] Ryttersiden er ikke responsiv på mobil',
    labelType: 'bug',
    priority: 'med',
    author: 'bobby2106',
    threadTitle: 'Ryttersiden skal mobiloptimeres',
    timestamp: '2026-05-07',
    text: '*"Ryttersiden skal mobiloptimeres. Virker ikke særligt godt fra telefon. Den er ikke responsiv."*\n\nRytter-detalje-siden er ikke optimeret til mobile viewports.',
    files: [
      '`frontend/src/pages/RiderStatsPage.jsx` (eller `RiderProfilePage.jsx`)',
      'Tailwind-breakpoints: `sm:`, `md:` udnyttes ikke konsistent',
      'Sammenlign med MobileQuickNav (#66) hvor mobile-first allerede er etableret',
    ],
    acceptance: [
      'Rytter-side er læsbar på 360px viewport',
      'Stat-tabel scroller horisontalt eller stacker pænt',
      'Action-knapper (bud, byttehandel, leje) er touch-venlige',
    ],
  },

  // ============ UX / FILTER BUGS ============
  {
    id: 'b4-evne-filter-slider',
    threadId: '1501869730934554664',
    title: '[ux/bug] Rytter evne-filter slider hopper ved drag (live re-render)',
    labelType: 'bug',
    priority: 'low',
    author: 'soren1207',
    threadTitle: 'Rytter evne filter, kan være mere smooth',
    timestamp: '2026-05-07',
    text: '*"Når man forsøger at benytte evnefilteret, kan det være svært at være meget præcis, da siden indlæser mens man trækker i sliders, hvilket gør at den kan hoppe over det tal man forsøger at ramme."*\n\nTest: åbn ryttersiden og forsøg at ændre min UDH mellem 74, 75, 76, 77, 78. Slider hopper pga. live-fetch ved hver onChange.',
    files: [
      '`frontend/src/pages/RidersPage.jsx` — slider-komponent',
      'Sandsynligvis: skift fra `onChange` til `onChangeCommitted` eller debounce 200-300ms',
    ],
    acceptance: [
      'Slider kan trækkes smoothly uden at hoppe',
      'Re-fetch trigger først efter slider-release (onChangeCommitted) eller efter debounce',
      'Test: præcist sæt min UDH til 75 uden at hoppe til 74 eller 76',
    ],
  },

  // ============ FEATURES ============
  {
    id: 'b4-board-overall-bar',
    threadId: '1501238549586907157',
    title: '[feature] Bestyrelsens overall tilfredshed som progress bar',
    labelType: 'feature',
    priority: 'low',
    author: 'cybersimon',
    threadTitle: 'Bestyrelsens tilfredshed nu og her overall',
    timestamp: '2026-05-05',
    text: '*"Kan man få en bar med bestyrelsens overall tilfredshed som den ser ud efter seneste sæson eller update."*\n\nEt overall-progress-bar visualiserer aktuel bestyrelses-tilfredshed sammenlagt på tværs af 1yr+3yr+5yr planer.',
    files: [
      '`frontend/src/pages/BoardPage.jsx`',
      'Memory: #102 (Visualisér bestyrelsens 9 personality-types) er relateret',
      'Aggreger fra de 3 parallelle plans (#1yr/3yr/5yr)',
    ],
    notes: 'Relateret til #101 (Vis bestyrelsens konkrete effekter) og #102. Kan grupperes ind i bestyrelses-UI-overhaul.',
    acceptance: [
      'Overall-bar synlig øverst på BoardPage',
      'Værdi reflekterer seneste sæson-update',
      'Tooltip eller dropdown kan vise breakdown per plan',
    ],
  },
  {
    id: 'b4-hojreklik-rytter',
    threadId: '1500973245799596222',
    title: '[ux/feature] Højreklik på rytter → åbn i ny fane',
    labelType: 'feature',
    priority: 'low',
    author: 'cybersimon',
    threadTitle: 'Højre klikke på ryttere',
    timestamp: '2026-05-04',
    text: '*"Højre klikke så man kan åbne ryttere i en ny fane."*\n\nRytter-rækker bruger `onClick` med JS-navigation; for at understøtte browser-native "Åbn i ny fane" skal de være `<a href="...">` eller `<Link>` så Cmd/Ctrl-klik virker.',
    files: [
      'Alle steder hvor rider-rows har `onClick={() => navigate(...)}`',
      'Skift til `<Link to="/riders/:id">` (React Router) — bevarer SPA-navigation + understøtter højreklik',
    ],
    acceptance: [
      'Højreklik på rytter-række → "Åbn link i ny fane" virker',
      'Cmd/Ctrl-klik → ny fane',
      'Almindeligt klik bevarer SPA-navigation',
    ],
  },
  {
    id: 'b4-board-mal-rakkefolge',
    threadId: '1500594045624516670',
    title: '[ux] Bestyrelsesmål-rækkefølge: 1yr først, 3yr i midten, 5yr nederst',
    labelType: 'feature',
    priority: 'low',
    author: 'cybersimon',
    threadTitle: 'Feedback på bestyrelse siden',
    timestamp: '2026-05-03',
    text: '*"1 årige bestyrelse mål kommer først, der næst 3 årige og 5 årige nederest."*\n\nVisuel rækkefølge på BoardPage skal matche tidshorisont — kortest først.',
    files: [
      '`frontend/src/pages/BoardPage.jsx` — sortering af de 3 parallelle plans',
    ],
    acceptance: [
      'BoardPage viser 1yr → 3yr → 5yr i denne rækkefølge fra top til bund',
      'Mobile + desktop',
    ],
  },
  {
    id: 'b4-lobsudgave-kalender',
    threadId: '1499747450045599885',
    title: '[feature] Vis hvilken løbsudgave/årgang i Løbskalenderen',
    labelType: 'feature',
    priority: 'low',
    author: 'soren1207',
    threadTitle: 'Løbsudgave i Løbskalenderen',
    timestamp: '2026-05-01',
    text: '*"En feature så man kan se hvilken udgave/årgang af løbet der skal køres."*\n\nLøbskalender viser ikke hvilken edition/årgang det aktuelle løb er (fx "Tour de France 2024 udgave" hvis spillet kører historiske data).',
    files: [
      '`frontend/src/pages/RaceCalendarPage.jsx` (eller tilsvarende)',
      'Backend: hvilken edition/year-felt er tilgængelig på race-record?',
      'UCI-import (memory: scraper henter fra UCI Google Sheet)',
    ],
    notes: 'Memory: UCI-historik (Slice 14) bygger arkitekturen for år/edition-data. Denne feature kan vente til 14 frontend Del C lander.',
    acceptance: [
      'Hvert løb i kalenderen viser edition (fx "2024-udgave" eller "111. udgave")',
      'Tooltip kan vise tidligere vindere af samme edition',
    ],
  },

  // ============ FOLLOW-UP ON SHIPPED FEATURES ============
  {
    id: 'b4-10pct-increment',
    threadId: '1500209380413407343',
    title: '[design] Genovervej 10%-bud-increment-regel nu hvor proxy-bidding er live',
    labelType: 'investigation',
    priority: 'low',
    author: '.sredna + bobby2106',
    threadTitle: 'Forbedring til budsystemet',
    timestamp: '2026-05-07',
    text: '*"Der er generelt ingen grund til at have 10% grænser, hvis den der funktion (proxy-bidding) er der."* — .sredna\n\nOprindeligt var 10%-increment-reglen tilføjet for at undgå "1-over"-spam. Med v2.64 (#10) proxy-bidding live er argumentet svækket — manager kan sætte max-loft i stedet for at byde 1 over manuelt.\n\nbobby: *"Lige nu er det bevidst at det er blevet bevaret, så det er ensartet i spillet."* — vil observere før evt. ændring.',
    images: ['1500209380413407343-1502026841706201119.png'],
    files: [
      '`backend/lib/auctionRules.js` / `backend/lib/auctionFinalization.js` — bid-validering 10%-min',
      '#10 (proxy-bidding shipped som v2.64)',
    ],
    notes: 'Investigations-issue: vent og se om proxy-bidding adoption tager hånd om 1-over-problemet, eller om 10%-reglen kan slækkes til mindre fast increment (fx 1% min).',
    acceptance: [
      'Triage: indsamle data på hvor ofte proxy-bidding bruges efter 1-2 uger',
      'Beslut: behold 10%, slæk til X%, eller fjern helt',
      'Hvis ændring: opdatér både backend-validation og UI-min-hint',
    ],
  },
];

function generateBody(i) {
  const channelLink = `https://discord.com/channels/${GUILD}/${i.threadId}`;
  let body = `## Symptom\n\n${i.text || 'Skærmbillede uden tekstbeskrivelse — se attached billede.'}\n\n`;
  body += `## Discord-kontekst\n\n**Tråd:** [${i.threadTitle}](${channelLink})\n**Rapporteret af:** ${i.author} (${i.timestamp})\n\n`;

  if (i.images && i.images.length > 0) {
    body += `## Skærmbillede${i.images.length > 1 ? 'r' : ''}\n\n`;
    for (const img of i.images) {
      body += `![${img}](${RAW_BASE}/${img})\n\n`;
    }
  }

  if (i.notes) {
    body += `## Note\n\n${i.notes}\n\n`;
  }

  if (i.files && i.files.length > 0) {
    body += `## Filer at tjekke\n\n${i.files.map(f => '- ' + f).join('\n')}\n\n`;
  }

  const accept = i.acceptance || [
    'Triage og specificér problem ud fra skærmbillede + manager-feedback',
    'Identificér årsag i kode',
    'Implementér fix + test',
  ];
  body += `## Acceptkriterier\n\n${accept.map(a => '- [ ] ' + a).join('\n')}\n\n`;
  body += `---\n*Issue oprettet automatisk af Claude fra Discord-feedback (Cycling Career server, batch 4 — 2026-05-07).*\n`;
  return body;
}

let success = 0;
const failed = [];
const created = [];

for (const issue of issues) {
  const body = generateBody(issue);
  const tmpFile = `.tmp_${issue.id}.md`;
  fs.writeFileSync(tmpFile, body);

  let url = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const titleQ = issue.title.replace(/"/g, '\\"');
      const labels = ['claude:todo', `type:${issue.labelType}`, `priority:${issue.priority || 'med'}`].join(',');
      const cmd = `gh issue create --repo ${REPO} --title "${titleQ}" --label "${labels}" --body-file ${tmpFile}`;
      url = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      break;
    } catch (e) {
      lastErr = e.message;
      if (attempt < 3) {
        try { execSync('sleep 2'); } catch (_) {}
      }
    }
  }

  try { fs.unlinkSync(tmpFile); } catch (_) {}

  if (url) {
    console.log(`  + ${url}  ${issue.title}`);
    created.push({ id: issue.id, url, title: issue.title });
    success++;
  } else {
    console.log(`  X ${issue.id} FAILED: ${lastErr}`);
    failed.push({ id: issue.id, title: issue.title, error: lastErr });
  }
}

console.log(`\n${success}/${issues.length} created.`);
if (failed.length > 0) {
  console.log('\nFAILURES:');
  failed.forEach(f => console.log(`  - ${f.id}: ${f.title}\n    ${f.error}`));
}
fs.writeFileSync('.tmp_batch4_results.json', JSON.stringify({ created, failed }, null, 2));
