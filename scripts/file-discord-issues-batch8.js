#!/usr/bin/env node
/**
 * Batch 8 — create GitHub issues from NEW Discord feedback (2026-06-03 triage).
 * Covers the 2026-06-02 feedback wave + two genuinely-new older stragglers.
 *
 * Skipped as duplicates/handled (NOT re-filed here):
 *   - Navnesøgning mellemrum            → dup #47
 *   - Managernavn (x2)                  → dup #224
 *   - Kan ikke lukke onboarding         → dup #225 / #107
 *   - Sæsonskifte/oprykninger (05-21)   → dækket af #533 + #962
 *   - Mistede overskrifter              → løst i tråden selv
 *   - Gældsloft (ejer-design-spm)       → dækket af #97
 *   - Test-batch + Fans-feedback-tråd   → ejer-prompts, ikke feedback
 *
 * Idempotent-ish: skips if an issue with the same title already exists (open or closed).
 *
 * Usage:
 *   node scripts/file-discord-issues-batch8.js          # dry-run
 *   node scripts/file-discord-issues-batch8.js --apply  # actually create issues
 */
import { execSync } from 'node:child_process';

const REPO = 'NicolaiDolmer/CyclingZone';
const GUILD = '474142653529849886';
const link = (id) => `https://discord.com/channels/${GUILD}/${id}`;

function body({ date, author, text, threadId, code, refs }) {
  return `**Fra Discord-feedback (${date}, @${author})**

${text}
${code ? `\n**Sandsynlige kode-steder** (lokaliseret, ikke verificeret rod-årsag):\n${code}\n` : ''}${refs ? `\n**Relateret:** ${refs}\n` : ''}
**Kilde:** Discord-tråd ${link(threadId)}

---
_Filed automatisk fra Discord-feedback-triage (batch 8)._`;
}

