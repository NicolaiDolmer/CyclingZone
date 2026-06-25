#!/usr/bin/env node
/**
 * Opret GitHub-issues + dedup-kommentarer fra Discord-sweep 2026-06-25
 * (28 nye feedback-tråde + #cycling-zone + #spørgsmål-og-svar siden cutoff 2026-06-22 22:42).
 * UTF-8-sikkert via temp body-filer. Kør IKKE blindt igen — ingen idempotens.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = 'Discord-sweep 2026-06-25 (#samlet-feedback-features-og-bugs / #spørgsmål-og-svar)';
const BUG = (p) => ['claude:todo', 'type:bug', 'cat:bug', `priority:${p}`];
const FEAT = (p) => ['claude:todo', 'type:task', 'cat:user-feature', `priority:${p}`];

const ISSUES = [
  {
    title: '[bug] Trup-fordeling auto-udfyld dobbelt-allokerer ryttere ved overlap + kan ikke fjerne/skifte kaptajn + lineup gemmes ikke',
    labels: BUG('high'),
    body: `Den netop shippede trup-fordeling/auto-udfyld (Fase 1, #1802) har flere blokerende fejl i overlap-scenariet:

1. **Dobbelt-allokering:** når man trykker auto-udfyld og to løb overlapper, sætter assistenten **samme rytter på begge trupper**. I @jeppeks eksempel er Coppens, Wilson, Brunet og Campos i begge trupper → kun **8 ryttere brugt til 12 pladser**. Én rytter må ikke køre to overlappende løb (invariant fra race-hub-designet).
2. **Kan ikke fjerne ryttere igen** efter auto-udfyld.
3. **Kan ikke skifte kaptajn** efter auto-udfyld.
4. **Lineup gemmes ikke:** "Couldn't save the selection. Try again." (@zootne, @jonasnielsen) — og når man går via hovedsiden kan man kun vælge til ét af løbene; intet ender med at være gemt til at køre løbet.

**Kilde:** ${SRC} — @jeppek + @zootne, tråd 1519328663907209226 (2026-06-24 13:09-15:54) + @zootne/@jonasnielsen i #cycling-zone (2026-06-24 15:47-17:54, screenshots).

**Accept:**
- [ ] Auto-udfyld respekterer overlap: en rytter allokeres til højst ét af to samtidige løb.
- [ ] Alle 12 pladser (6+6) fyldes med distinkte ryttere når truppen er stor nok.
- [ ] Ryttere kan fjernes fra en auto-udfyldt trup.
- [ ] Kaptajn kan skiftes efter auto-udfyld.
- [ ] Lineup gemmes pålideligt (ingen "Couldn't save the selection").
- [ ] Verificér mod en konto med to overlappende løb + 12-rytters trup.

**Relateret:** #1802 (Fase 1 trup-fordeling — netop merged), #1146 (shared race calendar: selection/overlap/assistant), #1800 (fyrede ryttere hænger i lineup — beslægtet lineup-state-bug).`,
  },
  {
    title: '[bug] Auktioner: manglende U23-badge + akademi-ejede ryttere kan sættes til salg (~48 ryttere kun synlige for admin)',
    labels: BUG('high'),
    body: `To sammenhængende problemer på auktionssiden:

1. **U23-badge mangler** på mange ryttere under auktioner lige nu.
2. **Akademi-ejede ryttere på auktion:** mistanke om at ryttere der ligger på **andres akademier** kan sættes til salg / optræde på auktion — det bør ikke være muligt. Desuden er der **ca. 48 ryttere som admins kan se men almindelige spillere ikke kan** — det skal undersøges hvorfor synligheden afviger.

**Kilde:** ${SRC} — @bobby2106, tråd 1519095019750031521 (2026-06-23 21:41-21:42, screenshot).

**Accept:**
- [ ] U23-badge vises korrekt på auktioner igen.
- [ ] Akademi-ejede ryttere kan ikke sættes til salg/optræde på offentlig auktion (medmindre eksplicit frigivet).
- [ ] Undersøg de ~48 admin-synlige/spiller-usynlige ryttere — afklar om det er en RLS-/filter-divergens og luk hullet.

**Relateret:** #1773 (ghost-auktioner: aktive auktioner uden rytter), #1756 (stale academy_intake 'offered'-rækker), #1742 (pensionerede under frie ungdomsryttere), #1739 (AI-hold-livscyklus).`,
  },
  {
    title: '[bug] Divisioner kører ikke synkront: nogle puljer har kørt flere etaper end andre + ryttere kom ind midt i etapeløb',
    labels: BUG('high'),
    body: `Løbsafviklingen er ude af sync på tværs af divisioner/puljer:
- 3. division gruppe C har kørt **3 etaper** af deres etapeløb, mens andre puljer kun har kørt 2.
- 1. division har kørt en ekstra etape (2.) som den ikke burde, da alle andre kun har kørt 2 løbsdage.
- Der er **kommet ryttere ind midt i et igangværende etapeløb** (var ikke med ved start).

Forventet: alle divisioner afvikler på samme tid/kadence, og **trupper må ikke kunne ændres mens et etapeløb er i gang**.

**Kilde:** ${SRC} — @jeppek, tråd 1519291565732921426 (2026-06-24 10:42-10:45, screenshot).

NB: dette overlapper det kendte løbs-afviklings-rod fra 23/6 (løb skulle køres om). Issue holdes for at få **synkronisering + lås-trup-under-aktivt-løb** som eksplicit invariant + forward-guard, ikke bare engangs-oprydning.

**Accept:**
- [ ] Alle divisioner/puljer afvikler samme etape-kadence (ingen pulje løber foran).
- [ ] Trup låses når et etapeløb er startet — ingen ryttere kan tilføjes/fjernes midt i løbet.
- [ ] Forward-guard/test der fanger desynkroniserede pulje-afviklinger.

**Relateret:** #1774 (antal etapedage inkonsistent forside vs. division vs. pulje), #1146 (shared race calendar), #1712 (140-etaper rekalibrering).`,
  },
  {
    title: '[bug] Transferliste: ryttertype-filter tømmer hele listen (alle ryttere forsvinder)',
    labels: BUG('med'),
    body: `På transferlisten kan ryttertype-filteret ikke bruges: når man vælger en ryttertype **forsvinder alle ryttere** fra listen.

**Kilde:** ${SRC} — @cybersimon, tråd 1519312306377461790 (2026-06-24 12:04, screenshot).

**Accept:**
- [ ] Valg af ryttertype på transferlisten filtrerer korrekt i stedet for at tømme listen.
- [ ] Verificér for alle ryttertyper.

**Relateret:** #164 (evne-filter slider-bug), #261 (manuel tal-input på filtre).`,
  },
  {
    title: '[bug] Fri-agent-søgning: løn-filter viser kun ryttere på managerhold (frie agenter mangler)',
    labels: BUG('med'),
    body: `På markedet/transfer-søgningen opfører "fri agent" sig forkert sammen med løn-filteret:
- Sætter man en **max-løn** og trykker "free agent", kommer der kun ganske få ryttere frem (i eksemplet kun Fillippo Donati) — selvom der er tusindvis af frie ryttere.
- @bobby2106 bekræfter **to fejl**: (1) bruger man løn-filteret, kommer kun ryttere frem der er **på et managerhold**; (2) "fri agent"-knappen virker reelt kun hvis man filtrerer på **værdi** i stedet for løn.

Workaround pt.: filtrér på værdi i stedet for løn (løn ≈ 6,67% af værdi).

**Kilde:** ${SRC} — @thelamba + @bobby2106, #spørgsmål-og-svar (2026-06-24 16:51-16:55).

**Accept:**
- [ ] Løn-filter på markedet returnerer også frie agenter (ikke kun managerhold-ryttere).
- [ ] "Fri agent"-filter virker uanset om man filtrerer på løn eller værdi.

**Relateret:** transferliste-filter (#164), markeds-pakke (#1310).`,
  },
  {
    title: '[bug] Løb-status: igangværende etapeløb vises som "Kommende" indtil alle etaper er kørt',
    labels: BUG('med'),
    body: `På løbssiden vises et etapeløb der **er i gang** ikke med markeringen "I gang" — det står stadig som "Kommende", selvom mindst én etape er afviklet (men ikke alle). Eksempel: Boucles Mayennaises havde kørt én etape men stod som "Kommende".

**Kilde:** ${SRC} — @cybersimon, tråd 1519075429028466708 (2026-06-23 20:23, screenshot).

**Accept:**
- [ ] Et etapeløb hvor ≥1 etape er kørt men ikke alle markeres "I gang" (ikke "Kommende").
- [ ] Status skifter til "Afsluttet" når sidste etape er kørt.

**Relateret:** #1801 (Afsluttet viser forkerte løb), #21 (Kommende løb viser forkerte løb).`,
  },
  {
    title: '[bug] Dashboard: "kørte løb"-tæller viser samlet total i stedet for kørte ud af sæsonens mulige',
    labels: BUG('med'),
    body: `Tælleren for antal kørte løb på dashboardet er forkert: den viser et samlet antal i stedet for **hvor mange løb man har kørt ud af dem man kan køre i sæsonen**. Lige nu burde der fx stå "1 ud af X etaper".

**Kilde:** ${SRC} — @jeppek, tråd 1519075095115600053 (2026-06-23 20:22, screenshot).

**Accept:**
- [ ] Dashboard-tælleren viser kørte / mulige løb i den aktive sæson.
- [ ] Tallet stemmer med kalenderen for spillerens egen division/pulje.

**Relateret:** #1774 (antal etapedage inkonsistent på tværs af visninger).`,
  },
  {
    title: '[bug] Dashboard-tilfredshed ≠ bestyrelsesside (65% vs. 67%)',
    labels: BUG('med'),
    body: `Bestyrelsens tilfredshed vises forskelligt to steder: **Dashboard** siger 65%, mens **Bestyrelse-siden** siger 67%. De to skal vise samme tal (samme kilde).

**Kilde:** ${SRC} — @cybersimon, tråd 1519098146905395331 (2026-06-23 21:53-21:54, 2 screenshots).

**Accept:**
- [ ] Dashboard og Bestyrelse-side læser samme tilfredsheds-værdi.
- [ ] Ingen afrunding/cache-divergens mellem de to flader.

**Relateret:** #165 (bestyrelsens tilfredshed som progress bar), #1795 (sponsortilbud-kort).`,
  },
  {
    title: '[bug] Alder uoverensstemmende: akademiside viser 17, rytterside viser 18 (samme rytter)',
    labels: BUG('med'),
    body: `En ung rytters alder vises forskelligt to steder: på **akademisiden** står 17, på **rytterprofilen** står 18 (eksempel: Eunwoo Song — gælder flere ryttere). Det ser primært ud til at ramme ryttere der vises som 17 på akademisiden.

**Kilde:** ${SRC} — @cybersimon, tråd 1519067653182984374 (2026-06-23 19:52-19:59, 2 screenshots).

**Accept:**
- [ ] Alder beregnes/visning ens på akademiside og rytterprofil.
- [ ] Verificér mod flere akademiryttere (særligt 17/18-grænsen).

**Relateret:** #109 (U25-kategorisering), #1791 (ungdoms-rytter rework).`,
  },
  {
    title: '[ux] Hjælp-siden viser 14 gamle PCM-stat-forkortelser — opdatér til det nye CZ-evnesystem',
    labels: FEAT('med'),
    body: `På hjælpe-/forklaringssiden står der 14 evner med forkortelser som stammer fra det **gamle PCM-stat-system** (fx KortBjerg). De skal opdateres til de **15 nye CZ-evner** som spillet faktisk kører med. @jeppek bekræfter i #spørgsmål-og-svar at de øverste er PCM-rester og at man skal fokusere på de 15 nederste.

**Kilde:** ${SRC} — @jeppek, tråd 1519410621630644326 (2026-06-24 18:35, screenshot) + #spørgsmål-og-svar (@thelamba/@jeppek 2026-06-24 17:57-18:33).

**Accept:**
- [ ] Hjælp-siden (help.json EN+DA) viser kun de nye CZ-evner, ikke de gamle PCM-stats.
- [ ] Ingen PCM-forkortelser tilbage i forklarings-/hjælpetekster.

**Relateret:** #1529 (PCM→CZ-evner i al visning — CLOSED, denne flade blev overset), #1781 (rytterprofil "bedste evne" PCM-rest), #1595 (PCM-sletning behold stat_* som derive-kilde).`,
  },
  {
    title: '[ux] In-game forklaring af rytter-evner + fysiologiske power-intervaller (tooltips/mouse-over)',
    labels: FEAT('med'),
    body: `Spillere kan ikke forstå de fysiologiske power-intervaller (Zone 2, VO2 Max, maksimal effekt 5s/15s, 1-min, 5-min) ud fra UI'et — der mangler en kort forklaring. @thelamba: "Hvis der lige kunne være en lille beskrivelse ved mouse over ville det være lækkert." @bobby2106 forklarede dem manuelt i chatten og er enig i at der skal en bedre bro mellem de tekniske intervaller og rytternes overflade-evner (sprint/climbing/TT/punch).

Mål: casuals skal kunne nøjes med overflade-evnerne (sprint, klatring, enkeltstart, punch), mens interesserede kan hovere/folde ud for den fysiologiske dybde.

**Kilde:** ${SRC} — @thelamba + @bobby2106, #spørgsmål-og-svar (2026-06-24 16:36-16:43).

**Accept:**
- [ ] Tooltip/mouse-over (eller inline-forklaring) på de fysiologiske evner/power-intervaller (EN+DA).
- [ ] Forklar sammenhængen mellem power-intervaller og overflade-evnerne.

**Relateret:** #1379 (genbesøg evnesystem + watt-intervaller), #99 (tooltip for rytter-værdi), #961 (kontekstuel hjælp overalt).`,
  },
  {
    title: '[ux] Klikbar løb-navigation: løbskategori → kategorivisning, løbsnavn → løbsdetalje + direkte links fra dashboard',
    labels: FEAT('med'),
    body: `Løb er ikke klikbare nok i dag. Ønsker (fra @bobby2106 "Generel klikbarhed" + @stephoslash "QoL Dashboard"):
- Klik på en **løbskategori** → visning med alle løb i den kategori.
- Klik på et **løbsnavn** → løbsvisning: er løbet kørt, vis resultaterne; er det ikke kørt, vis kommende rute-/etapeprofil, tidspunkt og forventet startliste. Deltager man selv, kan man udtage trup derfra.
- Fra **"Kommende løb"** (dashboard) → klik direkte ind på løbet, ikke den fulde kalender.
- Fra et løb → link til **"seneste resultater"**/fuld resultatside, så resultater er lette at finde (svært at finde resultater fuldt ud i dag, særligt for løb man ikke selv kørte).

