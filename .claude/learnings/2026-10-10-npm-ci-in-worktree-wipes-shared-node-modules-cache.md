# npm ci i et worktree tømte den delte node_modules-cache (10/10)

**Hvad skete:** Kl. 11:09 kørte jeg `npm ci` i `frontend/` i #4522-worktreet, fordi `@tailwindcss/vite` manglede. Worktreets `frontend/node_modules` var en junction til den delte cache `%LOCALAPPDATA%/CyclingZone/node-modules-cache/frontend-<hash>/node_modules`. `npm ci` sletter `node_modules` først og fulgte junctionen, så cachen stod tom. Worktreet fik bagefter sin egen rigtige mappe. Tre bølge-laner, der delte cachen, kunne ikke starte Vite (én lane stoppede helt). Cachen blev genopbygget kl. 11:46 af en anden kørsel.

**Rod-årsag:** Cachen var allerede ufuldstændig (manglede `@tailwindcss/vite`). Reparationen ramte delt tilstand i stedet for den lokale kopi.

**Regel:**
- Kør aldrig `npm ci`/`npm install` i en mappe, hvis `node_modules` er en junction (`ls -la frontend | grep node_modules` viser `->`).
- Mangler der en pakke i en delt cache, så reparér cachen ét sted (`npm ci` i cache-mappen, hvor `package.json` + lock ligger), når ingen laner kører. Eller brug `npm run sync-deps`.
- Briefen til bølge-laner siger allerede "ingen npm ci" (hard rule 14). Den gælder også orkestratoren.
