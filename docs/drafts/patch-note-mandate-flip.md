# Patch note-udkast: Mandatet flippes (#4855)

**Ikke publiceret.** Denne blok maa foerst ind i `frontend/src/data/patchNotes.js` samme dag som
`board_mandate_model_enabled` flippes for alle (#4859). Indtil da beskriver den en model spillerne
ikke kan se.

Ved flip: saet `version` + `date` til dagens vaerdier (samme rutine som enhver anden patch note,
version-tjekkes i CI), og indsaet blokken oeverst i `PATCHES`.

Refs #4855 #4557 #3514 #4859

---

```js
  {
    "version": "X.YYY",
    "date": "2026-MM-DD",
    "label": "Beta",
    "changes": [
      {
        "category": "new",
        "audience": "player",
        "topic": "Board",
        "en": {
          "title": "The board now runs on one confidence score and one season mandate",
          "body": "The three parallel plans and their three satisfaction numbers are gone. You have one confidence score, one mandate of targets for the season you are in, and a club vision of milestones further out. The Board page is now a boardroom with tabs for Overview, Mandate, Vision and Board, and every target shows the receipt behind its number."
        },
        "da": {
          "title": "Bestyrelsen kører nu på ét tillidstal og ét sæsonmandat",
          "body": "De tre parallelle planer og deres tre tilfredshedstal er væk. Du har ét tillidstal, ét mandat af mål for den sæson du er i, og en klubvision af milepæle længere ude. Bestyrelses-siden er nu et bestyrelseslokale med faner til Overblik, Mandat, Vision og Bestyrelse, og hvert mål viser kvitteringen bag sit tal."
        },
        "refs": [3514, 4557]
      },
      {
        "category": "new",
        "audience": "player",
        "topic": "Board",
        "en": {
          "title": "One annual meeting replaces the plan wizard",
          "body": "At the season changeover the board calls you in and proposes your mandate. You pick a focus, answer each target with Keep, Easier or Stretch, make one request and sign. Accepting the proposal takes two clicks. Leave it alone and the board signs its own proposal when the deadline runs out."
        },
        "da": {
          "title": "Ét årsmøde erstatter plan-guiden",
          "body": "Ved sæsonskiftet kalder bestyrelsen dig ind og foreslår dit mandat. Du vælger et fokus, svarer på hvert mål med Behold, Lettere eller Stræk, stiller én anmodning og underskriver. At acceptere forslaget tager to klik. Rører du det ikke, underskriver bestyrelsen sit eget forslag, når fristen løber ud."
        },
        "refs": [3514, 4557]
      },
      {
        "category": "improved",
        "audience": "player",
        "topic": "Help",
        "en": {
          "title": "Help has a section on the Mandate",
          "body": "Confidence, the annual meeting, bonus offers and how Club DNA seats your board are all explained under Help, in English and Danish."
        },
        "da": {
          "title": "Hjælp har et afsnit om Mandatet",
          "body": "Tillid, årsmødet, bonustilbud og hvordan klub-DNA sætter din bestyrelse er forklaret under Hjælp, på engelsk og dansk."
        },
        "refs": [4855]
      }
    ]
  },
```
