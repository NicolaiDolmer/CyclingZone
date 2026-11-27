# #8592 · "Kun denne dag": dommer-scenarier (skrevet FØR koden, AGENTS 40)

Ejerbeslutning 26/11 på #8592 (seks punkter):

1. I dagsvælgeren vælges en fremtidig dato for en rytter og et andet pas, fx hvile tirsdag.
2. Datoen får en prik, og rækken viser "Kun tirsdag 24 · Tilbage til planen".
3. Det gælder kun den dato. Ugeplanen ændres aldrig, og dagen efter kører planen igen af sig selv.
4. Et løb vinder altid. Spilleren får en linje om, at valget for dagen blev erstattet.
5. Datoer kan vælges i den rullende uge (de næste 7 dage).
6. Det kan gøres for én rytter, flere ad gangen eller en hel gruppe.

Ejerbeslutning 26/11 på #8819 (to svar, skrevet ind som prøver FØR koden blev rettet):

7. **Træthedsgrænsen mod dagsvalget: nyeste information vinder.** Ser spilleren allerede, at grænsen har ændret valget (dagen er markeret som erstattet pga. træthed), og vælger han derefter for den dag, går hans valg forud for grænsen. Er grænsen ikke aktiveret eller synlig på det tidspunkt, bestemmer grænsen, og spilleren får en tydelig linje om det.
8. **Hold uden program: det virker altid.** Programmer er aldrig tvunget. Uden program vælger man træning pr. dag; ændrer man intet, er det det samme som i går.

Fable-dom 26/11 på #8795 (NOTES, fire fund før tænding): markeringen skal nå spilleren, udløbne valg bevares til datoen er gjort op, motor-prøve for bundet hviledag (DO-2b), og spilleren må kun læse tabellen (backend skriver med service-role).

Kontakt: `training_day_override_8592` (off | beta | on), seedet off. Tænding er ejer-only.
Tabel: `training_day_overrides` (én række pr. hold, rytter og dato; ét pas for hele datoen).

## Forrang (motor og prognose, samme regel)

løb / binding / skade > træthedsgrænsen (medmindre valget er nyere end grænsens markering) > **dato-valget** > rotation > ugeblok > ugedagens felt > plan.

- Dato-valget erstatter passet i ALLE datoens frie felter. Felter med løb, bundet hvile og skade er urørte.
- Rotationen venter på datoen: passet, der stod for tur, kører næste frie felt efter datoen.
- Ugeblokkens omdirigering og lås gælder ikke på datoen (kildefeltet er feltet selv).
- Træthedsgrænsen vurderes på dato-valget som på ethvert andet pas (som WB-7), undtagen når valget er truffet efter grænsens markering (DO-10).
- "Synlig markering" (DO-10) er det, dagsvælgeren viser for i morgen: dagens prognose for i aften er morgendagens start, og samme regel som motoren siger, om grænsen slår til. Datoer længere ude har ingen markering endnu. Serveren afgør selv ved gemning, om markeringen var der; klienten sender intet om det.

## Scenarier

