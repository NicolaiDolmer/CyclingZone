#!/usr/bin/env node
/**
 * Opret GitHub-issues + dedup-kommentarer fra Discord-sweep 2026-06-25 (PM)
 * (6 nye feedback-tråde + #cycling-zone + #spørgsmål-og-svar siden cutoff
 *  tråd 1519410621630644326 / 2026-06-24 18:35).
 * UTF-8-sikkert via temp body-filer. Kør IKKE blindt igen — ingen idempotens.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = 'Discord-sweep 2026-06-25 PM (#samlet-feedback-features-og-bugs / #cycling-zone / #spørgsmål-og-svar)';
const BUG = (p) => ['claude:todo', 'type:bug', 'cat:bug', `priority:${p}`];
const FEAT = (p) => ['claude:todo', 'type:task', 'cat:user-feature', `priority:${p}`];

const ISSUES = [
  {
    title: '[bug] Træning kan ikke sættes op for hele/stor trup (~32 ryttere) — "det åd den ikke"',
    labels: BUG('med'),
    body: `Træningsopsætningen fejler når man forsøger at sætte træning op på en stor trup. @thelamba forsøgte at sætte træning op på alle **32 ryttere** i sin trup (29 senior + 3 akademi) og kunne ikke få det igennem ("Det åd den ikke", screenshot med fejl).

Bemærk: truppen var på 32 — over squad-cappet på 30 (se separat auktion-cap-bug). Det er værd at afklare om træningsfejlen hænger sammen med over-cap-tilstanden, eller om træning også fejler ved en lovlig fuld trup (≤30).

**Kilde:** ${SRC} — @thelamba, tråd 1519774212250665000 (2026-06-25 18:40, screenshot).

**Accept:**
- [ ] Træning kan sættes op for en fuld lovlig trup (op til squad-cap).
- [ ] Hvis fejlen skyldes over-cap/akademi-ryttere: giv en forklarende fejlbesked i stedet for tavst at afvise.
- [ ] Verificér med både senior- og akademiryttere i truppen.

**Relateret:** #931 (træningssystem-epic), #932 (ungdomsakademi), og auktion-squad-cap-bug fra samme sweep.`,
  },
  {
    title: '[bug] Auktioner: squad-cap (30) håndhæves ikke ved bud → trup nåede 32 + massebudte ryttere vises fejlagtigt som "til salg"',
    labels: BUG('high'),
    body: `To sammenhængende problemer omkring squad-cap og auktioner (@thelamba):

1. **Cap ikke håndhævet ved bud:** spillet siger at truppen max kan være på 30, men lod @thelamba byde på/føre auktion på rytter nr. 23+ og ender efter at have massebudt med en **trup på 32** — altså over cap.
2. **Massebudte ryttere markeres som "sælger":** efter massebud står der under auktioner at han **sælger 9 ryttere** — og alle 9 er ryttere han **massebød på / vandt**. Han har ikke selv aktivt sat nogen til salg. Det ligner enten en forkert "til salg"-markering eller en uforklaret auto-nedsalg (squad-enforcement der trimmer ned mod cap) der vises uden forklaring.

Risiko: uønsket auto-salg af netop-vundne ryttere + forvirrende UI.

**Kilde:** ${SRC} — @thelamba, tråd 1519757023833751804 (2026-06-25 17:31-18:22, screenshots).

**Accept:**
- [ ] Bud/auktion blokeres eller advarer hvis en gennemført handel ville bringe truppen over cap (30).
- [ ] Ryttere man har vundet/budt på markeres ikke automatisk som "til salg".
- [ ] Hvis auto-nedsalg mod cap er tilsigtet: forklar det eksplicit i UI'et (hvilke ryttere, hvorfor) og lad spilleren vælge.
- [ ] Verificér mod en konto der massebyder sig over cap.

**Relateret:** #1614 (squad-cap display ≠ håndhævelse), #1824 (akademi-/admin-only ryttere på auktion), #450 (minimumspris mod spam-bud), #230 (auto-cancel proxy-bud).`,
  },
  {
    title: '[ux] Dashboard: gør de nederste moduler skjulbare/tilpasselige',
    labels: FEAT('low'),
    body: `De to nederste dele af dashboardet skal kunne **tilpasses og skjules**, ligesom resten af dashboard-modulerne, så spilleren selv kan vælge hvad der vises.

**Kilde:** ${SRC} — @bobby2106, tråd 1519746440316850318 (2026-06-25 16:49, screenshot).

**Accept:**
- [ ] De nederste dashboard-moduler kan skjules/vises (samme customize-mekanik som de øvrige).
- [ ] Valget huskes pr. bruger.

**Relateret:** #977 (dashboard: konsolidér økonomi-risiko + Deadline Day), #62 (Today/Manager Inbox).`,
  },
  {
    title: '[feature] Auto-push patch notes til Discord når patch notes opdateres in-game',
    labels: FEAT('low'),
    body: `Når patch notes opdateres på den in-game patch-notes-side, skal en bot **automatisk poste en besked i Discord** om at en ny patch (med xy-indhold) er klar. @zootne ønsker det eksplicit — uden @everyone-ping, bare en notifikation i kanalen. @bobby2106 bekræfter at auto patch notes til Discord er på vej (i den nye server, kanal 1504952588578193480).

**Kilde:** ${SRC} — @zootne + @bobby2106, #cycling-zone (2026-06-25 15:09-15:13).

**Accept:**
- [ ] Ny/opdateret patch note → automatisk Discord-post i patch-notes-kanalen.
- [ ] Ingen @everyone/@here-ping som default.
- [ ] Posten linker til/citerer patch-note-indholdet.

**Relateret:** #1815 (Discord-webhook per etape), #264 (dedikeret kanal sæsonstart/slut), #415 (Discord world-class opsætning).`,
  },
  {
    title: '[ux] Vis/forklar hvem ens 4 profilryttere er',
    labels: FEAT('low'),
    body: `Spilleren kan ikke se/forstå **hvem ens 4 profilryttere er**, eller hvordan de udvælges. @thelamba spurgte direkte (screenshot af profilrytter-visningen).

**Kilde:** ${SRC} — @thelamba, #spørgsmål-og-svar (2026-06-25 19:00, screenshot).

**Accept:**
- [ ] Det fremgår tydeligt hvilke 4 ryttere der er holdets profilryttere.
- [ ] Kort forklaring af hvordan profilryttere udvælges (eller mulighed for selv at vælge).

**Relateret:** #957 (rytter-popularitet), #1833 (in-game forklaring af evner).`,
  },
];

const COMMENTS = [
  {
    issue: 1823,
    body: `**${SRC}** — overlap-holdudtagelsen er stadig fundamentalt brudt 24-25/6; flere nye brugere rammer det, med nye symptomer ud over dem der allerede er listet:

- **Hård "6 og 6"-lås:** @friisisch kan slet ikke ændre truppen til løb med overlap — så snart holdet er sat, er rytterne låst, og fejlen "Du skal udtage mellem 6 og 6 ryttere til hvert af løbene" kommer op (tråd 1519719292072104038, 2026-06-25 15:01, screenshots).
- **Afmeld låser stadig:** trykker man "afmeld" på det ene løb, forbliver hele den udtagne trup låst; tilmelder man igen, er det de samme ryttere — man slipper ikke ud af tilstanden.
- **Kan ikke tilføje ledige ryttere:** ryttere fra holdet der **ikke** er med i nogen af de overlappende løb kan ikke tilføjes (forsøgt som work-around). Samme i #cycling-zone: @zootne "Får ik valgt ledig rytter ind i trop der trenger flere" (18:17) og @jonasnielsen "kan ikke fylde begge løb selvom jeg har 12 ledige ryttere" (17:21).
- **Genudfyld virker ikke:** "genudfyldning af holdene" hjælper ikke.
- **Assistent låst i forkerte valg / spøgelses-ryttere:** @zootne ser assistenten vælge 4 ryttere + 2 låste "til hvem ved" — mistanke om at det er akademi- eller for længst fyrede ryttere (tråd 1519722502580998229). Verificér mod #1800 (fyrede hænger i lineup) og #1742 (pensionerede vises stadig).

→ Bekræfter at #1823's accept-kriterier bør udvides: ud over at fjerne/skifte-kaptajn/gemme skal man kunne **redigere efter sæt**, **afmelde og frigøre låsen**, **tilføje ledige ryttere uden for overlap-sættet**, og assistenten må kun vælge **valgbare** ryttere.`,
  },
  {
    issue: 1824,
    body: `**${SRC}** — hullet er ikke fuldt lukket: @thelamba så igen "meget hemmelige ryttere til salg" på auktionssiden (tråd 1519747129361432596, 2026-06-25 16:52, screenshot + to konkrete auktions-links). @bobby2106 genkendte det ("typisk mig... troede jeg havde fikset det") og **annullerede de to auktioner live** — efterfølgende var de væk hos @thelamba. Bekræfter at admin-only/akademi-ryttere stadig kan slippe ud på offentlig auktion. Brug som ekstra repro-evidens når det permanente filter-/RLS-fix laves.`,
  },
  {
    issue: 1815,
    body: `**${SRC}** — konkret ønske til **indholdet** af Discord-resultat-posten (ikke kun per-etape-kadencen): @zootne + @stephoslash beder om **holdnavne** i bot-posten (ikke kun rytternavne — svært at se om det er ens egne), en **top 3** + **direkte link til løbet/resultaterne**, og at resultater opdeles **pr. division/gruppe i hver sin kanal** (#cycling-zone 2026-06-25 13:06-13:07). @bobby2106 bekræfter at feedet får "en ordentlig tur" når det flyttes til den nye server, med eget område pr. division+gruppe. Folder ind i webhook-redesignet her (overlap med #1021-vision-input).`,
  },
  {
    issue: 1833,
    body: `**${SRC}** — konkret instans på races/strategy-siden: de to tal ved rytteren (grøn = form, grå = egnethed/"hvor god til ruten") har **ingen overskrift/label**, så spillere gætter på hvad de betyder (@_chriskp_ + @cybersimon, #spørgsmål-og-svar 2026-06-25 12:40-12:51). @bobby2106 bekræfter ("skal nok lige få givet det en overskrift"). Holdudtagelsessiden har en "egnethed"-overskrift, men løbs-/strategisiden mangler den. Tag med som del af forklarings-/label-arbejdet her.`,
  },
  {
    issue: 931,
    body: `**${SRC}** — træningsfokus-valgene er i dag uklare og nær-placeholder: @thelamba prøver at regne ud hvilke stats hvert fokus træner (VO2max, spurt, udholdenhed, tærskel/TT, teknik=brosten?, aero?) og kan ikke gennemskue det. @bobby2106 bekræfter at man "næsten uanset hvad man træner går op i alle stats" pt., og vil **rive valgmulighederne fra hinanden og lave et rigtigt, forståeligt system** — gerne så cykelnørden og casual-spilleren begge tilgodeses. Indtil rework'et: @thelamba beder om at det i **Hjælp** står hvad hvert fokus dækker (fx "Teknik træner meget brosten, lidt nedkørsel, mindre acceleration ..."). #cycling-zone/#spørgsmål-og-svar 2026-06-25 17:51-17:58.`,
  },
];

function runGh(args, tmpBody, tag) {
  const tmp = path.join(os.tmpdir(), `cz-2506pm-${tag}.md`);
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

console.log(`=== Opretter ${ISSUES.length} nye issues ===`);
let i = 0;
for (const it of ISSUES) {
  const args = ['issue', 'create', '--title', it.title];
  for (const l of it.labels) { args.push('--label', l); }
  const r = runGh(args, it.body, `i${i++}`);
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.out}  ::  ${it.title}`);
}

console.log(`\n=== ${COMMENTS.length} kommentarer på eksisterende issues ===`);
for (const c of COMMENTS) {
  const r = runGh(['issue', 'comment', String(c.issue)], c.body, `c${c.issue}`);
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} #${c.issue}  ${r.out}`);
}

console.log('\nDONE');
