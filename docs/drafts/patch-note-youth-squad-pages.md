# Patch note-udkast: U23 team og Junior team faar egne sider (#5519)

**Ikke publiceret.** Denne blok maa foerst ind i `frontend/src/data/patchNotes.js` samme dag som
`youth_squad_pages` flippes for alle (loerdag, se `docs/NOW.md`). Indtil da beskriver den sider
spillerne ikke kan se endnu.

Ved flip: saet `version` + `date` til dagens vaerdier (samme rutine som enhver anden patch note,
version-tjekkes i CI), og indsaet blokken oeverst i `PATCHES`.

Refs #5519 #5763 #5766 #5741

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
        "topic": "Team",
        "en": {
          "title": "U23 team and Junior team have their own pages",
          "body": "Both squads now live under Clubhouse, next to My Team, with the same Squad, Calendar, Results, Standings and Development tabs you already know from your senior squad. Youth races run on their own calendar from season 4."
        },
        "da": {
          "title": "U23-holdet og Juniorholdet har faaet egne sider",
          "body": "Begge trupper ligger nu under Klubhus, ved siden af Mit hold, med samme faner - Trup, Kalender, Resultater, Stilling og Udvikling - som du kender fra dit seniorhold. Ungdomsloeb koerer paa deres egen kalender fra saeson 4."
        },
        "refs": [5519]
      },
      {
        "category": "improved",
        "audience": "player",
        "topic": "Team",
        "en": {
          "title": "A clearer read on who stays senior",
          "body": "The Squad tab on U23 team and Junior team now explains that riders on your senior squad stay seniors until you move them yourself, and the training tables mark U23 and junior riders with a small badge next to their name."
        },
        "da": {
          "title": "Klarere besked om hvem der er senior",
          "body": "Trup-fanen paa U23-holdet og Juniorholdet forklarer nu at ryttere paa seniortruppen bliver seniorer, indtil du selv flytter dem, og traeningstabellerne maerker U23- og juniorryttere med et lille maerke ved navnet."
        },
        "refs": [5763, 5766]
      },
      {
        "category": "improved",
        "audience": "player",
        "topic": "Help",
        "en": {
          "title": "Help has a section on U23 team and Junior team",
          "body": "What the two squads are, how moving riders up and down works, Graduation Day at season age 23, and when youth races start are all explained under Help, in English and Danish."
        },
        "da": {
          "title": "Hjaelp har et afsnit om U23-holdet og Juniorholdet",
          "body": "Hvad de to trupper er, hvordan flyt af ryttere op og ned virker, Graduation Day ved saesonalder 23, og hvornaar ungdomsloeb starter, er alt sammen forklaret under Hjaelp, paa engelsk og dansk."
        },
        "refs": [5519]
      }
    ]
  },
```
