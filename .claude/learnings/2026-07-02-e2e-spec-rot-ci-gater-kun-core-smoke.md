# 2026-07-02 — e2e-spec-rot: suiten kørte og fangede fejlen, men rød frontend-smoke mergede stille

> Filnavnet afspejler den OPRINDELIGE hypotese ("CI gater kun core-smoke") —
> den viste sig at være forkert (se rod-årsag). Navnet er beholdt så
> eksisterende referencer (PR #2114 m.fl.) resolver. Denne version superseder
> #2114's udgave af filen: hændelsesforløb + sponsor-flake-metodik er bevaret,
> rod-årsagen er korrigeret med run-log-evidens.

## Hvad skete

Fuld `test:e2e:update`-kørsel 2/7 afslørede at `race-physiology-preview.spec.js`
fejlede på alle 3 Playwright-projekter. Rytterprofil-redesignet (#2000,
PR #2037, merget samme dag) fjernede bevidst "Effektprofil"-sektionen fra
default-visningen — men spec'en, der assertede på den gamle struktur, blev ikke
opdateret i samme PR. Spec-fix: PR #2114.

`sponsor-ui.spec.js` blev rapporteret fejlende i samme kørsel, men kunne ikke
reproduceres (15/15 grønne: isoleret, `--update-snapshots`, `--repeat-each=3`,
fuld suite; stale server/build på port 4173 udelukket via dist-mtime) —
transient, ingen ændring.

## Rod-årsag (evidens-verificeret)

Hypotesen "CI's obligatoriske gate kører kun core-smoke.spec.js; resten kører
aldrig automatisk" var **forkert**:

- `frontend-smoke` (playwright-smoke.yml) kører `npm run test:e2e` =
  `playwright test` = **hele suiten** (138 tests, desktop-chromium +
  mobile-chromium) på hver PR der rører `frontend/**`. Verificeret i run-log
  28614350009 ("Running 138 tests"). Kun det LOKALE pre-flight i CLAUDE.md er
  core-smoke-only — deraf forvekslingen.
- PR #2037's `frontend-smoke` var **FAILURE** — suiten fangede regressionen
  præcis som designet (run 28610888367 viser den nøjagtige
  'Effektprofil'-fejl). PR'en blev merget alligevel.
- Hullet: `frontend-smoke` er **ikke et required check** (branch protection
  kræver kun backend-tests, frontend-build, dependency-review, review +
  i18n-checks), og auto-merge.yml venter kun på `gh pr checks --required`.
  PR #2110 mergede efterfølgende også rødt på samme nedarvede fejl.
- Historisk grund til ikke-required: teardown-flake på windows-runneren — men
  den blev **løst 2026-06-14** (#1342/PR #1385: webkit droppet i CI + statisk
  preview-build). Alle 16 røde runs i de seneste 50 (30/6 + 2/7) havde reelle
  årsager; ingen flake-signatur.

## Fix (værn)

1. `playwright-smoke.yml`: workflow-niveau `paths:`-filter flyttet ind i et
   `changes`-job, så `frontend-smoke` ALTID rapporterer en konklusion (skipped
   = grøn) og dermed kan gøres til required check uden at blokere docs-PR'er.
   Plus PR-kommentar ved rød suite (synlighed på mobil).
2. `auto-merge.yml`: venter nu eksplicit på `frontend-smoke`-konklusionen
   (skipped/neutral OK, failure → label fjernes + kommentar + abort).
3. Anbefaling til ejer: flip `frontend-smoke` til required i branch protection
   — EFTER workflow-ændringen er merget (ellers hænger docs-PR'er på
   "Expected").

## Læring

1. **Verificér CI-adfærd i run-logs, ikke i antagelser/docs.** Ét
   `gh run view --log` modbeviste hypotesen på 30 sekunder. Havde vi bygget
   værnet på hypotesen (nightly-suite eller i18n-grep-check), havde vi tilføjet
   redundant infrastruktur og LADT det reelle hul stå åbent.
2. **Et check der kan ignoreres, ER ignoreret.** Under natbølger/auto-merge
   merges der på required checks alene — signal uden håndhævelse rådner.
3. **"Ikke hard-gate pga. flake"-beslutninger skal genbesøges når flaken
   fixes.** #1342 fjernede grunden 18 dage før denne hændelse; ingen genbesøgte
   gaten.
4. **Redesign-PR'er bør greppe e2e-suiten for berørte flader.** En PR der
   fjerner/omdøber en sektion, i18n-key eller komponent bør greppe
   `tests/e2e/*.spec.js` for de strenge/selectors den fjerner (her ville
   `grep -r "Effektprofil" tests/` have fanget det før merge).
5. **Ved "X fejler" fra en fuld kørsel: reproducér FØR fix.** Sponsor-fejlen
   var transient — at "fixe" den ville have været symptom-patching.
   Reproduktions-matrixen (isoleret → update-mode → repeat → fuld suite) +
   miljø-tjek (port/dist-mtime) afgjorde spec-rot vs. flake på evidens.

Refs: #2000, PR #2037, PR #2110, PR #2114, #1342.
