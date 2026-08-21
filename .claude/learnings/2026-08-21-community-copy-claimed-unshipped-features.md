# Community-copy påstod at shippede features manglede (21/8)

## Hvad skete der

Jeg skrev 7 Discord-opslag, heriblandt en afstemning med 15 "ting jeg kan bygge i september". Listen var bygget fra **backloggen** (åbne issues, MASTERPLAN) uden at slå op i koden.

Ejeren fangede det med en fornemmelse, ikke et bevis: *"Ved til at starte med, så skal du tjekke om nogle af disse ting er lavet i forvejen. Det føler jeg."*

Verifikation gav ham ret. **6 af 15 punkter var allerede shippet**, og 3 mere var forkert formuleret:

| Påstået manglende | Findes i dag |
|---|---|
| Race reports der forklarer løbet | `races.json`: "The story of the stage", "The bigger picture", story-tags (off day, peak, sacrifice, outsider win, collapse, crash) |
| Race centre | `RaceCentrePage.jsx` (#3858) |
| Ugentlige træningsskabeloner | `TrainingPage.jsx:56` — weekplan er fane 2 af 4 (#3746) |
| Auktions-notifikationer | `auctionWon` / `auctionStarted` / `viewAuction` + watchlist-ikoner (#4036) |
| Hall of fame / records | `halloffame.json`: Records, Managers, Division history |
| Swaps | findes i `TransfersPage.jsx` |

Forkert formuleret: værdimodellen er allerede din egen (#1101 lukket, v4 career-NPV), ikke en UCI-formel · `contractLength` findes allerede · dashboard-customize (vis/skjul) findes allerede (#1005).

Ved gennemgang af de øvrige 6 opslag fandtes to **værre** fejl i opslaget om U23/junior:
- Spurgte om man skulle kunne rykke ryttere op midt i sæsonen. Promotion findes allerede (`Promote`-knap + graduation-flow).
- Spurgte "should there be a U23 transfer market". Det **genåbner #2456**, som ejeren lukkede med den modsatte beslutning: talenter skal komme til ens eget akademi, ikke købes. Der findes desuden allerede en 24t ungdomsauktion.

## Rod-årsag

Backloggen beskriver **hvad der er ønsket**, ikke **hvad der er leveret**. Et åbent issue betyder ikke at intet er bygget: epics forbliver åbne mens deres slices shipper, og "claude:todo" er en label, ikke en runtime-tilstand. Jeg behandlede backloggen som en gap-analyse. Det er den ikke.

Det er samme klasse som den eksisterende regel *label ≠ live-state*, bare anvendt på **player-facing copy** i stedet for på status-rapportering. Skaden er også større her: et opslag der beder spillerne stemme om noget de allerede har, får udvikleren til at fremstå som en der ikke kender sit eget spil.

## Forward-guard

Før player-facing copy der påstår noget om spillets tilstand (mangler, kommer, findes ikke):

1. **Slå hvert punkt op i koden**, ikke i issue-listen. Hurtigste stier: `frontend/src/pages/` for om en side findes, `frontend/public/locales/en/*.json` for om en funktion har tekst, `App.jsx`-routes for om den er nået ud til brugerne.
2. **Tjek om spørgsmålet genåbner en lukket beslutning.** `gh issue list --state closed --search "<emne>"` før du stiller et åbent spørgsmål om et emne ejeren kan have afgjort.
3. **Hent tal fra live-DB**, ikke fra docs. MASTERPLAN sagde 232 brugere; DB sagde 233 konti / 80 aktive sidste 7 dage. Det andet tal er det interessante, og det stod ingen steder.
4. **Vend fundet til indhold.** De 6 shippede features blev til en besked 2: "det her findes allerede, gå og kig". Det løser samtidig ejerens egen observation fra 3/8: *"en for stor procentdel af spillerne har faktisk aldrig nogensinde åbnet et eneste resultat"*.

## Sekundær læring

Jeg kalibrerede tone på ejerens seneste Discord-beskeder uden først at læse `docs/TONE_OF_VOICE.md`, som indeholder en Voice DNA destilleret fra 4.453 af hans egne beskeder plus 4 låste tone-beslutninger. Udkastene holdt ved efterfølgende tjek, men det var held. **Læs `docs/TONE_OF_VOICE.md` FØR player-facing copy**, ikke efter.

Refs: #4074 (valuta-fund samme session), #2456, #1101, #3746, #3858, #1005.
