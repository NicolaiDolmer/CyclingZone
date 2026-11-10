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