| Nr. | Scenarie | Forventet |
|---|---|---|
| DO-1 | Hviledag: planen siger hvile tirsdag, dato-valget siger udholdenhed | Alle fem felter træner udholdenhed. Onsdag kører planen igen. Ugeplanen (`training_week_plans`) er urørt. |
| DO-2 | Løbsdag: rytteren kører en etape i felt 3, dato-valget siger hvile | Felt 3 er løb (løbet vinder). De andre felter er hvile. Rapporten for felt 3 bærer markeringen `date_override.outcome = "race"`, så skærmen kan sige, at valget blev erstattet af løbet. |
| DO-2b | Bundet hviledag (hviledag i et etapeløb) hele datoen | Motor-prøve: alle felter er bundet hvile, valget træner ikke. Markeringen er `bound_rest` i alle felter. |
| DO-2c | Skadet hele datoen | Alle felter er skade-hvile. Markeringen er `injured`. |
| DO-3 | Rotation: rytteren kører rotation, dato-valget siger hvile tirsdag | Tirsdag er hvile i alle frie felter, og rotationen rykker ikke (intet rotationsstempel). Onsdag kører passet, der stod for tur tirsdag. Prognosen bevarer rotationens tur, så ugen fortsætter onsdag. |
| DO-4 | Ugeblok med lås: rytteren har `plan_kind = 'week'` med lås i felt 5 | På datoen gælder dato-valget i alle felter, ingen `source_slot` og ingen lås. Dagen efter gælder ugeblokken igen. |
| DO-5 | Gruppe: valget gemmes for en hel gruppe | Én række pr. gruppemedlem på skrivetidspunktet. Ryttere uden for gruppen er urørte. En rytter, der kommer i gruppen bagefter, får ikke valget. |
| DO-5b | Flere ryttere ad gangen | Én række pr. valgt rytter. En rytter fra et andet hold afvises (403), og intet skrives. |
| DO-6 | Sletning ("Tilbage til planen") | Rækken slettes. Motoren og prognosen kører planen. |
| DO-7 | Dato i fortiden, i dag eller mere end 7 dage frem | Afvises med 400 `invalid_date`. Intet skrives. |
| DO-8 | Kontakten off | Motoren er bit-identisk med en frossen kopi af merge-basen (golden), også for hold uden program. Motoren læser kontakten (én gang, samtidig med indsats-kontakten) og aldrig tabellen. API'et svarer 409 `feature_disabled` på skrivning, og GET svarer `enabled: false`. |
| DO-9 | Et valg fra en tidligere dato (#8819 fund 2) | Rækken bevares, så længe datoen ikke er gjort op for holdet (`training_date_work` pending eller partial, eller ingen række endnu). En genkørsel af datoen bruger valget. Først når datoen er `complete`, slettes rækken ved næste læsning eller skrivning. Motoren læser kun datoens egen dato og kan aldrig bruge et valg fra en anden dato. |
| DO-10a | Træthedsgrænsen, valget truffet FØR markeringen (#8819 svar 1) | Rytteren er over sin grænse på datoen, og valget blev gemt, mens dagsvælgeren ikke viste markeringen. Grænsen bestemmer (feltet får grænsens pas), og markeringen er `fatigue_rule`. I dag og efter datoen viser skærmen linjen "Træthedsgrænsen tog dit valg". |
| DO-10b | Træthedsgrænsen, valget truffet EFTER markeringen (#8819 svar 1) | Dagsvælgeren viste for i morgen, at grænsen erstatter dagen, og spilleren gemte derefter et valg (fx hårdt). Rækken får `beats_fatigue_rule = true`. På datoen kører valget, grænsen bruges ikke, markeringen er `trained` med `beats_fatigue_rule: true`, og skærmen siger, at valget gik forud for grænsen. |
| DO-10c | Markeringen kan ikke forfalskes | Klientens body bestemmer intet om grænsen. En dato længere ude end i morgen får aldrig `beats_fatigue_rule`. |
| DO-11 | Hold uden program (#8819 svar 2) | Skrivning virker (200), også uden programfelter. Motoren bruger valget på datoen (alle frie felter), og dagen efter kører den samme plan som før valget ("samme som i går"). Prognosen for i dag viser valget. |
| DO-12 | Markeringen når spilleren (#8819 fund 1) | I dag: prognosen for i dag bærer `dateOverride.outcome` (og `some`), og I dag viser en linje pr. rytter, hvis valget blev taget (løb, binding, skade, grænse, pas ikke muligt). Dagsvælgeren: linjen for løb og hvile som før, plus grænsens markering for i morgen. Efter datoen: GET svarer `recent` (de seneste 7 datoer, fra kvitteringerne), og I dag viser, hvordan valgene gik. |
| DO-13 | Adgang (#8819 fund 4) | Spilleren må kun LÆSE eget holds rækker (RLS SELECT). Ingen INSERT/UPDATE/DELETE-politik og ingen skrive-grant til `authenticated`; service-role har SELECT, INSERT, UPDATE, DELETE. Erklæret i `data-api-access`. |

## Ikke i scope

- Indsats (Let/Mellem/Hård) pr. dato-valg. Passet kører på sit standardniveau.
- Et pas pr. felt på datoen (dato-valget gælder hele datoen).
- Valg for i dag (punkt 5: de næste 7 dage). Grænsens markering vises derfor for i morgen, hvor et nyt valg stadig kan gemmes.
