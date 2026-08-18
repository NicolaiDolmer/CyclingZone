# ignoreCommand-exit 128 brækkede alle prod-deploys (18/8)

## Hændelse
Nattens #3867-fix af Vercel Ignored Build Step diffede mod `VERCEL_GIT_PREVIOUS_SHA`. Den SHA ligger uden for Vercels shallow clone → `git diff` døde med `fatal: bad object` og **exit 128**. Antagelsen var fail-open ("non-zero → build kører"), men Vercels kontrakt er exit 0 = skip, exit 1 = byg, **alt andet = deploy-FEJL**. Alle production-deploys 08:00-08:52 stod i ERROR; prod-frontend sad fast på sidste gode deploy. Ingen spillerskade ud over forsinkede features; opdaget via ejer-spørgsmål ("mange errors på Vercel"), bekræftet i build-log.

## Fix
PR #3905: main-skip-logikken fjernet helt — main bygger ALTID (190/256 tegn). Verificeret: første post-merge prod-deploy READY + rollback-kandidat.

## Lektier
1. **Vercels ignoreCommand-kontrakt er treværdig** (0=skip, 1=byg, >1=fejl) — "fail-open via non-zero" er en falsk antagelse; git's fatal-fejl er 128.
2. **To hændelser på to dage fra samme "smarte" skip-logik** (17/8: mistede deploys via HEAD^-diff; 18/8: knækkede deploys via PREVIOUS_SHA). Skip-optimering på PROD-grenen er negativ EV på Pro-plan — byg altid.
3. **Deploy-config kan CI ikke verificere** — klassificerings-instinktet (draft trods type:bug) var rigtigt i nat; næste gang skal første post-merge-deploy overvåges AKTIVT som del af merge-handlingen, ikke opdages via dashboard.

Refs #3838, #3867, #3905.
