#!/usr/bin/env node
/** #2456: ejer-låst scope 15/7 — behold ungdomsauktion, usolgt = væk. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cz2456s-'));

const body = `## Scope LÅST 15/7 (ejer) — behold ungdomsauktionen, usolgt = væk

Mit åbne spørgsmål om \`listRejectedAsYouthAuction\` er besvaret. **Ejer: "Behold auktionen — usolgt = væk."**

### Sådan hænger de to ting sammen (verificeret mod kode + prod)

Ungdomsauktionen er kæden fra et *fravalg* til de andre holds *chance*:

1. Akademiet tilbyder et kuld på 3-5 kandidater (\`academy_intake\`, status \`offered\`).
2. Manageren **afviser** en → \`rejectAcademyCandidate\` (\`backend/lib/academyIntake.js:480-481\`) kalder \`listRejectedAsYouthAuction\`.
3. Auktion oprettes til **25 % af markedsværdien** (\`YOUTH_AUCTION_START_RATE = 0.25\`, \`backend/lib/youthMarket.js:13\`), **uden sælger** (\`seller_team_id = NULL\`) — den afvisende klub får intet. Vinderens bud betales som \`academy_signing\` = **gold sink**.
4. Vinder → rytteren ind i vinderens akademi.
5. **Ingen bud → "fri ungdom"** → lander på fri-agent-listen. ← dét er koblingen mellem de to features.

**Prod-tal (15/7):**

| | |
|---|---|
| Ungdomsauktioner i alt | 40 |
| Solgt til **ægte** hold | **35** (gnsn. 11.344 CZ$) |
| Gik usolgt | **5** |
| \`academy_intake\`: offered / signed / rejected | 229 / 224 / 41 |

Alle 5 usolgte er siden samlet op via fri-listen (3 i et akademi, 2 på et seniorhold). Mekanikken bruges og virker — derfor bevares den.

### ⚠️ Korrektion: "21 % supply-hul" var misvisende (mit tal, min fejl)

Jeg skrev tidligere at fri-listen udgør **~21 %** af akademi-tilgangen (22 af 106 signeringer/14 dage). Tallet er korrekt målt, men **fortolkningen var forkert**, og jeg gav ejeren det som beslutningsgrundlag.

De 22 signeringer var **forbrug af en endelig seed-pulje** (batchen fra 22/6 kl. 13:48:45), ikke en bæredygtig strøm. Verificeret: de 10 ryttere jeg slettede havde **nul auktions-historik** — de kom aldrig gennem pipelinen. Den ægte, løbende produktion fra pipelinen er **5 frie ungdomsryttere på 3 uger** (de 5 usolgte auktioner), dvs. ca. **~6 % af tilgangen**, ikke 21 %.

Seed-puljen er nu tømt (10 slettet + 51 tidligere signeret). **Konsekvens: supply-hullet ved at fjerne fri-listen er ~6 %, ikke ~21 %** — og med "usolgt = væk" bliver det ~0 %, fordi de 5 aldrig når listen. #2064-koordineringen er dermed langt mindre presserende end jeg først skrev.

### Den låste kontrakt

| Del | Beslutning |
|---|---|
| Fri-agent-liste i akademiet ("butikken") | **Fjernes** — funktionen, ikke bare knappen |
| Ungdomsauktion (afvist kandidat → 25 %, ingen sælger, bud = sink) | **Bevares uændret** |
| Usolgt ungdomsauktion | **Rytteren slettes** — forlader sporten. Ingen fri-liste at falde ned på |
| Eget akademi-intake (\`signAcademyCandidate\`) | **Bevares** — ejer-krav: "der skal stadig komme løbende talenter ind til en selv på eget akademi" |

Begrundelsen for "usolgt = væk": det er realistisk (et talent ingen vil have, bliver ikke prof), og det undgår at producere holdløse spøgelsesryttere — præcis den tilstand #2257 allerede rapporterer som en bug. Rammer ~5 ryttere pr. 3 uger.

### Implementering (rest — data er allerede ryddet, se kommentar ovenfor)

- [ ] **Fjern fri-agent-flowet:**
  - \`backend/routes/api.js\` — \`freeAgents\`-blokken (~10874-10920) + sign-route (~11055+)
  - \`backend/lib/youthMarket.js\` — \`signFreeAgentYouth\` (142-221)
  - \`frontend/src/lib/useAcademy.js\` — \`freeAgents\`, \`signFreeAgent\`
  - \`frontend/src/pages/AcademyPage.jsx\` — ~435-489 (\`freeAgentsHeading\`-sektionen)
- [ ] **Usolgt auktion → slet rytteren.** Hører hjemme i auktions-finaliseringen. Guard: må ALDRIG slette en rytter der imens er blevet signeret/har fået et hold (TOCTOU) — verificér \`team_id IS NULL\` i selve sletningen, scoped til rider-id.
- [ ] **#1847-fælden:** sletning af en rytter sætter \`race_results.rider_id\` til NULL (\`ON DELETE SET NULL\`). En usolgt ungdomsrytter har normalt 0 resultater, men **verificér det i koden** før sletning — ellers producerer denne feature nye orphans oven i de 13.262, der allerede findes ([#1847](https://github.com/NicolaiDolmer/CyclingZone/issues/1847), hævet til high i dag).
- [ ] Ryd \`listRejectedAsYouthAuction\`'s doc-kommentar: "ingen bud → rytteren forbliver fri ungdom" er ikke længere sandt.
- [ ] Patch note + help (en+da) — brugerrettet fjernelse + ny konsekvens ved at afvise.
- [ ] Drop \`backup_2456_*\`-tabellerne når fjernelsen er verificeret i prod (#1972/#2259).

**Bemærk konsekvensen for spillet:** med "usolgt = væk" får det nu en pris at afvise en kandidat — han kan blive samlet op af en rival (35 gange indtil nu), eller han kan forsvinde for altid. Det gør intake-beslutningen til et ægte valg i stedet for en gratis filtrering. Det trækker samme vej som #1922 (træning skal have reelle trade-offs).`;

const f = path.join(tmp, 'c-2456.md');
fs.writeFileSync(f, body, 'utf8');
gh(['issue', 'comment', '2456', '--body-file', f]);
console.log('  #2456 kommenteret (scope låst)');
gh(['issue', 'edit', '2456', '--remove-label', 'needs-decision']);
console.log('  #2456: needs-decision fjernet');
console.log('\nFÆRDIG.');
