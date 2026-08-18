# Vercel Ignored Build Step diffede mod forrige commit i stedet for sidste deploy - frontend-ændringer forsvandt stille

**Dato:** 2026-08-18 · **Kontekst:** #3838, PR se issue-tråd

## Symptom

Patch note-commit `c0091a5a` (rører `frontend/src/data/patchNotes.js`) blev pushet til `main`.
Sekunder/minutter senere blev to docs-only-commits pushet oveni. Vercel-deploymentlisten viste
INGEN production-deploy for `c0091a5a` - frontend-ændringen kom aldrig i produktion af sig selv;
den lå først live da et senere, ubeslægtet push tilfældigt trigger'ede et build.

## Rod-årsag

`ignoreCommand` for `main`-branchen i `frontend/vercel.json` var:

```
main) git diff --quiet HEAD^ HEAD -- .;;
```

Denne sammenligner altid mod den **umiddelbart forrige commit**, ikke mod den sidst faktisk
DEPLOYEDE commit. Når flere commits stables hurtigt efter hinanden på `main` (normal arbejdsform
med parallelle sessioner), sker et af to:

1. Vercel's default "Auto Job Cancellation" annullerer et build der stadig kører, når et nyt
   commit lander på samme branch - så et frontend-commits build kan blive skudt ned af et
   docs-commit der ankommer bagefter.
2. Selv uden annullering: når det NÆSTE commit (docs-only) evalueres, kigger scriptet kun på
   diffen mod SIT EGET forældre-commit (endnu et docs-commit) - ikke tilbage til det, der rent
   faktisk sidst blev deployet. En frontend-ændring et par commits tilbage, som aldrig fik sit
   eget build, bliver derfor aldrig opdaget.

## Fix

Brug Vercels dokumenterede systemvariabel `VERCEL_GIT_PREVIOUS_SHA` ("SHA of the last successful
deployment") som baseline i stedet for `HEAD^`, med fallback til `HEAD^` når variablen ikke er
sat (allerførste deploy):

```
main) git diff --quiet ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD -- .;;
```

Fail-open bevaret: findes `VERCEL_GIT_PREVIOUS_SHA` ikke i den lokale (evt. shallow) clone,
fejler `git diff` med non-zero exit → build kører (sikker retning - for mange builds er billigere
end en stille tabt deploy). Samme mønster som wildcard-branchen allerede brugte for fetch/
merge-base-fejl.

Måtte komprimeres (fjernet mellemrum omkring `||`/`;`, `--depth=100`→`--depth=50`) for at holde
sig under Vercels 256-tegns-grænse for `ignoreCommand` (se
`.claude/learnings/2026-07-24-vercel-ignorecommand-256-char-limit.md`) - ny længde: 249 tegn.

## Testet lokalt (konstruerede commit-ranges, se PR-body for fuld matrix)

- HEAD=docs-commit, `VERCEL_GIT_PREVIOUS_SHA`=sidste reelle deploy (før et udeployeret
  frontend-commit) → **BUILD** (bug rettet - var SKIP med gammelt script).
- Samme scenarie med det GAMLE script → **SKIP** (bug reproduceret).
- Ren docs-only-range siden sidste deploy → SKIP.
- `VERCEL_GIT_PREVIOUS_SHA` ikke sat (første deploy) → falder tilbage til `HEAD^`.
- `VERCEL_GIT_PREVIOUS_SHA` peger på SHA uden for lokal historik → fail-open (BUILD).
- `dependabot/*`-branches → uændret SKIP.
- Wildcard (PR/feature-branch) sti → uændret adfærd, testet både docs-only og frontend-diff.

## Læring

1. Et `ignoreCommand` der kun kigger på `HEAD^` er farligt i et repo med flere pushes/minut til
   `main` - brug altid `VERCEL_GIT_PREVIOUS_SHA` (kun eksponeret når Ignored Build Step er
   konfigureret) som baseline, ikke den seneste commit alene.
2. "Auto Job Cancellation" (Vercel-projektindstilling, default ON) er en relateret, ikke-rettet
   medvirkende faktor: den annullerer et build in-flight når et nyt commit lander på samme
   branch. Fixet her løser symptomet (tabt deploy) uden at slå den fra, men er værd at kende hvis
   mønsteret dukker op igen efter denne fix.
3. Test `ignoreCommand`-ændringer med konstruerede lokale git-repos (kunstige commit-kæder,
   `sh -c "$CMD"` med udfyldte env-vars) FØR push - scriptet selv-tester ellers kun ved at gætte
   og se på Vercel-status.
