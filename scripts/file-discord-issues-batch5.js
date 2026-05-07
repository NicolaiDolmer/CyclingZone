#!/usr/bin/env node
/**
 * File Discord-sourced GitHub issues from batch 5 (2026-05-07 sen aften).
 * Source: #samlet-feedback-features-og-bugs (1501501095325732925) — proxy-bidding
 * regression cluster + indbakke cache-bug. 7 tråde bundlet til 6 issues.
 *
 * Kontekst: v2.64 (#10 proxy-bidding) shipped 2026-05-07 — flere managers (cybersimon,
 * jeppek, bobby2106) rapporterer regressioner i auto-bud og bid-validation samme aften.
 */
const { execSync } = require('child_process');
const fs = require('fs');

const REPO = 'NicolaiDolmer/CyclingZone';
const GUILD = '474142653529849886';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/docs/discord-attachments`;

const issues = [
  // ============ PROXY-BIDDING REGRESSION CLUSTER (v2.64) ============
  {
    id: 'b5-autobud-follows-not',
    threadId: '1502041570764132483',
    title: '[bug] Auto-bud følger ikke med op når andre byder markant over (proxy-bidding regression)',
    labelType: 'bug',
    priority: 'high',
    author: 'cybersimon + jeppek',
    threadTitle: 'Auto bud bug / Autobyd',
    timestamp: '2026-05-07',
    text: '*"Auto bud virker ikke hvis man byder markant over det nuværende bud. Det ligner at den kun virker hvis der bliver budt 10% over [og] også aktiveres auto budet hvis der er 10% over det nye bud."* — cybersimon\n\n*"Virker ikke optimalt. Følger ikke med op, når en anden byder på rytteren, så fører man den ikke, selvom ens autobud er langt højere end 10%."* — jeppek (https://cycling-zone.vercel.app/auctions)\n\nTo uafhængige rapporter af samme symptom: proxy-bidding resolver-loopet matcher kun når new bid er præcis 10% over auto-bud-trigger; ved markant højere bud bliver auto-budet ikke aktiveret selvom max-loftet er langt højere.',
    files: [
      '`backend/lib/proxyBidding.js` — resolver loop / trigger-condition (mistænkes at bruge `===` eller fast 10%-step i stedet for `<= max_amount`)',
      '`backend/lib/auctionRules.js` — 10%-increment-regel interaktion med proxy-bid auto-step',
      '#10 (proxy-bidding shipped som v2.64 i PR #153)',
    ],
    notes: 'Cross-link: relateret til #155 (webhook missing) og #169 (10%-increment design-overvejelse). Sandsynligvis samme rod-årsag: proxy-bidding-loop respekterer ikke at ny manuel bid kan være >10% over og bør stadig trigge mod max-loftet.',
    acceptance: [
      'Auto-bud trigges altid når en ny manuel/auto bid < ens max-loft, uanset størrelse',
      'Test: A sætter auto-bud max 100K. B byder manuelt 80K (markant over min-step). A skal automatisk byde 80K + min-step',
      'Test: A sætter auto-bud max 100K. B sætter auto-bud max 200K. Resolver opløser til min(maxA + step, maxB)',
    ],
  },
  {
    id: 'b5-autobud-must-be-leading',
    threadId: '1502044264765456494',
    title: '[bug] Auto-bud kan ikke afgives medmindre du allerede fører auktionen',
    labelType: 'bug',
    priority: 'high',
    author: 'cybersimon',
    threadTitle: 'Man skal fører en auktion for at kunne ligge et auto bud',
    timestamp: '2026-05-07',
    text: '*"Hvis man ikke selv står til at vinde en auktion får man en fejl ved forsøg på at ligge et auto bud."*\n\nProxy-bidding endpoint returnerer fejl hvis manager ikke allerede er højest-bydende. Forventet adfærd: man kan oprette/opdatere auto-bud max-loft uafhængigt af aktuel leader-status — det er hele pointen med proxy-bidding (sæt loft, gå offline).',
    files: [
      '`backend/routes/api.js` — POST/PATCH proxy-bid endpoint validation',
      '`backend/lib/proxyBidding.js` — guard mod ikke-leader-managers',
    ],
    notes: 'Sandsynligvis en if-guard der tjekker `currentLeader === managerId` og afviser ellers. Skal fjernes — proxy-bidding skal accepteres uanset aktuel position.',
    acceptance: [
      'Manager kan oprette auto-bud-max-loft uden at være aktuel leader',
      'Resolver auto-stepper op til loftet umiddelbart efter opsætning hvis det overgår nuværende top-bid',
      'Manuel bid + proxy-bid fra samme manager kan eksistere samtidigt',
    ],
  },
  {
    id: 'b5-autobud-rounding',
    threadId: '1502043822841135116',
    title: '[bug] Auto-bud overholder ikke afrundings-regel og kan derfor ikke afgive bud',
    labelType: 'bug',
    priority: 'high',
    author: 'cybersimon',
    threadTitle: 'Auto bud overholder ikke afrundingsregl og kan derfor ikke give bud',
    timestamp: '2026-05-07',
    text: 'Skærmbillede uden tekstbeskrivelse — auto-bud-resolver beregner et bid-beløb der ikke overholder afrundings-reglen (sandsynligvis 1K- eller 5K-step) og afvises derfor af bid-validation.',
    images: ['1502043822841135116-1502043827693686825.png'],
    files: [
      '`backend/lib/proxyBidding.js` — resolver auto-step beregning (mangler runding til nærmeste valid-step)',
      '`backend/lib/auctionRules.js` — afrundings-regel og bid-amount-validation',
    ],
    notes: 'Symptom: resolver foreslår fx 80.001 hvor 80.000 ville være valid. Mangler `Math.ceil(amount / step) * step` eller tilsvarende clamp. Cross-link til [b5-autobud-follows-not](#) og [#169](https://github.com/NicolaiDolmer/CyclingZone/issues/169).',
    acceptance: [
      'Auto-bud-resolver afgiver kun bid-beløb der overholder afrundings-reglen',
      'Hvis beregnet bid ikke kan opfylde både afrunding + 10%-min, afvises bud GRACEFULT (ikke 500)',
      'Test: opsæt auto-bud med max ikke-deleligt med step-størrelse, verificér at bud afgives med korrekt afrunding',
    ],
  },
  {
    id: 'b5-autobud-managerejet-fejl',
    threadId: '1502042565988450384',
    title: '[bug] Generisk fejl uden besked ved bud på Ruslan Mustafayev (managerejet rytter)',
    labelType: 'bug',
    priority: 'med',
    author: 'bobby2106',
    threadTitle: 'Autobud på en managerejet rytter - Fejl',
    timestamp: '2026-05-07',
    text: '*"Jeg får fejl ved at byde på: Ruslan Mustafayev. Men mangler fejlmeddelse, så jeg ved hvad jeg gør galt."*\n\nFejl uden brugbar besked når der lægges (auto-)bud på en specifik managerejet rytter. UX-problem: backend afviser uden at fortælle hvorfor → manager kan ikke selv-diagnosticere.',
    images: ['1502042565988450384-1502042571487051986.png'],
    files: [
      '`backend/routes/api.js` — bid-endpoint error-response (mangler dansk besked på `error` felt)',
      '`frontend/src/pages/AuctionsPage.jsx` (eller proxy-bid-dialog) — error-rendering',
      'Sammenlign med hvordan andre fejl (utilstrækkelig saldo, gældsloft) viser besked',
    ],
    notes: 'Mulig duplikat af [b5-autobud-must-be-leading](#) hvis Ruslan Mustafayev allerede har anden manager som leader — men selv hvis så, skal fejlbesked være eksplicit. Test også med rytter på andres hold uden auktion åben.',
    acceptance: [
      'Alle bid-rejection-paths returnerer dansk error-besked på `error` felt',
      'Frontend viser besked til manager (toast eller form-error)',
      'Specifik test: forsøg bud på Ruslan Mustafayev → reproducer + identificér root-cause → eksplicit besked',
    ],
  },
  {
    id: 'b5-bid-match-price-blocked',
    threadId: '1502029191233802371',
    title: '[bug] Manuel bud blokeres af 10%-increment-regel ved match-pris (sat-til-salg-for)',
    labelType: 'bug',
    priority: 'high',
    author: 'cybersimon',
    threadTitle: 'Kan ikke byde pris rytter er sat til salg for',
    timestamp: '2026-05-07',
    text: '*"Man skal byde 10% over den værdi som en rytter er sat til salg for."*\n\nNår en rytter er listet med en eksplicit "sat-til-salg-for"-pris, blokerer 10%-increment-reglen at man byder PRÆCIS prisen. Skal kunne match-bide asking price (= 1. bud) — 10%-step gælder først for efterfølgende over-bud.',
    images: ['1502029191233802371-1502029220337942538.jpg'],
    files: [
      '`backend/lib/auctionRules.js` — bid-validation: 10%-increment skal gælde fra 1. faktiske bid, ikke fra asking-price',
      '`frontend/src/pages/AuctionsPage.jsx` — bid-input min-value når der ikke er bud endnu',
    ],
    notes: 'Cross-link til [#169](https://github.com/NicolaiDolmer/CyclingZone/issues/169) (10%-increment-design-overvejelse). Forskel: dette er en konkret bug-rapport (manager kan ikke byde asking-price) — #169 er bredere designdiskussion.',
    acceptance: [
      'Manager kan byde præcis asking-price når der ikke er andre bud',
      '10%-increment-reglen aktiveres først efter 1. bud er afgivet',
      'Test: rytter listet til 50K, ingen bud — bud på 50K skal accepteres',
    ],
  },

  // ============ FRONTEND CACHE / UI BUG ============
  {
    id: 'b5-indbakke-counter-stale',
    threadId: '1502029625986125905',
    title: '[bug] Indbakke "ulæste"-counter invalideres ikke efter sletning (kræver F5)',
    labelType: 'bug',
    priority: 'low',
    author: 'jeppek',
    threadTitle: '"Ulæste beskeder" fjernes ikke ved indbakken, når alle er væk',
    timestamp: '2026-05-07',
    text: '*"Når man fjerner beskeder i indbakken, opdateres det ikke i siden, før man klikker F5. Forbliver der, når man flytter sig rundt på sitet."*\n\nUlæste-counter (badge på indbakke-ikon) opdateres ikke i UI efter at beskeder er slettet — kræver hård reload. Klassisk frontend cache-invalidation-bug.',
    images: ['1502029625986125905-1502029630230630560.png'],
    files: [
      '`frontend/src/pages/NotificationsPage.jsx` — delete-handler skal invalidere unread-count-state',
      'Global state / context for unread-count (sandsynligvis i Layout eller Header)',
      'React Query / SWR-cache key for unread-counter',
    ],
    notes: 'Sandsynligvis manglende invalidate-call i delete-mutation eller stale closure i header-counter-komponent. Tjek hvordan unread-count fetches initielt og om delete-handler trigger refetch.',
    acceptance: [
      'Sletning af besked invaliderer unread-counter umiddelbart',
      'Counter forsvinder fra header-badge uden F5',
      'Counter opdateres også når man navigerer væk fra og tilbage til indbakken',
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
  body += `---\n*Issue oprettet automatisk af Claude fra Discord-feedback (Cycling Career server, batch 5 — 2026-05-07 proxy-bidding regression cluster).*\n`;
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
fs.writeFileSync('.tmp_batch5_results.json', JSON.stringify({ created, failed }, null, 2));
