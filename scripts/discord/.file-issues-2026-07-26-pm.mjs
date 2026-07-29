#!/usr/bin/env node
/**
 * Opretter GitHub-issues fra Discord-sweep 2026-07-26-pm.
 * Dubletter er allerede filtreret fra manuelt (se .sweep-2026-07-26-pm.md + close-out).
 * Kør: node scripts/discord/.file-issues-2026-07-26-pm.mjs [--dry]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const G = '1504615050831466669';
const T = (id) => `https://discord.com/channels/${G}/${id}`;
const DRY = process.argv.includes('--dry');

const ISSUES = [
  {
    key: 'locked-riders',
    title: '[P0/investigation] Ryttere fremstår låst og holdudtagelsen kan ikke ændres lige efter sæsonskiftet (2 brugere, S2-start)',
    labels: ['bug', 'claude:todo', 'priority:high', 'type:investigation', 'cat:user-feature'],
    body: `## Rapport (Discord #general, 26/7)

- **@knud_r_flink** 22:03 CEST: "Seems like alot of my riders are locked in races after we got moved up to div. II. Is it just me?" (skærmbillede med låste ryttere)
- **@shai2059** 22:39 CEST: "I try to change line up too and it not give me"

Begge rapporter kommer EFTER at sæson 2 blev tændt (21:30 CEST) og efter op-/nedrykning.

## Verificeret prod-tilstand (SELECT, ${new Date().toISOString().slice(0, 10)})

Datagrundlaget er **rent** — det er ikke stale/forkerte rækker:

| Tjek | Resultat |
|---|---|
| S2-entries hvor holdets division ≠ løbets division | **0** |
| S2-entries hvor rytterens \`team_id\` ≠ entryens \`team_id\` (stale) | **0** |
| Ryttere dobbeltbooket på samme \`scheduled_for\` | **0** |
| Forældreløse entries (rytter findes ikke) | **0** |
| S2-løb med \`stages_completed > 0\` (= \`lineup_locked\`) | **0** af 455 |

## Sandsynlig rod-årsag

Assistenten har auto-udfyldt **29.671 entries for 161 menneskehold** i sæson 2 (mod kun **162 manuelle**) — dvs. ~184 forpligtelser pr. hold på tværs af hele sæsonen, sat FØR manageren har set sin nye division.

\`lineup_locked\` er kun \`(race.stages_completed ?? 0) > 0\` ([backend/routes/api.js:3301](../blob/main/backend/routes/api.js#L3301)) og er falsk for alle S2-løb. Den låsning brugerne ser er derfor med stor sandsynlighed **binding-mappet**: en rytter der allerede er auto-committet i et andet løb i samme in-game-dag-vindue (\`buildBindingMap\` / \`buildExternalBindings\`, [backend/lib/raceDistribution.js:46](../blob/main/backend/lib/raceDistribution.js#L46)) vises som optaget/grå og kan ikke vælges.

For en manager der lige er rykket op, betyder det: hele sæsonen er forudbooket af assistenten, og hver gang han vil vælge en rytter til et løb, er rytteren "taget" af et auto-pick han aldrig har lavet.

## Opgave

1. Bekræft hypotesen mod en konkret ramt bruger (knud_r_flink) — hvilken flade, hvilket løb, hvilken binding.
2. Afgør om auto-fyld af HELE sæsonen ved sæsonstart overhovedet er ønsket (i dag: ja, 29.671 rækker). Alternativ: auto-fyld kun rullende N dage frem.
3. Giv manageren en vej ud: "frigør alle assistent-picks" (pr. dag / pr. sæson) så en auto-filled binding aldrig blokerer et manuelt valg — auto-picks bør vige for manuelle valg i stedet for at låse dem.
4. Hvis nr. 3 allerede findes, er problemet at den ikke er synlig på fladen → UX-fix.

**Tidsfølsomt:** første S2-løbsdag er mandag 27/7 18:00 CEST. Managerne skal kunne udtage hold inden da.

Kilde: ${T('1504952590486474805')}
`,
  },
  {
    key: 'squad-not-full',
    title: '[bug] Dashboard advarer "truppen er ikke fuld" på et løb hvor truppen ER fuld',
    labels: ['bug', 'claude:todo', 'priority:med', 'type:bug', 'cat:bug'],
    body: `## Rapport (Discord #bugs, 25/7 16:26 CEST)

**@cybersimon**: "On the dashboard it says the trup is not full but when I click in to it I have a full trup." (to skærmbilleder, Samsung Browser/mobil)

Dashboard-modulet og løbssiden er altså uenige om samme trup.

## Hypotese

Dashboardets tælling bruger ikke samme filter/kilde som selve holdudtagelsen — jf. det gentagne mønster i [[match-UI-filter-for-kapacitetslogik]]: bulk/service_role-veje eller en anden \`size.max\` end \`getSelectionContext\`. Tjek om dashboardet:
- tæller \`race_entries\` direkte i stedet for selection-kontekstens \`counts.selected\` vs \`counts.target\`
- bruger en fast trupstørrelse i stedet for løbets faktiske \`size.max\`
- ikke ekskluderer afmeldte (\`race_withdrawals\`) eller tilbagetrukne ryttere

## Verifikation

Reproducér med cybersimons hold og det konkrete løb; skriv en test der binder dashboard-tælleren til samme kontrakt som løbssiden.

Kilde: ${T('1530586322383671336')}
`,
  },
  {
    key: 'teams-below-8',
    title: '[bug/data] 2 menneskehold har under 8 ryttere ved sæson 2-start — kan ikke stille hold',
    labels: ['bug', 'claude:todo', 'priority:high', 'type:bug', 'cat:bug', 'backend-only'],
    body: `## Fund (prod-SELECT ved S2-start, 26/7 aften)

\`\`\`
menneskehold i alt:                        161
menneskehold med < 8 aktive ryttere:         2
menneskehold uden nogen S2-race-entries:     5
\`\`\`

8 ryttere er minimum for at stille til start. To hold er under grænsen efter sæsonskiftet (pension + kontraktudløb + frigivelse) og kan derfor ikke deltage i sæson 2, og fem hold har slet ingen entries.

## Opgave

1. Identificér de 2 + 5 hold (SQL i issuet nedenfor) og afgør pr. hold **hvorfor**: pension, udløbet kontrakt, frosset konto, eller manglende entry-generering.
2. Beslut håndteringen — kompensation/fri-agent-tildeling vs. lade holdet selv købe op inden mandag 18:00.
3. Forebyg: sæsonskiftet bør afvise/varsle et hold der falder under minimum, jf. #2748 (forvarsel + squad-minimum-check ved masse-retirement) — verificér om #2748 dækker dette eller kun varsler.

\`\`\`sql
select t.id, t.name, count(r.id) filter (where not r.is_retired) as active_riders
from teams t left join riders r on r.team_id = t.id
where t.is_ai = false group by 1,2 having count(r.id) filter (where not r.is_retired) < 8;
\`\`\`

Relateret: #2748.
`,
  },
  {
    key: 'achievements-i18n',
    title: '[bug/i18n] Achievements er dansk-only i databasen — engelske spillere ser dansk tekst (46 rækker uden i18n)',
    labels: ['bug', 'claude:todo', 'priority:med', 'type:bug', 'cat:user-feature'],
    body: `## Rapport (Discord #feedback-and-ideas, 25/7 10:52 CEST)

**@thelamba**: "I just noticed, that the achievement system isn't fully translated. I have the game in English and it's showing like this." (skærmbillede)

## Verificeret

\`\`\`sql
select count(*) total, count(*) filter (where title ~* '[æøå]' or description ~* '[æøå]') danish
from achievements;
-- total: 46 · danish: 32
\`\`\`

Achievements' \`title\`/\`description\` ligger som **fri tekst i DB-tabellen \`achievements\`**, ikke som i18n-nøgler. \`frontend/public/locales/en/achievements.json\` har kun 34 nøgler og dækker ramme-UI'et (overskrifter, tomme tilstande) — ikke de 46 achievement-navne selv. En EN-spiller får derfor dansk indhold.

Det bryder sprogreglen: alt spiller-vendt er **EN først, DA sekundært**.

## Løsning

Giv hver achievement en stabil i18n-nøgle (fx \`achievements.items.<id>.title\` / \`.description\`) og flyt teksten til \`en/achievements.json\` + \`da/achievements.json\`; DB beholder \`id\`, \`category\`, \`icon\`, \`sort_order\`, \`is_secret\`. Migration skal være idempotent og bevare eksisterende \`manager_achievements\`-referencer.

Kilde: ${T('1530497888520503316')}
`,
  },
  {
    key: 'mobile-portrait',
    title: '[ux/mobil] Portræt-visning skjuler rytter-stats på My team, Akademi, Wishlist, Rytterdatabase og Daily training',
    labels: ['claude:todo', 'priority:med', 'type:feature', 'cat:user-feature', 'enhancement'],
    body: `## Rapport (Discord #bugs, 25/7 10:36 CEST)

**@jeppek**, samlet liste:

- **My team** — meget lidt information om ryttere i samme skærmbillede; man skal skrolle meget for at se noget om dem.
- **Daily training** — man kan lige akkurat få fatigue + intensitet ind på skærmen når man vipper telefonen, men rytter-type og fokus kan ikke være der samtidig.
- **Akademi** — samme problem som My team.
- **Rytterdatabase** — ryttere har **ingen stats** i portræt; kun navn, nationalitet, rytter-type, hold, status og alder. Vipper man skærmen, kommer stats frem og ligner PC-versionen.
- **Wishlist** — samme som My team.

Det sidste punkt er det vigtigste: tabellen har en landskabs-variant med stats, men portræt får en amputeret kolonneliste. Det er ikke en generisk "mobil er trang"-klage — det er et konkret kolonnevalg der gør databasen ubrugelig til at vurdere ryttere på telefon.

## Opgave

Sub-issue under **#1602** (Epic: Mobil-optimering). Fastlæg en portræt-kolonnekontrakt for rytterlister: hvilke 2-3 stats følger altid med navnet (fx samlet rating + specialist-type + form), og brug samme regel på alle fem flader. Følg T2 wide data-skabelonen i \`docs/design/PAGE_TEMPLATES.md\`.

Kilde: ${T('1530494013311025163')} · Epic: #1602 · relateret: #2445
`,
  },
  {
    key: 'scouting-links',
    title: '[ux] Scoutingrapporter: rytternavne er ikke klikbare — ingen vej fra rapport til rytterprofil',
    labels: ['claude:todo', 'priority:med', 'type:feature', 'cat:user-feature', 'enhancement'],
    body: `## Rapport (Discord #feedback-and-ideas, 26/7 17:54 CEST)

**@jeppek**: "Isn't possible to click on the riders from the reports on this side, https://cyclingzone.org/scouting — That should be possible to get the to riders page" (skærmbillede af rapportlisten)

## Verificeret i koden

\`frontend/src/pages/ScoutingCentralPage.jsx\` har kun én navigation: \`navigate(\\\`/staff/\\\${central.scout.id}\\\`)\` (linje 387). Der er **ingen** \`/riders/:id\`-link nogen steder på siden — rytterne hentes kun som navne via \`POST /api/riders/names\` (linje 56) ud fra \`rider_id\`-referencer. Rapporten kender altså rytterens id, men bruger det ikke til et link.

Fix er lille: gør rytternavnet i rapportlisten til et \`Link\` til \`/riders/:riderId\`.

Bemærk: scoutingens fog-of-war skal bevares — profilen må ikke afsløre mere end scoutingen selv gør (jf. #2798).

Kilde: ${T('1530966482027286798')}
`,
  },
  {
    key: 'team-name-link',
    title: '[ux] Holdnavnet i rytter-switcherbaren er ikke klikbart (heroen er) — inkonsistent efter redesignet',
    labels: ['claude:todo', 'priority:low', 'type:bug', 'cat:user-feature'],
    body: `## Rapport (Discord #feedback-and-ideas, 25/7 15:53-19:16 CEST)

**@cuchiet**: "With the new design I cant see for which team the rider rides for. But I allways found this intresting. If I saw a rider won a race I first checked his abilities and then took a look at his team." → efter afklaring: "But still its not clickable. I liked that function and used it a lot. Maybe you could bring that back?"

**@bobby2106** (ejer): "100% i can. Ill look into it, when possible."

## Verificeret i koden

- \`components/rider/profile/RiderProfileHero.jsx:174\` — holdnavnet **er** pakket i \`<TeamLink>\`. ✅
- \`components/rider/profile/RiderSwitcherBar.jsx:61\` — holdnavnet renderes som ren \`<span>\`, intet link. ❌

Samme oplysning to steder på samme side, kun det ene klikbart. Det forklarer hvorfor cuchiet oplevede funktionen som forsvundet.

## Opgave

Gør \`RiderSwitcherBar\`'s holdnavn til et \`TeamLink\` med samme hover-affordance som heroen. Tjek samtidig om resultat-/rangliste-tabellerne viser holdnavn uden link — samme mønster som de registrerede dead clicks i #1919/#2254.

Kilde: ${T('1530573827405250711')}
`,
  },
  {
    key: 'bonus-sprint-placement',
    title: '[bug/design] Bonus-sprints placeres midt på stigninger (Hauts Plateaux etape 3, 5 og 7)',
    labels: ['bug', 'claude:todo', 'priority:med', 'type:bug', 'slice:race-engine', 'cat:balance'],
    body: `## Rapport (Discord #feedback-and-ideas, 25/7 22:58 CEST)

**@thelamba**: "I'm assuming this green dot is a bonus sprint for points and seconds. On stage 3, 5 and 7 of Hauts Plateaux, they're almost comically placed in/on climbs. I'm assuming it's unintended and honestly it's mostly graphically funny, as the breakaways will take them either way." (skærmbillede af etapeprofilen med den grønne prik oppe på stigningen)

## Hvorfor det betyder noget

Det er ikke kun kosmetik. En bonus-sprint der ligger på en stigning belønner klatrere med sprintpoint/bonussekunder de ikke burde have adgang til, og det trækker i samme retning som **#2757** (sprintpoint på bakke-/bjergetaper vægter for højt — flad-etape-vinderen mister pointtrøjen). Passage-ordenerne kom ind med **#2770**.

## Opgave

Placeringslogikken for mellemsprints skal respektere højdeprofilen: læg mellemsprints på flade/nedkørsels-segmenter, ikke inde i et kategoriseret klatresegment. Verificér mod hele S2-kalenderen (ikke kun Hauts Plateaux) og skriv en invariant-test: *ingen sprint-passage må ligge inden for et klassificeret klatresegment*.

Kilde: ${T('1530680670630707423')} · relateret: #2770, #2757
`,
  },
  {
    key: 'classics-roles',
    title: '[feature] Rolle-/taktikvalg pr. rytter i endagsløb (klassikere) — som i etapeløb',
    labels: ['claude:todo', 'priority:med', 'type:feature', 'cat:user-feature', 'enhancement', 'needs-decision'],
    body: `## Ønske (Discord #feedback-and-ideas, 25/7 10:04 CEST)

**@thelamba**: "I would love for this to also be part of classics. As it is right now, maybe my team's best bet is NOT going for the win, but to have 3 riders with respectable finishes to win the team classification. But if the game decides 'You know what, today we sacrifice', then I'm just left with nothing. I would like that to be my choice with 'free riders' and how hard they should work, not the AI's choice." (skærmbillede af etapeløbets per-etape-indstillinger)

## Kernen

I etapeløb kan manageren sætte roller og indsats pr. etape. I endagsløb overtager motoren valget — inklusive at ofre ryttere for en kaptajn. Det er præcis den slags beslutning en manager vil eje, og det er den samme motor der allerede understøtter det ved etapeløb; forskellen er kun at fladen mangler.

Særligt relevant nu, hvor **bjergklassikere er kommet i division 2 og 3** (patch notes 23-24/7), så endagsløb ikke længere er "bare en spurt".

## Beslutningspunkt til ejeren

Skal endagsløb have **hele** etape-taktikpanelet (kaptajn + free-role + indsats), eller kun free-role-delen? Anbefaling: hele panelet — motoren kender allerede rollerne (\`race_stage_roles\`), og et reduceret panel bliver en ny særregel at forklare.

Kilde: ${T('1530485975858286673')} · relateret: #2794 (løbssidens IA)
`,
  },
  {
    key: 'friendly-races',
    title: '[feature] Venskabsløb / custom turneringer på tværs af divisioner (spiller-oprettede sim-løb)',
    labels: ['claude:todo', 'priority:low', 'type:feature', 'cat:user-feature', 'enhancement', 'needs-decision'],
    body: `## Ønske (Discord #feedback-and-ideas, 26/7 08:38 CEST)

**@thelamba**, forkortet:

> Sometimes we just want to have fun and compete and see who is actually the best. It could be fun (and useful!) to have friendly races [...] a feature separate from the actual game, where for example Hansen Pro Cycling, Team Easy On, Acier and I could decide to try some races against eachother to see how we really stack up, seeing as we're in different divisions right now.
>
> Or even more fun; a bit like the "custom tournament" thing you can do in Football Manager: allow us to create a custom tournament/race with a budget and the option to buy any rider that fits the budget in that closed simulation. Stages could be run every 5 minutes (whatever interval the creator sets, from 1 minute to 30 minutes).
>
> It would be a great extra feature to keep us playing. It would be more test data for you to work with from the engine, and if you really want to push it, it could require pro status to create the tournaments/races, giving a little extra something to those who decide to support the game, while everyone can still participate.
>
> *And yes. I have racetesting with human test subjects in mind, primarily.*

## Hvorfor det er værd at overveje

Tre ting på én gang: (a) retention mellem løbsdage, (b) et Pro-perk der **ikke** giver konkurrencefordel — helt i tråd med "Premium køber aldrig stærkere ryttere", og (c) menneske-drevet belastningstest af race-motoren, som i dag kun testes mod AI-hold.

Divisionsopdelingen betyder at spillere der kender hinanden aldrig mødes; venskabsløb løser det uden at røre ligastrukturen.

## Beslutningspunkt

Scope: (A) simpelt venskabsløb med eksisterende trupper, eller (B) fuld custom turnering med budget-draft i en lukket simulering? Anbefaling: start med **A** — den genbruger hele race-motoren og kræver ingen ny økonomi; B er et selvstændigt projekt.

Kilde: ${T('1530826533860544603')}
`,
  },
  {
    key: 'fun-achievements',
    title: '[feature] "For sjov"-achievements uden score + rekrutterings-rangliste',
    labels: ['claude:todo', 'priority:low', 'type:feature', 'cat:user-feature', 'enhancement'],
    body: `## Ønske (Discord #feedback-and-ideas, 25/7 10:52 CEST)

**@thelamba** (samme tråd som i18n-fejlen, men et selvstændigt ønske):

- En **separat kategori** til achievements der er nær-umulige eller ren RNG, så de kan eksistere uden at forurene en eventuel score-rangliste. Eksempler han selv giver: *"Win a stage or race on an off-day after suffering a puncture or crash"* og *"At least twice in a season, be in 1st place in the GC of a stage race and crash on the final stage to either abandon or finish 2nd or lower"* — altså også "uheld"-badges: *"Things like that, to show 'YOU KNOW WHAT, I WAS UNLUCKY!!!'"*.
- En **top-recruitment-rangliste** / referral-achievements — eksplicit **uden** in-game fordel: *"Not that I want any in-game advantage for it, but it could be interesting."*

## Vurdering

Kategori-delen er billig: \`achievements\` har allerede en \`category\`-kolonne og 5 kategorier, så en \`misc\`/\`for-fun\`-kategori er data + et filter i UI'et. Kravet er kun at motoren kan opdage hændelserne (styrt, mekanisk, off-day, GC-position pr. etape) — det ligger allerede i \`race_incidents\` og \`race_results\`.

Rekrutterings-delen kræver et referral-spor der ikke findes i dag; hold den adskilt hvis den bliver til noget.

Afhænger af **{{ACH_I18N}}** (achievements skal have i18n-nøgler før der tilføjes flere).

Kilde: ${T('1530497888520503316')}
`,
  },
];

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();
}

const filed = {};
for (const it of ISSUES) {
  let body = it.body;
  body = body.replaceAll('{{ACH_I18N}}', filed['achievements-i18n'] ? `#${filed['achievements-i18n']}` : 'achievements-i18n-issuet');
  const f = `${process.env.TEMP || '/tmp'}/cz-issue-${it.key}.md`;
  fs.writeFileSync(f, body, 'utf8');
  if (DRY) { console.log(`[DRY] ${it.title}`); continue; }
  const args = ['issue', 'create', '--title', it.title, '--body-file', f];
  for (const l of it.labels) args.push('--label', l);
  let url = '';
  for (let attempt = 1; attempt <= 5; attempt++) {
    try { url = gh(args); break; }
    catch (e) { if (attempt === 5) throw e; }
  }
  const num = url.split('/').pop();
  filed[it.key] = num;
  console.log(`#${num}\t${it.title}`);
}
fs.writeFileSync('scripts/discord/.filed-2026-07-26-pm.json', JSON.stringify(filed, null, 2));
console.log('\nFiled:', JSON.stringify(filed));
