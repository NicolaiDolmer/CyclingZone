# En "aktiv" sæson kan være aktiv OG endnu ikke begyndt

**Dato:** 2026-08-27
**Issue:** [#4293](https://github.com/NicolaiDolmer/CyclingZone/issues/4293)
**Klasse:** manglende tredje tilstand (en boolsk gate over en tre-tilstands-virkelighed)

## Symptom

@knud_r_flink 27/8 kl. 03:20 UTC: "Skill raises this season" fejler. Skærmbilledet
viste rytterprofilens Træning-fane med "Siden 28. aug" over en kolonne hvor hver
evne stod på **+0**, selvom holdet havde trænet hver dag.

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

Kvitteringen filtrerer på `tick_date >= seasonStart`
(`frontend/src/lib/useTrainingHistory.js:76`), så alle fire dages kørsler faldt
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

Generaliseringen: hver gang en visning har formen "siden X", er der tre
tilstande, ikke to. X er ukendt, X ligger i fremtiden, X er passeret. Den
midterste bliver typisk først opdaget af en spiller.

**Nul er et resultat. Tomt er en tilstand.** En kvittering må vise et nul den har
målt, men aldrig et nul den ikke har målt. Rettelsen var ikke at finde tal at
vise, men at holde op med at kalde fraværet af tal for et tal.

## Fixet

`seasonReceiptState(seasonStart, today)` i `frontend/src/lib/trainingReport.js`
giver `unknown` / `notStarted` / `running`. `useTrainingHistory` eksponerer den,
afledt af dagens **danske** kalenderdag (`copenhagenDayKey`), ikke browserens og
ikke UTC's: med en UTC-baseret "i dag" ville sæsonen stå som ikke-begyndt de
første to timer af sin egen første dag.

Vinduet blev **bevidst ikke** flyttet til "siden forrige sæsons slutning".
Enheden er point pr. sæson (ejer-beslutning 9, 14/8), og et vindue der talte
interregnummet med ville få tallet til at FALDE på sæsonstartsdagen, når vinduet
snapper til den ægte start. En kvittering der går baglæns er en værre løgn end
en der siger "ikke begyndt endnu". Overskriften ændrer sig i stedet.

Kortet bliver stående i alle tre tilstande. "Nu"-kolonnen og fremdriftsbaren ER
sande uanset sæsonens tilstand, og de bærer netop den træning interregnummet
gav. Det var derfor forkert at erstatte kortet med en EmptyState: den ville have
skjult ægte data for at markere et fravær der kun gjaldt én af fire kolonner.

## Forward-guard

- `frontend/src/lib/trainingReport.test.js`: `seasonReceiptState` med start i
  fremtiden, på grænsen (dag 1 tæller med, samme `>=` som gains-filteret) og med
  ubrugelige datoer. Plus en test på at tilstanden når hele vejen ud i rækken
  som tom-glyf, mens `value` og `pct` bliver stående.
- `frontend/src/lib/useTrainingHistory.test.js`: dato-aksen (midnat i København,
  ikke i UTC) plus struktur-guards på at hooken stadig eksponerer `seasonState`
  og stadig afleder den af `seasonReceiptState`.

## Sidegevinst værd at huske

Under den visuelle verifikation startede preview-værktøjets `frontend-preview`-
konfiguration en dev-server fra **hoved-checkoutet** (`c:/dev/cyclingzone`), ikke
fra worktree'et, fordi `.claude/launch.json` bruger `--prefix frontend` relativt
til en cwd der ikke er worktree-roden. Serveren så grøn ud og viste den gamle
kode. `/__worktree-id` (`frontend/vite.config.js`) afslører det på ét kald og bør
tjekkes FØR man konkluderer noget af en preview i en worktree-session.
