# #7730: jagten afgøres af de hold der jager

> Ejer 5/11: hvor sent feltet henter udbruddet må ikke være én lodtrækning pr. etape. Det skal bygge på de hold, der jager: hvem arbejder, hvor stærke og friske de er, og hvor mange. Design først, målt baseline, så byg bag slukket kontakt. Går live på ejerens kør. Tal privat. Filmen skal kunne forklare det.

## Før

På flad og rullende overtager feltet jagten i etapens sidste kilometer (jagt-gulvet, #5813). Hvilket forspring feltet kører udbruddet ned til, afgøres af ét slag pr. etape: enten er feltet til tiden, eller også kommer det for sent. Slaget ser hverken holdene, ordrerne eller trætheden. Spilleren kan ikke se årsagen, og samme etape kan ende forskelligt alene på slaget.

Målt på gemte etaper og i #7714: slaget afgør et synligt udfald uden en årsag, og på rullende er det blandt de stærkeste enkeltlodtrækninger. Tallene står privat (`balance-internals/7730/`, `balance-internals/7714/`).

## Efter

Med kontakten tændt spørges slaget aldrig. Jagtens dom (`judgeFloorChase7730`, `mechanics/chaseGroup.ts`) læser jagten, som den ser ud i segmentet:

- **Hvem:** de ryttere der faktisk arbejder i jagtplanen, med deres indsats. Ordrer, klassementsreaktioner og etapeinteresse virker gennem planen, så "lad andre jage" og egne ryttere foran slår igennem af sig selv.
- **Hvor stærke:** rytterens motor set mod udbruddets. Begrænset, så én stjerne ikke er et helt hold.
- **Hvor friske:** samme friskhed som resten af jagten. En rytter der er for træt til en klassementsreaktion, trækker heller ikke her. Et hold der har arbejdet hele dagen, betaler for det i finalen.
- **Hvor mange:** hvert hold bidrager kun op til et loft. Ét hold kan ikke alene være i tide; flere hold deler føringerne.

Dommen giver et mål mellem de to gamle yderpunkter. Nok træk er til tiden, for lidt er for sent, og imellem glider målet. Grænserne fra #5813 står: hullet ved mål er aldrig over for-sent-målet, og gulvet lukker uanset hvad, så en ordre kan ikke skabe et forspring ud over det.

Samme tilstand giver samme dom. Ingen rng, og udfaldet kan genskabes.

## Filmen

Kommer jagten ikke i tide, melder motoren `breakaway_chase_short` på sidste segment med art og hold, aldrig tal (fog-gate #1791). Årsagen er det der alene havde bragt jagten i tide: friske ben (`tired`) eller ben der matcher udbruddet (`outgunned`). Kan intet af det alene gøre det, fordi ét hold aldrig når målet selv, er årsagen det der kostede mest af trækket: et helt udkørt hold er `tired`, et friskt hold der står alene er `too_few`. Arbejder ingen, skelner motoren mellem `no_chasers`, hvor hold ville jage men ingen ryttere havde, og `nobody_wanted`, hvor intet hold ville, og filmen siger det samme som for et ujaget udbrud. Årsagen flytter aldrig målet. Holder udbruddet, bliver det til en årsagslinje i filmen (`narrativeCauses6469.ts`, `stageTimelineFilm.js`, alle fem sprog).

## Kontakten

`app_config.team_chase_7730 = "on"`, kun den streng, kun under `s5_profiles_v3` og senere. Ejer-only flip, seedet `off` af migrationen.

**Kun løb der ikke er startet.** Flaget alene tænder intet. Et løb omfattes ved sin første etape-claim og bindes på `races.team_chase_7730`, med samme betingede UPDATE som regel-revisionen (#5955). Senere etaper, retries og genstarter læser bindingen. Et startet løb uden binding omfattes aldrig, heller ikke hvis flaget tændes midt i det.

**Slukket rammer kun nye løb.** Samme regel som enkeltstartens kontakt (`ittNoDayRoll7726Flag.js`, #7726): et bundet løb kører færdigt på sine regler, også ved en opslagsfejl. Værdien `stop` er ejerens nødstop og fjerner reglen fra bundne løb fra næste etape. Den bruges kun på ejerens ord.

Med flaget slukket læser runneren løbets binding, men intet skrives, og for et løb uden binding er motor-argumenter og `input_checksum` uændrede. Værdien er med i run-identiteten og i #1857-snapshottet, så genafspilningen genskaber etapen.

## Fravalgt

- **Vægte lodtrækningen efter holdene.** Stadig en lodtrækning. Ejerens krav er en årsag.
- **Fjerne gulvet.** Så kan en ordre skabe store forspring (#5813), og det er en anden beslutning.
- **Binde via en ny revision.** En revision for én mekanik binder alle andre valg med. Samme kolonne-mønster uden revisionen er mindre.
- **Læse flaget pr. etape som de andre kontakter.** Det ville ændre reglerne midt i et etapeløb.
- **Lade en slukket kontakt ramme bundne løb.** Det ville også ændre reglerne midt i et etapeløb. Nødstoppet er sin egen værdi, så det er et valg, aldrig en bivirkning.
- **Aflede bindingen af `app_config.updated_at`.** Afhænger af hvordan flaget er sat, og fejler stille.

## Ikke dækket

- Kun flad og rullende: gulvet findes ikke på andre profiler.
- Følgeeffekter over flere etaper er ikke målt: hver etape er genafspillet alene.
- Spillerne kan endnu ikke se dommen før løbet; prognosen (#6912 B) regner den med, når kontakten er tændt.

Refs #7716, #7714, #6912, #7557
