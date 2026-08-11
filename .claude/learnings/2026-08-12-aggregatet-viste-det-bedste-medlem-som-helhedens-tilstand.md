# 2026-08-12 · Aggregatet viste det BEDSTE medlem som helhedens tilstand

**Issue:** [#3639](https://github.com/NicolaiDolmer/CyclingZone/issues/3639) · **Kilde:** tre spillerrapporter i Discord 10/8, ikke en vagt

Nær familie af [de to målinger der blev mildere 11/8](2026-08-11-maalinger-der-bliver-mildere-af-det-de-skal-maale.md), men en variant der er værd at kunne genkende for sig selv — og den her ramte spillerne, ikke os.

## Hvad der skete

Et træningsfokus træner **flere** evner (`vo2max` = climbing + punch + tempo). Hver evne har sit eget livstidsloft. Fladen viste to tal:

- **tier-procenten** (#3195/#3234) — hvor HURTIGT fokusset vokser, afledt af ryttertype
- **progress-baren** (`focusProgress`) — den evne der er **tættest på gennembrud**, altså `max()` over fokussets evner

Ingen af dem kunne udtrykke "der er intet tilbage at hente". En rytter hvis climbing stod på loftet, mens tempo stadig rykkede, viste en sund bar på 74 % og en tier på 100 %. Spillerens rationelle konklusion var *"klatring stiger bare ikke"* — og den var korrekt.

`isFocusFullyCapped` (#2578) fandtes allerede, men fyrede kun når **ALLE** evner var døde. Den fangede yderpunktet og var blind for hele mellemrummet.

Målt i prod 12/8 (spiller-ejede ryttere i træning, inkl. dem assistenten styrer):

| | Antal | Andel |
|---|---|---|
| I træning | 3.469 | |
| Helt dødt fokus (træning giver **nul**) | 142 | 4,1 % |
| Mindst én død evne — **helt tavst** | 892 | 25,7 % |
| Heraf med climbing død i vo2max | 291 | |

Median 5,3 dage siden planen sidst blev rørt; længste 21,5 dage. 25 af de helt døde slots er **assistentens** fokus — dér har spilleren aldrig selv valgt noget og leder derfor slet ikke efter det.

## Hvad der var galt

Ikke matematikken. `focusProgress`'s `max()` er den rigtige regel for anticipation: vis mig det der er ved at ske. Fejlen var at **den samme aggregerede visning også skulle bære en tilstands-oplysning den ikke kan bære.** `max()` over en mængde kan aldrig fortælle at ét medlem er dødt — den fortæller pr. konstruktion om det bedste.

Og: **et fokus er et sæt, men blev overalt behandlet som en skalar.** Fokusset havde ét tier-tal, én bar, ét cappet/ikke-cappet-flag. Ingen af dem havde plads til "climbing færdig, tempo i gang".

## Hvad der blev gjort

1. `focusCapState` afløser det binære `isFocusFullyCapped` med tre tilstande (`open` / `partial` / `dead`) og navngiver evnerne på begge sider.
2. Fladen: den låste evne navngives ved siden af baren; fokus-listen markerer et dødt fokus **før** valget.
3. `smartDefaultFocus` er **ikke** rørt. Fokus-valget er balance-følsomt og fastfrosset i #3234; at ændre hvilket fokus tusindvis af ryttere trænes med må ikke ske som sideeffekt af en UI-rettelse.
4. Forward-guard: `training_slot_health_daily` + daglig cron-vagt der tæller døde slots pr. fokus og alarmerer ops ved andels-brud **eller** spring på ét døgn. Vagten genbruger `cappedVisibleAbilities` — samme funktion fladen sender til klienten, så måling og skærm ikke kan divergere.

## Hvad der skal huskes

**Når en visning aggregerer et sæt, så spørg hvilket medlem aggregatet gør usynligt.** `max` skjuler den døde, `min` skjuler den færdige, gennemsnittet skjuler begge. Er der en tilstand pr. medlem som spilleren handler på, skal den have sin egen plads — den kan ikke deles med et fremdrifts-tal.

**Et binært flag over et sæt (`every()`) er en gate, ikke et signal.** `every()` er per definition tavs indtil det sidste medlem falder. Havde #2578 haft tre tilstande fra starten, ville de 892 have været synlige hele tiden.

**Vagten skal kalde den samme funktion som fladen.** Havde jeg skrevet loft-logikken igen i SQL til vagten, ville metrikken og skærmen kunne drive fra hinanden — og så måler vagten noget spilleren ikke ser.

**Denne blev fundet af spillere, ikke af os.** Der fandtes ingen måling der kunne have sagt det, og fejlen var strukturel (112 af de døde slots var ældre end ryttertype-migrationen 11/8, som fik skylden i første omgang). Hver gang et loft flytter sig — 23/8-pakken, 1-99-remappen i #3564 — kan det ske igen; nu tælles det dagligt.
