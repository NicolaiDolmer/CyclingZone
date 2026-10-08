# Form og formtoppe i løbsmotor v4 + løbsmotor-pakken uge 41

Status: ejer-besluttet 4/10 (fire kort, §2). Design, ikke leveret kode. Byg starter man 5/10. Refs #6156.

SSOT: [RACE_ENGINE_RULES](../../RACE_ENGINE_RULES.md) ejer motorens kontrakt, [TRAINING_RULES](../../TRAINING_RULES.md) ejer form og formtoppe. Begge opdateres i bygge-PR'en; denne spec er ikke en parallel SSOT. Præcise vægte, formler og tærskler står aldrig her (repoet er offentligt, #3436).

## 1. Problemet

Siden v4 blev tændt 28/9, når hverken rytterens form eller hans formtoppe frem til løbet. Kun træthed gør. Bevis og prod-tal står i #6156. Kort:

- `race_engine_v3_scoring` og `race_engine_v4` er begge on, så peak-vinduer og træningskvalitet hentes og regnes ud (`raceRunner.js` `attachPeakContext`).
- Broen (`raceEngineV4Bridge.js` `toV4Entrants`) sender dem ikke videre, og v4's `Entrant` har intet felt til dem.
- v4 kalder selv sin "dårlig dag"-mekanik med `form: null` (`engine/v4/groups.ts`).
- Hjælpeteksten lover: en top løfter formen, form tæller i resultatet, god form giver færre dårlige dage, og toppen koster et dyk bagefter.

Omfang 4/10 på menneskehold i S4: 232 toppe afsluttet uden virkning, 207 i gang, 114 starter senest 11/10, 287 senere.

## 2. Ejerens beslutninger 4/10

| # | Spørgsmål | Valg |
|---|---|---|
| 1 | Hvordan virker form og top i v4? | **Én samlet form.** Toppen lægges oven i rytterens form, dykket trækkes fra. Den samlede form virker to steder: ydeevnen hele etapen og risikoen for en dårlig dag |
| 2 | De brugte toppe? | **Gives tilbage.** Datareparation med dry-run og ejer-go på de konkrete tal |
| 3 | Besked til spillerne? | **Først når rettelsen er live.** Én samlet besked sammen med patch noten. Ingen besked og ingen Known issue før |
| 4 | Hvilke løb gælder rettelsen for? | **Kun løb der starter efter tændingen.** Igangværende løb kører færdigt på deres bundne regler |
| 5 | Pakkens indhold | Alle fire områder (§5), med et fast trin 0: tjek hvad der allerede er løst, og følg op på kvaliteten af det der er leveret siden flippet |

## 3. Design

### 3.1 Samlet form

Samlet form på en etapedag = rytterens form (`rider_condition.form`, skala 0-100) + toppens tillæg, hvis dagen ligger i et peak-vindue, eller minus dykket, hvis dagen ligger i tilbagebetalingen efter et vindue.

Toppens størrelse genbruger det, der allerede findes og er testet: vinduerne fra `racePeakPlans.loadPeakPlans`, træningskvaliteten fra `resolvePeakTrainingQualities` og fasen fra `racePeaks.resolvePeakPhase`. Der opfindes intet nyt regnestykke for selve toppen. Det er den samme værdi, planlæggeren viser spilleren.

### 3.2 Kontrakten

