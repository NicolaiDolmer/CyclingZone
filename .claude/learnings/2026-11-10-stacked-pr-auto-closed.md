# Stablede PR'er blev lukket automatisk, da base-branchen blev slettet (10/11)

**Hvad skete:** Træn nu del 2 (#7954) og del 4 (#7957) havde base = del 1-branchen
`feat/7737-traen-nu-pr1-motor`. Merge-køen squash-mergede del 1 (#7948) og slettede
branchen; GitHub lukkede straks de to stablede PR'er (aktør = ejerens konto, fordi køen
kører på hans login). Push til de lukkede PR'ers branches opdaterede ikke PR-siden, så det
lignede "GitHub hænger" i 10+ minutter.

**Rodårsag:** stablede PR'er peger på en branch, der forsvinder ved merge, og squash-merge
gør del 1's mellemcommits til fremmede historik i de stablede branches (rebase-konflikt).

**Rettelse i dag:** genåbnet som nye PR'er mod main (#7967, #7968) på samme branch via en
ikke-destruktiv merge-commit, hvis træ = del-commit'en cherry-picket oven på main
(`git commit-tree <træ> -p <gammel-head> -p origin/main`); force-push er blokeret.

**Forebyggelse:** før en base-PR sendes i merge-køen: `gh pr list --base <branch>`; findes
stablede PR'er, retarget dem til main FØRST (`gh pr edit N --base main`). Kandidat til et
tjek i `scripts/merge-queue.ps1` (kræver ejer-ja som ny ops-ændring).

## Preventive queue change, Codex 10/11

Refs #7911, owner mandate 10 November 2026.

### Verified missing guard

The owner reported stacked PRs closing when their base PR merged and its branch was deleted. The queue invoked guarded merge with branch deletion without first discovering open PRs targeting that branch. Required checks on the parent do not establish that its branch is safe to delete.

The missing protection is verified in the pre-change source and reproduced by a failing queue integration test. No live branch was deleted to reproduce GitHub's behavior; the incident report is the owner mandate, not a new production experiment.

### Correction

Discover open children using `gh pr list --base`, retarget them to main, read back each result and check the old base again before the parent's final HEAD/check/tick guards. Dry-run makes no edits. Fork heads cannot accidentally retarget children of same-named local branches. Invalid metadata, discovery at the result cap, failed edits/readback, concurrently changed bases or newly discovered children stop through `Exit-Queue`, which preserves verification of a previously merged train.

### Verification and recovery

Isolated PowerShell behavior tests use the GitHub wrapper boundary without network or wall-clock dependence. They cover multiple/no children, dry-run, safe repetition, partial failure, failed discovery/readback, changed bases/HEADs, fork namesakes and a new child during processing. Existing queue regression tests and preflight also apply.

If only some children moved, leave them on main and rerun after inspecting the failure. Do not close/reopen children or force their branches. Reevaluate each child's checks and review against main before its later merge. Retargeting can expose parent commits until the parent merges; it is not permission to merge the child early. No atomic GitHub transaction covers a child created after the final discovery, so concurrent stack changes during a merge remain a limitation.

No player behavior, balance, migration, flag or product runtime changes. Patch notes and FEATURE_REGISTRY are not applicable. Claude owns review, merge and release verification.
