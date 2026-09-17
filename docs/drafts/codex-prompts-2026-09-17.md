# Codex-sessioner 17/9 - copy-paste-klare prompter

Mandat valgt af ejeren 16/9: **Codex bygger og aabner PR. Codex merger ALDRIG.**
Ejeren eller Claude merger dagen efter.

Koer **een prompt pr. session**. Giv ikke Codex to spor i samme session - jeres
parallel-guardrails (`.claude/workflows/wave.js`, `scripts/hooks/guard-agent-spawn.sh`)
kender kun Claudes spawn-moenstre og daekker ikke Codex.

**Raekkefoelge, mest vaerdi foerst:** A (#5296) -> B (#5289) -> C (#5290) -> D (#5292).
A er priority:high og har allerede en indsnaevret rodaarsag, saa den er billigst at lukke.
B og C er smaa og oplagte. D er stoerst og maa gerne vente.

---

## FAELLES PREAMBLE - saet den oeverst i HVER session

```
Repo: C:\Dev\CyclingZone. Laes AGENTS.md foerst (den auto-loades, men laes den bevidst) -
hard rules dér gaelder uden undtagelse.

MANDAT DENNE SESSION: du bygger og aabner PR. Du MERGER ALDRIG, uanset hvor groen CI er.
Ejeren merger selv. Skriv i PR-body'en at den afventer ejer-merge.

FOER DU GAAR I GANG:
1. Laes docs/NOW.md - kort status, aktive parkeringer, aabne fund.
2. Koer `npm run sync-deps`. Uden den fejler routes/api.test.js,
   routes/raceStrategy.contract.integration.test.js og routes/rankings.test.ts med
   "Cannot find package 'zod'". De tre fejl er IKKE en regression og er IKKE din opgave.
3. Arbejd i et EGET worktree, aldrig i hoved-checkoutet:
   pwsh -File scripts/new-worktree.ps1 -Branch <branch> -FromBranch origin/main
   Hoved-checkoutet C:\Dev\CyclingZone skal blive staaende paa main.
4. Commit kun bag guarden:
   bash scripts/guard-commit-branch.sh <branch> <dir> && git -C <dir> commit -F msg.txt
   Brug `git commit -F <fil>`, aldrig heredoc og aldrig backticks i commit-beskeder.

FOER PUSH:
- `pwsh -File scripts/preflight-pr.ps1` skal vaere groen.
- Roerer du frontend/: ogsaa `npm run lint`, `node --test` og en build.
- TIER FULL (backend, delte libs, i18n, config, eller >6 filer): `scripts/verify-local.ps1`.
- Koer verifikation i FORGRUNDEN. En session der "venter paa et baggrundsjob" er stoppet.
- Loop-guard: 2 CI-fejl paa samme symptom -> STOP, skriv hvad du saa i PR-body'en, byg ikke videre.

PR-KRAV:
- Body foelger repoets template og SKAL have et udfyldt "## Brugerverifikation" med `- [x]`,
  ellers fejler check-verification.
- Brug `Refs #N`, IKKE `Closes #N`. Ejeren lukker selv issues.
- Brug `gh pr create --body-file <fil>`, aldrig inline backticks.

RØR IKKE:
- `docs/NOW.md` - den ejes af orkestratoren.
- PR #5285 / issue #5284 (fairplay-handel). Den tilhoerer en anden sessions boelge og har
  3 aegte CI-fejl. Lad den vaere.
- PR #5281, #5264, #5169, #5263, #5262, #5235, #3512 - alle parkeret paa ejer-beslutninger.
- Alt der muterer prod-data. Ingen SQL mod prod, ingen scripts med --apply.
- `MENTAL_ABILITY_TAG_CEILING` i backend/lib/riderProgression.js. Ejeren skal have en
  designsamtale om den foerst.

PLAYER-FACING TEKST:
- Laes docs/TONE_OF_VOICE.md. EN foerst, DA under. "jeg"/"du", aldrig "vi". Ingen em-dash.
- Danske tegn æøå i UI-tekst (ae/oe/aa kun i commit-beskeder og CLI).
- Er aendringen brugerrettet, skal der en patch note i frontend/src/data/patchNotes.js
  (EN+DA). Er den ikke, skriv i PR-body'en hvorfor ikke.
- Ny eller aendret spilmekanik: ogsaa help.json (en+da).
```

---

## SESSION A - #5296 welcome-mailen sender 0 (priority:high)

Branch: `fix/5296-mail-drift-vagt`

```
Opgave: GitHub-issue #5296. Laes issuet OG min kommentar fra 16/9 foerst - den indsnaevrer
rodaarsagen og aendrer praemissen for hele opgaven.

HVAD DER ALLEREDE ER MAALT (gentag det ikke):
Mail-drift-vagten rapporterer "0 sendte trods fundne kandidater", to doegn i traek. Men
Resend-loggen viser det modsatte: welcome-mailen "Your team is on the start line" er afsendt
og DELIVERED 10/9 20:51, 11/9 17:40, 12/9 00:55, 12/9 19:20 og 15/9 23:08 UTC. Kaeden pr. ny
manager er intakt: "Confirm Your Signup" -> "Your team is on the start line" -> "Day 1: ...".
Den seneste gik fra bekraeftelse til welcome-mail paa fire minutter. Ingen bounces, ingen
fejl i vinduet. 14/9 er tom, men der er heller ingen "Confirm Your Signup" den dag, saa det
ligner en dag uden tilmeldinger - ikke tabte mails.

KONKLUSION AT ARBEJDE UD FRA: fejlen ligger efter alt at doemme i VAGTEN, ikke i udsendelsen.

DIN OPGAVE:
1. Find mail-drift-vagten i repoet (start i backend/ og scripts/; den koerer som en
   overvaagning og rapporterer et antal sendte mod et antal kandidater).
2. Sammenlign PRAECIST to ting mellem vagten og den faktiske udsendelse:
   a) TIDSVINDUET - hvilken zone og hvilket doegn hver af dem regner i. Projektet koerer
      Europe/Copenhagen (CET/CEST), Resend logger i UTC. En vagt der taeller i UTC-doegn mod
      en udsendelse der koerer paa dansk lokaldato vil rapportere 0 paa skaeve dage.
   b) KANDIDAT-DEFINITIONEN - hvad vagten kalder en "kandidat" mod hvad udsendelsen faktisk
      sender til. Hvis de to saet ikke er ens, sammenligner vagten aebler og paerer.
