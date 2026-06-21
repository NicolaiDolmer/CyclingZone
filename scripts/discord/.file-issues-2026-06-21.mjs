#!/usr/bin/env node
/**
 * Opret GitHub-issues + kommentarer fra Discord-feedback-sweep 2026-06-21
 * (11 nye tråde siden 2026-06-19-evening-sweep). UTF-8-sikkert via temp body-filer.
 * Kør IKKE blindt igen — idempotens findes ikke; tjek output for dubletter.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = 'Discord #samlet-feedback-features-og-bugs (sweep 2026-06-21)';

const ISSUES = [
  {
    title: '[ux] Auktionsside "Alle"-fanen (PC): kan ikke sortere på alder mm.',
    labels: ['claude:todo', 'type:feature', 'cat:user-feature', 'priority:low'],
    body: `På auktionssiden under fanen **"Alle"** kan man ikke sortere på alder (og lignende kolonner). Sortering bør virke på "Alle"-fanen ligesom på de øvrige faner.

**Kilde:** ${SRC} — @cybersimon, 2026-06-21 14:05, tråd 1518285801010626621 (m. screenshot, PC-visning).

**Relateret:**
- #259 [feature] Mobil auktion: tilføj sortering på 'Alle'-fanen — samme mangel, mobil-scope. Kan koordineres/foldes sammen.
- #1033 UI/UX-beslutning: skal auktion/standings-headers sortere eller afklikkes? — afklar mønster først.
- #228 Auktionsside: prioritér kolonner + ønskeliste-indikator.

**Accept:** "Alle"-fanen på auktionssiden (PC + mobil) kan sorteres på alder og de øvrige relevante kolonner.`,
  },
  {
    title: '[bug] Skadesvarighed viser "0 dage" på træningssiden trods resterende skadesdage',
    labels: ['claude:todo', 'type:bug', 'cat:bug', 'priority:med'],
    body: `På **træningssiden** står en rytter som skadet i **"0 dage"**, selvom rytteren faktisk har 3 dage tilbage af skaden. Dage-tælleren viser forkert (sandsynligvis off-by-one eller forkert felt/afrunding mellem skades-slutdato og "dage tilbage").

**Kilde:** ${SRC} — @bobby2106, 2026-06-21 15:36, tråd 1518278317961379850 (m. screenshot fra træningssiden).

**Relateret:** #1531 (synligt skade-badge under status) — denne er en separat *korrekthedsbug* i selve dage-tallet, ikke badge-synlighed.

**Accept:** Skadesvarighed på træningssiden viser det korrekte antal resterende dage. Verificér mod en rytter med kendt skades-slutdato.`,
  },
  {
    title: '[bug] Visse ryttere mangler stats helt (fx Qiang Zhou, Daniel Cabrera) — find rod-årsag + forward-guard',
    labels: ['claude:todo', 'type:bug', 'cat:bug', 'priority:high'],
    body: `Nogle ryttere har **ingen stats overhovedet** (tomme/manglende evne-/stat-felter). Konkrete eksempler nævnt: **Qiang Zhou** og **Daniel Cabrera**. Ejer-direktiv: "Find ud af hvorfor og sørg for det ikke sker igen."

Dette er en data-integritets-bug — formentlig fra seed/generator/derive-pipeline hvor enkelte ryttere falder igennem.

**Kilde:** ${SRC} — @jeppek (m. screenshot), bekræftet af @bobby2106 + @cybersimon, 2026-06-21 14:39, tråd 1518264210998693888.

**Accept (backwards-check + forward-guard):**
- [ ] Find rod-årsagen til at disse ryttere mangler stats.
- [ ] Backwards-check: find ALLE ryttere i prod med manglende stats (ikke kun de 2 navngivne) og ret dem.
- [ ] Forward-guard: tilføj invariant/test/CI-tjek så ryttere ikke kan oprettes/seedes uden stats.
- [ ] Postmortem i \`.claude/learnings/\`.`,
  },
  {
    title: '[ux] Vis rytterens alder igen på rytteroverblik + transferliste',
    labels: ['claude:todo', 'type:feature', 'cat:user-feature', 'priority:med'],
    body: `Rytterens **alder** skal vises igen på rytteroverblikket (ryttersiden). Gælder også **transferlisten**.

**Kilde:** ${SRC} — @bobby2106, 2026-06-21 14:27, tråd 1518261092818747533; @jeppek tilføjer at det også gælder transferlisten.

**Relateret:** #1537 (rytterdatabase-kolonner: status+hold-sortering, ryttertype-kolonne, fjern potentiale, CZ-evner) — alder-kolonnen koordineres med den kolonne-gennemgang.

**Accept:** Alder er synlig på rytteroverblik + transferliste.`,
  },
  {
    title: '[ux] Smalle sider med for meget whitespace: transferliste + andre holds holdside skal bruge fuld bredde',
    labels: ['claude:todo', 'type:feature', 'cat:user-feature', 'priority:low'],
    body: `To sider er for smalle og har for meget tom whitespace i siderne — de skal bredes ud (samme bredde som rytter-markedet / fuld content-bredde):

1. **Transferlisten** — skal bredes ud, så den har samme bredde som rytter-markedet. (@jeppek, 2026-06-21 14:18, tråd 1518258763738644541)
2. **Andre managers holdside** (fx \`/teams/<id>\`) — for meget whitespace. (@bobby2106, 2026-06-20 08:18, tråd 1517805710140768296)

**Kilde:** ${SRC}.

**Relateret:**
- #1027 Pre-launch UI: whitespace/density + nav-header/IA-restructure (bred paraply).
- #1523 (transferliste: rækker i stedet for cards — LUKKET/leveret) — denne handler om *bredde*, ikke format.

**Accept:** Begge sider bruger fuld content-bredde uden overdreven side-whitespace; konsistent med rytter-markedet.`,
  },
  {
    title: '[balance/feature] Træthed: daglig recovery (mod midnat) + transparens om hvornår/hvorfor energi vender tilbage',
    labels: ['claude:todo', 'type:feature', 'cat:user-feature', 'epic:progression', 'priority:high'],
    body: `**Daglig recovery:** Hver dag (omkring midnat) bør ryttere blive mindre trætte, så trætheden ikke bliver hængende på 100% når den først er nået. De kan stadig blive mere trætte i løbet af dagen, når de kører løb og træner.

**Transparens:** Det skal være nemmere at forstå **hvornår og hvorfor** man får energi tilbage. Konkret spørgsmål fra ejer: "Får man energi tilbage hver dag?" — svaret skal være synligt i UI.

**Kilde:** ${SRC}:
- @jeppek, 2026-06-19 09:04, tråd 1517455122790350898 (daglig recovery mod midnat).
- @bobby2106, 2026-06-21 14:03, tråd 1518254948859645993 ("Skal fikses inden start": transparens + daglig recovery).

**Relateret:** #931 (Træningssystem-epic), #1306 (Form/Træthed-spine — lukket). epic:progression.

**Accept:**
- [ ] Træthed reduceres dagligt (midnats-tick) i stedet for at sidde fast på 100%.
- [ ] UI forklarer recovery-reglen (hvornår + hvor meget energi der vender tilbage pr. dag).`,
  },
  {
    title: '[feature] Fyr/opsig rytterkontrakter (frigør rytter fra holdet)',
    labels: ['claude:todo', 'type:feature', 'cat:user-feature', 'epic:economy-overhaul', 'priority:med'],
    body: `Det skal være muligt at **fyre / opsige** en rytters kontrakt og frigøre ham fra holdet. Dette er en kerne-manager-mekanik der mangler.

Økonomi-konsekvens skal afklares (fritkøbs-omkostning / resterende løn / straf?) — koordinér med økonomi-epic.

**Kilde:** ${SRC} — @bobby2106, 2026-06-21 14:03, tråd 1518254948859645993 ("Skal fikses inden start": "Fyringer").

**Relateret:** #1310 (markeds-pakke: forlængelse/uopfordrede bud — *forlængelse* dækkes der; *fyring/release* er ikke i scope der). epic:economy-overhaul.

**Accept:** Manager kan opsige en rytters kontrakt; økonomi-effekt defineret og vist; rytteren bliver fri/går på markedet.`,
  },
  {
    title: '[economy] Sæson 1-start: ingen sponsorpenge hvis hold har fået startkapital + ingen upkeep før sæsonen går i gang',
    labels: ['claude:todo', 'type:feature', 'cat:user-feature', 'epic:economy-overhaul', 'priority:high'],
    body: `To økonomi-regler for sæson 1-start (ejer-direktiv "skal fikses inden start"):

1. **Ingen sponsorpenge i sæson 1** hvis holdet allerede har fået **startkapital** (undgå dobbelt-indtægt ved opstart).
2. **Ingen upkeep/driftsomkostninger** før sæsonen reelt er gået i gang (hold betaler ikke upkeep i opstartsfasen).

**Kilde:** ${SRC} — @bobby2106, 2026-06-21 14:04, tråd 1518254948859645993.

**Relateret:** #1663 (renown-skaleret sponsor — MERGED), #1441 (økonomi-epic anti-inflation). epic:economy-overhaul.

**Accept:**
- [ ] Hold med startkapital får ikke sponsor-udbetaling i sæson 1.
- [ ] Upkeep trækkes ikke før sæson-start.
- [ ] Verificér mod fresh-gate / økonomi-harness så det ikke skævvrider balancen.`,
  },
  {
    title: '[feature] Se andre holds træning på deres ryttere',
    labels: ['claude:todo', 'type:feature', 'cat:user-feature', 'priority:low'],
    body: `Man skal kunne se **andre holds træning** på deres ryttere (hvad de andre hold træner deres ryttere i), ikke kun sit eget holds træning.

**Kilde:** ${SRC} — @bobby2106, 2026-06-21 14:07, tråd 1518254948859645993 ("Skal fikses inden start").

**Accept:** Når man kigger på et andet holds ryttere, kan man se deres træningsvalg/-status (read-only).`,
  },
  {
    title: '[forever] Sæson 1 ikke længere låst for nye hold (start med ryttere fra dag 1) + bestyrelse låst op fra start',
    labels: ['claude:todo', 'type:feature', 'cat:user-feature', 'slice:season-1', 'priority:high'],
    body: `Til forever-relaunch ("skal fikses inden start"):

1. **Sæson 1 skal ikke længere være låst for nye hold.** Et nyt hold skal kunne komme ind fra start — man starter med sine ryttere, og holdet "bare kommer" efter man har fået sine ryttere (ikke en låst/lukket sæson).
2. **Bestyrelsen skal låses op inden start** — board/bestyrelses-funktionen skal være tilgængelig for nye hold fra begyndelsen.

**Kilde:** ${SRC} — @bobby2106, 2026-06-21 14:41, tråd 1518254948859645993.

**Relateret:** #1105 (forever-relaunch epic), #1560 (nye hold fik INGEN starttrup — lukket), #1596 (WS1-aktivering). slice:season-1.

**Accept:**
- [ ] Nye hold kan oprettes og komme ind i sæson 1 efter relaunch (ikke blokeret af "sæson låst").
- [ ] Nyt hold får sin starttrup + bestyrelsen tilgængelig med det samme.`,
  },
  {
    title: '[ux] Holdudtagelse svær at finde — gør funktionen synlig/findbar',
    labels: ['claude:todo', 'type:feature', 'cat:user-feature', 'priority:med'],
    body: `Ejeren kunne ikke finde holdudtagelses-funktionen og spurgte: "Kan man selv udtage trupper? Hvor finder man holdudtagelsesfunktionen?"

Funktionen findes (jf. #1307 holdudtagelse + #1560), men den er **ikke findbar nok** i UI'et — et discoverability-problem. Hvis selv ejeren ikke kan finde den, gør nye spillere det heller ikke.

**Kilde:** ${SRC} — @bobby2106, 2026-06-21 15:35, tråd 1518254948859645993.

**Relateret:** #1307 (holdudtagelse + kaptajn/hjælpere), #1560 (tom-trup), #1569 (onboarding-audit).

**Accept:** Holdudtagelse er tydeligt tilgængelig fra et logisk sted (fx hold-/dashboard-nav) med klar label.`,
  },
  {
    title: '[decision] Forever-relaunch league-struktur: skal div 1 fyldes med AI-hold? Skal puljer til div 2 + 3 laves fra start?',
    labels: ['claude:todo', 'type:task', 'needs-decision', 'cat:user-feature', 'priority:med'],
    body: `Åbne ejer-beslutninger om league-struktur ved forever-relaunch ("skal fikses inden start"):

1. **Skal 1. division fyldes op med AI-hold?**
2. **Skal der laves puljer/divisioner til division 2 og 3 med det samme** (fra start)?

Dette er strukturelle beslutninger der påvirker hvordan relaunch-sæsonen sættes op.

**Kilde:** ${SRC} — @bobby2106, 2026-06-21 14:04, tråd 1518254948859645993.

**Relateret:** #1608 ([Epic] Skalerbar divisions-struktur 20→1000+ hold), #1152 ([Design] Divisions, promotion/relegation, newcomer catch-up), #1616 (Beslutnings-session: åbne ejer-beslutninger).

**Næste skridt:** Ejer-beslutning → derefter konkret implementerings-issue.`,
  },
];

const COMMENTS = [
  {
    n: 1310,
    body: `**Discord-feedback 2026-06-21 (@bobby2106, "Skal fikses inden start", tråd 1518254948859645993):** ejeren bekræfter at to dele af denne pakke ønskes prioriteret **inden forever-relaunch**, ikke kun som fast-follow:

- **Kontraktforlængelse** ("Muligt at forlænge kontrakter - Det skal laves") → dækkes af scope-punkt 5 (forlængelses-vindue).
- **Altid-åben handel** ("Man skal kunne handle hele tiden, også midt på sæsonen og ikke i transfervinduer") → dækkes af scope-punkt 6 (ingen transfervinduer + Deadline Day).

Filed som kommentar frem for dubletter, da begge allerede er i scope her. Overvej at hive forlængelses-UI + altid-åben-handel ud som launch-prioritet hvis resten af pakken glider.`,
  },
  {
    n: 959,
    body: `**Discord-feedback 2026-06-21 (@bobby2106) — tre konkrete V1-tilføjelser til etaperesultat-visningen:**

1. **Filtrér resultater på hold** — "kun eget hold" eller vælg et bestemt hold frem, så man kan se hvordan alle ryttere fra det hold klarede sig på etapen. (tråd 1518258590643654807, 14:17)
2. **Vis trøje-klassementer på etaperesultater** — top 10 i klassementet (GC) + ungdomstrøjen og den slags pr. etape. (tråd 1518258228771684585, 14:16)
3. **Progressiv visning + skjul tomme** — vis kun **top 10** først, med "se alle resultater"-udvidelse til hele feltet. Ryttere uden point skal **ikke** fremgå på bjergpoint-/pointtrøje-lister. (tråd 1518257724696170566, 14:14)

Punkterne 2+3 ligger i V1-scope (de 5 klassifikationer findes i \`race_results\`). Filtrering på hold (1) koordineres med #923. Ejer-prioritet noteret. Filed som kommentar frem for dubletter (samme præcedens som 19/6-sweep).`,
  },
  {
    n: 1378,
    body: `**Discord-feedback 2026-06-21 (@bobby2106, tråd 1518260174534480004, m. screenshot):** konkret fejlklassificerings-eksempel der hører under denne kalibrering:

> "Det er kritisabelt at disse ryttere ikke er blevet bakkeryttere i ryttertype. Hvis man er langt bedre i bakker end man er i bjerge, så skal man ikke være climber."

Dvs. ryttere der er markant stærkere i **bakker/punch** end i **bjerge** klassificeres fejlagtigt som **climber** i stedet for **puncheur/bakkerytter**. Brug dette som test-case når \`computeRiderTypes\` z-score-kontrast + guards kalibreres. (NB: "Luka fra polen tæller ikke med i kritikken.")`,
  },
];

function createIssue(it) {
  const tmp = path.join(os.tmpdir(), `cz-issue-${Math.abs(it.title.length * 7 + it.title.charCodeAt(0))}.md`);
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

function addComment(c) {
  const tmp = path.join(os.tmpdir(), `cz-comment-${c.n}.md`);
  fs.writeFileSync(tmp, c.body, 'utf8');
  try {
    const out = execFileSync('gh', ['issue', 'comment', String(c.n), '--body-file', tmp], { encoding: 'utf8' });
    console.log(`OK  comment #${c.n}  ::  ${out.trim().split('\n').pop()}`);
  } catch (e) {
    console.log(`FAIL comment #${c.n}\n     ${(e.stderr || e.message || '').toString().trim().slice(0, 300)}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

console.log('=== Opretter issues ===');
for (const it of ISSUES) createIssue(it);
console.log('\n=== Tilføjer kommentarer ===');
for (const c of COMMENTS) addComment(c);
console.log('\nDONE');
