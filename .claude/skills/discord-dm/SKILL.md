---
name: discord-dm
description: Triagér en Discord-DM som ejeren har copy-pastet ind, og omsæt den til GitHub-issue plus svarudkast på EN/DA. Trigger med "/dm", "her er en DM", "en spiller skrev til mig", "discord-besked", eller når ejeren paster tekst der tydeligt er en privat besked fra en spiller. Anonymiserer altid, fordi repoet er publicly viewable.
---

# Discord-DM-triage

Ejeren modtager spiller-henvendelser som personlige Discord-DM'er og paster dem ind her. Denne skill omsætter dem til backlog og svarudkast uden at tabe indholdet og uden at eksponere spilleren.

**Design:** [`docs/superpowers/specs/2026-08-18-discord-dm-triage-design.md`](../../../docs/superpowers/specs/2026-08-18-discord-dm-triage-design.md)

## Hard gates

Tre regler der ikke bøjes, uanset hvor travlt der er:

1. **Anonymisér altid.** Repoet er closed-source men publicly viewable. Se `## Anonymisering`.
2. **Send aldrig noget til spilleren.** Svar leveres som udkast til copy-paste. Ejeren poster selv.
3. **Verificér før du kalder noget en bug.** En DM er en påstand. Se Trin 3.

## Trin 1: normalisér input

Copy-paste fra Discord tager typisk afsendernavn, tidsstempel og beskedtekst i én klump, og lange beskeder kan slæbe citat-blokke fra tidligere svar med.

- Skil afsender fra indhold. Resten af rutinen arbejder kun på beskedteksten.
- Er der flere beskeder i klumpen, så afgør om det er én sammenhængende henvendelse eller flere separate. Flere separate behandles hver for sig, med egen triage og eget issue.
- Er beskeden på dansk, arbejd videre på dansk. Svarudkastet leveres uanset på begge sprog.

Spørg ikke ejeren om afsenderens navn. Det skal alligevel ikke bruges.

## Trin 2: triagér

Fire spande:

| Spand | Kendetegn | Bliver til issue |
|---|---|---|
| **Bug** | Noget virker ikke som beskrevet eller som spilleren med rimelighed kunne forvente | Ja, efter Trin 3 |
| **Feature-ønske** | Spilleren vil have noget der ikke findes | Ja |
| **Spørgsmål eller support** | Spilleren forstår ikke noget, eller har brug for hjælp | Kun hvis spørgsmålet afslører at spillet er uforståeligt på det punkt. Så er det et UX-issue, ikke en supportsag |
| **Støj** | Ros, smalltalk, noget der allerede er besvaret | Nej |

Grænsetilfældet mellem support og UX er det vigtige. Én spiller der spørger hvor knappen er, er support. Et spørgsmål om noget spillet burde have forklaret selv, er et UX-issue. Er du i tvivl, så sig til ejeren hvilken vej du hælder og hvorfor, i stedet for at oprette et issue på må og få.

## Trin 3: verificér før claim

Repoets hard rule, og den er nemmest at bryde præcis her, hvor spilleren lyder sikker på sin sag.

Før noget beskrives som en bug:

- Slå den påståede adfærd op i koden eller mod runtime
- Tjek `database/schema-snapshot.json` før ad-hoc SQL, hvis påstanden handler om data
- Skeln mellem "spillet gør noget forkert" og "spillet gør noget spilleren ikke forventede". Det sidste er ofte et UX-issue, ikke en bug

Kan påstanden ikke verificeres, så opret stadig issuet, men hold påstand og verifikationsforsøg tydeligt adskilt. Skriv hvad du prøvede og hvad du ikke kunne bekræfte. Skriv aldrig en uverificeret påstand som konstateret fejl.

## Trin 4: søg for dublet

Altid, før oprettelse:

```bash
gh issue list --state all --search "<nøgleord fra henvendelsen>" --limit 20
```

