# Deploy verify: tvilling-runs cancellede hinanden → falsk "cancelled" i verify-deploy.ps1

**Dato:** 2026-06-10
**Symptom:** `scripts/verify-deploy.ps1` kastede "GitHub Actions fejlede: Deploy verify:cancelled" efter PR-merges, selvom deploy reelt var grønt. Observeret ved merge af #1243 (main-runnet vandt racet) og #1249 (PR-runnet vandt).

## Rod-årsag

`deploy-verify.yml` havde både `push: branches: [main]` og `pull_request: types: [closed]`-triggers. Ved et bruger-merge fyrer **begge** events for samme merge — to runs med samme indhold. De delte concurrency-group (nøglet på merge-commit-sha) med `cancel-in-progress: true`, så den ene cancellede altid den anden; hvilket run der vandt var et race.

`verify-deploy.ps1` (`Test-CiStatus`) matcher runs via `/actions/runs?branch=main` + `head_sha == merge-sha`. Kun **push-runnet** matcher (PR-closed-runnet har `head_branch` = PR-branchen og `head_sha` = branch-HEAD, ikke merge-committen). Når PR-runnet vandt racet, så scriptet kun det cancellede push-run → falsk negativ.

## Hvorfor fandtes den redundante trigger?

`pull_request: closed` blev tilføjet i #186 ud fra antagelsen at den ville fange auto-merges hvor push-eventet undertrykkes af GITHUB_TOKEN-anti-loop-beskyttelsen. Antagelsen var forkert: anti-loop undertrykker **alle** events fra GITHUB_TOKEN-handlinger — også `pull_request: closed`. #191 tilføjede derfor det rigtige fix (`workflow_dispatch` fra auto-merge.yml) uden at fjerne den virkningsløse trigger. Den lå derefter som harmløs-udseende redundans indtil concurrency-gruppen (tilføjet senere) gjorde tvillingerne selvdestruktive.

## Fix

Fjernet `pull_request`-triggeren + tilhørende dead code (job-level `if`, `PR_MERGE_SHA`/`PR_NUMBER`-envs, `merge_commit_sha` i concurrency-key). Dækning efter fix:

| Merge-type | Event der fyrer |
|---|---|
| Bruger/PAT-merge eller direkte push | `push` (main) |
| GITHUB_TOKEN-auto-merge (auto-merge.yml) | `workflow_dispatch` (eksplicit dispatch) |

## Læring (generaliserbar)

1. **To triggers der kan fyre for samme logiske hændelse + delt concurrency-group med cancel-in-progress = selvdestruktion.** Tjek event-matrixen når du tilføjer en trigger ELLER en concurrency-group — fejlen opstod først da begge var til stede.
2. **En workaround der ikke virkede skal fjernes, ikke bare suppleres.** #191 løste problemet rigtigt, men efterlod #186's virkningsløse trigger — som blev en latent bug.
3. **`pull_request: closed`-runs har `head_sha` = branch-HEAD, ikke merge-committen.** Tooling der matcher runs på main-sha ser dem aldrig.
