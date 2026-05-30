#!/usr/bin/env node
/**
 * Batch 7 — create GitHub issues from NEW Discord feedback (2026-05-31 triage).
 * Covers the 2026-05-30 feedback wave + genuinely-new older stragglers that had
 * no existing issue. Duplicates of #21/#224/#234/#226/#225 are handled via
 * comments instead (see triage notes), not re-filed here.
 *
 * Idempotent-ish: skips if an issue with the same title already exists (open or closed).
 *
 * Usage:
 *   node scripts/file-discord-issues-batch7.js          # dry-run (prints what it would do)
 *   node scripts/file-discord-issues-batch7.js --apply  # actually create issues
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const REPO = 'NicolaiDolmer/CyclingZone';
const GUILD = '474142653529849886';
const link = (id) => `https://discord.com/channels/${GUILD}/${id}`;

function body({ date, author, text, threadId, note }) {
  return `**Fra Discord-feedback (${date}, @${author})**

${text}
${note ? `\n${note}\n` : ''}
**Kilde:** Discord-tråd ${link(threadId)}

---
_Filed automatisk fra Discord-feedback-triage (batch 7)._`;
}

// Each: { threadId, title, type: 'bug'|'feature', priority: 'high'|'med'|'low', body }
const ISSUES = [
  // ---------- 2026-05-30 wave ----------
  {
    threadId: '1510406407244218579',
    title: 'Bestyrelsesopgave (ungdomsudvikling): kræver stat-stigning der ikke kan opnås endnu',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-05-30', author: 'jeppek', threadId: '1510406407244218579',
      text: 'Under ungdomsudvikling i bestyrelsesforhandlinger kan man få en opgave om at få U25-rytterne til at stige med i gennemsnit X eller mere. Det er ikke muligt at træne rytterne lige nu, så statsændringer kan ikke ske ved at spille spillet på nuværende tidspunkt. Foreslår at fjerne disse opgaver indtil træning/stat-udvikling er muligt.',
      note: 'Ejer (@bobby2106) bekræftede: "God pointe. Jeg kigger på det."',
    }),
  },
  {
    threadId: '1510406001751363584',
    title: 'Auktioner: gør "Live bud · dine auktioner"-panel valgfrit + vis længere historik end 30 sek.',
    type: 'feature',
    priority: 'low',
    body: body({
      date: '2026-05-30', author: 'bobby2106', threadId: '1510406001751363584',
      text: 'Ønske: at det er valgfrit, om "Live bud · dine auktioner" er synligt. Og at de viste bud ikke kun dækker de sidste 30 sekunder — der må gerne være en større periode.',
    }),
  },
  {
    threadId: '1510405618966724718',
    title: 'Bestyrelsesopgave "Stjernesignering": vis antal stjerner i stedet for skjult popularitetstal',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-05-30', author: 'jeppek', threadId: '1510405618966724718',
      text: 'Under forhandling (Holdfokus → Stjernesignering) kan man få en opgave om at signe en rytter med over X i popularitet. Man kender ikke tallet — kun rytternes stjerner. Opgaven bør udtrykkes i antal stjerner i stedet for et skjult popularitetstal.',
      note: 'Ejer (@bobby2106) bekræftede: "Enig, det laver jeg om."',
    }),
  },
  {
    threadId: '1510403676408254534',
    title: 'Forklar eller cap "over 100%"-status (uklart hvad det betyder)',
    type: 'feature',
    priority: 'low',
    body: body({
      date: '2026-05-30', author: '.sredna', threadId: '1510403676408254534',
      text: 'Det er uklart, at man kan gå over 100%. Enten mangler der en forklaring på, hvad det betyder (fx "overgår forventninger"), eller også bør man ikke kunne gå over 100%.',
      note: 'Ejer (@bobby2106) bekræftede: "Det giver god mening. Jeg kigger på det."',
    }),
  },
  {
    threadId: '1510403318223212574',
    title: 'Achievement for "første resultat" mangler',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-05-30', author: '.sredna', threadId: '1510403318223212574',
      text: 'Achievement omkring sit første resultat mangler (rapporteret med skærmbillede).',
      note: '📷 Skærmbillede i Discord-tråden.',
    }),
  },
  {
    threadId: '1510402977620426752',
    title: 'Bestyrelsen: forklar forhandlingsrækkefølgen (5 år → 3 år → 1 år) ved første møde',
    type: 'feature',
    priority: 'med',
    body: body({
      date: '2026-05-30', author: '.sredna', threadId: '1510402977620426752',
      text: 'Ved første bestyrelsesmøde var det ikke tydeligt, at man forhandler først 5 år, så 3 år, så 1 år. Det virkede som om siden glitchede, og brugeren forsøgte at reloade. Der bør være en guide/forklaring på, hvad der sker.',
      note: 'Ejer (@bobby2106) bekræftede: "God pointe, det skal forklares bedre."',
    }),
  },
  {
    threadId: '1510402181855969520',
    title: 'Bestyrelsesforhandling mangler konsekvens/cap (kun upside ved at forhandle ned)',
    type: 'feature',
    priority: 'med',
    body: body({
      date: '2026-05-30', author: '.sredna', threadId: '1510402181855969520',
      text: 'Pt. er det udelukkende en fordel at forhandle målet ned. Der bør enten være et cap på antal gange, man kan gøre det, eller en risiko for at det fejler. Forslag: vis alle (5/3/1-års) mål samtidig, så man ved hvad der kommer næste gang.',
    }),
  },
  {
    threadId: '1510401904759537825',
    title: 'Bestyrelsen vurderer på forkert DNA-grundlag (klassiker-purist trods anden holdprofil)',
    type: 'bug',
    priority: 'high',
    body: body({
      date: '2026-05-30', author: '.sredna', threadId: '1510401904759537825',
      text: 'Holdets DNA er ikke klassiker-purist, men brugeren vurderes alligevel på det grundlag.',
      note: '📷 Skærmbillede i Discord-tråden.',
    }),
  },
  {
    threadId: '1510401779337134291',
    title: 'Bestyrelsesside: layout er svært at læse (hvad-er-hvad)',
    type: 'feature',
    priority: 'med',
    body: body({
      date: '2026-05-30', author: '.sredna', threadId: '1510401779337134291',
      text: 'Layoutet på bestyrelsessiden gør det svært at se, hvad der er hvad. Trænger til forbedring/hjælp.',
      note: 'Ejer (@bobby2106) bekræftede: "Enig. Layout skal forbedres." 📷 Skærmbillede i tråden.',
    }),
  },
  {
    threadId: '1510386171216265377',
    title: 'Rytter fjernes ikke fra transferlisten, når han sælges på auktion',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-05-30', author: '.sredna', threadId: '1510386171216265377',
      text: 'Når en rytter sælges på auktion, bør det trigge en fjernelse fra transferlisten. Pt. står rytteren stadig på transferlisten uden hold.',
      note: '📷 Skærmbillede i Discord-tråden.',
    }),
  },
  {
    threadId: '1510385618260197477',
    title: 'Kalender under sæsonsnapshot: sortér efter dato, ikke alfabetisk',
    type: 'bug',
    priority: 'low',
    body: body({
      date: '2026-05-30', author: '.sredna', threadId: '1510385618260197477',
      text: 'Kalenderen under sæsonsnapshot er sorteret alfabetisk. Den bør sorteres efter dato.',
      note: 'Ejer (@bobby2106) bekræftede: "Enig, skal sorteres efter dato." 📷 Skærmbillede i tråden.',
    }),
  },
  {
    threadId: '1510385447216615577',
    title: 'Klik på holdnavn i rangliste bør åbne holdets resultatliste',
    type: 'feature',
    priority: 'med',
    body: body({
      date: '2026-05-30', author: '.sredna', threadId: '1510385447216615577',
      text: 'Når man klikker på et holdnavn (eller "udvikling") i ranglisten, forventer man at komme til en resultatliste for holdet — gerne kun pointgivende resultater med rytternavn pr. resultat.',
      note: '📷 Skærmbillede i Discord-tråden.',
    }),
  },
  {
    threadId: '1510384905979301928',
    title: 'Rangliste: dårlig farve-kontrast (lys linje på nr. 2 i dark mode, svær guld i light mode)',
    type: 'bug',
    priority: 'low',
    body: body({
      date: '2026-05-30', author: '.sredna', threadId: '1510384905979301928',
      text: 'I dark mode er der en ekstremt lys linje på nummer 2 (ikke ved hover). I light mode er guld-fremhævningen svær at læse. Kontrasten bør forbedres.',
      note: '📷 Skærmbillede i Discord-tråden.',
    }),
  },
  {
    threadId: '1510384171925635273',
    title: 'Holdsammenligning: tallene ud for rytterne giver ikke mening (0 for rytter der har kørt)',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-05-30', author: '.sredna', threadId: '1510384171925635273',
      text: 'Tallene ud for rytterne i holdsammenligningen virker forkerte — fx står der 0 ud for en rytter, der har kørt.',
      note: 'Ejer (@bobby2106): "Jeg kigger på det." 📷 Skærmbillede i tråden.',
    }),
  },
  {
    threadId: '1510361906421174473',
    title: 'Garanteret salg: rytter forlader holdet selvom transfervinduet er lukket',
    type: 'bug',
    priority: 'high',
    body: body({
      date: '2026-05-30', author: 'bobby2106', threadId: '1510361906421174473',
      text: 'Ved garanteret salg mister man rytteren fra holdet, selvom transfervinduet er lukket. Rytteren bør blive på holdet sæsonen ud og først skifte, når vinduet åbner.',
      note: 'Relateret: transfervindue-håndhævelse (se også tråd om transfertilbud uden for vinduet).',
    }),
  },
  {
    threadId: '1510271780814585936',
    title: 'Transfertilbud på andre managerholds ryttere skal kunne afgives uden for transfervinduet',
    type: 'feature',
    priority: 'high',
    body: body({
      date: '2026-05-30', author: 'bobby2106', threadId: '1510271780814585936',
      text: 'Pt. kan man ikke byde på andre managerholds ryttere, når vinduet er lukket — det er en fejl. Det skal være muligt at byde/gennemføre/acceptere handler selvom vinduet er lukket, men selve rytterskiftet skal først ske, når vinduet åbner igen.',
      note: 'Relateret: garanteret salg-fejl (transfervindue-håndhævelse).',
    }),
  },
  // ---------- ældre stragglers uden eksisterende issue ----------
  {
    threadId: '1507078529282605106',
    title: 'AI-ryttere vises ikke som frie agenter, når man filtrerer',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-05-21', author: '.sredna', threadId: '1507078529282605106',
      text: 'AI-ryttere fremtræder ikke som frie agenter, når man filtrerer.',
      note: '📷 Skærmbillede i Discord-tråden.',
    }),
  },
  {
    threadId: '1503494959276494968',
    title: 'Notifikationsbadge bør vise antal ulæste mails, ikke samlet antal modtagne',
    type: 'feature',
    priority: 'med',
    body: body({
      date: '2026-05-11', author: '.sredna', threadId: '1503494959276494968',
      text: 'Tallet ude til venstre bør vise antallet af ulæste mails — ikke antallet af mails man har modtaget.',
      note: 'Stadig aktuelt pr. 2026-05-16 (bekræftet i tråden). 📷 Skærmbillede i tråden.',
    }),
  },
  {
    threadId: '1501677018348130515',
    title: 'Ikke alle ryttere under 25 kategoriseres som U25',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-05-06', author: 'jeppek', threadId: '1501677018348130515',
      text: 'Ikke alle ryttere under 25 er kategoriseret som U25.',
      note: '📷 Skærmbillede i Discord-tråden.',
    }),
  },
  {
    threadId: '1501676929403846928',
    title: 'Mulig fejl i søgning/filtrering på alder',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-05-06', author: 'jeppek', threadId: '1501676929403846928',
      text: 'Mulig fejl i søgning på alder (rapporteret af @jeppek; se tråd for detaljer/dialog).',
    }),
  },
  {
    threadId: '1501674134483107971',
    title: 'Status "Vinduet er åbent" bør i stedet vise om manageren er online/offline',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-05-06', author: 'jeppek', threadId: '1501674134483107971',
      text: 'Der vises "Vinduet er åbent", hvor det i stedet skulle indikere, om manageren er online eller offline.',
      note: '📷 Skærmbillede i Discord-tråden.',
    }),
  },
];

const existing = new Set();
function loadExisting() {
  // NB: do NOT use --jq with a single-quoted filter here — on Windows/PowerShell
  // the quotes aren't stripped and gh errors with "unexpected token", which
  // silently disables title-dedup. Fetch raw JSON and parse in-process instead
  // (dup-incident 2026-05-31).
  try {
    const out = execSync(
      `gh issue list --repo ${REPO} --state all --limit 1000 --json title`,
      { encoding: 'utf8' }
    );
    const arr = JSON.parse(out);
    for (const it of arr) { const t = (it.title || '').trim(); if (t) existing.add(t.toLowerCase()); }
    if (!existing.size) throw new Error('0 existing titles parsed — refusing to run blind');
    console.log(`loadExisting: ${existing.size} existing titles loaded`);
  } catch (e) {
    console.error('WARN: could not list existing issues:', e.message);
    process.exit(2); // fail loud — never --apply without a working dedup guard
  }
}

const makeLabels = (type, priority) => `claude:todo,type:${type},priority:${priority}`;

function run(dry, iss) {
  const labelArg = makeLabels(iss.type, iss.priority);
  if (existing.has(iss.title.toLowerCase())) {
    console.log(`SKIP (exists): ${iss.title}`);
    return;
  }
  if (dry) {
    console.log(`DRY: would create [${labelArg}] ${iss.title}`);
    return;
  }
  const tmp = `.issue-body-batch7-${iss.threadId}.md`;
  fs.writeFileSync(tmp, iss.body);
  try {
    const out = execSync(
      `gh issue create --repo ${REPO} --title ${JSON.stringify(iss.title)} --body-file ${tmp} --label ${JSON.stringify(labelArg)}`,
      { encoding: 'utf8' }
    );
    console.log(`CREATED: ${iss.title} -> ${out.trim()}`);
  } catch (e) {
    console.error(`FAIL: ${iss.title}: ${e.message}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

const dry = !process.argv.includes('--apply');
loadExisting();
console.log(`Batch 7 — ${dry ? 'DRY-RUN' : 'APPLY'} (${ISSUES.length} issues)`);
for (const iss of ISSUES) run(dry, iss);
console.log('Done.');
