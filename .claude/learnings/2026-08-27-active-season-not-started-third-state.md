# En "aktiv" sæson kan være aktiv OG endnu ikke begyndt

**Dato:** 2026-08-27
**Issue:** [#4293](https://github.com/NicolaiDolmer/CyclingZone/issues/4293)
**Klasse:** manglende tilstand (en boolsk gate over en fire-tilstands-virkelighed)

## Symptom

@knud_r_flink 27/8 kl. 03:20 UTC om "Skill raises this season": "Seems like this
feature fails after the changes". Det er hele rapporten. Der var et skærmbillede
vedhæftet i Discord-tråden, men det er **ikke inspekteret** (issue #4293's body
siger det selv), så hvad han så, ved vi ikke af egen iagttagelse.

Det vi ved, er hvad koden tegnede den dag. Prod-tilstanden 27/8 (verificeret
read-only) sender kvitteringen ned ad en gren hvor rytterprofilens Træning-fane
skriver "Siden 28. aug" over en kolonne hvor hver evne står på **+0**, selvom
holdet havde trænet hver dag. Det svarer til det han beskriver, og det er
grundlaget for resten af denne postmortem. Konklusionen er altså udledt af kode
plus prod-data, ikke aflæst af et skærmbillede.

## Hvad det IKKE var

Issue-titlen pegede på #4277 (D1+D2-slukningen for sæson 3, lukket tre timer før
rapporten). Det var forkert. `backend/lib/dailyTrainingEngine.js:344` gater kun
selve løbsdags-tick'et på `race_day_development_enabled`. Med flaget off kører en
racende rytter sit normale pas, og gains skrives som før. Prod bekræftede
kørsler hver dag: 24/8 = 354, 25/8 = 357, 26/8 = 359.

Timing-korrelation er ikke årsag. Rollbacken lå tættest på i tid og var derfor
den nemmeste forklaring, men gains-stien var uberørt.

## Rodårsag

Sæson 3 stod i prod som `status = 'active'` med `start_date = 2026-08-28`, mens
det var 27/8. Sæson 2 sluttede 23/8. Dagene 24.-27/8 hørte altså til **ingen**
sæson: et interregnum hvor sæsonen er sat op, men ikke begyndt.

Den tilstand er **ikke** en fejl i data. Den er den krævede tilstand mellem to
sæsoner: #4229 gjorde "der findes præcis én aktiv sæson" til en invariant, fordi
30+ kaldesteder spørger på `.eq("status","active")` og lå ned i timevis da sæson
3 var sat til `upcoming`
(`backend/lib/activeSeasonInvariant.js`,
[2026-08-25-interregnum-ingen-aktiv-saeson.md](2026-08-25-interregnum-ingen-aktiv-saeson.md)).
Prisen for den invariant er præcis dette hul: en sæson der er `active` før sin
egen `start_date`. Rettelsen hører derfor hjemme på fladen, ikke i data. De to
postmortems er to sider af samme kalender-skifte, to dage fra hinanden.

Kvitteringen filtrerer på `tick_date >= seasonStart`
(`frontend/src/lib/useTrainingHistory.js`), så alle fire dages kørsler faldt
ud af vinduet. `seasonAbilityGains` returnerede et tomt objekt, og
`abilityReceipt` oversatte det til `gained: 0`.

Koden kendte kun to tilstande:

| seasonStart | vist |
|---|---|
| `null` (ingen aktiv sæson hentet) | tom-glyf + "afventer" |
| sat | tal |

Interregnummet faldt i den anden. Et **tomt** vindue blev derfor præsenteret som
et **målt** nul: "+0 point i en periode der ikke er startet".

## Læringen

**En boolsk gate over "har vi data" skjuler tilstanden "der er endnu ikke noget
at have".** `if (seasonStart)` besvarer spørgsmålet "kender vi sæsonen", ikke
"er der gået en eneste sæsondag". De to spørgsmål faldt sammen så længe en aktiv
sæson altid var begyndt, og gik fra hinanden første gang en sæson blev aktiveret
en dag før sin startdato.

Generaliseringen: hver gang en visning har formen "siden X", er der **fire**
tilstande, ikke to. X er ukendt; X ligger i fremtiden; X er passeret, men der er
endnu ikke målt noget; X er passeret og der er data. Nummer to og tre bliver
typisk først opdaget af en spiller, og de ser ens ud på skærmen.

