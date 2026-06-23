#!/usr/bin/env node
/**
 * Opret GitHub-issues + dedup-kommentarer fra Discord-feedback-sweep 2026-06-23
 * (10 nye tråde siden cutoff 1518705388545900566). 9 nye issues + 1 kommentar.
 * UTF-8-sikkert via temp body-filer. Kør IKKE blindt igen — ingen idempotens.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = 'Discord #samlet-feedback-features-og-bugs (sweep 2026-06-23)';
const BUG = (p) => ['claude:todo', 'type:bug', 'cat:bug', `priority:${p}`];
const FEAT = (p) => ['claude:todo', 'type:task', 'cat:user-feature', `priority:${p}`];

const ISSUES = [
  {
    title: '[bug] Ghost-auktioner: ryttere forsvundet efter update står som aktive auktioner uden rytter',
    labels: BUG('high'),
    body: `Efter en af de seneste updates er nogle ryttere forsvundet (sandsynligvis ungdoms-/akademiryttere der blev flyttet/fjernet). Deres auktioner blev **ikke lukket ordentligt** og står stadig som **aktive auktioner uden tilknyttet rytter** — "rytter ligner at de ikke findes". Det roder auktionssiden til og ser i stykker ud.

**Kilde:** ${SRC} — @cybersimon, 2026-06-22 22:14-22:42, tråd 1518740959020580955 (3 screenshots: aktive auktioner uden rytter).

**Accept:**
- [ ] Identificér de forældreløse/aktive auktioner uden gyldig rytter i prod.
- [ ] Luk/ryd op i auktioner hvis rytter er fjernet (ungdom/akademi/pension) — auktion må ikke overleve sletning af rytteren.
- [ ] Forward-guard: når en rytter fjernes/flyttes (akademi-intake, pension, division-cleanup), annulleres/lukkes en evt. aktiv auktion atomisk.
- [ ] Verificér mod UI-filteret (kun rigtige, eksisterende ryttere vises som aktive auktioner).

**Relateret:** #1742 (pensionerede stadig under frie ungdomsryttere), #1748 (rytter-dobbeltadgang auktion/transfer/akademi), #615 (finalizeExpiredAuctions tick-overlap-guard).`,
  },
  {
    title: '[bug] Antal etapedage stemmer ikke: forside vs. division vs. pulje (40 vs. 60 vs. 41)',
    labels: BUG('med'),
    body: `Antallet af løbs-/etapedage er inkonsistent på tværs af visninger:
- Division 3 D viser kun **40 etapedage** i denne sæson.
- Forsiden siger **60 løbsdage**.
- Division gruppe A viser **41 løbsdage**.

Tallet bør være **ens på forsiden og i "Kommende løb"**, og det samme i hver division/pulje (eller forklare hvorfor det varierer, hvis det er bevidst).

**Kilde:** ${SRC} — @jeppek, 2026-06-22 22:04, tråd 1518738582670545069.

**Accept:**
- [ ] Find kilden til "60 løbsdage" på forsiden og afklar om det er hardcodet/forældet.
- [ ] Etapedage-antal vises konsistent: forside = "Kommende løb" = pr. division/pulje.
- [ ] Verificér mod faktisk seedet kalender pr. pulje.

**Relateret:** #1734 (katalog-loft beskærer puljer til 6/8 etapeløb — bagvedliggende årsag til skæve antal), #1146 (shared race calendar design), #1712 (140-etaper rekalibrering post-launch).`,
  },
  {
    title: '[ux] AI-fyld-holdnavne er generiske ("AI 1/2/3") — gør realistiske + fjern "AI" fra navnet',
    labels: FEAT('med'),
    body: `AI-fyld-holdenes navne er af meget lav kvalitet (fx nummererede "AI 1", "AI 2" ...). Det ser uprofessionelt ud og bryder indlevelsen.

Ønsker:
1. **Fjern "AI" fra selve holdnavnet** — AI-badget bevares, så "AI" i navnet er redundant.
2. **Ingen nummererede navne** (1, 2, 3 ...).
3. Navnene skal **lyde som rigtige cykelhold** (maksimalt: sjove holdnavne).
4. Forslag fra @bobby2106: scan de største ~400-500 virkelige cykelhold som **inspiration** til navne-generatoren (uden at kopiere 1:1 — fiktiv-sæson-IP, jf. #1276).

**Kilde:** ${SRC} — @bobby2106 ("DO BETTER", screenshot) + @jeppek (behold badge, fjern "AI" fra navn), 2026-06-22 21:48-21:50, tråd 1518734443706187786.

**Accept:**
- [ ] AI-holdnavne genereres som plausible (fiktive) cykelholdnavne, ikke "AI N".
- [ ] "AI" optræder ikke i holdnavnet (kun som badge).
- [ ] Navne-generator har en kuration/blokliste der undgår real-world 1:1-navne.

**Relateret:** #933 (hold-ejerskab & holdnavne epic), #1276 (fiktiv-IP — undgå real-world navne), #1739 (AI-hold-livscyklus i divisioner).`,
  },
  {
    title: '[bug] Transferhistorik: sæson 1-transfers vises under sæson 0 + akademiryttere mangler helt',
    labels: BUG('med'),
    body: `To problemer på transferhistorik-fanen (https://cyclingzone.org/team → transferhistorik):
1. **Forkert sæson-tagging:** transfers der er foretaget i den aktive **sæson 1** ligger under **sæson 0**. De skal ligge under den sæson hvor rytteren faktisk blev hentet ind.
2. **Akademiryttere mangler:** hentninger via akademiet optræder slet ikke i transferhistorikken — de bør også indgå.

**Kilde:** ${SRC} — @jeppek, 2026-06-22 21:28, tråd 1518729450232086641.

**Accept:**
- [ ] Transfers tagges med den sæson de blev gennemført i (sæson 1-transfers under sæson 1).
- [ ] Akademi-hentninger registreres og vises i transferhistorikken.
- [ ] Verificér mod en konto med både auktions-/transfer- og akademi-hentninger i sæson 1.

**Relateret:** #1741 (samme flade: køb vs. salg uklart i historikken — distinkt bug), #794 (RiderStatsPage/historik-rework).`,
  },
  {
    title: '[ux] Browser-tilbage fra rytterprofil under auktioner lander altid på "Min situation"',
    labels: BUG('low'),
    body: `Når man bruger browserens **tilbage**-funktion fra en rytterprofil, man er nået til via **auktionssiden**, ender man altid på fanen **"Min situation"** — også selvom man kom fra **"Alle"**-fanen.

Foreslået løsning (@jeppek): brug URL-tabs ligesom transfermarkedet (\`?tab=market\`), dvs. \`/auctions?tab=all\` osv., så tilbage-navigationen rammer den fane man faktisk kom fra. Samme mønster bør gælde "andre managers"-visningen.

**Kilde:** ${SRC} — @cybersimon + @jeppek, 2026-06-22 21:20-21:22, tråd 1518727362118942721.

**Accept:**
- [ ] Auktions-faner afspejles i URL (\`?tab=all\` / \`?tab=mine\` osv.).
- [ ] Browser-tilbage fra en rytterprofil returnerer til den korrekte auktions-fane.

**Relateret:** auktions-IA / tab-state i URL (samme mønster som transfermarkedets \`?tab=\`).`,
  },
  {
    title: '[ux] Sponsor-deadlines er utydelige — vis hvornår man vælger/skifter/udløber sponsor',
    labels: FEAT('med'),
    body: `Det er uklart for spilleren hvilke deadlines der gælder for valg af sponsor. Spørgsmål spilleren ikke kan besvare i UI'et i dag:
- Hvornår starter den nye aftale?
- Hvis man glemmer at vælge sponsor — hvornår kan man så få en ny? Altid? Aldrig? Kun i et vindue?
- Hvornår udløber min nuværende aftale?

**Kilde:** ${SRC} — @bobby2106, 2026-06-22 21:10, tråd 1518724858287099944.

**Accept:**
- [ ] Sponsor-fladen viser tydeligt: nuværende aftales udløb + næste valg-/skifte-vindue.
- [ ] Forklar reglerne for hvad der sker hvis man ikke vælger (mister man indtægt? auto-fornyes?).
- [ ] EN+DA copy.

**Relateret:** #101 (vis bestyrelsens konkrete effekter inkl. sponsor), #1663 (standing-skaleret sponsor), #933 (sponsorforhandling epic), #1441 (langsigtet økonomi).`,
  },
  {
    title: '[bug] Kontraktforlængelse: ny løn vises ikke for ryttere med kontrakt over 2 sæsoner',
    labels: BUG('med'),
    body: `Når man forsøger at **forlænge** en rytter der allerede har kontrakt **over 2 sæsoner** (dvs. løbende til S3), kan man **ikke se den nye løn** i forlængelses-UI'et — løntallet mangler/vises ikke.

**Kilde:** ${SRC} — @jeppek, 2026-06-22 20:56, tråd 1518721239273963700 (screenshot).

**Accept:**
- [ ] Den nye/foreslåede løn vises korrekt i forlængelses-flowet også for kontrakter der løber > 2 sæsoner.
- [ ] Verificér med en rytter hvis kontrakt rækker til S3.

**Relateret:** #1310 (markeds-pakke fast-follow inkl. forlængelses-UI), #1677 (fyr/opsig kontrakter).`,
  },
  {
    title: '[content] Rigtige løbsnavne bruges stadig i løbs-kategorier — skal omdøbes til fiktive',
    labels: BUG('med'),
    body: `Der bruges fortsat **rigtige (real-world) løbsnavne** under kategorier på løbssiderne. I den fiktive sæson skal disse ikke optræde — kategorierne skal omdøbes til noget andet (fiktivt/neutralt).

Berørte sider:
- https://cyclingzone.org/races?tab=world
- https://cyclingzone.org/races?tab=points
- https://cyclingzone.org/races?tab=library

**Kilde:** ${SRC} — @jeppek, 2026-06-22 20:33, tråd 1518715659326849165 (2 screenshots).

**Accept:**
- [ ] Find alle steder real-world løbsnavne optræder i løbs-kategori-visningerne (world/points/library).
- [ ] Omdøb til fiktive/neutrale kategori-navne (EN+DA).
- [ ] Forward-guard: nye løb/kategorier seedes med fiktive navne.

**Relateret:** #1276 (fiktiv-IP: real-world navne i public repo/visning), #1105 (frisk fiktiv sæson 1), #1734 (løb-katalog udvidelse).`,
  },
  {
    title: '[bug] Rytterprofil: "bedste evne" øverst til højre stammer fra gamle PCM-stats — fjern feltet',
    labels: BUG('med'),
    body: `På rytterprofilen viser feltet **"bedste evne"** (øverst til højre i oversigten) en værdi der stammer fra de **gamle PCM-stats**, ikke de nye CZ-evner. Det er forældet og misvisende.

Ejer-beslutning i tråden (@jeppek + @bobby2106 enige): **fjern feltet helt** fra oversigten — det skal **ikke** erstattes af noget andet, så ryttersiden ikke bliver overfyldt.

**Kilde:** ${SRC} — @jeppek (screenshot) + @bobby2106, 2026-06-22 20:21-20:22, tråd 1518712486902366391.

**Accept:**
- [ ] "Bedste evne"-feltet (gammelt PCM-stat) fjernes fra rytterprofil-oversigten.
- [ ] Ingen erstatning tilføjes (bevidst — undgå overfyldt side).
- [ ] Verificér at ingen andre flader stadig læser dette gamle "bedste evne"-felt.

**Relateret:** #1529 (CLOSED — PCM-stats→CZ-evner display-rollout; denne flade blev overset/skal fjernes), #1595 (PCM-sletning, behold stat_* som derive-kilde).`,
  },
];

const COMMENTS = [
  {
    issue: 1137,
    body: `**Ny Discord-rapport (${SRC})** — spiller-transparens om pension (UX oven på retirement-motoren):

@bobby2106 (2026-06-22 20:47, tråd 1518719118172225616): spilleren skal "på en eller anden måde vide mere om pensioner" — fx **hvornår man kan forvente at en rytter går på pension**. Lige nu er det helt uigennemsigtigt.

→ Forward-guard til denne issue: når retirement/aldring-motoren bygges, eksponér forventet pensions-vindue/sandsynlighed til spilleren (rytterprofil + evt. trup-varsel), så pension ikke kommer som en overraskelse. Relateret: #1154 (rider personality — ambition/loyalty), #932 (akademi/ungdom).`,
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

console.log('=== Opretter 9 nye issues ===');
for (const it of ISSUES) {
  const args = ['issue', 'create', '--title', it.title];
  for (const l of it.labels) { args.push('--label', l); }
  const r = runGh(args, it.body);
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.out}  ::  ${it.title}`);
}

console.log('\n=== Kommentar på eksisterende issue ===');
for (const c of COMMENTS) {
  const r = runGh(['issue', 'comment', String(c.issue)], c.body);
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} #${c.issue}  ${r.out}`);
}

console.log('\nDONE');
