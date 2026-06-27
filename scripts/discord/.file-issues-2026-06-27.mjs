#!/usr/bin/env node
/**
 * Opret GitHub-issues + dedup-kommentarer fra Discord-sweep 2026-06-27
 * (7 feedback-tråde + #cycling-zone + #spørgsmål-og-svar siden FILED cutoff
 *  tråd 1519774212250665000 / 2026-06-25 18:40 — 26/6-dumpet blev aldrig filed).
 *
 * Bemærk: @bobby2106 = ejer/dev (ikke tester). Kun ægte tester-feedback filed.
 * Dedup: #1930 (sortér afsluttede løb), #1929 (akademi i My Team),
 *        #1889/#1928 (profil-/stjerneryttere), #1927 (løn) findes allerede.
 * UTF-8-sikkert via temp body-filer. Kør IKKE blindt igen — ingen idempotens.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = 'Discord-sweep 2026-06-27 (#samlet-feedback-features-og-bugs / #cycling-zone / #spørgsmål-og-svar)';
const T = (id) => `https://discord.com/channels/474142653529849886/${id}`;
const BUG = (p) => ['claude:todo', 'type:bug', 'cat:bug', `priority:${p}`];
const FEAT = (p) => ['claude:todo', 'type:task', 'cat:user-feature', `priority:${p}`];

const ISSUES = [
  {
    title: '[bug] Frie agenter der tidligere har været akademiryttere kan ikke hentes',
    labels: BUG('high'),
    body: `Flere frie ryttere (free agents) kan **ikke hentes** — man får en fejlbesked når man forsøger. @jeppek rapporterede det først, og @thelamba reproducerede det selv: det gælder **mindst 4-5 ryttere**, alle med samme fejl.

**Fællesnævner (tester-observation):** det er ryttere der **tidligere har været akademiryttere / "academy rejects"** — typisk dem hvor lønnen var vanvittig høj dagen før. @bobby2106 bekræftede: "Så er det nok bare noget historik på ham" → der ligger gammel akademi-/kontrakt-historik på rytteren der blokerer signering.

**Kilde:** ${SRC} — @jeppek + @thelamba, tråd [Frie ryttere kan ikke hentes](${T('1520383484655304888')}) (2026-06-27 11:01-11:44, screenshots).

**Accept:**
- [ ] En fri agent kan hentes uanset om vedkommende tidligere har været i et akademi.
- [ ] Find og ryd den blokerende historik-tilstand (sandsynligvis gammel academy/contract-relation) på de berørte ryttere.
- [ ] Verificér mod de konkrete ryttere fra screenshottet.

**Relateret:** #1927 (frossen/for-høj løn på samme academy-reject-ryttere), #932 (ungdomsakademi), #1799 (akademi-signering lægger rytter forkert), #1776 (akademiryttere mangler i historik).`,
  },
  {
    title: '[bug] Lån-knap synlig for spillere skal fjernes (ikke-funktionel + misbrugsrisiko)',
    labels: BUG('high'),
    body: `Der er en **"ansøg om lån"-knap synlig for spillere** som ikke virker og ikke skal være der. @thelamba opdagede den og troede man kunne optage et lån på ~2m og "genstarte". @bobby2106 var meget klar: **"Nej, det skal væk. Langt væk."** og **"Knappen virker ikke."**

Lån gives i dag **automatisk** til de hold der har brug for det (midlertidigt, rentefrit) — spilleren skal ikke selv gøre noget. Knappen er derfor både overflødig og en potentiel misbrugs-/forvirringsvektor (@thelamba: "Jeg håber heller ikke, at der er nogen der kunne finde på at misbruge det").

**Kilde:** ${SRC} — @thelamba + @bobby2106, #spørgsmål-og-svar (2026-06-27 19:19-19:22).

**Accept:**
- [ ] Lån-ansøgnings-knappen fjernes/skjules helt fra spiller-UI.
- [ ] Verificér at den automatiske lån-tildeling (rentefrit nødlån) er upåvirket.
- [ ] Hvis spiller-initieret lån ønskes senere: lav det som en bevidst feature med admin-godkendelse (jf. @thelamba's forslag) — ikke en løs knap.

**Relateret:** #1237 (board-økonomi: vurdér saldo vs gæld), #1150 (kontrakter + development loans, design), #986 (økonomiside-rework).`,
  },
  {
    title: '[bug] Form nulstilles ikke efter løb slettes (kalender-rebuild oprydning)',
    labels: BUG('med'),
    body: `Efter at løb/resultater er slettet i forbindelse med kalender-rebuild'et mangler **rytternes form at blive nulstillet**. @bobby2106 (ejer) flaggede det som en udestående oprydning: "Dette mangler at være nulstillet, efter løbene er slettet" + "Form på rytterne mangler at blive nulstillet".

Konteksten: division 1-3 (alle grupper) fik resultater slettet 27/6 forud for genstart mandag 29/6. Træthed nulstilles, men form gør (endnu) ikke.

**Kilde:** ${SRC} — @bobby2106, tråd [Skal nulstilles](${T('1520421548576604350')}) (2026-06-27 13:32-16:01, screenshot).

**Accept:**
- [ ] Rytter-form nulstilles til udgangspunkt sammen med resten af state efter race-sletning.
- [ ] Verificér på et udsnit af berørte ryttere før mandagens genstart.

**Relateret:** #1848 (omkørsel af korrupte løb + delvis state-nulstilling — træthed/værdier/løn), #1847 (orphaned race_results efter rytter-sletning).`,
  },
  {
    title: '[bug] Inkonsistent rytter-navnesortering på tværs af sider (dobbelt-a kollation)',
    labels: BUG('low'),
    body: `Rytter-navne sorteres **forskelligt på forskellige sider**. @thelamba: på **træningssiden** kommer "Saadi" før "Sato", men på **holdsiden** kommer "Sato" før "Saadi" (holdsiden læser tilsyneladende dobbelt-a som "å" og sorterer det sidst i alfabetet).

Inkonsistent collation/locale i sorteringen — vælg én konsekvent sortering (sandsynligvis ren alfabetisk, ikke dansk å-collation) og brug den begge steder.

**Kilde:** ${SRC} — @thelamba, tråd [Sortering af ryttere efter navn](${T('1520184228149596231')}) (2026-06-26 21:49, screenshots).

**Accept:**
- [ ] Samme navnesortering på trænings-, hold- og lineup-siderne.
- [ ] Beslut bevidst om dansk æ/ø/å-collation skal bruges — og anvend den ens overalt.`,
  },
  {
    title: '[feature] Sortér ryttere på holdudtagelses-/lineup-siden (navn, type, rute-match, form, træthed)',
    labels: FEAT('low'),
    body: `Når man er inde på et løb og skal udtage ryttere, ønsker @cybersimon at kunne **sortere rytterlisten** efter:
- Rytter (navn)
- Type
- Rute-match
- Form
- Træthed

I dag er listen usorterbar, hvilket gør det svært at finde de rette ryttere til et givent løb.

**Kilde:** ${SRC} — @cybersimon, tråd [Sortering på udtagelsens siden](${T('1520352164718055554')}) (2026-06-27 08:56, screenshot).

**Accept:**
- [ ] Rytterlisten på holdudtagelses-/lineup-siden kan sorteres efter mindst: navn, type, rute-match, form, træthed.
- [ ] Sorteringen er konsistent med navnesorteringen andre steder (jf. dobbelt-a-bug).

**Relateret:** #1930 (sortér afsluttede løb), #923 (filtrér/sortér rytter-resultater), #1033 (skal headers sortere/afklikkes).`,
  },
  {
    title: '[feature] Notifikation når et løb er kørt ("du har et resultat at se på" på dashboard/indbakke)',
    labels: FEAT('low'),
    body: `@zootne foreslår: når et løb er kørt, vis en **notifikation på dashboardet eller i indbakken** — "du har et resultat at se på" med direkte link til løbet/resultatet. I dag skal man ind via "se alle" og lede sig frem til løbet, hvilket tager for mange klik.

@bobby2106 viste to dashboard-mockups som retning og er positiv.

Beslægtet observation fra samme tråd: kalenderen viser pt. **alle divisioners resultater**, ikke kun ens egen (se separat kommentar på #1835).

**Kilde:** ${SRC} — @zootne + @bobby2106, tråd [Resultater](${T('1520420511014846586')}) (2026-06-27 13:28-14:00, mockups).

**Accept:**
- [ ] Efter et løb er kørt får manageren en notifikation (dashboard og/eller indbakke) med direkte link til resultatet.
- [ ] Notifikationen forsvinder/markeres set når resultatet er åbnet.

**Relateret:** #976 (fold Min Aktivitet ind i Indbakke), #956 (deadline-hub: liv året rundt), #1147 (Living World feed), #959 (etape-resultater).`,
  },
];

const COMMENTS = [
  {
    issue: 1927,
    body: `**${SRC}** — ny instans i samme løn-cluster, denne gang ved **akademi-flytning**: @thelamba oplever at en rytters **løn STIGER** (~20%) når man sender en 18-20-årig **ned i akademiet** — stik imod patch-notes-teksten der lover at lønnen "falder til ungdomsløn". @bobby2106 forklarer at akademi-grundløn er højere, mens seniorer får resultat-bonus oveni (så for ryttere uden resultater føles det omvendt), og at det vil føles mere naturligt over tid.

To ting at tracke her: (1) **kopi-mismatch** — patch notes/hjælp siger eksplicit "falder til ungdomsløn", men adfærden er det modsatte; enten ret modellen eller ret teksten. (2) Hænger sammen med de "vanvittige lønninger" på academy-reject-ryttere fra 26/6 (#1927-kernen). Tråd: [løn](${T('1520177147128320080')}) (2026-06-26 21:21-21:27).`,
  },
  {
    issue: 1835,
    body: `**${SRC}** — konkret bekræftelse på resultat-/kalender-siden: @zootne påpeger at **kalenderen viser alle divisioners resultater**, ikke kun ens egen division, hvilket gør det svært at finde sit eget seneste løb. @bobby2106 bekræfter direkte: "den der kalender viser lige nu alle resultater, og ikke kun ens egen division" (der findes allerede et \`?scope=division\`-view, men default er alle). Tag med i divisions-filter-arbejdet her — også for **resultat-/kalender-visningen**, ikke kun standings. Tråde: [Resultater](${T('1520420511014846586')}) + #cycling-zone (2026-06-27 14:00 / 19:37).`,
  },
  {
    issue: 986,
    body: `**${SRC}** — konkret forvirring på økonomisiden: @thelamba undrede sig over at starte med >500k og fandt en **"Andet"-udgiftslinje** der præcist svarede til forskellen, uden forklaring på hvad den dækker. Forklaringen viste sig at være **tilbagetrukne præmiepenge** fra de slettede løb (kalender-rebuild). @bobby2106: "Jeg tænker ikke dette dækker ind under en visuel fejl, bare dårligt forklaret." → finance-breakdownet skal **labelle/forklare "Andet"-linjen** (fx clawback af præmie fra slettede løb), så spilleren ikke gætter. Tag med i økonomiside-rework'et. #spørgsmål-og-svar (2026-06-27 19:23-19:26, screenshots).`,
  },
  {
    issue: 1930,
    body: `**${SRC}** — genbekræftet 27/6: @bobby2106 uddyber at **hele siden der leder ind til resultater skal laves om fra bunden** (vejen derhen tager for lang tid / for meget er gemt væk), og at sorteringsmuligheder skal være en del af den nye visning. Sortér-nyeste-øverst (dette issue) bør foldes ind i det resultat-side-rework. Tråd: [Sortering af afsluttede løb](${T('1520016040304578693')}) (2026-06-26 10:41-10:43).`,
  },
];

function runGh(args, tmpBody, tag) {
  const tmp = path.join(os.tmpdir(), `cz-2706-${tag}.md`);
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
