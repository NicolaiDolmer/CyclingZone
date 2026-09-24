# 2026-09-24: PR lukkede sig selv, da dens base-branch blev merget og slettet

## Symptom
PR #5655 (hjaelpetekster, base = `cloud/4850-c1-help`, PR #5615) forsvandt fra koen. GitHub lukkede den automatisk, da #5615 blev squash-merget med `--delete-branch`. Ingen fejl, ingen notifikation i koeen; opdaget ved gennemgang af aabne PR'er 40 min senere.

## Rodaarsag
Stablede PR'er (base = en anden PR's branch) lukkes af GitHub, naar base-branchen slettes. `merge-queue.ps1` sletter altid branchen. #5654 havde samme opsaetning (base #5640) og blev retargetet i tide, #5655 blev overset.

## Fix
- #5655 genoprettet som #5670 med base `main` (commits cherry-picket, konflikt i help.json loest af WAVE-FOLLOWUP).
- Cloud-specs (#5659) rettet: stablede PR'er skal retargetes til main FOER base-PR'en merges.

## Forward guard
- FOER merge af en PR: `gh pr list --base <branch>` for at finde PR'er der bygger paa den; retarget dem med `gh pr edit N --base main`.
- Cloud-prompter: stablede PR'er er forbudt; byg i stedet paa main og skriv afhaengigheden i PR-body.
