#!/usr/bin/env node
/**
 * Opret GitHub-issues fra Discord-feedback-sweep 2026-06-21 aften
 * (4 nye tråde siden 2026-06-21-sweep, cutoff 1518285801010626621).
 * UTF-8-sikkert via temp body-filer. Kør IKKE blindt igen — ingen idempotens.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = 'Discord #samlet-feedback-features-og-bugs (sweep 2026-06-21 aften)';

const ISSUES = [
  {
    title: '[bug] Auktion vundet: dobbelt "du vandt"-notifikation + pris vises i "point" i stedet for CZ $',
    labels: ['claude:todo', 'type:bug', 'cat:bug', 'priority:med'],
    body: `To fejl når en auktion afsluttes og man **vinder** den:

1. **Dobbelt notifikation** — man får **2 beskeder** om at man har vundet auktionen. Der bør kun komme én.
2. **Forkert valuta-visning** — prisen på den vundne rytter vises i **"point"**. Det er forkert: rytteren kostede **CZ $**. Valuta-label/feltet er forkert i vundet-beskeden.

**Kilde:** ${SRC} — @bobby2106, 2026-06-21 18:42, tråd 1518325176771674113 (m. screenshot der viser begge fejl).

**Accept:**
- [ ] Der sendes kun **én** vundet-notifikation pr. afsluttet auktion (find kilden til duplikatet — fx både realtime-event + finalization-tick, eller dobbelt-render).
- [ ] Prisen vises i **CZ $** (korrekt valuta), ikke "point".`,
  },
  {
    title: '[bug] Auktion: vundet rytter afvises trods ledig plads + man kan tabe en førende auktion når truppen bliver fuld',
    labels: ['claude:todo', 'type:bug', 'cat:bug', 'priority:high'],
    body: `Auktions-/trup-placeringslogikken fejler i to relaterede tilfælde (ejer-rapport, vigtig korrekthedsbug — kan koste spilleren rytter og penge):

1. **Vundet rytter må aldrig afvises når der er ledig plads.** Når man vinder en rytter på auktion og der ER ledig plads, skal rytteren placeres på **seniorholdet eller akademiet** (alt efter hvad der giver mening). Lige nu kan rytteren blive **afvist til holdet** selvom der stadig er ledig plads — det må ikke ske.
2. **Bloker bud når truppen er fuld** (i stedet for at lade spilleren tabe). Hvis der **ikke** er ledig plads, skal man slet ikke kunne **afgive bud**. Man skal ikke kunne **miste en auktion man fører**, fordi pladsen forsvinder undervejs — buddet skal blokeres på forhånd (med klar besked), ikke fejle ved tildeling.

**Kilde:** ${SRC} — @bobby2106, 2026-06-21 16:44, tråd 1518295586112143451 (m. screenshot).

**Accept:**
- [ ] Vundet rytter placeres automatisk på senior/akademi efter ledig kapacitet; **aldrig afvist** når der er plads.
- [ ] Bud **blokeres med klar besked** når truppen er fuld; en førende auktion kan ikke længere gå tabt pga. "ingen plads".
- [ ] Verificér begge stier: (a) plads ved tildeling, (b) ingen plads → bud-knap disabled/afvist før afgivelse.`,
  },
  {
    title: '[copy] Landing-side: grammatik + klarhed efter founder-voice-relaunch (jeppek + cybersimon)',
    labels: ['claude:todo', 'type:task', 'cat:user-feature', 'priority:high'],
    body: `To testere gav detaljeret copy-feedback på den **relancerede founder-voice landing** (#671/#672-relaunch). Vi er i marketing-go — landingssiden er det første marketing-trafik ser, så grammatik-fejl + et utydeligt fairness-løfte rammer direkte. Samlet i ét issue da begge testere kommenterer de samme linjer.

> **Founder-tone:** per arbejdsdeling skriver Nicolai selv den endelige founder-prosa (klarheds-/tone-punkterne i Del 2). Claude kan rette de objektive fejl i Del 1 og levere struktur/forslag til Del 2.

## Del 1 — Objektive sprogfejl (kan rettes nu)
- Apostrof-sammentrækninger gennemgående: \`I am\` → \`I'm\`, \`It is not\` → \`It's not\`, \`The Discord is where I share what I am working on\` → \`I'm working on\`.
- \`Nothing to download, nothing to update.\` → \`Nothing to download or update.\`
- \`a cycling manager\` → \`a cycling manager game\`.
- \`what I build next\` → \`what I'll build next\` (eller \`what I'll work on next\`).
- \`Cycling Zone started as one idea\` → \`an idea\`.

## Del 2 — Klarhed / formulering (afventer founder-prosa)
**Hero:**
- @jeppek foreslår rewrite: *"Build your team, bid on riders in live auctions, and take control of every decision throughout the season. Climb through the divisions — all directly from your browser."* (NB: tjek em-dash mod tone-reglen.)

**"Four Decisions, One Season":**
- Overvej \`every season\` i stedet for \`one season\` (begge testere).
- Kort #1: \`plan\` → \`strategy\`; \`Flat\` → \`sprints\`.
- \`Riders with real, readable ratings\` lyder mærkeligt for **begge** testere — hvad betyder "readable ratings"? Hvis det handler om udvikling: noget a la \`Riders with growing potential\`.
- Kort #3: \`Name\` → \`Pick\`; \`plan the breakaway opportunities\` (man planlægger ikke et udbrud) → fx \`decide who's chasing the breakaway\`.
- Kort #4: \`race the calendar\` er uklar (planlægger man kalenderen eller følger man løb?); \`Stages\` → \`stage races\`; afslutningen \`..., then build for the next one\` — \`one\` → \`race\` eller \`season\` (uklart om næste løb eller næste sæson). Begge testere nævner #4.
- @cybersimon: \`A FULL SEASON OF RESULTS\` lyder mærkeligt — fjern/erstat, fx med fokus på at man kan **træne ryttere** og **finde/udvikle næste stjerne via akademiet**.

**"Built on one promise":**
- **Vigtigst:** fairness-sætningen \`The game must be fair for everyone. You cannot pay for better riders, faster training, or better results.\` kan **misforstås** — det lyder som om man slet ikke kan *købe* ryttere. Gør eksplicit at det er **rigtige penge** der ikke giver fordele (ikke in-game-valuta). Gælder også \`Strategy over spending\` (læses stadig som in-game-penge). Begge testere.
- @cybersimon: under-overskriften \`Strategy over spending\` passer ikke helt ind, når pay-to-win allerede nævnes under 2 andre punkter.
- \`The game is built in the open\` / \`in the open\` er uklart for læseren — hvad er "åbent"? Præcisér (build-in-public?).
- \`I am making it on my own, in the open, season by season\` — uklar (laver du det "on the fly" hver sæson?).
- \`and help shape where it goes\` → overvej \`shape what comes next\` / \`shape the future of the game\`.
- \`Open the Discord\` → kan ændres til \`Go to the Discord\` (begge virker).
- \`No install\`: \`in your browser\` (nuværende) er fint; \`on your browser\` er et alternativ.

**Kilde:** ${SRC}:
- @jeppek, 2026-06-21 19:47 + 20:05, tråd 1518341550285918378.
- @cybersimon, 2026-06-21 19:46, tråd 1518341244332540075.

**Relateret:** #672 (oprindelig landing-byg), #671 (brand/wordmark), #1576 (AI-slop cleanup). Tone-regler: \`docs/TONE_OF_VOICE.md\` (ingen em-dash, ingen "støtte" som verb).`,
  },
];

function createIssue(it) {
  const tmp = path.join(os.tmpdir(), `cz-issue-ev-${Math.abs(it.title.length * 7 + it.title.charCodeAt(0))}.md`);
  fs.writeFileSync(tmp, it.body, 'utf8');
  const args = ['issue', 'create', '--title', it.title, '--body-file', tmp];
  for (const l of it.labels) { args.push('--label', l); }
  try {
    const out = execFileSync('gh', args, { encoding: 'utf8' });
    const url = out.trim().split('\n').pop();
    console.log(`OK  ${url}  ::  ${it.title}`);
  } catch (e) {
    console.log(`FAIL  ${it.title}\n     ${(e.stderr || e.message || '').toString().trim().slice(0, 300)}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

console.log('=== Opretter issues ===');
for (const it of ISSUES) createIssue(it);
console.log('\nDONE');
