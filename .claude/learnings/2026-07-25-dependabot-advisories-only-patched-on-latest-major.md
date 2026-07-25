# En advisory er ofte KUN patchet på seneste major — tjek det før du planlægger fixet

**Dato:** 2026-07-25
**Anledning:** 4 åbne Dependabot-alerts (#22/#23/#24 react-router, #25 brace-expansion). PR [#2953](https://github.com/NicolaiDolmer/CyclingZone/pull/2953) + [#2959](https://github.com/NicolaiDolmer/CyclingZone/pull/2959).

## Kernen

GitHub-advisories angiver ét `vulnerable_version_range` og ÉN `first_patched_version`. Range'et går tit på tværs af alle major-linjer, mens patchen kun findes på den nyeste. Det betyder at "bump til patched version" i praksis kan være en **major-migration i forklædning** — og at en transitive dependency på en gammel major slet ikke KAN fixes.

Tjek derfor altid, før du lægger en plan:

```bash
gh api repos/OWNER/REPO/dependabot/alerts/N \
  -q '{range: .security_vulnerability.vulnerable_version_range,
       patched: .security_vulnerability.first_patched_version.identifier,
       manifest: .dependency.manifest_path}'
npm view <pkg> versions --json    # findes der en backport på DIN major-linje?
```

## Tre konkrete fælder fra denne omgang

### 1. `overrides` til en ny major kan brække API'et — verificér export-formen

`brace-expansion` var sårbar i `<= 5.0.7`, patchet kun i `5.0.8`. Fristelsen: pin alle instanser med `"overrides": {"brace-expansion": "^5.0.8"}`. Det ville have brækket prod ved runtime:

```js
// brace-expansion 5's CJS-build:
const be = require("brace-expansion");
typeof be;        // "object"  — IKKE en funktion
Object.keys(be);  // ["EXPANSION_MAX", "EXPANSION_MAX_LENGTH", "expand"]
```

`minimatch@3/5` gør `const expand = require("brace-expansion")` og **kalder** den. En blanket-override havde givet `be is not a function` i `archiver`-kæden.

**Læring:** før du overrider en transitive dep over en major-grænse, installér den i en scratch-mappe og `require()` den. Det tog 30 sekunder og forhindrede en prod-fejl.

### 2. Den bedste fix er tit at fjerne dependency'en, ikke at pinne den

Den sårbare `brace-expansion`-kæde løb gennem `exceljs → archiver → glob/readdir-glob → minimatch`. Men `exceljs` var **ubrugt**: den blev tilføjet som xlsx-erstatning, hvorefter det viste sig at PCM eksporterer SpreadsheetML 2003 (XML), ikke OOXML-zip — så `pcmResultsParser.js` bruger `fast-xml-parser`. Ingen importerede exceljs.

Ét `npm uninstall exceljs` tog `npm audit` fra 9 high til 0.

**Læring:** når en advisory kommer via en transitive kæde, så spørg først "bruger vi overhovedet roden af den kæde?" — før du leder efter en version at pinne.

### 3. Fixet kan trække en NY advisory ind — tjek destinationen før du migrerer

`react-router` skulle til `>= 7.18.0` for at lukke #22/#24. Men hele `7.12.0–8.2.x` er ramt af [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) (RSC CSRF, high), først patchet i `8.3.0` — som kræver React 19. Repoets egen `dependency-review` (`fail-on-severity: high`) blokerede derfor PR'en.

Kør `npm audit` **efter** installationen af mål-versionen, ikke kun før. Ellers opdager du det først i CI.

## Bonus: v6 → v7 relative paths i splat-routes

React Router v7 opløser en relativ path inde i en splat-route mod **hele** den matchede location; v6 strippede splatten. `<Route path="*" element={<Navigate to="season">}>` under `/admin` blev derfor til `/admin/bogus/season` → ny splat-match → redirect-loop.

Verificeret empirisk i stedet for gættet — det er billigt:

```js
renderToStaticMarkup(
  React.createElement(StaticRouter, { location: "/admin/bogus" }, tree)
); // Probe bruger useResolvedPath("season")
```

Guard lagt i `frontend/src/App.adminSplatRedirect.test.js`, så både v7-semantikken og de absolutte redirects holdes ærlige.

## Bonus 2: baseline før du kalder noget en regression

`mobile-webkit`-smoketesten fejlede 6/9 lokalt efter migrationen. I stedet for at debugge kørte jeg samme kommando i et rent worktree på `origin/main` med react-router 6: **5/9 fejlede der også**, med varierende fejlsæt mellem kørsler. Pre-eksisterende lokal flake, ikke en regression. Et worktree + `npm ci` koster få minutter og er billigere end en halv dag i den forkerte ende.
