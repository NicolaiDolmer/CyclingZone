# Skitse #7638: prisord på alle ordrer

Tre varianter af, hvordan prisordet (Let / Middel / Hård / Meget hård) kan stå de tre steder, hvor det mangler i dag:

1. enkeltstartens indsatstrin (Kør roligt / Normal / Alt ud),
2. holdets udbrudsholdning (Jag / Vurder undervejs / Overlad jagten til andre),
3. de gamle ordreknapper Forsøg udbrud og Sprint-tog (løb uden etapeplan).

| Bogstav | Navn | Idé |
|---|---|---|
| **A (anbefalet)** | Ordet i knappen | Ordet står i selve kontrollen efter navnet, i dæmpet tekst, som etapeplanens opgave-chip |
| B | Ord og trappe | Som A plus en trappe med fire firkanter |
| C | Ordet i forklaringen | Kontrollerne er uændrede; ordet står i en linje under eller ved siden af |

- Prisordene for indsatstrin og ordreknapper læses fra spillets egen model (`EFFORT_COST_WORD`, `taskCostWord`), teksterne fra `public/locales/da/races.json`. Kun udbrudsholdningens ord er et forslag (`STANCE_PRICE` i `data.ts`) og står markeret som åbent på siden.
- Ryttere og navne er syntetiske. Ingen backend, ingen app-router.

Åbn: `npx vite` fra `frontend/` og gå til `/src/preview/sketches/7638-prisord/index.html` (`?id=a|b|c&w=d|m&theme=dark`).
Billeder: `node src/preview/sketches/7638-prisord/shoot.mjs` fra `frontend/` (starter og lukker sin egen server). Ud til `pr-screens/7638-prisord/`.
