#!/usr/bin/env node
/**
 * File Discord-sourced GitHub issues — batch 6 (triage 2026-05-30).
 * Source: #samlet-feedback-features-og-bugs — feedback fra 2026-05-16 → 2026-05-30.
 *
 * Triage-metode: aktive tråde hentet via scripts/discord/list-active-threads.mjs,
 * dedupet mod eksisterende issues (scripts/discord/dedupe-feedback.mjs), og hver
 * kandidat verificeret mod kildekoden før oprettelse (Explore-agent 2026-05-30).
 * Verifikations-verdikt står i hver issue under "Kode-verifikation".
 *
 * Allerede dækket → kommenteret separat, ikke oprettet her:
 *   - "Transfertilbud udenfor transfervinduet"  → dup af #19
 *   - "De kommende løb er slet ikke de kommende" → dup af #21
 * Selv-løst i tråden → udeladt: "Mistede overskrifter" (rapportør: "ser fint ud igen").
 */
const { execSync } = require('child_process');
const fs = require('fs');

const REPO = 'NicolaiDolmer/CyclingZone';
const GUILD = '474142653529849886';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/docs/discord-attachments`;

const issues = [
  {
    id: 'b6-hall-of-fame-self-only',
    threadId: '1510242164226134236',
    title: '[bug] Hall of Fame viser kun én selv — andre managers mangler',
    labelType: 'bug',
    priority: 'high',
    author: 'jeppek',
    threadTitle: 'Hall of Fame',
    timestamp: '2026-05-30',
    text: '*"Man kan kun se sig selv i Hall of Fame"* — https://cycling-zone.vercel.app/hall-of-fame\n\nHall of Fame-siden viser kun den indloggede managers egne rækker i stedet for alle. Det gør siden reelt ubrugelig.',
    images: ['1510242164226134236-1510242169204641802.png'],
    notes: 'Kode-verifikation (2026-05-30): `HallOfFamePage.jsx` henter `supabase.from("hall_of_fame").select(...)` UDEN user-filter i query — så begrænsningen kommer mest sandsynligt fra en RLS-policy på `hall_of_fame`-tabellen. Tabellen findes ikke i `database/`-migrations (oprettet direkte i Supabase UI), så RLS-status skal bekræftes i Supabase Dashboard. Mistanke: policy med `auth.uid()`-lighed der kun tillader egne rækker.',
    files: [
      '`frontend/src/pages/HallOfFamePage.jsx` (~linje 42 — select-query uden filter)',
      'Supabase: RLS-policies på tabel `hall_of_fame` (SELECT skal være public/læsbar for alle authed)',
      'Sammenlign med RLS-mønster i `docs/RLS_AUDIT_2026-05-22.md`',
    ],
    acceptance: [
      'Bekræft om `hall_of_fame` har en RLS-SELECT-policy der begrænser til egne rækker',
      'Alle managers vises i Hall of Fame for enhver indlogget bruger',
      'Verificér i prod med to forskellige konti',
    ],
  },
  {
    id: 'b6-rider-sold-to-ai-still-listed',
    threadId: '1506046994051891210',
    title: '[bug] Rytter solgt til AI står fortsat som "til salg" på markedet',
    labelType: 'bug',
    priority: 'high',
    author: '.sredna',
    threadTitle: 'Rytter til salg, der ikke er til salg',
    timestamp: '2026-05-18',
    text: '*"Ham her er blevet solgt til AI, men står fortsat som om han er til salg på markedet"* (rytteren er Xavier).\n\nEn rytter der er solgt/overdraget til AI rydder ikke sin transfer-listing/markeds-status — fremstår som phantom-listing.',
    images: ['1506046994051891210-1506046996996423752.png'],
    notes: 'Kode-verifikation (2026-05-30): I `auctionFinalization.js` (~linje 421-433) opdateres rytterens `team_id`/`pending_team_id` ved guaranteed-sale-flowet, men matchende `transfer_listings`-rækker (status `open`) ryddes ikke eksplicit → zombie-status. Tjek om salg-til-AI går gennem samme path og om transfer_listing sættes til `sold`/`withdrawn`.',
    files: [
      '`backend/lib/auctionFinalization.js` (~linje 421-433 — guaranteed-sale / salg til bank/AI)',
      '`backend/lib/transferExecution.js` — ejerskifte + oprydning af listings',
      'Tabel `transfer_listings.status` (`open|negotiating|sold|withdrawn`)',
    ],
    acceptance: [
      'Når en rytter sælges til AI/bank lukkes alle åbne transfer_listings for rytteren',
      'Markedet viser ikke længere rytteren som til salg',
      'Repro: sælg rytter til AI → verificér markedet + DB-status',
    ],
  },
  {
    id: 'b6-owner-filter-free-agents',
    threadId: '1510263255757754660',
    title: '[bug] Ejer-filter på rytter-rangliste: fri-agenter vises under "Manager-ejede"',
    labelType: 'bug',
    priority: 'med',
    author: 'soren1207 + .sredna + bobby2106',
    threadTitle: 'Knapper i rytterranglisten virker ikke',
    timestamp: '2026-05-30',
    text: '*"Trykker man på Manager-ejede kommer der stadig \'Fri agent\' ryttere op."*\n\nbobby2106 uddyber: ryttere er sat i forkerte kasser — fri-agenter og AI-ejede skal ikke tælle som manager-ejede. Alle 19 managers ryttere skal vises under manager-ejet-filteret.\n\nRelateret tråd (samme rod-årsag): *"AI-ryttere fremtræder ikke som frie agenter, hvis man filtrerer"* (.sredna, 2026-05-21).',
    images: ['1510263255757754660-1510263655445434378.png', '1507078529282605106-1507078532600430723.png'],
    notes: 'Kode-verifikation (2026-05-30): BUG BEKRÆFTET i `RiderRankingsPage.jsx` (~linje 101-105). Filteret bruger `ownerFilter === "manager" → return !r.team?.is_ai`. For en fri-agent uden hold er `r.team` null, så `r.team?.is_ai` er `undefined`, og `!undefined === true` → fri-agenter inkluderes fejlagtigt i "Manager-ejede". Der mangler en eksplicit tredje bucket (fri-agent = intet team), adskilt fra AI-ejet og manager-ejet.',
    files: [
      '`frontend/src/pages/RiderRankingsPage.jsx` (~linje 101-105 — owner-filter logik)',
      'Afklar 3 buckets: manager-ejet (`team && !team.is_ai`), AI-ejet (`team.is_ai`), fri-agent (`!team`)',
    ],
    acceptance: [
      '"Manager-ejede" viser kun ryttere på menneske-managede hold',
      'Fri-agenter og AI-ejede er deres egne kategorier',
      'Test alle tre filter-tilstande mod kendt data',
    ],
  },
  {
    id: 'b6-flash-auction-team-page',
    threadId: '1507075204008906822',
    title: '[bug] Flash-auktion på egne ryttere kan ikke startes fra holdsiden',
    labelType: 'bug',
    priority: 'med',
    author: 'jeppek',
    threadTitle: 'Flash Auktion',
    timestamp: '2026-05-21',
    text: '*"Ikke muligt at lave flashauktion på egne ryttere via knappen til højre på egen holdside."* — https://cycling-zone.vercel.app/team',
    images: ['1507075204008906822-1507075209679605860.png'],
    notes: 'Kode-verifikation (2026-05-30): Backend understøtter flash-auktion — `api.js` (~linje 745-763, 881) accepterer `flash_auction` og sætter `is_flash`. Men `TeamPage.jsx` (~linje 37-49) har ingen UI der sender `flash_auction: true` — kun `startAuction()`, `sellToBank()`, `listTransfer()`. Dvs. frontend-UX mangler, backend er klar.',
    files: [
      '`frontend/src/pages/TeamPage.jsx` (~linje 37-49 — actions, mangler flash-auktion-knap)',
      '`backend/routes/api.js` (~linje 745-763, 881 — flash_auction allerede understøttet)',
    ],
    acceptance: [
      'Holdsiden har en knap til at starte flash-auktion på egen rytter',
      'Knappen sender `flash_auction: true` til auktions-endpointet',
      'Flash-timeout (30 min) anvendes korrekt',
    ],
  },
  {
    id: 'b6-guaranteed-sale-deadline-day',
    threadId: '1507072644862972057',
    title: '[bug/investigation] Garanteret salg følger normal-auktionsregler under deadline day',
    labelType: 'bug',
    priority: 'med',
    author: 'jeppek',
    threadTitle: 'Garanteret salg sættes til 24-timer under deadline day',
    timestamp: '2026-05-21',
    text: '*"Når man sætter en rytter på garanteret salg (måske også auktion) uden det er flash ved deadline day, følger den reglerne for almindelig auktion."* — https://cycling-zone.vercel.app/auctions',
    images: ['1507072644862972057-1507072649350877297.png'],
    notes: 'Kode-verifikation (2026-05-30): MULIGT INTENDED, skal afklares. `auctionFinalization.js` (~linje 412-485) håndterer guaranteed-sale i et separat flow (sælges direkte uden bud-mekanisme), og `api.js` (~linje 823-829) sætter pris = garanteret-pris men beholder normal auktions-timeout, ikke flash-timeout (30 min). Spørgsmål til afklaring: SKAL garanteret salg bruge flash-timeout under deadline day? Hvis ja → bug. Hvis nej → forventet, og det er en UX-forventnings-mismatch der bør forklares i UI.',
    files: [
      '`backend/lib/auctionFinalization.js` (~linje 412-485 — guaranteed-sale flow)',
      '`backend/routes/api.js` (~linje 823-829 — pris + timeout for guaranteed-sale)',
      'Se også `docs/GAME_INVARIANTS.md` (deadline-day / flash-grænser)',
    ],
    acceptance: [
      'Beslut: skal garanteret salg bruge flash-timeout under deadline day?',
      'Implementér beslutningen ELLER tydeliggør forventet adfærd i UI',
      'Repro under deadline-day-tilstand',
    ],
  },
  {
    id: 'b6-rider-result-history-broken',
    threadId: '1510266246116151436',
    title: '[bug] Løbsresultat-historik virker ikke inde på den enkelte rytter',
    labelType: 'bug',
    priority: 'med',
    author: '.sredna + bobby2106',
    threadTitle: 'Budhistorik virker ikke',
    timestamp: '2026-05-30',
    text: 'Trådtitel siger "Budhistorik", men bobby2106 præciserer: *"Vi mener her, at løbsresultat-historikken ikke virker inde på den enkelte rytter."*\n\nResultat-historik på rytter-detalje-/stats-siden viser ikke rytterens løbsresultater.',
    images: ['1510266246116151436-1510266253376491611.png'],
    notes: 'Kode-verifikation (2026-05-30): Rytter-resultat-visning ligger i `RiderStatsPage.jsx` / `RaceHistoryPage.jsx` (begge læser `race_results`). NB: der er for nylig fundet flere paginerings-bugs på `race_results` (1000-row-cap) — se #772/#774 (fikset 2026-05-30). Tjek om rytter-historik-queryen rammer samme cap eller filtrerer forkert på `rider_id`/sæson.',
    files: [
      '`frontend/src/pages/RiderStatsPage.jsx` — per-rytter resultat-historik',
      '`frontend/src/pages/RaceHistoryPage.jsx` — race_results-query',
      'Cross-ref #772 / #774 (race_results paginerings-fixes 2026-05-30)',
    ],
    acceptance: [
      'Rytter-detaljesiden viser rytterens løbsresultat-historik korrekt',
      'Verificér mod en rytter med kendte resultater i sæson 1',
      'Bekræft ingen paginerings-/cap-afkortning',
    ],
  },
  {
    id: 'b6-ranking-oneday-as-overall',
    threadId: '1510269165255135263',
    title: '[bug] Rangliste: vinder af endagsløb vises som "samlet sejr"',
    labelType: 'bug',
    priority: 'med',
    author: 'bobby2106',
    threadTitle: 'Rangliste fejl',
    timestamp: '2026-05-30',
    text: '*"På ranglisten bliver man vist som om man har vundet en samlet sejr, hvis man vinder et endagsløb. Det er en fejl. Man skal stå som om man har vundet en klassiker. Hvis man vinder en samlet sejr, så må man noteres som samlet sejr."*',
    images: ['1510269165255135263-1510269169718001814.png'],
    notes: 'Kode-verifikation (2026-05-30): `RiderRankingsPage.jsx` (~linje 76-79) tæller sejre på `result_type` (`stage`, `gc`, ...). Problemet: en sejr i et endagsløb registreres med samme `result_type` som en etape/GC, og koden bruger ikke `races.race_type` (`single` vs `stage_race`) til at skelne. Derfor klassificeres endagsløb-vinder forkert. Fix kræver at race_type følger med result-rækken (JOIN eller denormalisering).',
    files: [
      '`frontend/src/pages/RiderRankingsPage.jsx` (~linje 76-79 — sejr-aggregering på result_type)',
      'Schema: `races.race_type IN (single, stage_race)` + `race_results.result_type`',
      'Afklar mapping: single-race-vinder → "klassiker", stage_race GC-vinder → "samlet sejr"',
    ],
    acceptance: [
      'Endagsløb-vinder noteres som klassiker-sejr, ikke samlet sejr',
      'Samlet sejr noteres kun for GC-vinder i etapeløb',
      'Verificér mod kendte løbsresultater',
    ],
  },
  {
    id: 'b6-wins-counting',
    threadId: '1510273057355464885',
    title: '[bug] Sejre tælles forkert + mangler samlet "sejre i sæsonen"-optælling',
    labelType: 'bug',
    priority: 'med',
    author: 'bobby2106',
    threadTitle: 'Sejre tælles forkert på ranglisten',
    timestamp: '2026-05-30',
    text: '*"Vi mangler en funktion der viser en rytters \'sejre i sæsonen\', hvor alle sejre rytteren får tælles i samme kasse. Derudover skal vi have et sted hvor \'etapesejre\' bliver talt — dette er pt. forkert. Skal kun tælle etapesejre fra etapeløb."*',
    notes: 'Kode-verifikation (2026-05-30): Aggregeringen i `RiderRankingsPage.jsx` + `HallOfFamePage.jsx` tæller kun visse `result_type` (stage/gc/points/mountain/young) og håndterer ikke `*_day`-varianterne (`points_day`, `mountain_day`, `young_day`). Der findes ingen samlet "sejre i sæsonen"-metrik. Etapesejr-tælling bør kun medregne `result_type=stage` fra `race_type=stage_race` (samme race_type-problem som søster-issue om endagsløb).',
    files: [
      '`frontend/src/pages/RiderRankingsPage.jsx` — sejr-aggregering (mangler *_day + samlet)',
      '`frontend/src/pages/HallOfFamePage.jsx` (~linje 87-97 — bruger season_standings.stage_wins)',
      'Definér "sejre i sæsonen" = sum af alle sejrstyper for rytter i sæsonen',
    ],
    acceptance: [
      'Samlet "sejre i sæsonen" vises per rytter',
      'Etapesejre tæller kun etaper fra etapeløb',
      'Alle sejrstyper (inkl. *_day) håndteres konsistent',
    ],
  },
  {
    id: 'b6-dashboard-progress-stale',
    threadId: '1510268058420383824',
    title: '[bug] Dashboard: sæson-fremskridt opdateres ikke',
    labelType: 'bug',
    priority: 'med',
    author: 'bobby2106',
    threadTitle: 'Dashboard fejl - Løb opdateres ikke',
    timestamp: '2026-05-30',
    text: '*"Der er en fejl her i dashboardet, hvor den ikke opdaterer fremskridt i sæsonen."*',
    images: ['1510268058420383824-1510268063763796089.png'],
    notes: 'Kode-verifikation (2026-05-30): `DashboardPage.jsx` henter data én gang i `loadAll()` uden polling/refetch, så sæson-fremskridt forbliver statisk indtil hård reload. Tjek desuden om fremskridts-beregningen bruger korrekt kilde (afsluttede løb vs sæson-status). Beslægtet med "kommende løb"-sortering (#21) der bruger samme side.',
    files: [
      '`frontend/src/pages/DashboardPage.jsx` — `loadAll()` + sæson-fremskridt-beregning',
      'Overvej refetch ved navigation/fokus eller efter løb-finalisering',
    ],
    acceptance: [
      'Sæson-fremskridt afspejler faktisk antal afviklede løb uden hård reload',
      'Verificér efter et løb er finaliseret',
    ],
  },
  {
    id: 'b6-prizemoney-overview',
    threadId: '1510273771901026375',
    title: '[feature] Præmiepenge-oversigt: forudsig holds forventede indtjening',
    labelType: 'feature',
    priority: 'med',
    author: 'bobby2106',
    threadTitle: 'Præmiepenge',
    timestamp: '2026-05-30',
    text: '*"Jeg vil gerne have at alle spillere får en oversigt hvor de kan se hvor mange præmiepenge diverse hold står til at tjene ind. Ligesom ranglisten, så skal der være en præmiepenge-oversigt, sådan man kan forudsige hvor mange penge man står til at få."*',
    notes: 'Feature-request. Bemærk: præmiepenge-/payout-logik er for nylig pagineret + fået confirm-dialog (#773). En offentlig forventet-indtjening-oversigt skal genbruge samme beregningskilde for at undgå drift.',
    files: [
      'Genbrug prize/payout-beregning (se #773 — prize-preview paginering)',
      'Ny side/sektion: forventet præmiepenge per hold, sorterbar som rangliste',
    ],
    acceptance: [
      'Oversigt viser forventet præmieindtjening per hold',
      'Tal stemmer med den faktiske payout-beregning',
      'Tilgængelig for alle managers',
    ],
  },
  {
    id: 'b6-confusing-history-unsold-auction',
    threadId: '1506222527591088198',
    title: '[bug] Forvirrende historik: usolgt salgsauktion efterlader uklar rytter-status',
    labelType: 'bug',
    priority: 'low',
    author: '.sredna + bobby2106',
    threadTitle: 'Forvirrende historik',
    timestamp: '2026-05-19',
    text: '*"Synes det ser ud til at han burde være solgt til ikke nogen, men han er stadig på holdet?"*\n\nbobby2106s gæt: en salgsauktion uden bud ("fisketur") efterlader en forvirrende historik-/status-visning, selvom rytteren korrekt forbliver på holdet.',
    images: ['1506222527591088198-1506222532972253325.png', '1506222527591088198-1506222533517508719.png'],
    notes: 'Kode-verifikation (2026-05-30): Sandsynligvis kosmetisk/UX — en auktion uden bud annulleres, men historik-visningen antyder et "salg til ingen". Tjek hvordan annullerede/usolgte auktioner repræsenteres i transfer-/auktions-historik.',
    files: [
      '`frontend/src/pages/RaceHistoryPage.jsx` / transfer-historik-visning',
      '`backend/lib/auctionFinalization.js` — håndtering af auktion uden bud',
    ],
    acceptance: [
      'Auktion uden bud vises tydeligt som "ingen salg" / "tilbagetrukket"',
      'Ingen visning der antyder salg til ukendt modpart',
    ],
  },
  {
    id: 'b6-transferlist-many-actions',
    threadId: '1506780095275204608',
    title: '[bug/ux] Transferliste med mange actions er forvirrende',
    labelType: 'bug',
    priority: 'low',
    author: '.sredna',
    threadTitle: 'Transferliste med mange actions',
    timestamp: '2026-05-20',
    text: '*"Tænker at billedet forklarer min forvirring."* — transferlisten bliver uoverskuelig når en rytter har mange samtidige actions/tilstande.',
    images: ['1506780095275204608-1506780100132212907.png'],
    notes: 'UX-feedback uden tekstlig præcisering — se skærmbillede. Sandsynligvis behov for tydeligere gruppering/prioritering af actions per rytter på transferlisten.',
    files: [
      '`frontend/src/pages/` transferliste-/listings-visning',
    ],
    acceptance: [
      'Triagér konkret problem ud fra skærmbillede',
      'Forenkle/gruppere actions så listen er overskuelig',
    ],
  },
  {
    id: 'b6-language-dropdown-scroll',
    threadId: '1505613603217084487',
    title: '[bug] Sprog-dropdown kan ikke scrolles / afskæres',
    labelType: 'bug',
    priority: 'low',
    author: 'cybersimon',
    threadTitle: 'Skifte sprog menue',
    timestamp: '2026-05-17',
    text: '*"Man kan ikke rulle ned og se hvad der står i drop-down menuen når man trykker på sproget."*',
    images: ['1505613603217084487-1505613608128741496.png'],
    notes: 'Kode-verifikation (2026-05-30): Kan ikke reproduceres statisk. `LanguageSwitcher.jsx` (~linje 62-95) har kun 2 valg (da/en) og ingen `max-height`/`overflow`. Problemet er sandsynligvis device-/browser-specifikt (lille viewport eller dropdown der åbner ud over skærmkant). Behøver repro på den enhed cybersimon brugte.',
    files: [
      '`frontend/src/components/LanguageSwitcher.jsx` (~linje 62-95)',
      'Tjek placering/overflow ved lille viewport (mobil) + sikr dropdown holdes inden for skærm',
    ],
    acceptance: [
      'Reproducér på relevant enhed/viewport',
      'Begge sprogvalg er altid synlige og klikbare',
    ],
  },
  {
    id: 'b6-loan-interest-double-display',
    threadId: '1507246935625433138',
    title: '[bug] Lånerente vises forvirrende to gange i transaktionshistorik (kosmetisk)',
    labelType: 'bug',
    priority: 'low',
    author: 'andreas311. + bobby2106',
    threadTitle: 'Dobbelt tilskrivning af rente på lån ved sæsonskift',
    timestamp: '2026-05-22',
    text: 'Oprindelig rapport lød "dobbelt tilskrivning af rente", men i tråden bekræfter rapportøren at pengene IKKE trækkes dobbelt — det er kun **visningen** der er forvirrende: renten optræder både ved sæsonskift og igen ved afdrag på lånet i transaktionshistorikken.',
    notes: 'Kode-verifikation (2026-05-30): Ikke en økonomisk fejl (bekræftet af rapportør i tråden) — kosmetisk/UX. Tjek hvordan rente-posteringer labels i transaktionshistorik så det er entydigt hvad der er tilskrivning vs afdrag.',
    files: [
      'Transaktionshistorik-visning (finance) + rente-posterings-labels',
      '`backend/lib/seasonTransition.js` — rente-postering ved sæsonskift',
    ],
    acceptance: [
      'Rente-posteringer er entydigt mærket (tilskrivning vs afdrag)',
      'Bekræft ingen reel dobbelt-debitering (allerede afkræftet, men verificér)',
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
    body += `## Kode-verifikation\n\n${i.notes}\n\n`;
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
  body += `---\n*Issue oprettet af Claude fra Discord-feedback (Cycling Career server, batch 6 — triage 2026-05-30, feedback 2026-05-16 → 2026-05-30). Verificeret mod kildekoden før oprettelse.*\n`;
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
fs.writeFileSync('.tmp_batch6_results.json', JSON.stringify({ created, failed }, null, 2));
