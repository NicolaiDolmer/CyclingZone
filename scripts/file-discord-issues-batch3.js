#!/usr/bin/env node
/**
 * File 20 remaining Discord-sourced GitHub issues:
 *  - Tier 1 #C #D #E (cybersimon with images)
 *  - Tier 3 with images (4 bobby issues)
 *  - Tier 2 (13 jeppek image-only)
 */
const { execSync } = require('child_process');
const fs = require('fs');

const REPO = 'NicolaiDolmer/CyclingZone';
const GUILD = '474142653529849886';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/docs/discord-attachments`;

const issues = [
  // ============ TIER 1 #C #D #E (cybersimon with images) ============
  {
    id: 'tier1-c',
    threadId: '1500511461003366402',
    title: '[bug] Garanteret salg blokerer bud når man har 10 ryttere',
    labelType: 'bug',
    author: 'cybersimon',
    threadTitle: 'Sikkert salg gør du ikke kan byde på andre hvis han er nr. 10',
    timestamp: '2026-05-03',
    text: '*"Ved garanteret salg kan du ikke byde hvis du havde 10 rytter før salg."*\n\nNår en manager har 10 ryttere og ét garanteret salg er pending, blokeres bud på andre auktioner — selv om det garanterede salg vil frigive trupplads.',
    images: ['1500511461003366402-1500511466111897630.png'],
    files: [
      '`backend/lib/auctionFinalization.js` — bud-validering tjekker squad-cap',
      '`frontend/src/pages/AuctionPage.jsx` — UI disabler bud-knap',
    ],
    notes: 'Reservation-logikken bør tage højde for pending garanteret salg når den beregner "tilgængelig trupplads". Aktuelt regner den salget som ikke-eksisterende indtil finalize, hvilket blokerer parallel bidding.',
    acceptance: [
      'Manager med 10 ryttere + 1 pending garanteret salg KAN byde på anden auktion',
      'Bud-validering trækker pending-garanteret-salg fra squad-count',
      'Test: opsæt scenario, bekræft bud accepteres',
    ],
  },
  {
    id: 'tier1-d',
    threadId: '1500960022270836867',
    title: '[bug] Bestyrelsen — minus-points for bedre placering i ligaen',
    labelType: 'bug',
    author: 'cybersimon',
    threadTitle: 'Værdier der ikke giver mening i bestyrelsen',
    timestamp: '2026-05-04',
    text: '*"Får mere minus for at være placeret bedre i ligen."*\n\nBestyrelsens scoring er inverteret: bedre placering i ligaen giver flere minus-points end dårligere placering.',
    images: ['1500960022270836867-1500960028687995071.png'],
    files: [
      '`backend/lib/boardEngine.js` — scoring-logik for placerings-mål',
      '`backend/lib/boardRequests.js`',
      '`backend/lib/boardEngine.test.js` — tilføj test der fanger inverteret scoring',
    ],
    notes: 'Sandsynlig årsag: sign-fejl i delta-beregning eller inverteret target-vs-actual-comparison. Memory note: bestyrelses-systemet har 1yr+3yr+5yr parallel plans (v1.40).',
    acceptance: [
      'Bedre placering = højere (eller mere positiv) board-score',
      'Test der specifikt verificerer at score(div=1, pos=1) > score(div=1, pos=10)',
      'Eksisterende manager-data: re-scor og verificér ingen falsk-negative',
    ],
  },
  {
    id: 'tier1-e',
    threadId: '1501315801133879337',
    title: '[bug] Gældsforhandling gør intet ved klik',
    labelType: 'bug',
    author: 'cybersimon',
    threadTitle: 'Forhandling virker ikke',
    timestamp: '2026-05-05',
    text: '*"Når man forhandler gæld sker der intet."*\n\nForhandlings-knap/flow til gæld giver ingen synlig respons (ingen UI-feedback, ingen ændring i lån-state).',
    images: ['1501315801133879337-1501315807228072117.png'],
    files: [
      '`backend/lib/loanEngine.js` — forhandlings-endpoint',
      '`backend/routes/api.js` — er endpoint registreret?',
      'Frontend: forhandlings-dialog/-knap, error-handling for fejlede API-kald',
    ],
    notes: 'Sandsynlige årsager: (a) endpoint mangler eller returnerer 404, (b) frontend swallow\'er error, (c) success-respons mangler UI-update.',
    acceptance: [
      'Forhandlings-knap giver synlig feedback (success eller fejlbesked)',
      'Hvis forhandling lykkes: lån-state opdateres real-time',
      'Hvis forhandling fejler: klar fejlbesked til manager',
    ],
  },

  // ============ TIER 3 BOBBY WITH IMAGES (4 issues) ============
  {
    id: 'tier3-speaks',
    threadId: '1495102203990642708',
    title: '[bug] Fejl i speaks (rytter-evne)',
    labelType: 'bug',
    author: 'bobby2106',
    threadTitle: 'Fejl med speaks',
    timestamp: '2026-04-18',
    text: '*"Se billede. Fejl i speaks."*\n\nFejl relateret til "speaks"-evnen på ryttere. Original screenshot var embedded som CDN-link i message body (ikke attachment), så den er muligvis ikke længere tilgængelig.',
    images: [], // No real attachment, only embedded link
    files: [
      'Frontend: rytter-detalje-side, evne-visning',
      'Backend: rytter-import / -seed-data',
      '`docs/DOMAIN_REFERENCE.md` for evne-definitioner',
    ],
    notes: 'Vag — bobby har originalt billede uden for tråden. Bobby tilføjer beskrivelse efter triage.',
    acceptance: [
      'Bobby specificerer hvad fejlen i speaks er',
      'Identificér årsag og fix',
      'Test',
    ],
  },
  {
    id: 'tier3-salgmin',
    threadId: '1496263138364883017',
    title: '[feature] Tillad salg af rytter under division-minimum i transfer-vinduet',
    labelType: 'feature',
    author: 'bobby2106',
    threadTitle: 'Salg af rytter - Komme under minimum',
    timestamp: '2026-04-21',
    text: '*"Det skal være muligt at sælge en rytter, sådan man kommer under minimum af ryttere i løbet af vinduet. Du må være ikke være under minimum, når sæsonen starter. Lav funktion til dette."*\n\nManager skal kunne sælge ned under division-minimum midlertidigt under transfer-vinduet — så længe holdet er over minimum når sæsonen starter.',
    images: ['1496263138364883017-1496263177246347314.png'],
    files: [
      '`backend/lib/transferExecution.js` — minimum-rytter-validering',
      'Sæson-start cron: skal blokere start hvis et hold er under min',
      'Frontend: sælg-dialog skal advare hvis man går under min',
    ],
    acceptance: [
      'Salg under division-minimum er TILLADT under transfer-vindue',
      'UI viser advarsel ("Du er under minimum — fyld op før sæson-start")',
      'Sæson-start blokeres for hold under min (med klar fejlbesked til admin/manager)',
    ],
  },
  {
    id: 'tier3-forhandles',
    threadId: '1496576763860484196',
    title: '[bug] Burde ikke kunne forhandles (skærmbillede)',
    labelType: 'bug',
    author: 'bobby2106',
    threadTitle: 'Burde ikke kunne forhandles',
    timestamp: '2026-04-22',
    text: 'Skærmbillede uden tekst — kontekst tyder på forhandlings-flow tilgængelig i en situation hvor det ikke burde være muligt.',
    images: ['1496576763860484196-1496576768230821959.png'],
    notes: 'Bobby tilføjer beskrivelse efter inspektion af skærmbillede.',
    files: [
      'Sandsynligvis transfer- eller lån-forhandlings-flow',
      '`backend/lib/transferExecution.js` eller `loanEngine.js`',
    ],
  },
  {
    id: 'tier3-passwordreset',
    threadId: '1496621137130422432',
    title: '[bug] Fejl ved password reset (skærmbillede)',
    labelType: 'bug',
    author: 'bobby2106',
    threadTitle: 'Fejl ved password reset',
    timestamp: '2026-04-22',
    text: 'Skærmbillede af fejl i password-reset-flow. Relateret til Issue #11 (Glemt password-link mangler).',
    images: ['1496621137130422432-1496621142314713109.png'],
    files: [
      '`frontend/src/pages/ResetPasswordPage.jsx`',
      'Supabase auth `resetPasswordForEmail()` integration',
    ],
    notes: 'Sammenhænger med #11 — løs forløbet samlet.',
  },

  // ============ TIER 2 JEPPEK IMAGE-ONLY (13 issues) ============
  {
    id: 't2-potentiale',
    threadId: '1501336583679381604',
    title: '[bug] Ryttere uden potentiale (skærmbillede)',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Ryttere uden potentiale',
    timestamp: '2026-05-05',
    text: 'Skærmbillede fra jeppek\'s bug-bash 2026-05-05. Ryttere mangler potentiale-værdi.',
    images: ['1501336583679381604-1501336588444110979.png'],
    files: [
      'UCI-import / rytter-seed (potentiale-feltet udfyldes ved import?)',
      '`scripts/uci_scraper.py` for hvilke felter der trækkes',
    ],
  },
  {
    id: 't2-lon',
    threadId: '1501342366869618899',
    title: '[bug] Fejl i løn (skærmbillede)',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Fejl i løn',
    timestamp: '2026-05-05',
    text: 'Skærmbillede af løn-fejl. Bemærk: SALARY_RATE = 0.10 er GENERATED kolonne (kan ikke skrives fra app, jf. v2.25).',
    images: ['1501342366869618899-1501342372749906000.png'],
    files: [
      '`database/2026-05-04-salary-generated-column.sql`',
      '`backend/lib/economyConstants.js` (SALARY_RATE = 0.10)',
      'Frontend lønvisning',
    ],
  },
  {
    id: 't2-fejlauk',
    threadId: '1501342816721309819',
    title: '[bug] Fejlvisning under auktioner (skærmbillede)',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Fejlvisning under auktioner',
    timestamp: '2026-05-05',
    text: 'Skærmbillede fra jeppek\'s bug-bash. UI-fejl under auktion-visning.',
    images: ['1501342816721309819-1501342820521349221.png'],
    files: ['Frontend auction-visning'],
  },
  {
    id: 't2-vagthojde',
    threadId: '1501342989232898108',
    title: '[bug] Fejl i vægt og højde på nogle ryttere (skærmbilleder)',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Fejl i vægt ved nogle ryttere og højde',
    timestamp: '2026-05-05',
    text: '*"Fejl i vægt ved nogle ryttere"* + *"Og højde"* (jeppek\'s opfølgning).\n\nNogle ryttere har forkerte vægt- og/eller højde-værdier.',
    images: [
      '1501342989232898108-1501342995117637804.png',
      '1501342989232898108-1501343223358947378.png',
    ],
    files: [
      'UCI-import (`scripts/uci_scraper.py`)',
      '`docs/MEMORY.md` reference: UCI Sheet auto-sync',
      'DB: `riders.weight_kg`, `riders.height_cm` kolonner',
    ],
  },
  {
    id: 't2-mangeklik',
    threadId: '1501343527894913185',
    title: '[bug] Mange auktioner ved hurtige klik efter hinanden (race condition)',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Mange auktioner ved mange klik efter hinanden',
    timestamp: '2026-05-05',
    text: '*"Simon har tremor"* + *"Man kan byde på den ene af dem, og kun føre den"*\n\nVed mange hurtige klik på "opret auktion"-knap oprettes flere identiske auktioner. Manager kan kun føre én af dem.',
    images: [
      '1501343527894913185-1501343532554915860.png',
      '1501343527894913185-1501344903370903703.png',
    ],
    files: [
      'Frontend auction-create-form: mangler debounce eller submit-disable',
      '`backend/routes/api.js` — endpoint mangler idempotency-key check',
    ],
    notes: 'Klassisk dobbelt-submit race. Quick fix: disable submit-knap efter første klik. Robust fix: server-side idempotency-key.',
    acceptance: [
      'Submit-knap disables efter første klik (UI debounce)',
      'Backend afviser duplicate-create requests inden for 2 sek vindue',
      'Test: klikspam fra browser → kun 1 auktion oprettet',
    ],
  },
  {
    id: 't2-fejlauk2',
    threadId: '1501344466437410968',
    title: '[bug] Fejl ved auktioner (skærmbillede)',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Fejl ved auktioner',
    timestamp: '2026-05-05',
    text: 'Generel auktion-fejl uden tekstbeskrivelse. Triage: hvilken specifik fejl?',
    images: ['1501344466437410968-1501344471894196274.png'],
  },
  {
    id: 't2-u23u25',
    threadId: '1501346323503386634',
    title: '[bug] U23-søgning viser U25-kategori under rytter',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Søgning på U23 viser U25 under rytteren. Kun en kategori ved dem',
    timestamp: '2026-05-05',
    text: '*"Søgning på U23 viser U25 under rytteren. Kun en kategori ved dem."*\n\nNår man søger på U23 og åbner en rytter, vises kategorien som U25 (ikke U23). Antagelse: ryttere har én kategori, men UI/filter viser den forkert.',
    images: ['1501346323503386634-1501346330532905010.png'],
    files: [
      'Frontend rytter-detalje: alder/U-kategori-visning',
      'Sandsynlig årsag: alder-tærskler matcher ikke mellem søge-filter og detalje-visning',
    ],
  },
  {
    id: 't2-patchnotes',
    threadId: '1501350653287469086',
    title: '[bug] Patch Notes-side ikke på dansk',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Patch Notes snakker ikke dansk',
    timestamp: '2026-05-05',
    text: '*"Jeg skriver heller ikke latinske ord, så den må lige tage sig sammen."*\n\nPatch Notes-side har engelske/latin-tekster mens resten af spillet er dansk.',
    images: ['1501350653287469086-1501350656970063973.png'],
    files: [
      '`frontend/src/pages/PatchNotesPage.jsx` (per memory: opdateres ved hver brugerrettet commit)',
    ],
    notes: 'Memory: PatchNotesPage skal opdateres med dansk version-tekst efter ENHVER brugerrettet commit. Audit eksisterende notes.',
  },
  {
    id: 't2-balancebud',
    threadId: '1501353203915165766',
    title: '[bug] Lavere balance end aktuelle bud på auktioner',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Lavere balance end aktuelle bud på auktioner',
    timestamp: '2026-05-05',
    text: 'Balance vises lavere end summen af aktive bud. Konsistens-bug i hvordan disponibel balance beregnes.',
    images: [
      '1501353203915165766-1501353219434086502.png',
      '1501353203915165766-1501353220029681744.png',
      '1501353203915165766-1501353220721873118.png',
    ],
    files: [
      '`backend/lib/auctionFinalization.js` — bud-reservation logik',
      'Frontend balance-visning vs. aktive-bud-sum',
    ],
    notes: 'Mulig dobbeltreservation eller mismatch mellem committed balance og pending-bid balance.',
  },
  {
    id: 't2-smalan',
    threadId: '1501355219047415949',
    title: '[bug] Mange små lån kan overstige gældsloftet',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Mange små lån og overstigelse af gældsloftet',
    timestamp: '2026-05-05',
    text: 'Manager kan tage flere små lån der tilsammen overstiger gældsloftet for divisionen.',
    images: [
      '1501355219047415949-1501355222826615016.png',
      '1501355219047415949-1501355223116025996.png',
      '1501355219047415949-1501355223388520498.png',
    ],
    files: [
      '`backend/lib/loanEngine.js` linje 125-127 — `currentDebt + totalOwed > ceiling` race-condition',
      '`docs/archive/ECONOMY_AUDIT_2026-05-07.md` F3 — TOCTOU debt-ceiling',
      'Slice 07b adresserer dette (TOCTOU + DB constraint)',
    ],
    notes: 'Kendt bug — dækket i ECONOMY_AUDIT 2026-05-07 (F3). TOCTOU race i `createLoan`. Slice 07b skal lukke det med DB constraint. Dette issue lukkes når 07b lander.',
    acceptance: [
      'DB CHECK constraint: balance ≥ -debt_ceiling',
      'Atomic loan-creation der ikke kan race',
      'Verificér mod jeppek\'s scenario',
    ],
  },
  {
    id: 't2-balancerefresh',
    threadId: '1501359883163930634',
    title: '[bug] Forskellig balance på UI — løses ved refresh',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Forskellig balance. Løses ved refresh',
    timestamp: '2026-05-05',
    text: 'UI viser forskellige balance-værdier forskellige steder (eller forkert balance der opdateres efter refresh). Klassisk stale-state issue.',
    images: ['1501359883163930634-1501359888167862442.png'],
    files: [
      'Frontend balance-state-management — sandsynligvis manglende invalidation efter mutationer',
      'React Query / SWR cache-keys?',
    ],
    notes: 'Common pattern: efter en transaktion (bud, salg, lån) bliver cached balance ikke invalidated, så forskellige views viser forskellige værdier.',
  },
  {
    id: 't2-fornavn',
    threadId: '1501363934760796282',
    title: '[bug] Søgning på ryttere virker kun på fornavn — ikke for- + efternavn',
    labelType: 'bug',
    author: 'jeppek',
    threadTitle: 'Fejl ved søgning af ryttere. Kan kun søge på fornavn, og ikke efterfølgende efternavn',
    timestamp: '2026-05-05',
    text: '*"Fejl ved søgning af ryttere. Kan kun søge på fornavn, og ikke efterfølgende efternavn."*\n\nNår man søger "Tadej Pog..." matcher den ikke. Kun "Tadej" alene virker.',
    images: ['1501363934760796282-1501363939458416650.png'],
    files: [
      'Backend search-endpoint — sandsynligvis matcher kun mod fornavn-felt',
      'DB: skal søge mod `first_name || \' \' || last_name` (concatenated)',
      'Frontend search-input og query-params',
    ],
    notes: 'Memory: æ/ø/å skal håndteres eksplicit, plus token-set-match (jf. UCI cron memory).',
    acceptance: [
      'Søgning matcher mod fornavn ELLER efternavn ELLER (fornavn + efternavn)',
      'Test: "Tadej Pogačar", "Pogačar", "Tadej" — alle finder rytteren',
      'Æ/ø/å håndteres korrekt',
    ],
  },
  {
    id: 't2-balancetab',
    threadId: '1501358396329164850',
    title: '[feature] Vis balance + aktive transfersummer i auktion-tabben',
    labelType: 'feature',
    author: 'jeppek',
    threadTitle: 'Balance og aktive transfersummer i auktionstabben',
    timestamp: '2026-05-05',
    text: 'Manager-forslag: vis disponibel balance + sum af aktive bud direkte i auktion-tabben (ikke kun i finance-side).',
    images: ['1501358396329164850-1501358401999864039.png'],
    files: [
      'Frontend auction-page header / sidebar',
      'Reuse balance-component fra finance-side',
    ],
    notes: 'Relateret til Tier 2 #balancebud (#)1501353203915165766) — løs balance-konsistens-bug først.',
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
  body += `---\n*Issue oprettet automatisk af Claude fra Discord-feedback (Cycling Career server).*\n`;
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
      const cmd = `gh issue create --repo ${REPO} --title "${titleQ}" --label "claude:todo" --label "type:${issue.labelType}" --body-file ${tmpFile}`;
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
    console.log(`  ✓ ${url}  ${issue.title}`);
    created.push({ id: issue.id, url, title: issue.title });
    success++;
  } else {
    console.log(`  ✗ ${issue.id} FAILED: ${lastErr}`);
    failed.push({ id: issue.id, title: issue.title, error: lastErr });
  }
}

console.log(`\n${success}/${issues.length} created.`);
if (failed.length > 0) {
  console.log('\nFAILURES:');
  failed.forEach(f => console.log(`  - ${f.id}: ${f.title}\n    ${f.error}`));
}
fs.writeFileSync('.tmp_batch3_results.json', JSON.stringify({ created, failed }, null, 2));