3. Naar du har fastslaaet hvilken af de to det er (eller en tredje ting), saa RET DEN - og
   skriv en test der ville have fanget det. Vagten skal rapportere korrekt, ikke bare tie.
4. Roer IKKE selve mail-udsendelsen. Den virker, og det er bevist ovenfor. Aendrer du noget i
   afsendelsesstien, risikerer du at braekke noget der fungerer for at fikse en maaler.

HVIS DU FINDER AT UDSENDELSEN ALLIGEVEL ER I STYKKER: stop, byg ikke, og skriv praecis hvad
du saa som en kommentar paa #5296. Det aendrer praemissen og skal forbi ejeren.

Patch note: sandsynligvis nej (intern overvaagning, ikke brugerrettet). Begrund i PR-body.
```

---

## SESSION B - #5289 raa i18n-noegle SELECTION.HUNTER

Branch: `fix/5289-selection-role-i18n`

```
Opgave: GitHub-issue #5289. En spiller ser den raa noegle "SELECTION.HUNTER" i stedet for
"Udbrudsjaeger" paa den danske planlaegningsside, naar rollen er tildelt en rytter.
Versaler i UI er i18next' fallback naar opslaget fejler.

GAA BREDERE END DEN ENE NOEGLE. Issuet beder eksplicit om det:
1. Find aarsagen: slaas noeglen op i et andet namespace end det planlaegningssiden loader,
   eller saettes rollens visningsnavn fra en kode-vaerdi ("hunter") der ikke har en
   oversaettelse i `selection`-namespacet?
2. Tjek ALLE roller, ikke kun `hunter`. Hvis én mangler, mangler der formentlig flere.
3. Tjek BEGGE sprog (en + da).
4. Tjek om samme noegle bruges andre steder - holdudtagelse og taktik-fanen er naevnt i
   issuet som sandsynlige steder.
5. Verificer i browseren at teksten faktisk vises rigtigt bagefter, paa dansk. Et gruent
   lint-run beviser ikke at strengen naar skaermen.

FORWARD-GUARD: repoet har allerede i18n-guards i CI (key-coverage, page-untranslated,
namespace-inline, nav-strings). Find ud af hvorfor ingen af dem fangede det her, og udvid den
rette guard saa den ville have gjort det. En fix uden guard betyder at det kommer igen.

Patch note: ja, det er brugerrettet. Kort, EN+DA.
```

---

## SESSION C - #5290 etapeloeb i morgen vises som "i dag"

Branch: `fix/5290-race-today-badge-date`

```
Opgave: GitHub-issue #5290. En spiller ser et loeb der starter I MORGEN maerket "today".

FASTSLAA FOERST HVOR BADGET STAAR. Screenshottet siger det ikke. Issuet gaetter paa
Planlaegning eller Overblik. Find den faktiske komponent foer du retter noget - retter du det
forkerte sted, ser spilleren stadig fejlen.