// Each: { threadId, title, type, priority, labelsExtra?, body }
const ISSUES = [
  {
    threadId: '1511472183971676231',
    title: 'Bestyrelse: etapesejre tæller ikke i 3- og 5-årsplanens delmål',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-06-02', author: 'jeppek', threadId: '1511472183971676231',
      text: 'Bestyrelsen registrerer ikke etapesejre i 3- og 5-årsplanens delmål, selvom holdet har vundet etapesejre i sæsonen. I eksemplet (Above & Beyond Cancer) burde tælleren stå på 1, men den står på 0. Der er et screenshot i Discord-tråden.',
      code: '- `frontend/src/pages/BoardPage.jsx:1044` — cumulative-mål: `(cumulative_stats?.stage_wins || 0) >= goal.target`\n- `frontend/src/pages/BoardPage.jsx:1055` — ikke-cumulative stage_wins-mål\n- `backend/lib/boardEngine.js` — evaluerer mål mod cumulative_stats (verificér at stage_wins faktisk populeres)',
      refs: '#914 (board-tilfredshed gav 0% trods sejre, lukket), #782 (sejre tælles forkert)',
    }),
  },
  {
    threadId: '1511441112815108157',
    title: 'Auktionsside: ledende hold opdateres ikke i realtid ved overbud',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-06-02', author: 'jeppek', threadId: '1511441112815108157',
      text: 'Når man bliver overbudt på en rytter, opdateres "ledende hold" ikke i UI uden en manuel side-genindlæsning. Holdet med højeste bud bør opdateres live til den der fører buddet.',
      code: '- `frontend/src/pages/AuctionsPage.jsx:749-784` — realtime-subscription på `auctions` UPDATE; verificér at skift i `current_bidder_id`/ledende hold faktisk re-rendrer\n- `frontend/src/lib/auctionsRealtime.js:11-18` — `isOverbidEvent()` detekterer skift i `current_bidder_id`',
      refs: '#783 (realtime results/standings)',
    }),
  },
  {
    threadId: '1511433829343166486',
    title: 'Økonomi: præmiepenge-prognose er lavere end allerede indtjent',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-06-02', author: 'jeppek', threadId: '1511433829343166486',
      text: 'På økonomifanen står der for Above & Beyond Cancer en prognose på 833.197 i præmiepenge, men holdet har allerede tjent 1.347.000 i denne sæson. En prognose for sæsonen bør aldrig være lavere end det allerede indtjente — det er misvisende.',
      code: '- `backend/lib/financeForecast.js:61-64` — `projected_prize` beregnes som sum af nuværende rytteres `prize_earnings_bonus` (rolling avg), uden at medregne allerede realiseret præmieindtægt i sæsonen\n- `frontend/src/components/FinanceForecastCard.jsx:153-156` — viser "Prize"-rækken',
    }),
  },
  {
    threadId: '1511432800585388083',
    title: 'Økonomi: vises som "konkurs truet" trods >2,5 mio. i indtægt',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-06-02', author: 'bobby2106', threadId: '1511432800585388083',
      text: 'Holdet markeres som "konkurs truet", selvom det har mere end 2.500.000 i indtægt. Risk-tier-flaget ser ud til at udløses forkert. Der er et screenshot i Discord-tråden.',
      code: '- `backend/lib/financeForecast.js:179-198` — `computeRiskTier()` sætter "red" når `debtRatio > 0.8` ELLER `projectedNet < -50K`\n- `backend/lib/financeForecast.js:104-109` — `debtRatio = totalDebt / debtCeiling`; positiv indtægt kan stadig give "red" hvis gæld/ceiling-ratio er høj',
      refs: '#85 (finance-forecast + risk-tier)',
    }),
  },
  {
    threadId: '1511432754359832800',
    title: 'Sæson Preview: ulæselig tekstkontrast i hold-bokse (omvendt dark mode)',
    type: 'bug',
    priority: 'high',
    body: body({
      date: '2026-06-02', author: 'cybersimon', threadId: '1511432754359832800',
      text: 'Under "Sæson Preview" har teksten i de små bokse ved hvert hold en farve, der gør den ulæselig — særligt felterne ryttere, AVG BJ og AVG SP. Det ligner en omvendt dark mode. Der er et screenshot i Discord-tråden. (@bobby2106 bekræftede i tråden.)',
      code: '- `frontend/src/pages/SeasonPreviewPage.jsx:105-115` — hold-bokse med stats; betinget farve `s.value >= 75 ? text-cz-accent-t : text-cz-2`\n- `frontend/src/pages/SeasonPreviewPage.jsx:146-147` — "Avg BJ"/"Avg SP" med samme betingede farve (mørk tekst på mørk baggrund i dark mode)',
    }),
  },
  {
    threadId: '1511427545323802704',
    title: 'Transferhistorik: omvendt fortegn på køb/salg + forkert sæson-placering',
    type: 'bug',
    priority: 'med',
    body: body({
      date: '2026-06-02', author: 'jeppek', threadId: '1511427545323802704',
      text: 'På transferhistorikken (/team → transferhistorik) er fortegnene byttet om: køb bør være minus (trækkes fra kontoen) og salg bør være plus (lægges til). Lige nu er det modsat. Desuden placeres rytterne i forkert sæson — det rammer salg foretaget samme dag som en ny sæson starter (efter vinduet er lukket og rytteren er solgt).',
      code: '- `frontend/src/components/TeamTransferHistoryTab.jsx:182-186` — fortegn: `direction === "in" ? "+" : direction === "out" ? "-" : ""` (bør vendes: køb/in = "-", salg/out = "+")\n- `frontend/src/components/TeamTransferHistoryTab.jsx:100-106` — sortering/sæson-gruppering\n- `backend/lib/teamTransferHistory.js` — sæson-tildeling pr. transfer (grænse-dag-håndtering)',
    }),
  },
  {
    threadId: '1511423873978208346',
    title: 'Udlejning: max-grænser (antal/varighed), løndeling, label + indbakke-routing',
    type: 'feature',
    priority: 'med',
    body: body({
      date: '2026-06-02', author: 'bobby2106 + jeppek', threadId: '1511423873978208346',
      text: `Samlet ønske til udlejning af ryttere:
- Max på hvor mange ryttere et hold må leje **ind**.
- Max på hvor mange ryttere et hold må leje **ud**.
- Max på hvor lang tid en lejeaftale må vare (kun næste sæson — ikke fx 10 sæsoner frem).
- Mulighed for at det udlejende hold betaler en del af lønnen.
- "Foreslå lejeaftale": midterste række viser kun "0" uden label — bør angive at det er lejegebyr pr. sæson.
- Når man laver et lejetilbud, lander accepter/afvis-notifikationen i ens **egen** indbakke i stedet for modpartens. Klik bør navigere til accepter/afvis-visningen, ikke transfersiden.`,
      code: '- `backend/routes/api.js:2248-2304` — POST `/api/loans`-validering; ingen hardcap på antal ind-/udlejede fundet\n- `backend/routes/api.js:2256-2259` — varigheds-check (`end_season > start_season`); verificér mod "kun næste sæson"\n- `backend/routes/api.js:2298-2301` — `notifyTeamOwner(rider.team_id, …)` — verificér modtager (bruger melder eget tilbud lander i egen indbakke)',
      refs: '#160 (lejeaftale >1 sæson, lukket)',
    }),
  },
  {
    threadId: '1511432981330526278',
    title: 'Økonomiside: rework af struktur (faner, forecast, lån, sæson-historik)',
    type: 'feature',
    priority: 'low',
    body: body({
      date: '2026-06-02', author: 'jeppek', threadId: '1511432981330526278',
      text: `Forslag til overhaling af økonomisiden for bedre overblik/brugervenlighed:
- Flyt "økonomifanen" under Mit Hold ind som startskærm på økonomisiden (samlet overblik).
- Korrekt sæsonprognose med rigtig sponsorindtægt + præmiepenge-prognose, så man ser hvad man har til næste sæson.
- "Fordeling i denne sæson" kan blive eller flyttes til en separat fane koblet med sæson-/finansrapport, med vælger mellem sæsoner (historik på tværs af alle holdets sæsoner).
- Sponsor-modifier-kurven hører ikke til finansrapporten — flyt evt. til selve økonomisiden.
- Lån bør have egen fane, men aktivt lån + antal lån skal stadig vises samlet på økonomisiden (én linje).`,
      refs: '#60 (tydeliggør overlap Mit Hold ↔ Økonomi)',
    }),
  },
  {
    threadId: '1511426864961552577',
    title: 'Marked: genvej direkte til transferlisten + ryttersiden-lignende stats',
    type: 'feature',
    priority: 'low',
    body: body({
      date: '2026-06-02', author: 'jeppek', threadId: '1511426864961552577',
      text: 'Ønske: en knap under Marked, der fører direkte til transferlisten (færre klik). Derudover kunne transferliste-siden ligne ryttersiden, så man kan se alle stats på rytteren.',
      refs: '#58 (transferside: gruppér faner i modes)',
    }),
  },
  {
    threadId: '1511413819728072907',
    title: 'Sæson-snapshot: pointudviklings-graf bør forbedres eller fjernes',
    type: 'feature',
    priority: 'low',
    body: body({
      date: '2026-06-02', author: 'bobby2106', threadId: '1511413819728072907',
      text: 'Grafen for "Dit holds pointudvikling" på sæson-snapshot ser ikke pæn ud og bør enten forbedres visuelt eller fjernes. Der er et screenshot i Discord-tråden.',
    }),
  },
  {
    threadId: '1510407394851557538',
    title: 'Bestyrelse: forklar hvordan 3-årsplanens "top X i division" evalueres',
    type: 'feature',
    priority: 'low',
    body: body({
      date: '2026-05-30', author: 'jeppek', threadId: '1510407394851557538',
      text: 'Ved en 3-årsplan får man besked om at man skal være i top 5 ved planens afslutning. Det er uklart om det betyder slutplaceringen i sidste sæson, eller et gennemsnit over de tre sæsoner. UI bør forklare hvordan målet evalueres. Der er et screenshot i Discord-tråden.',
      refs: '#818 (forklar forhandlingsrækkefølge), #954 (transparens-epic)',
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