Rytter- og holdnavn-klikbarhed dækkes allerede af #1796 (hele rytter-rækken) og #260 (holdnavn → holdside) — dette issue er afgrænset til **løb + resultat-navigation**.

**Kilde:** ${SRC} — @bobby2106 (tråd 1519336698994233344) + @stephoslash/@bobby2106 (tråd 1519075669202436349, 2026-06-23/24).

**Accept:**
- [ ] Løbskategori er klikbar → kategorivisning.
- [ ] Løbsnavn er klikbart → løbsdetalje (resultater hvis kørt; ellers kommende profil/tidspunkt/startliste + trup-udtagelse hvis man deltager).
- [ ] "Kommende løb" på dashboard linker direkte til løbet.
- [ ] Hurtig vej fra løb til fuld resultatside.

**Relateret:** #1796 (rytter-række klikbar), #260 (holdnavn klikbar), #1484 (ruteprofil ved løbsresultat), #1010 (sæsonoverblik rute-/etapeprofiler).`,
  },
  {
    title: '[ux] Sæson-overblik: divisions-visning (alle divisioner samlet + filtrér til egen division)',
    labels: FEAT('med'),
    body: `Ønske om et overblik der viser **alle divisioner i én visning** og en visning med **kun ens egen division**.

**Kilde:** ${SRC} — @bobby2106, tråd 1519335649847803934 (2026-06-24 13:37, screenshot).

**Accept:**
- [ ] Overblik der lister alle divisioner/puljer.
- [ ] Toggle/filter til "kun min division".

**Relateret:** #1152 (Design: divisions, promotion/relegation), #1608 (skalerbar divisions-struktur), #1106 (multi-sæson visning).`,
  },
  {
    title: '[feature] Kontraktudløb-notifikation i indbakke (sæsonskift + ved køb af rytter med udløb samme sæson)',
    labels: FEAT('med'),
    body: `Når en ny sæson starter og en eller flere ryttere har **kontraktudløb** til den nye sæson, bør man få en **meddelelse i indbakken**. Det samme gælder hvis man **henter en rytter der har kontraktudløb i den sæson man køber ham i**. @jeppek foreslår samme **røde markering** som når man bliver overbudt på en auktion.

**Kilde:** ${SRC} — @jeppek, tråd 1518923623748993106 (2026-06-23 10:20-10:21, screenshot).

**Accept:**
- [ ] Indbakke-besked ved sæsonskift for ryttere med udløbende kontrakt.
- [ ] Indbakke-besked ved køb af rytter hvis kontrakt udløber i indeværende sæson.
- [ ] Rød markering på beskeden (samme som overbudt-auktion).

**Relateret:** #1677 (fyr/opsig kontrakter), #1310 (forlængelses-UI), #1150 (contracts/rider demands).`,
  },
  {
    title: '[feature] Autobud/proxy-bud fra rytterprofil når man starter en auktion',
    labels: FEAT('low'),
    body: `Det skal være muligt at lave et **autobud (proxy-bud)** direkte fra en rytters profil **i samme flow som man starter en auktion**.

**Kilde:** ${SRC} — @jeppek, tråd 1518914028917886976 (2026-06-23 09:42).

**Accept:**
- [ ] Autobud/max-bud kan sættes fra rytterprofilen ved auktions-start.

**Relateret:** #230 (auto-cancel proxy-bud når outbiddet over max), #228 (auktionsside-prioritering).`,
  },
];