Nummer tre er den lumske. Sæsonens **første** morgen, før dagens tick har kørt,
er vinduet ægte tomt: tilstanden er "running", tallet er et sandt nul, og
visningen er pixel for pixel den samme som fejlen ovenfor ("+0" under "Siden
28. aug"). En rettelse der kun lukkede tilstand to, ville altså have genskabt
det rapporterede billede for alle spillere dagen efter. Det er værd at spørge
ved hver "siden X"-flade: hvad ser den ud til at sige på dag 1?

**Nul er et resultat. Tomt er en tilstand.** En kvittering må vise et nul den har
målt, men aldrig et nul den ikke har målt. Rettelsen var ikke at finde tal at
vise, men at holde op med at kalde fraværet af tal for et tal.

## Fixet

To rene funktioner i `frontend/src/lib/trainingReport.js`:
`seasonReceiptState(seasonStart, today)` svarer på **datoen** (`unknown` /
`notStarted` / `running`), og `seasonReceiptView(dateState, seasonRuns)` lægger
sæsonens faktisk hentede dage oveni: en kørende sæson uden en eneste træningsdag
bliver `noDays` ("ingen træningsdage i denne sæson endnu"), og en **fejlet**
hentning bliver `unknown` i stedet for et nul vi ikke har målt.

`useTrainingHistory` eksponerer den samlede tilstand, afledt af dagens **danske**
kalenderdag (`copenhagenDayKey`), ikke browserens og ikke UTC's: med en
UTC-baseret "i dag" ville sæsonen stå som ikke-begyndt de første to timer af sin
egen første dag.

To rækkefølge-detaljer der begge er en del af fixet:

- Tilstanden sættes **efter** `setRuns`/`setSeasonRuns`, ikke før hentningen. Et
  dato-opslag der kastede før hentningen ville have tømt ikke bare
  sæson-tilstanden, men også den daglige log og 30-dages-trenden. `??`-fallback
  dækker kun en null-retur, ikke et kast.
- `copenhagenDayKey` (`raceCentre.js`) kaster ikke længere: `Intl.DateTimeFormat`
  svarer med `RangeError` på en zone runtime'en ikke kender, og funktionen
  returnerer nu `null` i stedet, præcis som ved en ugyldig ms. Begge interne
  kaldere havde allerede en null-gren.

Vinduet blev **bevidst ikke** flyttet til "siden forrige sæsons slutning".
Enheden er point pr. sæson (ejer-beslutning 9, 14/8), og et vindue der talte
interregnummet med ville få tallet til at FALDE på sæsonstartsdagen, når vinduet
snapper til den ægte start. En kvittering der går baglæns er en værre løgn end
en der siger "ikke begyndt endnu". Overskriften ændrer sig i stedet.

Kortet bliver stående i alle fire tilstande. "Nu"-kolonnen og fremdriftsbaren ER
sande uanset sæsonens tilstand, og de bærer netop den træning interregnummet
gav. Det var derfor forkert at erstatte kortet med en EmptyState: den ville have
skjult ægte data for at markere et fravær der kun gjaldt én af fire kolonner.

## Forward-guard

- `frontend/src/lib/trainingReport.test.js`: `seasonReceiptState` med start i
  fremtiden, på grænsen (dag 1 tæller med, samme `>=` som gains-filteret) og med
  ubrugelige datoer. `seasonReceiptView` for sæsonens første morgen (nul dage →
  `noDays`), for en fejlet hentning (`null` → `unknown`) og for at dato-
  tilstandene går uændret igennem. Plus en test på at tilstanden når hele vejen
  ud i rækken som tom-glyf, mens `value` og `pct` bliver stående, og en på at
  hver tilstand har sin egen fodnote-nøgle.
- `frontend/src/lib/useTrainingHistory.test.js`: dato-aksen (midnat i København,
  ikke i UTC) plus struktur-guards på at hooken stadig eksponerer `seasonState`,
  stadig afleder den gennem `seasonReceiptView(seasonReceiptState(...))`, og
  stadig sætter den EFTER `setRuns`/`setSeasonRuns`.
- `frontend/src/lib/raceCentre.test.js`: `copenhagenDayKey` med en ukendt zone
  giver `null` og kaster ikke, og de to interne kaldere falder pænt igennem.

## Sidegevinst værd at huske

Under den visuelle verifikation startede preview-værktøjets `frontend-preview`-
konfiguration en dev-server fra **hoved-checkoutet** (`c:/dev/cyclingzone`), ikke
fra worktree'et, fordi `.claude/launch.json` bruger `--prefix frontend` relativt
til en cwd der ikke er worktree-roden. Serveren så grøn ud og viste den gamle
kode. `/__worktree-id` (`frontend/vite.config.js`) afslører det på ét kald og bør
tjekkes FØR man konkluderer noget af en preview i en worktree-session.
