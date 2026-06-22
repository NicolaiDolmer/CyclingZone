#!/usr/bin/env node
/**
 * Opret GitHub-issues + dedup-kommentarer fra Discord-feedback-sweep 2026-06-22
 * (21 nye tråde siden cutoff 1518347996545155162). 13 nye issues + 5 kommentarer
 * på eksisterende issues. UTF-8-sikkert via temp body-filer.
 * Kør IKKE blindt igen — ingen idempotens.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = 'Discord #samlet-feedback-features-og-bugs (sweep 2026-06-22)';
const BUG = (p) => ['claude:todo', 'type:bug', 'cat:bug', `priority:${p}`];
const FEAT = (p) => ['claude:todo', 'type:task', 'cat:user-feature', `priority:${p}`];

const ISSUES = [
  {
    title: '[bug] Bestyrelse: forhandling refererer holdfokus (sprint) der ikke matcher valgt DNA (British All-rounder)',
    labels: BUG('med'),
    body: `Bestyrelsesforhandlingen siger at holdet har **sprint-fokus**, men holdets valgte **DNA er British All-rounder**. Sprint-fokus er ikke valgt nogen steder, og spilleren kan ikke finde hvor det kommer fra — uigennemsigtigt og selvmodsigende.

**Kilde:** ${SRC} — @jeppek, 2026-06-22 19:50, tråd 1518704676881567984 (2 screenshots).

**Accept:**
- [ ] Find hvor 'sprint-fokus' i bestyrelses-forhandlingen kommer fra når DNA = British All-rounder.
- [ ] Forhandlings-mål/fokus skal matche holdets faktiske DNA/holdfokus (eller forklare relationen tydeligt i UI).

**Relateret:** #1239 (Board-DNA og holdfokus v2), #1721 (bestyrelse aktiv i sæson 1).`,
  },
  {
    title: '[bug] AI-hold fjernes ikke fra divisionen når et rigtigt hold rykker ind',
    labels: BUG('med'),
    body: `Når et rigtigt (manager-)hold kommer ind i en division, bliver et AI-hold ikke fjernet for at give plads. Et AI-hold skal fjernes når et rigtigt hold tilføjes, så divisionsstørrelsen holdes konstant.

**Kilde:** ${SRC} — @jeppek, 2026-06-22 19:32, tråd 1518700204335960085.

**Accept:**
- [ ] Når et rigtigt hold tilføjes en division, fjernes ét AI-fyld-hold.
- [ ] Verificér divisionsstørrelse forbliver korrekt på tværs af tilmeldinger.

**Relateret:** #1682 (decision: AI-fyld i div 1), #1680 (sæson 1 ikke låst for nye hold), #1608 (skalerbar divisions-struktur), #1688 (additive follow-ups efter form-frys).`,
  },
  {
    title: '[bug] Auktion: spiller med auto-bud får "overbudt"-besked selvom han stadig fører',
    labels: BUG('med'),
    body: `Man får en 'du er blevet overbudt'-besked selvom man **stadig fører** auktionen. @cybersimon bekræfter at det sker **når modtageren har et auto-bud** (proxy-bud): når en anden byder, men ens auto-bud automatisk overbyder dem igen, sendes der alligevel en overbudt-besked. Man skal kun have beskeden hvis man **rent faktisk** ender med at være overbudt.

**Kilde:** ${SRC} — @bobby2106 (2 screenshots) + @cybersimon, 2026-06-22 19:25-19:26, tråd 1518698498457866300.

**Accept:**
- [ ] Overbudt-notifikation sendes kun når spilleren faktisk er overbudt efter auto-bud-resolution (ikke når eget auto-bud genvinder føringen).
- [ ] Verificér med auto-bud-scenarie: A fører via auto-bud, B byder under A's loft → A skal IKKE få overbudt-besked.

**Relateret:** #1693 (dobbelt vundet-notifikation), #230 (auto-cancel proxy-bud over loft).`,
  },
  {
    title: '[bug] Transaktions-/transferhistorik er misvisende — kan ikke se om en rytter er købt eller solgt',
    labels: BUG('med'),
    body: `Historikken giver ikke mening: man kan ikke se om en rytter er **købt** eller **solgt** i en given postering. To screenshots viser posteringer der er uforståelige.

**Kilde:** ${SRC} — @bobby2106 (2 screenshots), 2026-06-22 19:13-19:17, tråd 1518695518241554582.

**Accept:**
- [ ] Hver historik-postering viser tydeligt retning (køb vs salg) + beløb med korrekt fortegn.
- [ ] Verificér mod screenshot-eksemplerne i tråden.

**Relateret:** tidligere transferhistorik-feedback (fortegn på køb/salg).`,
  },
  {
    title: '[bug] Pensionerede ryttere optræder stadig under "Frie ungdomsryttere" — skal fjernes',
    labels: BUG('med'),
    body: `Der ligger fortsat **pensionerede** ryttere i puljen af frie ungdomsryttere. Disse skal fjernes.

Eksempler:
- https://cyclingzone.org/riders/5bfedf21-1e70-4d0e-8bc6-54576f5cb4e6
- https://cyclingzone.org/riders/71aebdbd-64fa-4951-bfff-c63765ea9752

**Kilde:** ${SRC} — @jeppek, 2026-06-22 18:57, tråd 1518691479021948980.

**Accept:**
- [ ] Pensionerede ryttere udelukkes fra frie-ungdomsryttere-puljen.
- [ ] De to nævnte eksempel-ryttere er ikke længere i puljen.
- [ ] Forward-guard: pensionering fjerner rytter fra ungdoms-/frie-markeder.

**Relateret:** #1713 (frie ungdomsryttere pris), #932 (ungdomsakademi), #1137 (retirement).`,
  },
  {
    title: '[feature] Intake-ryttere skal skjules fra rytterdatabasen indtil de hentes (begrænset spejder-info)',
    labels: FEAT('med'),
    body: `Intake-ryttere bør **ikke** kunne findes i rytterdatabasen, og man bør ikke kunne klikke ind på deres fulde stats før de er hentet til akademiet. De bør først oprettes som fuldt synlige ryttere når en manager henter dem.

Det eneste man bør kunne se om en intake-rytter før hentning:
- Hvor stort potentialet er
- Pris for at hente
- Alder
- Navn
- Nationalitets-flag
- Om de er en seriøs kandidat

**Kilde:** ${SRC} — @jeppek, 2026-06-22 18:55, tråd 1518690920554299573.

**Accept:**
- [ ] Intake-ryttere er ikke søgbare/klikbare i den almindelige rytterdatabase.
- [ ] Intake-visning viser kun: potentiale, pris, alder, navn, flag, seriøs-kandidat-flag.
- [ ] Fulde stats afsløres først efter hentning til akademiet.

**Relateret:** #932 (ungdomsakademi: intake/udvikling), #1138 (scouting & skjult potentiale).`,
  },
  {
    title: '[ux] Akademi: vis tydeligt hvad det koster at hente en rytter + "er du sikker"-bekræftelse',
    labels: FEAT('med'),
    body: `To relaterede ønsker om akademi-hentning (samme flade):

1. **Tydelig pris ved hentning** (@bobby2106): når man henter en rytter fra akademiet/intake, skal det **tydeligt forklares hvad det koster** (jf. vedhæftet eksempelbillede med klar pris-visning).
2. **Bekræftelses-modal** (@bobby2106): der bør komme en **'er du sikker?'-modal** op når man vil **købe en rytter i akademiet for penge**, så man ikke ved et uheld bruger penge.

**Kilde:** ${SRC}:
- @bobby2106, 2026-06-22 18:44, tråd 1518688114011541756 (m. eksempelbillede). Bekræftet af @cybersimon.
- @bobby2106, 2026-06-22 16:50, tråd 1518659436472696962.

**Accept:**
- [ ] Hentning/køb fra akademiet viser prisen tydeligt før bekræftelse.
- [ ] Køb for penge kræver eksplicit bekræftelse (modal med pris + saldo-effekt).

**Relateret:** #1713 (akademi: frie ungdomsryttere skal koste den viste pris — billings-siden af samme flade).`,
  },
  {
    title: '[bug] Op-/nedrykning i divisioner: forvirrende visning + antal skal stemme på tværs af puljer',
    labels: BUG('med'),
    body: `Forvirring om op-/nedrykning i 3. division:
- Første fane viser alle samlet i én tabel med '2 op / 2 ned'.
- Når man går ind i hver **pulje** i divisionen står der yderligere '2 op / 2 ned' **per pulje**.
- Det er uklart hvad der gælder, og tallene virker ikke til at stemme.
- Op- og nedrykning skal hænge sammen: hvis 2 fra hver 3.-divisions-pulje rykker op, skal der tilsvarende rykke 4 ned fra hver 2.-division (antal ind = antal ud).

**Kilde:** ${SRC} — @jeppek, 2026-06-22 16:08, tråd 1518648834257981551.

**Accept:**
- [ ] Konsistent, entydig visning af hvor mange der rykker op/ned (samlet vs. per pulje).
- [ ] Op-/nedrykningsantal balancerer på tværs af divisioner/puljer.

**Relateret:** #1152 (divisions-design: promotion/relegation), #1718 (standings viser ikke div 1+2), #1682 (league-struktur).`,
  },
  {
    title: '[feature] Konto-indstillinger: skift e-mailadresse + brugernavn',
    labels: FEAT('med'),
    body: `Det skal være muligt at **skifte e-mailadresse** og **brugernavn** på sin konto.

**Kilde:** ${SRC} — @bobby2106, 2026-06-22 06:54, tråd 1518509472299876431.

**Accept:**
- [ ] Bruger kan ændre e-mailadresse (med verifikation via Supabase Auth).
- [ ] Bruger kan ændre brugernavn (med unikheds-/validerings-tjek).
- [ ] EN+DA copy.

**Relateret:** #491 (ManagerProfilePage i18n), managerprofil-redigering.`,
  },
  {
    title: '[ux] Holdudtagelse: vis ryttertyper/stats, skjul skadede, multi-løb sæsonplanlægning + uklart element',
    labels: FEAT('med'),
    body: `Flere konkrete forbedringer til holdudtagelses-fladen (@bobby2106, 2026-06-22 06:48-06:50, tråd 1518507834575425598):

1. **Vis ryttertyper og stats** på holdudtagelsessiden.
2. **Nemmere adgang** til holdudtagelse for de enkelte løb.
3. **Multi-løb sæsonplanlægning:** kunne planlægge **flere løb på samme tid** — en løbsplanlægningsside hvor man ser hele sæsonens løb og nemt vælger løb for hele holdet / enkelt rytter ad gangen.
4. **Skjul skadede ryttere** på holdudtagelsessiden.
5. **Uklart element:** et element på siden (screenshot) giver ikke mening for spilleren — hvad betyder det? (afklar/forklar eller fjern).

**Kilde:** ${SRC} — @bobby2106 (m. screenshot af det uklare element), tråd 1518507834575425598.

**Accept:**
- [ ] Ryttertyper + stats synlige i holdudtagelsen.
- [ ] Mulighed for at skjule skadede ryttere.
- [ ] Uklart element afklaret/forklaret eller fjernet.
- [ ] (Større) multi-løb sæsonplanlægning designet — koordineres med #1146.

**Relateret:** #1681 (holdudtagelse svær at finde), #1715 (kalender-UI + tydelig holdudtagelse), #1146 (shared race calendar: selection/planning).`,
  },
  {
    title: '[bug] Rytter-dobbeltadgang: rytter på auktion kan også købes via transfer + akademi-rytter hentbar efter auktionssalg',
    labels: BUG('high'),
    body: `To relaterede korrektheds-bugs hvor en rytter er tilgængelig ad flere anskaffelses-veje samtidig. En rytter der er på auktion (eller allerede solgt via auktion) skal være låst fra de øvrige veje.

1. **Auktion vs transfer** (@jeppek, 2026-06-21 23:23, tråd 1518395940338274476): Man kan købe en rytter, **der er på auktion**, via **transfer**. Det skal ikke være muligt — man skal hverken kunne byde via transfer eller købe en rytter mens han er på aktiv auktion.
2. **Auktion vs akademi** (@jeppek, 2026-06-21 23:06, tråd 1518391567184957551): Man kan hente en rytter på **akademiet**, som **allerede har skrevet kontrakt til næste sæson via auktionssiden**. Det skal ikke være muligt; rytteren skal fjernes fra akademisiden hvis han allerede er solgt via auktion.

**Kilde:** ${SRC} — @jeppek (begge), tråde 1518395940338274476 + 1518391567184957551.

**Accept:**
- [ ] En rytter på aktiv auktion kan ikke samtidig købes/bydes på via transfer.
- [ ] En rytter solgt via auktion (kontrakt næste sæson) fjernes fra akademi-/intake-listen og kan ikke hentes der.
- [ ] Verificér begge veje afspejler én kilde til rytter-tilgængelighed.

**Relateret:** #1189 (auktions-/transfer-timing policy), #1694 (auktion/trup-korrekthed).`,
  },
  {
    title: '[copy] Founder Supporter / premium-waitlist-side: sprogfejl + forkerte prispunkter + uklare termer (EN)',
    labels: FEAT('med'),
    body: `@jeppek gav detaljeret copy-feedback på **Founder Supporter / premium-waitlist-siden** (engelsk). Som ved landing-copy (#1695): Nicolai skriver selv den endelige founder-prosa; Claude kan rette de objektive fejl.

## Del 1 — Objektive fejl (kan rettes nu)
- **Forkerte prispunkter:** siden viser €3.89 / €6.57 / €9.25/mo. De faktiske er ikke €3.89 og €9.25 — der er (udover de 2 første) tiers til **€11.93** og **€19.97**. Ret prispunkterne så de matcher de reelle tiers.
- '**GDPR-compliant**' bør ikke stå her — fjern.
- "You are charged nothing today." → "**You're** charged nothing today."
- "Cycling Zone is a browser-based cycling manager" → overvej at tilføje "**game**" til sidst.

## Del 2 — Klarhed/formulering (afventer founder-prosa)
- "**fair premium discussion**" / "**Fair premium**" — uklart hvad det betyder; præcisér eller fjern.
- "**Sold**" er forkert ord i "What may be sold, and what must never be sold" — det forstås ikke som 'hvad man får med premium'. Boksene nedenfor skal opdateres til det premium/subscription faktisk indeholder; overvej en "hvad får du IKKE"-boks.
- "The goal is to hear whether enough cyclists want to back the project financially before I build payment." → foreslået: "**The goal is to see whether there is enough interest in financially supporting the project before I add payments.**"
- **Questions** i bunden bør kobles sammen med FAQ/questions på landingssiden.

**Kilde:** ${SRC} — @jeppek, 2026-06-21 20:31, tråd 1518352582374854656.

**Relateret:** #673 (Founder Supporter waitlist + payment-flow), #672 (landing polish), #1695 (landing-copy efter relaunch), #1587 (brand-mail som kontakt). Tone: docs/TONE_OF_VOICE.md.`,
  },
  {
    title: '[bug] Bestyrelsesforhandling: målene vises på dansk i den engelske version',
    labels: BUG('med'),
    body: `I bestyrelses-forhandlingen er ikke alt oversat: **målene (goals/targets)** vises på **dansk** selv når man er på den engelske version af siden (screenshot).

**Kilde:** ${SRC} — @jeppek, 2026-06-22 19:51, tråd 1518705052833808576 (screenshot).

**Accept:**
- [ ] Forhandlings-mål/target-tekster er oversat til EN (en+da locale-keys).
- [ ] Verificér hele bestyrelses-forhandlingsflowet for DA-leaks på EN.

**Relateret:** #694 (boardArchetypes reaction-templates EN — separat board-tekst-mængde).`,
  },
];

const COMMENTS = [
  {
    issue: 109,
    body: `**Ny Discord-rapport (${SRC})** — relateret U25-dimension:

@jeppek (2026-06-22 19:53, tråd 1518705388545900566, screenshot): **Akademi-ryttere tæller med i trup-antallet, men IKKE i U25-tællingen** (fx bestyrelsens U25-mål), selvom de er under 25. De skal tælle som U25 når de er under 25.

→ Mulig samme rod-årsag som dette issue (uensartet U25-kategorisering), men specifikt: akademi-ryttere ekskluderes fra U25-tælling. Tilføj til scope: akademi-ryttere under 25 indgår i U25-tællingen overalt (inkl. bestyrelses-mål).`,
  },
  {
    issue: 228,
    body: `**Ny Discord-rapport (${SRC})** — udvider 'Mine auktioner'-behovet:

@cybersimon (2026-06-22 19:21, tråd 1518697437752070165, screenshot): ønsker at kunne **sortere/filtrere efter sælger**, så man kan se sit **eget holds** udbudte auktioner. Dvs. ud over 'auktioner jeg har budt på' (denne issue) også 'auktioner hvor jeg er sælger'. Overvej en sælger-filter/kolonne som del af samme fane-arbejde.`,
  },
  {
    issue: 1719,
    body: `**Ny Discord-rapport (${SRC})** — follow-up bug på fyrings-knappen:

@jeppek (2026-06-22 19:08, tråd 1518694302036001090, screenshot): **Prisen for at fyre en rytter vises ikke altid.** Buyout-gebyret skal fremgå konsekvent før man bekræfter en fyring.

→ Tilføj til accept: buyout-pris vises altid i fyrings-flowet (ingen tilfælde uden pris).`,
  },
  {
    issue: 1674,
    body: `**Ny Discord-rapport (${SRC})** — alder også på flere flader:

- @jeppek (2026-06-22 17:51, tråd 1518674930248712232): alder skal også kunne ses i **rytterdatabasen**.
- @stephoslash (2026-06-22 17:18, tråd 1518666553422385192): alder synligt på **Trup-baren** (ikke kun et U23/25-tag).

→ Udvid scope: alder synlig på rytteroverblik + transferliste + **rytterdatabase** + **trup-bar**. (Rytterdatabase-kolonnen koordineres med #1537.)`,
  },
  {
    issue: 1716,
    body: `**Live bekræftelse (${SRC}):** @jeppek (2026-06-22 15:25, tråd 1518638017605144727): træningssiden er **stadig ikke nulstillet efter relaunch** — man kan se tidligere træninger fra før, og det er ikke muligt at træne igen i dag. Bekræfter at problemet stadig er live for spillere; fix/cleanup mangler at lande/virke.`,
  },
];

function runGh(args, tmpBody) {
  const tmp = path.join(os.tmpdir(), `cz-${Math.abs(tmpBody.length * 31 + tmpBody.charCodeAt(0))}-${args[1]}.md`);
  fs.writeFileSync(tmp, tmpBody, 'utf8');
  try {
    const out = execFileSync('gh', [...args, '--body-file', tmp], { encoding: 'utf8' });
    return { ok: true, out: out.trim().split('\n').pop() };
  } catch (e) {
    return { ok: false, out: (e.stderr || e.message || '').toString().trim().slice(0, 300) };
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

console.log('=== Opretter 13 nye issues ===');
for (const it of ISSUES) {
  const args = ['issue', 'create', '--title', it.title];
  for (const l of it.labels) { args.push('--label', l); }
  const r = runGh(args, it.body);
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.out}  ::  ${it.title}`);
}

console.log('\n=== Kommentarer på 5 eksisterende issues ===');
for (const c of COMMENTS) {
  const r = runGh(['issue', 'comment', String(c.issue)], c.body);
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} #${c.issue}  ${r.out}`);
}

console.log('\nDONE');