- `Entrant` får et valgfrit felt til samlet form (additivt, som `team_id` blev det i #4246). Uden feltet opfører motoren sig som i dag.
- Broen regner samlet form pr. rytter pr. etape og sender den. Det er første gang `stage.peakDay` og `e.peakWindows` læses på v4-stien.
- Kernen forbliver ren: ingen DB, ingen dato-logik i `engine/v4`. Alt der kræver kalender, bliver i `raceRunner` og broen.

### 3.3 To virkesteder i motoren

1. **Risikoen for en dårlig dag.** Krogen findes allerede (`physiology.jourSansProbability` tager form); den får bare den rigtige værdi i stedet for `null`.
2. **Ydeevnen hele etapen.** Et lille, begrænset led på rytterens bæreevne, samme sted som dagsformen virker i dag. Neutralt ved middel form, så en rytter uden data ikke flytter sig.

Doktrin der skal holde: styrke straffes aldrig; form er et tillæg oven på evnen, aldrig en evne i sig selv (samme princip som #5957); en svag rytter på top slår ikke en stærk rytter i normal form på form alene.

### 3.4 Tekniske valg der træffes i byggeriet

- Hvad sker der, når form plus top overstiger skalaens loft.
- Hvor det neutrale punkt ligger (fast værdi eller feltets middel).
- Enkeltstart og holdtidskørsel: samme led eller eget.
- Fortællingen: v4 får i dag tomme form-kort (`raceRunner.js` ved `extractStageMoments`); samlet form kan gives videre, så "kørte på sin formtop" kan fortælles sandt.

### 3.5 Tænding

- Ny regel-revision efter mønsteret fra #5955 (`races.engine_rules_revision`, bundet ved løbets første etape, uforanderlig). Kun løb der starter efter tændingen, får den.
- Ukendt revision er en fejl, aldrig nyeste regler.
- Selve tændingen er ejer-only og sker med ordret go, efter gaten i §3.6.

### 3.6 Gate før tænding (simulér-før-ship)

- Parrede simuleringer med og uden samlet form på prod-lignende felter, flere seeds.
- v4's kalibreringsbånd må ikke brydes (favorit-sejrsrate, feltspredning, udbrudsandel).
- En top skal kunne mærkes, men ikke afgøre løbet alene. Båndet for "mærkes" vises til ejeren som tal før go.
- Hjælpetekstens udsagn (EN og DA) skal være sande efter ændringen. Kan et tal ikke holdes, rettes teksten i samme PR, og det vises i go-kortet.
- Regressionsvagt: en test der fælder, hvis broen igen taber form eller peak-vinduer på vej ind i v4. Den manglede ved flippet.

## 4. De brugte toppe gives tilbage

Regel: en top gives tilbage, hvis den ikke kan have fået virkning. Det er tilfældet når

- dens vindue startede fra S4's start og frem til tændingen, eller
- dens målløb er startet før tændingen (løbet kører færdigt uden form, jf. beslutning 4), uanset hvornår vinduet ligger.

Udførelse: script med dry-run, backup-tabel, idempotent, verificering bagefter. Prod-skrivning kun efter ejer-go på dry-run-tallene, og ejeren ser tilstanden live først. Ingen top må både tælle i et løb og blive givet tilbage. Tilbagegivne toppe udløser intet dyk. Hvordan en tilbagegivet top teknisk bliver planlægbar igen (låsen er bundet til vinduets startdato), afklares i byggeriet og vises i dry-run-rapporten.

Følgeeffekt at vise ejeren i go-kortet: managere med et langt etapeløb i gang får toppen tilbage, men kan først bruge den i et løb der starter efter tændingen.

## 5. Løbsmotor-pakken uge 41 (fire laner)

**Trin 0, mandag morgen, før noget bygges (read-only).** Der er leveret 22 motorændringer siden flippet, 14 af dem 2/10.

- Sandhedstjek pr. issue: hvad er leveret, hvilken regel-revision kørte de løb spillerne klager over, hvad viser prod-data nu. Dom: løst, delvist, åben.
- Kvalitetsopfølgning pr. leveret ændring: holder den i prod-data, står reglen i `RACE_ENGINE_RULES.md`, er der test bag.

| Lane | Indhold | Issues |
|---|---|---|
| 1 | Form og formtoppe i v4 + toppene tilbage | #6156 |
| 2 | Udbrud og jagt: bekræft eller afvis efter leverancerne 1-2/10, ret kun det der stadig fejler | #5951 · #5978 |
| 3 | Genmål gamle fejl i v4, luk eller skriv om; dokumentér ungdomsløbenes ikke-startere | #3460 · #5059 · #2557 · #3426 · #3965 · #5907 |
| 4 | Kalibrering og vagter + kvalitetsopfølgningen; leverer gaten i §3.6 | #4914 · #4197 · #5515 |

Rækkefølge i lane 1: kontrakt og bro → de to virkesteder → gate-simulering → dry-run af toppene → go-kort (tænding + reparation) → patch note og besked.

## 6. Ved tænding

Patch note (EN først, DA under) og Discord-udsnit af samme tekst; ejeren poster selv. Kerneindhold: form og formtoppe tæller igen i løb der starter fra nu, og toppe brugt siden sæsonstart er givet tilbage. `FEATURE_REGISTRY.yml` og `help.json` afstemmes i samme tur.