const COMMENTS = [
  {
    issue: 1747,
    body: `**${SRC}** — flere holdudtagelse-ønsker (tråd 1519331030488711198, @bobby2106 2026-06-24):
- **Auto-udfyld for hele sæsonen:** assistenten skal kunne lave trupper til alle sæsonens løb på én gang (ikke kun ét løb ad gangen).
- **Forhindr udtagelse til løb man ikke skal køre:** managers oplever at de kan udtage ryttere til løb deres hold slet ikke deltager i — det bør ikke være muligt.
- **Vis kontekst ved udtagelse:** rytternes evner + ryttertyper + løbets ruteprofil skal være synlige mens man udtager truppen.

(De akutte auto-udfyld-bugs — dobbelt-allokering ved overlap, kan ikke fjerne/skifte kaptajn, save-fejl — er filed separat som ny bug, da #1747 er UX-laget.)`,
  },
  {
    issue: 931,
    body: `**${SRC}** — træningsplanlægning (tråde 1519330947189702816 + 1519288343014281216, @bobby2106 + @friisisch 2026-06-24):
- **Ugeplan:** kunne planlægge hele ugens træninger (fx mandag hård, tirsdag let, onsdag mellem) i stedet for dag-for-dag.
- **Vælg træningsfokus:** mulighed for at vælge hvad rytterne træner.
- **Assistent-forslag:** assistenten skal kunne foreslå både ugeplan og fokus.
- **Vis evner ved kategori-valg:** rytternes evner skal være synlige på trænings-dashboardet når man vælger hvilken kategori de skal træne.`,
  },
  {
    issue: 1791,
    body: `**${SRC}** — to balance-/data-observationer på den netop udrullede ungdomsmodel:
1. **Growth muligvis for hurtig:** @jeppek så en ungdomsrytter gå fra **21 → 25 i klatring på én træning** (tråd 1519330947189702816, 2026-06-24 14:13, screenshot). Værd at holde mod scorecard'et — så stort spring pr. enkelt-træning kan være for meget.
2. **Løn ikke genberegnet efter stat-nedjustering:** akademiryttere hvis stats blev sænket i rework'et har **ikke fået opdateret deres løn** tilsvarende (tråd 1519099225529389258, @bobby2106 + @thelamba, screenshots). Lønnen bør reflektere de nye (lavere) stats/værdi.

→ Forward-guard: når akademi-stats migreres/nedjusteres, skal afledt løn + værdi genberegnes i samme operation.`,
  },
  {
    issue: 1676,
    body: `**${SRC}** — træthed opdateres ikke (tråd 1519330947189702816, @jeppek 2026-06-24 13:22, 2 screenshots): trætheden er **den samme i dag som i går** efter løbene, selvom holdet **ikke har kørt løb i dag**. Daglig recovery ser ikke ud til at tikke for hold uden løbsaktivitet. Relevant for denne issues recovery-/transparens-scope (kan delvist hænge sammen med 23/6-løbsafviklings-rodet — verificér efter løbene er kørt om).`,
  },
  {
    issue: 932,
    body: `**${SRC}** — to-vejs flyt akademi↔senior (tråd 1519330873629999114, @bobby2106 2026-06-24 13:21; bekræftet i #spørgsmål-og-svar af @thelamba/@jeppek): det skal være muligt at **sende en akademirytter op på seniorholdet** og **sende en ung rytter ned fra seniorholdet til akademiet**. I dag kan akademiryttere ikke køre løb, og der mangler en op/ned-promotion-mekanik. (Dette er også forudsætning for at unge kan deltage i løb — flere spillere spurgte hvornår/hvor gamle ryttere må køre løb.)`,
  },
  {
    issue: 1239,
    body: `**${SRC}** — holdets nationalitet (tråd 1519293493040906333, @friisisch 2026-06-24 10:49): spilleren kan i dag **ikke finde ud af hvad holdets nationalitet er**, hvilket gør det svært både for holdets identitet og når **bestyrelsen sætter mål baseret på nationalitet**. Ønske: vis holdets nationalitet tydeligt, og gerne **sponsorernes nationalitet**, så man kan opbygge en identitet. @bobby2106 bekræfter at **valgfri holdnationalitet** kommer senere (kobler til dette + #933). Indtil da bør den nuværende (af og til viste) nationalitet/flag være synlig og konsistent.`,
  },
  {
    issue: 1675,
    body: `**${SRC}** — transferlistens øverste bjælke (tråd 1518921704871694376, @jeppek 2026-06-23 10:12-10:15, screenshot): ud over whitespace-problemet (denne issues kerne) bemærker @jeppek at **transfervindue-status-bjælken helt bør fjernes**, fordi transfervinduet nu er **permanent åbent** — bjælken giver ikke mening længere. Den øverste bjælke bør desuden gå helt ud til kanten (fuld bredde) så der ikke er stort whitespace til højre.`,
  },
  {
    issue: 1741,
    body: `**${SRC}** — flere regler for transferhistorik (tråd 1518908968200572938, @jeppek 2026-06-23 09:21):
- **Fyrede ryttere skal vises** i transferhistorikken (så man kan se at de har forladt holdet).
- **Usolgte auktionsryttere skal IKKE vises:** en rytter der kom på auktion men **ikke blev solgt** hører ikke i historikken. De skal kun stå der hvis de **blev solgt**, med **salgspris + køber**.

Hænger sammen med denne issues kerne (købt vs. solgt skal være tydeligt) og #1776 (sæson-tag + akademiryttere mangler). Samme flade — kan løses samlet.`,
  },
  {
    issue: 1021,
    body: `**${SRC}** — community-input til race engine-oplevelsen (tråd 1518959506292216000, "Drømmen omkring race engine", 2026-06-23). @bobby2106 spurgte hvad spillerne drømmer om for løbsafviklingen:
- **@stephoslash:** en 10-15 min afvikling med **fælles live-chat** hvor managers kan snakke mens simuleringen kører (GPRO-fællesskabsfølelse); evt. **PCS-style live coverage**-vibe.
- **@zootne:** **2D-visualisering** runde-for-runde med tilkoblet online-chat (GPRO-stil); en **Discord-resultatfane pr. division/gruppe** hvor en bot poster "X løb er færdigt" med direkte link til resultater.
- @bobby2106 bekræfter at Discord-resultat-feed pr. division/gruppe er på vej (flyttes til den nye server).

Gem som vision-input til race engine V1/V2 (relaterer #91 Race Day Live-ticker, #936 3D-visualisering, #1311 tekst-recaps, #959 etape-resultater, #1815 Discord-webhook per etape).`,
  },
];

function runGh(args, tmpBody, tag) {
  const tmp = path.join(os.tmpdir(), `cz-2506-${tag}.md`);
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