Søg på symptomet, ikke på spillerens ordvalg. Prøv to til tre formuleringer, for backloggen er stor og en henvendelse rammer sjældent samme ord som det eksisterende issue.

Findes sagen allerede:

```bash
gh issue comment <N> --body "<anonymiseret evidens>"
```

Kommentér den nye spiller-evidens på det eksisterende issue og opret ikke nummer to. Fortæl ejeren at det var en dublet og til hvilket issue.

## Trin 5: opret issue

```bash
gh issue create --title "<symptom, ikke citat>" --body-file <fil> \
  --label "claude:todo" --label "type:bug" --label "priority:med"
```

Brug `--body-file`, ikke `--body` med heredoc. Æøå bliver korrupt gennem heredoc på Git Bash under Windows.

**Titel:** beskriv symptomet set fra spillet, ikke spillerens ordlyd.

**Body:**

1. Anonymiseret citat som evidens
2. Dine verifikationsfund, tydeligt adskilt fra citatet
3. Hvad der skal ske, hvis det er klart

**Labels** (verificeret 2026-08-18):

| Akse | Værdier |
|---|---|
| State | `claude:todo` (altid ved oprettelse) |
| Type | `type:bug`, `type:feature`, `type:refactor`, `type:docs`, `type:investigation` |
| Prioritet | `priority:high`, `priority:med`, `priority:low` |

Sæt `priority:high` når noget er i stykker for flere spillere eller blokerer spil. Enkeltstående irritation er `priority:med` eller lavere.

## Trin 6: svarudkast

Leveres på **EN først, DA under**, klar til copy-paste.

Udkastet skal:

- Kvittere for det konkrete spilleren skrev, ikke generisk
- Sige hvad der sker nu
- Være kort. Dette er en DM, ikke en pressemeddelelse

Udkastet må ikke:

- Love en dato eller en release
- Love at ønsket bliver bygget, hvis det kun er oprettet som issue
- Bruge em-dash, hverken i EN eller DA

Er sagen en dublet af noget kendt, så sig det ligeud i udkastet. At en anden allerede har rapporteret det er et fint svar.

## Anonymisering

Repoet er publicly viewable. Alt der ryger i et issue er offentligt læsbart permanent.

**Default, uden at spørge:**

- Discord-håndtag udelades. Skriv "en spiller skriver" plus citatet
- Rens citatet for indirekte identifikatorer: holdnavn, e-mail, andre spilleres navne, links til profiler
- Bevar det tekniske indhold uændret. Anonymisering må ikke koste detaljer der gør issuet svært at handle på

**Undtagelsen:** ejeren kan bede om håndtaget i den enkelte sag. Først da kommer det med. Spørg ikke om lov proaktivt, og gør det ikke til en vane.

Sporbarheden tilbage til personen ligger i ejerens egen DM-tråd, ikke i issuet.

## Fejlhåndtering

| Situation | Håndtering |
|---|---|
| Uklar DM ("der er noget galt med mit hold") | Spørg ejeren hvad spilleren mente. Opfind ikke et issue. Dette er den fejlklasse der fylder backloggen med gæt |
| Påstand kan ikke verificeres | Opret med påstand og verifikationsforsøg adskilt. Ikke som konstateret fejl |
| Flere henvendelser i ét paste | Separate sager, hver med egen triage |
| Dublet fundet | Kommentér på eksisterende, opret ikke nyt |
| `gh` fejler | Stop og rapportér. Efterlad ikke et halvt oprettet issue |
| Henvendelsen er ren støj | Sig det, og lever kun svarudkastet. Intet issue |

## Output til ejeren

Afslut altid med denne struktur, så han kan handle uden at læse tilbage:

1. **Triage:** hvilken spand, og hvorfor på én linje
2. **Issue:** nummer og link, eller "dublet af #N", eller "intet issue oprettet, fordi ..."
3. **Svarudkast:** EN, derefter DA, i en kodeblok så det er nemt at kopiere

Hold hele outputtet kort. Ejeren skal kunne skimme det, kopiere svaret og komme videre.