TO HYPOTESER, og den foerste er svaekket:
a) Tidszone-forskydning: en UTC-timestamp sammenlignet mod dansk lokaldato. MEN rapporten
   kom 16:06 UTC = 18:06 CEST, altsaa langt fra midnat i begge zoner. En ren +/-2 timers
   forskydning forklarer det derfor IKKE alene. Udeluk den ordentligt foer du forkaster den.
b) Badget bindes til "naeste loeb i kalenderen" eller til `game_day` uden en rigtig
   datosammenligning, saa det naeste loeb altid faar "i dag".

Projektet koerer Europe/Copenhagen. Etaper ligger kl. 11-19 dansk tid. S3 loeber 28/8 - 27/9.

SAMME FEJLKLASSE ER SET FOER - laes dem foerst, loesningen ligger formentlig taet paa:
#3724 (ren dato formateret tidszone-foelsomt), #3119 (entry-sweep bandt paa CET-dato i
stedet for game_day), #3773 (patch notes daterede en dag ude i fremtiden).

Skriv en test med en fast, injiceret "nu"-tid der daekker doegnskiftet i begge retninger -
23:30 dansk tid og 00:30 dansk tid - saa fejlen ikke kan komme igen uopdaget.

Patch note: ja, brugerrettet. Kort, EN+DA.
```

---

## SESSION D - #5292 rytterdatabase: hurtig-scout + filter-state

Branch: `feat/5292-rider-db-scout-and-filter-state`

```
Opgave: GitHub-issue #5292. To ting i samme flow, meldt af samme spiller:
1. Rytterdatabasen mangler den hurtig-scout-knap som auktionssiden har i listen.
2. Filtrene nulstilles naar man gaar ind paa en rytter og navigerer tilbage.

De to forstaerker hinanden: uden scout-knap skal man ind paa hver rytter, og hver gang
mister man filtrene. Mobil er den haardest ramte flade - "aabn i ny fane" er ikke et reelt
workaround paa telefon. Ejeren har ANDROID, aldrig iOS.

VERIFICER FOER DU BYGGER: punkt 2 er samme klasse som #3916 og #1777, der begge er LUKKET.
Find ud af hvad de loeste, og om rytterdatabasen bare aldrig blev omfattet, eller om
loesningen er drevet tilbage. Genbrug den eksisterende mekanisme frem for at opfinde en ny.

Punkt 1 er ren paritet med auktionssiden. Find scout-genvejen dér og genbrug komponenten -
byg ikke en ny knap der ser anderledes ud.

BINDENDE DESIGN-KRAV - laes dem FOER du roerer UI:
- docs/design/PAGE_TEMPLATES.md: brug een af de tre kanoniske skabeloner. Opfind aldrig eget
  sidehoved, container-bredde, padding, radius eller typografi-trin.
- docs/design/TASTE.md: skabelonen er gulvet, TASTE er maalet.
- Bindende: een gold primary-knap pr. view, hairline-borders (ingen skygger), 5px
  card-radius, tabular figures paa numerik, stroke-ikoner (ALDRIG emoji).

Tag skaermbilleder af resultatet i baade desktop- og mobilbredde og laeg dem i PR-body'en.
Ejeren skal kunne se aendringen uden at koere noget selv.

Patch note: ja, brugerrettet. Kort, EN+DA.
```

---

## Hvad Codex IKKE skal have

| Emne | Hvorfor ikke |
|---|---|
| Loft-designet (`MENTAL_ABILITY_TAG_CEILING`) | Ejeren vil have en designsamtale om rodproblemet foerst. Ikke en byggeopgave endnu. |
| Sponsor #4860 / PR #5263 | Bygget, afventer ejerens gennemgang. Deadline 27/9, men beslutningen er hans. |
| #5281, #5264, #5169 | Parkeret 16/9. #5264 skal ogsaa flettes med main, men afventer loebsdage-retningen - flettes den nu, kan arbejdet vaere spildt. |
| #5285 / #5284 | Anden sessions boelge, 3 aegte CI-fejl. |
| Apply-go-kort #5268, #4619 | Prod-mutationer. Ejer-gated, een ad gangen, med ham kiggende med. |
| #5294, #5295 | Ubesvarede docs-spoergsmaal - de kraever ejerens stemme, ikke kode. |

## En ting der boer rettes uanset

`docs/AI_CHANNEL_ROUTING.md` siger stadig *"Solo Claude-operation siden 2026-06-12 - ingen
Codex/Manus-kanaler laengere"*. Det er ikke sandt laengere: Codex byggede PR #5263 den 15/9,
og repoet har `.codex/config.toml`, `.codex/hooks.json` med 46 hook-referencer og
`.codex.local/SESSION_CONTEXT.md`. Baade Codex og Claude laeser den doc og faar en forkert
praemis. Den kan tages som et lille docs-spor i enhver session - eller af ejeren selv paa to
minutter.
