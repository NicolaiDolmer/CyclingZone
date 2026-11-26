# #8592 · "Kun denne dag": dommer-scenarier (skrevet FØR koden, AGENTS 40)

Ejerbeslutning 26/11 på #8592 (seks punkter):

1. I dagsvælgeren vælges en fremtidig dato for en rytter og et andet pas, fx hvile tirsdag.
2. Datoen får en prik, og rækken viser "Kun tirsdag 24 · Tilbage til planen".
3. Det gælder kun den dato. Ugeplanen ændres aldrig, og dagen efter kører planen igen af sig selv.
4. Et løb vinder altid. Spilleren får en linje om, at valget for dagen blev erstattet.
5. Datoer kan vælges i den rullende uge (de næste 7 dage).
6. Det kan gøres for én rytter, flere ad gangen eller en hel gruppe.

Kontakt: `training_day_override_8592` (off | beta | on), seedet off. Tænding er ejer-only.
Tabel: `training_day_overrides` (én række pr. hold, rytter og dato; ét pas for hele datoen).

## Forrang (motor og prognose, samme regel)

løb / binding / skade > træthedsgrænsen (spillerens egen regel) > **dato-valget** > rotation > ugeblok > ugedagens felt > plan.

- Dato-valget erstatter passet i ALLE datoens frie felter. Felter med løb, bundet hvile og skade er urørte.
- Rotationen venter på datoen: passet, der stod for tur, kører næste frie felt efter datoen.
- Ugeblokkens omdirigering og lås gælder ikke på datoen (kildefeltet er feltet selv).
- Træthedsgrænsen vurderes på dato-valget som på ethvert andet pas (som WB-7 for ugeblokke).

## Scenarier

| Nr. | Scenarie | Forventet |
|---|---|---|
| DO-1 | Hviledag: planen siger hvile tirsdag, dato-valget siger udholdenhed | Alle fem felter træner udholdenhed. Onsdag kører planen igen. Ugeplanen (`training_week_plans`) er urørt. |
| DO-2 | Løbsdag: rytteren kører en etape i felt 3, dato-valget siger hvile | Felt 3 er løb (løbet vinder). De andre felter er hvile. Rapporten for felt 3 bærer markeringen `date_override.outcome = "race"`, så skærmen kan sige, at valget blev erstattet af løbet. |
| DO-2b | Bundet hviledag (GT-hviledag) hele datoen | Alle felter er bundet hvile. Markeringen er `bound_rest`. |
| DO-2c | Skadet hele datoen | Alle felter er skade-hvile. Markeringen er `injured`. |
| DO-3 | Rotation: rytteren kører rotation, dato-valget siger hvile tirsdag | Tirsdag er hvile i alle frie felter, og rotationen rykker ikke (intet rotationsstempel). Onsdag kører passet, der stod for tur tirsdag. |
| DO-4 | Ugeblok med lås: rytteren har `plan_kind = 'week'` med lås i felt 5 | På datoen gælder dato-valget i alle felter, ingen `source_slot` og ingen lås. Dagen efter gælder ugeblokken igen. |
| DO-5 | Gruppe: valget gemmes for en hel gruppe | Én række pr. gruppemedlem på skrivetidspunktet. Ryttere uden for gruppen er urørte. En rytter, der kommer i gruppen bagefter, får ikke valget. |
| DO-5b | Flere ryttere ad gangen | Én række pr. valgt rytter. En rytter fra et andet hold afvises (403), og intet skrives. |
| DO-6 | Sletning ("Tilbage til planen") | Rækken slettes. Motoren og prognosen kører planen. |
| DO-7 | Dato i fortiden, i dag eller mere end 7 dage frem | Afvises med 400 `invalid_date`. Intet skrives. |
| DO-8 | Kontakten off | Motoren er bit-identisk med en frossen kopi af merge-basen (golden). Uden programceller intet ekstra databasekald i motoren; med programceller kun kontaktens eget opslag, aldrig tabellen. API'et svarer 409 `feature_disabled` på skrivning, og GET svarer `enabled: false`. |
| DO-9 | Udløbne valg | Rækker med en dato før i dag slettes ved næste læsning eller skrivning for holdet. Motoren læser kun datoens egen dato og kan aldrig bruge et gammelt valg. |
| DO-10 | Træthedsgrænsen | Er rytteren over sin egen grænse, vinder grænsens erstatning over dato-valget (som WB-7). |
| DO-11 | Hold uden program (ingen programfelter) | Skrivning afvises med 409 `program_required`, så skærmen aldrig viser et valg, motoren ikke bruger. (Ejer-spørgsmål i PR'en.) |

## Ikke i scope

- Indsats (Let/Mellem/Hård) pr. dato-valg. Passet kører på sit standardniveau.
- Et pas pr. felt på datoen (dato-valget gælder hele datoen).
