#!/usr/bin/env node
/**
 * Opret GitHub-issues + dedup-kommentarer fra Discord-sweep 2026-06-30
 * (siden FILED cutoff 1520421548576604350 / 2026-06-27 13:32).
 *
 * @bobby2106 = ejer/dev (ikke tester). Testere: thelamba, cybersimon, zootne,
 * jeppek, friisisch, soren1207, jonasnielsen.
 *
 * Dedup (springes over — findes allerede): #1978 (akademi-potentiale),
 *  #1977 (salg-kommentar), #1976 (ruteprofil-længde), #1975 (kalender i18n/
 *  60-racedays), #1974 (træning FLAD/SPRINT/ACC), #1936 (intet-fokus-valgt).
 * Kommentarer i stedet for nye: #1984, #1974, #1936, #819, #2002, #1148.
 *
 * UTF-8-sikkert via temp body-filer. Kør IKKE blindt igen — ingen idempotens.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = 'Discord-sweep 2026-06-30';
const T = (id) => `https://discord.com/channels/474142653529849886/${id}`;
const BUG = (p) => ['claude:todo', 'type:bug', 'cat:bug', `priority:${p}`];
const FEAT = (p) => ['claude:todo', 'type:task', 'cat:user-feature', `priority:${p}`];

const ISSUES = [
  {
    title: '[bug] Team Strategy: kaptajn skifter uventet efter redigering uden eksplicit gem',
    labels: BUG('high'),
    body: `@thelamba rodede med indstillinger i **Team Strategy** (ingen faste roller, ingen A-kæde — blot top-3 i de forskellige kategorier) og forlod siden "uden at have gemt noget afgørende". Bagefter var hans **kaptajn i Vuelta Burgalesa pludselig skiftet** fra **Jakub Adamczyk** (som fører alle 4 konkurrencer) til **Owen Whitfield**.

@thelamba: "Det er helt gakkelak, hvis mit hold ikke kører for Jakub i morgen." Dette er pre-race kritisk — en uventet kaptajn-ændring lige før løbsafvikling kan ødelægge resultatet for en manager der troede han havde sat sit hold rigtigt.

**Kilde:** ${SRC} — @thelamba, tråd [Team Strategy override?](${T('1521265325964791849')}) (2026-06-29 21:25, screenshot).

**Accept:**
- [ ] Reproducér: åbn Team Strategy, ændr top-3/kategorier uden at sætte eksplicit kaptajn, forlad siden → verificér om en allerede valgt løbs-kaptajn overskrives.
- [ ] En manuelt valgt kaptajn på et konkret løb må ikke ændres af en urelateret Team Strategy-redigering uden at manageren bekræfter det.
- [ ] Hvis Team Strategy legitimt skal kunne påvirke kaptajn-auto-valg: gør ændringen synlig + kræv gem/bekræft, så den ikke sker tavst.

**Relateret:** #1800 (fyrede ryttere hænger i lineup/kaptajn-kandidater), #1884 (race-hub taktik: roller), #1177 (vejkaptajner).`,
  },
  {
    title: '[bug] Grand Tour genereret med 5 enkeltstarter (forkert etape-komposition)',
    labels: BUG('med'),
    body: `Ejeren (@bobby2106) opdagede live at et **Grand Tour-løb blev genereret med 5 enkeltstarter (ITT)** i etape-sammensætningen — klart for mange. @bobby2106: "Der er gået et eller andet helt galt, når der er 5 enkeltstarter i løbet, men hey. deeeet må jeg lige følge op på."

Etape-genereringen/stage-profil-fordelingen for store rundure giver en urealistisk komposition. En GT bør have en balanceret blanding (fladt/bjerg/etape) med højst 1-2 enkeltstarter, ikke 5.

**Kilde:** ${SRC} — @bobby2106, #cycling-zone (2026-06-29 09:15-09:18), løb-link i tråden.

**Accept:**
- [ ] Find hvor etape-profilerne for et etapeløb/GT vælges, og hvorfor ITT kan udgøre 5 etaper.
- [ ] Indfør realistisk loft på antal enkeltstarter pr. etapeløb (typisk 1-2).
- [ ] Verificér på de aktuelle sæson-1-etapeløb at fordelingen nu ser fornuftig ud.

**Relateret:** #1293 (race-motor: gate-bånd cobbles/hilly/itt), #1734 (udvid løb-katalog til fulde 8 etapeløb), #1856 (scheduler tillader overlappende etapeløb), #1953 (ITT kan ikke skelnes visuelt).`,
  },
  {
    title: '[feature/ux] Race-kalender (trup-planlægning): auto-skift til næste racedag når dagens løb er kørt',
    labels: FEAT('low'),
    body: `Den kalender-/trup-side man nu bruger til at lægge program, **hopper ikke automatisk videre til "dag 2" / næste racedag**. @zootne spurgte om det var meningen den blev stående, og @thelamba foreslog: når dagens sidste løb er kørt, burde visningen skifte til **næste racedag** automatisk (forudsat at resultater er nemme at tilgå et andet sted).

@bobby2106 var positiv til begge dele: "Det tænker jeg da, at jeg skal få den til at gøre i løbet af idag" + "Jo det synes jeg egentlig giver rigtigt god mening."

**Kilde:** ${SRC} — @zootne + @thelamba + @bobby2106, tråd [Race kalender](${T('1521410630261932135')}) (2026-06-30 07:02-07:32, screenshot).

**Accept:**
- [ ] Kalender-/planlægningssiden defaulter til den førstkommende racedag der endnu ikke er afviklet.
- [ ] Når en racedags sidste løb er kørt, ruller visningen frem til næste racedag.
- [ ] Man kan stadig manuelt navigere tilbage til tidligere dage.

**Relateret:** #1984 (holdudtagelse ved samtidige løb), #1146 (Design: shared race calendar), #1952 (notifikation når løb er kørt), #1925 (holdudtagelses-overhaul follow-ups).`,
  },
  {
    title: '[feature] Sortér transferlisten efter evner',
    labels: FEAT('low'),
    body: `@cybersimon ønsker en **sorteringsfunktion efter evner inde på transferlisten**, så man kan finde de relevante ryttere på markedet uden at scrolle manuelt.

**Kilde:** ${SRC} — @cybersimon, tråd [Sorterings funktion på transferlisten](${T('1521253927826358473')}) (2026-06-29 20:40, screenshot).

**Accept:**
- [ ] Transferlisten kan sorteres efter rytter-evner (og gerne type/værdi/alder).
- [ ] Sorteringen er konsistent med sorteringen andre steder (jf. #1951 lineup-sortering, #1950 navnesortering).

**Relateret:** #1951 (sortér ryttere på holdudtagelses-/lineup-siden), #1151 (Epic: human-driven transfer market), #2000 (rytter-side rework), #923 (filtrér/sortér resultater).`,
  },
  {
    title: '[bug] Ung rytter kan ikke sættes på akademiholdet',
    labels: BUG('med'),
    body: `@zootne rapporterer at en bestemt **ung rytter ikke kan rykkes til/optages på akademiet** ("Ham her går ikke til akademiet xD"). En dedikeret feedback-tråd med samme titel blev oprettet, men uden yderligere tekst — kernen er at akademi-placering fejler for mindst denne rytter.

Lav-evidens (én rapport + ét screenshot uden detaljer) — start med at reproducere og afdække fællesnævneren (alder/kategori/eksisterende kontrakt-historik?).

**Kilde:** ${SRC} — @zootne, #cycling-zone (2026-06-28 06:39, screenshot) + tom tråd [ung rytter kan ikke komme på akademi holdet](${T('1520776366340177980')}).

**Accept:**
- [ ] Reproducér med den/de berørte ryttere og find hvorfor akademi-placering afvises.
- [ ] En kvalificeret ung rytter (under aldersgrænsen, ledig akademi-plads) kan placeres på akademiet.
- [ ] Bekræft mod den konkrete rytter fra screenshottet.

**Relateret:** #1799 (akademi-signering lægger rytter på senior i stedet for akademi), #109 (ikke alle ryttere under 25 er U25-kategoriseret), #932 (Epic: ungdomsakademi), #1831 (akademi-alder uoverensstemmende).`,
  },
  {
    title: '[ux/a11y] Rytter-type-farver: bakkerytter og etapeløbsrytter for ens (også farveblind-uvenligt)',
    labels: FEAT('low'),
    body: `Flere testere kan ikke skelne **bakkerytter** og **etapeløbsrytter** på type-farverne — de er hhv. en "varm gullig orange" og "solgul", som ved hurtigt øjekast er næsten identiske. Problemet forstærkes af at de to typer også har **overlappende skills**, og af farveblindhed (@friisisch: "Jeg kan ikke se forskel 😅"; ~10% af mænd er farveblinde).

@thelamba: "Kan du overveje om bakkerytter og etapeløbsrytter skal være LIDT mere adskilte i farverne? Specielt fordi de også har overlappende skills." @bobby2106: "Det er da bestemt muligt ✌️".

**Kilde:** ${SRC} — @thelamba + @friisisch + @bobby2106, #spørgsmål-og-svar (2026-06-29 17:43-18:15, screenshots).

**Accept:**
- [ ] Bakkerytter og etapeløbsrytter får tydeligt adskilte type-farver (ikke kun nuance-forskel).
- [ ] Tjek paletten mod gængse farveblindheds-typer (deuteranopia/protanopia) — suppleres evt. med ikon/tekst-label, ikke kun farve.

**Relateret:** #1011 (attribut-farver: darkmode-læsbarhed + toggle), #2000 (rytter-side rework), #1953 (ITT-silhuet kan ikke skelnes).`,
  },
];

const COMMENTS = [
  {
    issue: 1984,
    body: `**${SRC}** — ny bekræftelse + ejer-mandat. @cybersimon og @friisisch ramte præcis (b)-tilfældet: på **dag 9** (cybersimon) og **dag 3** (friisisch) ser de 3 løb samme dag og kan **ikke bruge "ledige ryttere"-listen til at tilføje samme rytter til to ikke-overlappende løb** — man er tvunget til manuelt at gå ind på det enkelte løb (@thelamba's workaround). @bobby2106 var utvetydig: **"Nope, det dur ikke, det må fikses. Så er det en elendig måde det er bygget på. Vi laver et spil uden nødvendigheder for workarounds."** → bekræfter scope: ledige-ryttere-listen skal kunne tildele en rytter til flere samme-dags ikke-overlappende løb, ikke kun løbs-detaljevisningen. Tråde: #spørgsmål-og-svar (2026-06-28 21:51-22:01 + 2026-06-29 07:21-07:34).

Bemærk separat: @cybersimon mener **dag 9 har en uoptimal trippel-overlap-struktur** i selve kalenderen; @bobby2106: "det føles i hvert fald heller ikke optimalt for mig" → hører under #1856 (scheduler-overlap), ikke læsbarheds-issuet her.`,
  },
  {
    issue: 1974,
    body: `**${SRC}** — vigtig diagnostik fra opfølgende diskussion (#spørgsmål-og-svar, 28-29/6). Det ser ud til at rytterens **type/label gater hvad den kan udvikle**, ikke kun et generelt VO2Max-bias: @thelamba's ryttere (stort set alle endte som bjerg-type) får ~0 fremgang i FLAD/SPRINT/ACCELERATION, mens @cybersimon og @zootne viser at **sprint-træning DOES virke for en sprinter-type rytter** (screenshots). @thelamba's egen konklusion: "Købte nogle unge der faktisk står som sprintere, og de træner det" + "vildt nok at et, i mine øjne, tilfældigt påsat label skal betyde så meget."

To ting at afklare: (1) Er FLAD/SPRINT/ACC-udvikling **bevidst type-gated** (bjerg-rytter kan ikke trænes til sprinter)? Hvis ja, er det a) ikke kommunikeret nogen steder, og b) et problem at start-ryttere der var ~21 i alt nu er "låst" som bjerg. (2) Hvis det IKKE er bevidst, er der en bug i hvordan type påvirker træningsgevinst. Hænger sammen med ryttertype-arbejdet i #2014 (utypet-tilstand) + #1894 (smart default-fokus pr. type).`,
  },
  {
    issue: 1936,
    body: `**${SRC}** — testeren oprettede en dedikeret tråd for "intet fokus valgt"-symptomet (2 ryttere stod som "intet fokus valgt" i mindst 2 dage, selvom fokus tydeligt var valgt). Samme rod-årsag som beskrevet her. Ny tråd til sporbarhed: [Træningsbug - "ingen fokus valgt"](${T('1520683268113039380')}) (@thelamba, 2026-06-28 06:52, screenshots).`,
  },
  {
    issue: 819,
    body: `**${SRC}** — konkret bekræftelse på at genforhandling i dag er for billig. @thelamba opdagede at man kan **genforhandle 5-års-planen flere gange** ("Jeg prøvede lige alle tre muligheder i 1-års planen" / "Man har mere [end én]"), hvilket gør målene nærmest meningsløse — han kunne sætte målene ned så de matchede hans nu meget stærkere trup, uden konsekvens. @bobby2106 troede selv det var "1 genforhandling i perioden" → adfærden matcher ikke intentionen.

Beslægtet ønske fra samme tråd: når ens oprindelige målsætning er blevet **helt urealistisk** (fx hvis man overpræsterer voldsomt), efterspørger @thelamba en **"skal vi revurdere?"-prompt** fra bestyrelsen i stedet for tavst at lade målet stå. Tråd: #spørgsmål-og-svar (2026-06-29 18:49-19:05). Se også #103 (genforhandling-design) + #1235 (forhandle mål OP).`,
  },
  {
    issue: 2002,
    body: `**${SRC}** — @zootne efterspørger at **evne-tabellen sorteres bedst→dårligst** i visningen: "kommer tabellen til å blive sortert fra best til dårligst i framtiden? Føler det klør i øynene når jeg ser på den å finne hva er best/nestbest." @bobby2106: "Det kunne vi da nok godt få ordnet ✌️". Tag med i evne-rækkefølge/visnings-rework'et (skal kunne sortere efter værdi, ikke kun fast P/M/T-rækkefølge). #spørgsmål-og-svar (2026-06-29 17:40-17:41).`,
  },
  {
    issue: 1148,
    body: `**${SRC}** — @thelamba sendte en "for sjov"-ønskeliste til statistik/rekorder (eksplicit lav prioritet, "når der er ro på spillet"), som passer ind under World history & Club Museum:

**Løbsstatistik/rekorder:** største/mindste margin mellem nr. 1 og 2 i samlet stilling · yngste/ældste vinder af et givent løb · flest sejre (og flest i træk) i et givent løb · flest "hattricks" pr. hold (GC + ungdom + hold) i et løb.
**Rytter-rekorder:** top-X største udvikling i specifikke stats · top-X største værdi-udvikling · top-X flest akkumulerede point.
**Økonomi-stats (aggregeret over alle menneske-ejede hold):** samlet kassebeholdning · samlet lånt · samlet lønudgift ved sæson-slut · samlede renter.

Kilde: tråd [For sjov ønsker](${T('1521207946573254717')}) (2026-06-29 17:37). Økonomi-aggregaterne kan evt. høre under en separat økonomi-statistik-flade; resten er records/legends-materiale.`,
  },
];

function runGh(args, tmpBody, tag) {
  const tmp = path.join(os.tmpdir(), `cz-3006-${tag}.md`);
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
