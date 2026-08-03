# Postmortem · 2026-08-03 · Parallel-orkestrator-kollisioner (verdensklasse-batch vs nat-batch-hale)

## Hvad skete der?
Verdensklasse-batchen (aften) claimede NOW.md mens nat-batchens (formiddag) orkestrator stadig var aktiv i hoved-checkoutet. Tre kollisions-klasser fulgte:

1. **Fremmed staged index i delt checkout:** Orkestratorens docs-commit (`git add <fil> && git commit`) tog 17 fremmede staged scout-filer (#3203) med, fordi `git commit` committer HELE index'et. Opdaget FOER push (non-fast-forward-fejl), repareret kirurgisk med `reset --soft` + `restore --staged <egen fil>`; de fremmede staged filer blev bevaret uroert.
2. **Duplikeret arbejde:** Begge orkestratorer fixede swallowed-catch-guard-branden paa main (identisk fix; PR #3253 lukket som overfloedig, #3254 vandt). Tre ejer-startede task-chips var OGSAA dubletter af samme fix.
3. **Lokal main pullet under fremmed session:** Lokal main flyttede sig midt i batchen (den anden sessions pull), hvilket gjorde alle antagelser om checkoutets tilstand utrovaerdige.

Dertil tre worker-moenstre der bed gentagne gange:
- **Baggrunds-CI-ventere doer ved worker-stop** (3 workers afleverede "venter paa CI" i stedet for slutrapport).
- **`.progress.md` laekkede ind i main 2x** via PR-squashes (#3248, #3246) og skabte en hel konflikt-klasse paa tvaers af parallelle PRs. Lukket permanent med `.gitignore`-linje samme aften.
- **Workers spawnede task-chips** trods orkestrator-ejer-reglen; ejeren startede 3 dublet-sessioner fra dem.

## Root cause
NOW.md-claim-protokollen blev laest ensidigt: den nye session tolkede "Aften-batch FAERDIG" som at AL forudgaaende aktivitet var slut, men Working agent-linjen beskrev en ANDEN (nat-)batch der stadig koerte. Og hoved-checkoutet blev brugt til commits under en batch, hvor dets index/branch-state ikke er under egen kontrol.

## Fix / forhindret-fremover
1. **Orkestrator committer ALDRIG fra hoved-checkoutet under en batch** - GitHub API (create_or_update_file/delete_file) eller dedikeret worktree. Skal et checkout-commit ske alligevel: brug pathspec-commit (`git commit <fil> -m ...`) som kun tager den navngivne fil, uanset index.
2. **Claim-tjek er tovejs:** foer claim skal BAADE Working agent-linjen laeses OG live-tegn tjekkes (nylige commits/PRs fra den anden session, `git log origin/main --since=2h`). Ved tvivl: koordiner i stedet for at antage.
3. **`.progress.md` er gitignored** (commit c124d40c) - workers skriver den lokalt, den kan ikke laenger committes.
4. **Worker-prompt-standard opdateret** (natboelge-prompten 3/8): forbud mod baggrunds-CI-ventere (poll direkte foer slutrapport) + forbud mod chips (fund -> orkestrator -> issue + egen worker).
5. **PRs der roerer samme filer sekvenseres** af orkestratoren (cron.js/financeCategories/drift-watch gav konflikt-storme naar 13 PRs var armeret samtidig).

## Laering
En batch-orkestrators farligste antagelse er at den er alene. Delt mutable state (hoved-checkoutets index, main-branchen, scratch-filnavne, guard-baselines) skal enten undgaas (API-commits, worktrees, gitignore) eller laeses defensivt lige foer hver brug - aldrig antages stabil hen over en tur.
