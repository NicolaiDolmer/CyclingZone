# Postmortem · 2026-06-25 · Advisory CI-gate lod patch-notes-snapshot-drift slippe igennem 2×

## Hvad skete der?
Core-smoke patch-notes-snapshots drev stille to gange: #1853 (v6.11) måtte refreshes i #1862, og #1864 (v6.13) drev igen og blev refreshet i #1874. Hver gang landede en patch-notes-content-commit uden at opdatere snapshots, og CI sagde ikke fra.

## Root cause
To ting i kombination:
1. **Default-open-nyeste:** `/patch-notes` åbner nyeste entry by default (`localStorage` tom i test). Hver ny dag/version i `frontend/src/data/patchNotes.js` vokser first paint → den maskede layout-diff i `core-smoke.spec.js` overstiger `maxDiffPixelRatio: 0.05`.
2. **Advisory gate:** den visuelle test bor i `frontend-smoke` (`playwright-smoke.yml`), som **ikke** er i required checks (backend-tests, frontend-build, dependency-review, review). Så en ægte visuel diff blokerede ikke merge — den drev bare videre. Memory-reglen `feedback_refresh_core_smoke_snapshots` fangede det kun adfærdsmæssigt, ikke automatisk.

## Fix
Mulighed B (billig required lint), commit `26f2043b` ([#1878](https://github.com/NicolaiDolmer/CyclingZone/pull/1878)): udvidede den **allerede-required** `scripts/check-patch-notes-version.js` (kører i `frontend-build`). Når en PR tilføjer en ny top-version men ikke refresher `core-smoke.spec.js-snapshots/patch-notes-*.png`, fejler guarden og peger på `npm run test:e2e:update`. Escape-hatch: token `[patch-notes-snapshot-ok]` i en commit-besked til den sjældne sub-threshold-entry.

Nøgle-indsigt der gjorde B billig: den eksisterende guard kræver allerede version-bump ved enhver `patchNotes.js`-ændring, så jeg kunne hænge snapshot-kravet på den præcise "ny top-version"-gren uden ny windows-runner, uden at rendere, og uden win32-PNG-platformkobling.

## Forhindret-fremover
- **Når en visuel/dyr test er bevidst advisory (flake-historik), så find den billige proxy der KAN være required.** Her: "ny patch-notes-version uden snapshot-refresh" er en deterministisk, render-fri proxy for "first paint voksede forbi threshold". Et required node-lint-job slår en advisory pixel-test når målet bare er at blokere drift.
- Mønstret matcher repo-idiomet: `ui-anti-drift`, `postgrest-cap-guard`, `migration-idempotency` er alle billige node-lints i required jobs.
- A ("ét spec, kun den ene side") så billigere ud end den var: patch-notes er ikke sin egen test — den er én iteration i `for (const spec of CORE_PAGES)`-loopet, så A kræver enten refaktor eller en duplikeret baseline (= ny drift-kilde). Læs strukturen før du estimerer "kun den ene side".

## Læring
1. **Advisory + auto-default-til-nyeste = stille drift.** Enhver flade der renderer "nyeste" by default i en snapshot-test driver med hver content-tilføjelse. Enten frys et deterministisk view i testen, eller hæng en billig required guard på content-kilden.
2. **Procesfejl jeg selv lavede (delt checkout):** jeg kørte `git checkout -- frontend/src/components/Layout.jsx` som en tankeløs "no-op" og kom til at reverte en PARALLEL sessions ucommittede WIP (`min-w-0`-mobil-fix, nu branchen `fix/mobile-main-overflow-min-w-0`). Fanget og gendannet byte-identisk, men: **kør aldrig destruktive working-tree-kommandoer (`git checkout --`, `reset --hard`, `clean`) i et delt checkout med løse filer du ikke selv lavede.** Stage kun egne filer ved navn; lad alt andet være. Det delte checkout skiftede endda branch under mig midt i close-out — commit-kæde-guarden (`test "$(git rev-parse --abbrev-ref HEAD)" = "main"`) fangede det, og noten her blev committet fra en isoleret worktree i stedet. Jf. `feedback_verify_branch_before_commit_shared_checkout`.
