# Lokal gate kørte core-smoke — CI kører hele e2e-suiten. En UI-regression slap igennem.

**Dato:** 2026-08-07 · **Issues:** [#2756](https://github.com/NicolaiDolmer/CyclingZone/issues/2756) · **PR'er:** [#3474](https://github.com/NicolaiDolmer/CyclingZone/pull/3474) (regressionen), [#3485](https://github.com/NicolaiDolmer/CyclingZone/pull/3485) (fixet)

## Hvad skete der

#2756 gjorde stage-ending-badgen ("Massespurt"/"Bjergfinale") til en fokusérbar knap med tooltip. `race-detail-upcoming.spec.js` og `race-detail.spec.js` asserter badgen med `getByText(...)` — som nu matchede BÅDE knappen og tooltip-elementet → strict mode violation → `frontend-smoke` rød på main og på alle efterfølgende PR'er.

Regressionen slap igennem, fordi implementerings-agenten fulgte den dokumenterede gate til punkt og prikke: `npx playwright test core-smoke.spec.js` (alle 3 projekter, 42/42 grønne). Men CI's `frontend-smoke`-job kører `npm run test:e2e` = **hele** e2e-mappen (250 tests). De to ramte specs var ikke i core-smoke.

Forværrende omstændighed: PR'en blev admin-merget under GitHub Actions-outaget på netop den lokale evidens — så CI's bredere net fangede den først NÆSTE dag, på uskyldige PR'er (dependabot), hvor symptomet lignede en flake.

## Rod-årsag

**Gaten og CI måler ikke det samme.** CLAUDE.md's frontend-preflight nævner eksplicit `core-smoke.spec.js`; CI kører hele suiten. Enhver UI-ændring i komponenter som ANDRE specs rører, kan derfor være "lokalt grøn, CI rød" — og under et CI-outage bliver hullet usynligt.

## Fix

Begge specs bruger nu rolle-baserede locators (`getByRole("button", {name})`) — committet på #3485 sammen med em-dash-/warning-oprydningen. Sweep bekræftede at ingen andre specs har mønstret.

## Forward-guards

1. **UI-PR'er skal køre HELE e2e-suiten lokalt** (`npm run test:e2e`), ikke kun core-smoke — eller minimum alle specs der grep-matcher de ændrede komponenters tekster/roller. (CLAUDE.md-linjen bør opdateres — ejer-forslag afgivet 7/8.)
2. **Admin-merge under CI-outage kræver at den lokale verifikation spejler CI's FULDE scope** — tjek workflow-filens faktiske kommando (`npm run test:e2e` ≠ `playwright test core-smoke.spec.js`), ikke huskereglen.
3. Assertions på interaktive elementer: foretræk rolle-baserede locators fra start — `getByText` på et element der senere får tooltip/aria-udvidelser er en tikkende strict-mode-bombe.
