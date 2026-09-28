# Patch note-udkast: Natbolgen 26/9 (#5474)

**Ikke publiceret.** Samler player-facing changes fra de 13 PR'er i natbolgen 26/9 til ejerens
merge-runde. Hver change er markeret med en `// PR #NNNN`-kommentar, saa ejeren kan slette den
enkelte change hvis han ikke merger den paagaeldende PR.

Ved brug: saet `version` + `date` til dagens vaerdier (samme rutine som enhver anden patch note,
version-tjekkes i CI), udfyld `label`, slet de changes der hoerer til PR'er der ikke blev merget,
og indsaet blokken oeverst i `PATCHES` i `frontend/src/data/patchNotes.js`.

Kildeliste (Refs #5474, samle-issue for weekendens kommunikation):
- Training: #5769, #5771, #5782, #5787
- Squad: #5766
- Riders: #5770, #5777
- Dashboard: #5775
- Races: #5776, #5781
- Season: #5783
- Sponsors: #5772
- Help: #5786 (kun pyramide-rettelsen, se note nedenfor)

**Ikke inkluderet:**
- #5768 / #5779 (bag et slukket flag, ingen spillervendt aendring endnu)
- #5773 / #5774 / #5778 / #5784 / #5785 / #5765 / #5780 / #5767 (tests/docs/mockups, ingen spillervendt aendring)
- #5786's `youthSquads`-hjaelpesektion (del 1 i PR-beskrivelsen) er UDELADT her. Den sidder bag det
  slukkede flag `youth_squad_pages` og er ikke synlig for nogen spiller endnu. Kun del 2 (rettelsen af
  divisionspyramiden, som ER synlig i den ugatede Hjaelp-side i dag) er taget med nedenfor. #5786's
  egen fil `docs/drafts/patch-note-youth-squad-pages.md` daekker allerede den gatede sektion til
  loerdagens flip.

Refs #5474

---

```js
  {
    "version": "X.YYY",
    "date": "2026-MM-DD",
    "label": "TBD",
    "changes": [
      // PR #5766 (#5763, #5519) - Squad
      {
        "category": "improved",
        "audience": "player",
        "topic": "Team",
        "en": {
          "title": "Senior riders stay senior, and the U23/JR badge is back in training",
          "body": "What changed: A short line on the U23 and Junior squad pages explains that a rider on your senior squad stays a senior until you move him. In Daily training, a rider's U23 or JR badge shows again next to his name, on desktop and phone.\n\nWhat it means for you: You know why a rider isn't on U23 or Junior yet, and you can tell youth riders apart in the training table again."
        },
        "da": {
          "title": "Seniorryttere bliver seniorer, og U23/JR-mærket er tilbage i træning",
          "body": "Hvad er ændret: En kort linje på U23- og Junior-siderne forklarer at en rytter på din seniortrup bliver senior, indtil du flytter ham. I Daglig træning viser rytterens U23- eller JR-mærke sig igen ved siden af navnet, på computer og telefon.\n\nHvad det betyder for dig: Du ved hvorfor en rytter ikke står på U23 eller Junior endnu, og du kan igen se forskel på ungdomsryttere i træningstabellen."
        },
        "refs": [5763, 5519]
      },
      // PR #5769 (#5734) - Training
      {
        "category": "improved",
        "audience": "player",
        "topic": "Training",
        "en": {
          "title": "Training score now shows in the report too",
          "body": "What changed: Each rider's daily training score, already visible on Daily training, now also shows in the Report tab's history for that day.\n\nWhat it means for you: You can check a rider's score without switching back to Daily training."
        },
        "da": {
          "title": "Træningsscore vises nu også i rapporten",
          "body": "Hvad er ændret: Hver rytters daglige træningsscore, som allerede vises på Daglig træning, står nu også i rapport-fanens historik for den dag.\n\nHvad det betyder for dig: Du kan tjekke en rytters score uden at skifte tilbage til Daglig træning."
        },
        "refs": [5734]
      },
      // PR #5771 (#5735) - Training
      {
        "category": "improved",
        "audience": "player",
        "topic": "Training",
        "en": {
          "title": "Rider name in the training card links to his profile",
          "body": "What changed: In the expanded rider card on the phone's Daily training view, the rider's name is now a link to his profile page.\n\nWhat it means for you: Tap the name to jump straight to the rider, or ctrl/middle-click to open him in a new tab."
        },
        "da": {
          "title": "Rytternavn i træningskortet linker til profilen",
          "body": "Hvad er ændret: I det udfoldede rytterkort på telefonens Daglig træning-visning er rytterens navn nu et link til hans profilside.\n\nHvad det betyder for dig: Tryk på navnet for at hoppe direkte til rytteren, eller ctrl/midterklik for at åbne ham i en ny fane."
        },
        "refs": [5735]
      },
      // PR #5782 (#5539) - Training
      {
        "category": "new",
        "audience": "player",
        "topic": "Training",
        "en": {
          "title": "See how many percent of a point a session moved",
          "body": "What changed: The training receipt now shows how many percent of a full ability point yesterday's session moved, next to the progress bar, for example \"yesterday +12%\".\n\nWhat it means for you: You see the size of a session's effect, not just how close the bar is to the next point."
        },
        "da": {
          "title": "Se hvor mange procent af et point en session flyttede",
          "body": "Hvad er ændret: Træningskvitteringen viser nu hvor mange procent af et helt point gårsdagens session flyttede, ved siden af statuslinjen, for eksempel \"i går +12 %\".\n\nHvad det betyder for dig: Du ser hvor stor en sessions effekt var, ikke kun hvor tæt linjen er på næste point."
        },
        "refs": [5539]
      },
      // PR #5787 (#5318) - Training
      {
        "category": "improved",
        "audience": "player",
        "topic": "Training",
        "en": {
          "title": "Today's story leads with real news, and injuries get their own warning",
          "body": "What changed: The daily training story on the Report tab now shows a landed ability point or a fresh training injury before the near-breakthrough story. A new warning line above the story names every rider hurt in training today and roughly how many days he is expected to miss.\n\nWhat it means for you: Your daily story leads with what actually happened, and you no longer have to go hunting in the roster for a fresh injury."
        },
        "da": {
          "title": "Dagens historie fører med rigtige nyheder, og skader får deres egen advarsel",
          "body": "Hvad er ændret: Dagens træningshistorie på rapport-fanen viser nu et landet point eller en frisk træningsskade før den næsten-der-historien. En ny advarselslinje over historien nævner hver rytter der blev skadet i træning i dag, og cirka hvor mange dage han ventes at være ude.\n\nHvad det betyder for dig: Din daglige historie fører med det der faktisk skete, og du skal ikke længere lede i truppen efter en frisk skade."
        },
        "refs": [5318]
      },
      // PR #5775 (#5315) - Dashboard
      {
        "category": "fixed",
        "audience": "player",
        "topic": "Dashboard",
        "en": {
          "title": "Full standings now opens your own pool",
          "body": "What changed: The Full standings link on the dashboard now opens your own group in the standings, not the whole division.\n\nWhat it means for you: One click takes you straight to your own pool, no more scrolling to find it."
        },
        "da": {
          "title": "Fuld stilling åbner nu din egen pulje",
          "body": "Hvad er ændret: Fuld stilling-linket på dashboardet åbner nu din egen pulje i stillingen, ikke hele divisionen.\n\nHvad det betyder for dig: Ét klik tager dig direkte til din egen pulje, uden at skulle rulle for at finde den."
        },
        "refs": [5315]
      },
      // PR #5776 (#5317) - Races / Notifications
      {
        "category": "fixed",
        "audience": "player",
        "topic": "Notifications",
        "en": {
          "title": "A stage result message now opens that stage",
          "body": "What changed: Tapping an inbox message about a stage result now opens that stage's result, instead of the race's overall standings.\n\nWhat it means for you: You land on the result the message was actually about."
        },
        "da": {
          "title": "En etaperesultat-besked åbner nu den etape",
          "body": "Hvad er ændret: Trykker du på en indbakke-besked om et etaperesultat, åbner den nu netop den etapes resultat i stedet for løbets samlede stilling.\n\nHvad det betyder for dig: Du lander på det resultat beskeden faktisk handlede om."
        },
        "refs": [5317]
      },
      // PR #5777 (#5316) - Riders
      {
        "category": "fixed",
        "audience": "player",
        "topic": "Riders",
        "en": {
          "title": "A tie in Compare no longer picks a fake winner",
          "body": "What changed: When two or more riders you compare have the exact same value in a stat, Compare no longer highlights one of them as best.\n\nWhat it means for you: A highlighted stat now always means a real edge, never a tie."
        },
        "da": {
          "title": "Uafgjort i Sammenlign udpeger ikke længere en falsk vinder",
          "body": "Hvad er ændret: Har to eller flere ryttere du sammenligner nøjagtig samme værdi i en evne, fremhæver Sammenlign ikke længere en af dem som bedst.\n\nHvad det betyder for dig: En fremhævet evne betyder nu altid en reel forskel, aldrig uafgjort."
        },
        "refs": [5316]
      },
      // PR #5770 (#5733) - Riders. FORSIGTIG ORDLYD: aarsagen til spillerens rapport er IKKE bekraeftet, kun hardening.
      {
        "category": "improved",
        "audience": "player",
        "topic": "Riders",
        "en": {
          "title": "Extra safety check on a rider's first win",
          "body": "What changed: The check behind a rider's first professional win now looks at his complete result history instead of a limited recent slice.\n\nWhy: A player reported a first-win message that looked wrong. We could not confirm what caused that specific report, but hardened the check regardless, since a limited slice could in theory miss an earlier win.\n\nWhat it means for you: Your rider's first-win moment stays reliable as his result history grows."
        },
        "da": {
          "title": "Ekstra sikkerhedstjek på en rytters første sejr",
          "body": "Hvad er ændret: Tjekket bag en rytters første professionelle sejr kigger nu på hele hans resultathistorik i stedet for et begrænset udsnit.\n\nHvorfor: En spiller rapporterede en første sejr-besked der så forkert ud. Vi kunne ikke bekræfte hvad der udløste netop den rapport, men har hærdet tjekket alligevel, da et begrænset udsnit i teorien kunne overse en tidligere sejr.\n\nHvad det betyder for dig: Din rytters første sejr-øjeblik forbliver pålideligt efterhånden som hans resultathistorik vokser."
        },
        "refs": [5733]
      },
      // PR #5781 (#5419) - Races
      {
        "category": "new",
        "audience": "player",
        "topic": "Races",
        "en": {
          "title": "Switch stage right from the Team tab",
          "body": "What changed: The Team tab on a multi-stage race now has the same stage stripe as the Stages tab, so you can browse stages and check the route fit without leaving Team.\n\nWhat it means for you: Pick a stage on Team to see its profile and your fit, then set your roster without switching tabs."
        },
        "da": {
          "title": "Skift etape direkte fra Hold-fanen",
          "body": "Hvad er ændret: Hold-fanen på et etapeløb har nu samme etape-stribe som Etaper-fanen, så du kan bladre etaper og tjekke rutepasset uden at forlade Hold.\n\nHvad det betyder for dig: Vælg en etape på Hold for at se dens profil og dit pas, og sæt så holdet uden at skifte fane."
        },
        "refs": [5419]
      },
      // PR #5783 (#5390) - Season
      {
        "category": "new",
        "audience": "player",
        "topic": "Season",
        "en": {
          "title": "Classic wins now show in your season recap",
          "body": "What changed: The season recap now includes classic (one-day race) wins, both in your team's stat row and in the season's winners grid, alongside stage and overall wins.\n\nWhat it means for you: A strong one-day season finally shows up in your recap, not just stage races."
        },
        "da": {
          "title": "Klassikersejre vises nu i din sæsonrecap",
          "body": "Hvad er ændret: Sæsonrecappen viser nu klassikersejre (endagsløb), både i dit holds statistikrække og i sæsonens vindere-oversigt, ved siden af etape- og samlede sejre.\n\nHvad det betyder for dig: En stærk endagssæson viser sig nu endelig i din recap, ikke kun etapeløb."
        },
        "refs": [5390]
      },
      // PR #5772 (#5684) - Sponsors
      {
        "category": "improved",
        "audience": "player",
        "topic": "Sponsors",
        "en": {
          "title": "Sponsor offers explain what sets the amount",
          "body": "What changed: The sponsor page now explains that an offer follows your club's own reputation, division and standing in its group, not a fixed amount per sponsor type. The same explanation is now in Help.\n\nWhat it means for you: You know why two clubs see different offers from the same sponsor type."
        },
        "da": {
          "title": "Sponsortilbud forklarer hvad der sætter beløbet",
          "body": "Hvad er ændret: Sponsorsiden forklarer nu at et tilbud følger din klubs eget omdømme, division og placering i sin gruppe, ikke et fast beløb pr. sponsortype. Samme forklaring står nu i Hjælp.\n\nHvad det betyder for dig: Du ved hvorfor to klubber ser forskellige tilbud fra samme sponsortype."
        },
        "refs": [5684]
      },
      // PR #5786 (#5519) - Help. KUN pyramide-rettelsen, se note i toppen af filen.
      {
        "category": "fixed",
        "audience": "player",
        "topic": "Help",
        "en": {
          "title": "Help's division pyramid now shows the right pool count",
          "body": "What changed: Help wrongly said Division 4 has 8 pools; it has had 4 since season 4, same as Division 3.\n\nWhat it means for you: The pyramid and split-evenly text in Help now match how divisions actually split."
        },
        "da": {
          "title": "Hjælpens divisionspyramide viser nu det rigtige antal puljer",
          "body": "Hvad er ændret: Hjælp sagde fejlagtigt at Division 4 har 8 puljer; den har haft 4 siden sæson 4, ligesom Division 3.\n\nHvad det betyder for dig: Pyramiden og teksten om lige fordeling i Hjælp stemmer nu overens med hvordan divisionerne faktisk deles."
        },
        "refs": [5519]
      }
    ]
  },
```
