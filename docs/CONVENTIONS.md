# CONVENTIONS — Cycling Zone

## Sprog

- Dansk i UI, dokumentation og anden brugerrettet tekst
- Engelske variabelnavne, funktionsnavne, kolonnenavne og enums i kode
- Hold labels korte, konkrete og konsekvente på dansk

## Naming

- Database-navne bruger snake_case
- JavaScript-navne bruger camelCase
- React-komponenter bruger PascalCase
- Route-navne skal afspejle domænet, ikke intern implementation

## UI og labels

- Vis valuta som `CZ$`
- Brug konsekvente domæneord: rytter, hold, transfer, lån, auktion, bestyrelse
- Bland ikke dansk og engelsk i samme UI-flow

## Kodeformat

- Hold docs kompakte og referencevenlige
- Foretræk små, domæneafgrænsede ændringer frem for brede refactors

## Produktindhold

- `frontend/src/pages/PatchNotesPage.jsx` er den løbende changelog for brugerrettede releases og fixes
- `frontend/src/pages/HelpPage.jsx` er den løbende forklaring af regler, flows og FAQ
- Nye features og mærkbare adfærdsændringer skal reviewe begge sider før opgaven betragtes som færdig
