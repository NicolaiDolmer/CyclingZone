# 2026-10-01 · To loeb paa samme loebsdag blokerede traeningsafregning (#6009)

## Hvad skete der
To ryttere fik etaperesultat i to loeb paa S4 loebsdag 12: sidste etape af et
etapeloeb (kl. 10, Hold A) og foerste etape af et andet etapeloeb (kl. 13, Hold B).
Rytterne havde skiftet fra Hold A til Hold B midt i det foerste loeb. Hold B's
traeningsdato 30/9 kunne derefter ikke afregnes: motoren kastede
`Missing recorded race load`, og sweepen proevede igen hvert 5. minut.

## Rodaarsag (to huller, hvert nok alene)
1. **Bindingen frigives ved `completed`.** `race_entry_days_rebuild` sletter
   bindingen og `binding_span` nulstilles, naar loebet afsluttes. Kalenderen
   lagde det foerste loebs sidste etape og det andet loebs foerste etape paa SAMME
   loebsdag (forskellige klokkeslaet). Udtagelsen til det andet loeb blev gemt ca.
   45 min efter at det foerste loeb var afsluttet, saa ingen af de tre lag
   (app-preflight, RPC-guard i `replace_race_selection`, EXCLUDE-constrainten)
   saa loebsdag 12 som optaget.
2. **Bindingen er hold-scopet** (`race_entry_days.team_id = p_team_id`). En rytter
   der skifter hold, tager ikke sine bundne/koerte loebsdage med.

Ledgeren (`training_race_loads`) gjorde det rigtige: én kanonisk raekke + et
godkendt alias for det andet resultat. Men motorens etape-opslag
(`buildRaceDayStageByRider`) vaelger den foerste etape, der matcher, og den var
aliasset. Sammenligningen mod den kanoniske raekke fejlede derfor.

## Rettelse
- Motor: `stageMatchesCanonicalLoad` accepterer en etape, der er et godkendt alias
  af den kanoniske belastning (canonicalRaceLoads har allerede verificeret parret).
  Uden et entydigt kanonisk match kaster motoren som foer.
- Forebyggelse: `prepareSelectionChange` afviser (409 `selection_rider_bound`) en
  rytter der allerede har et etaperesultat paa en loebsdag i det nye loebs spaend.
  Kilden er race_results ⋈ race_stage_schedule, rytter-scopet og saeson-scopet.
  Den forsvinder aldrig, i modsaetning til bindingen.

## Laering
- En binding der frigives ved afslutning, beskytter kun fremtiden. Hvis to loeb
  kan dele en loebsdag, skal "allerede koert" vaere en selvstaendig kilde.
- Rytter-invarianter maa ikke vaere hold-scopede: transfers flytter rytteren, ikke
  holdets bindinger.
- "Foerste match vinder" i et opslag er kun deterministisk, ikke korrekt. Ved
  dubletter skal opslaget afstemmes mod ledgerens kanoniske raekke.

## Ikke daekket
- Auto-udfyldning (`raceEntryGenerator`/`raceHubAutofill`) skriver race_entries
  uden om `prepareSelectionChange` og har samme hul i teorien.
- RPC-guarden og DB-constrainten kender stadig ikke koerte loebsdage (ingen
  migration i denne rettelse).
- Kalender-generatoren kan stadig placere to loebs etaper paa samme loebsdag i
  samme division.
