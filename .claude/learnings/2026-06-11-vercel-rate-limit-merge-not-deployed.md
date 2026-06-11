# Merged ≠ deployet: Vercel-kvote kan stille efterlade main udeployet

**Dato:** 2026-06-11 · **Kontekst:** #1302 GA4 (PR #1303)

## Hvad skete

GA4-integration merged til main med auto-merge. Antagelsen "auto-merge grøn → live om ~10 min"
holdt ikke: Vercel Hobby-deploy-kvoten var opbrugt tidligere samme dag, så Vercel oprettede
ALDRIG et deployment for merge-committet. Prod kørte videre på ældre bundle. Først opdaget
fordi prod-verifikation af consent-gaten fejlede (0 gtag-requests efter accept).

## Signaler der afslørede det

1. `deploy-verify`-workflow fejlede med 10-min-timeout ("ventede på Vercel-deploy") — samme
   symptom som benigne docs-only-skips, så det blev næsten overset.
2. **Afgørende bevis:** `gh api repos/<repo>/commits/<sha>/status` → Vercel-context =
   `"Deployment rate limited — retry in 24 hours"` (state: failure).
3. Bundle-forensik: prod-index manglede den nye lazy-chunk men HAVDE nyere env-vars
   (env ≠ kode-version; env inlines ved næste build uanset commit).

## Regler fremover

- **Claim aldrig "live efter merge" uden deploy-bevis.** Verificér at et deployment med
  merge-SHA'en findes og er READY (Vercel MCP `list_deployments` matcher `githubCommitSha`),
  eller at deploy-verify-workflowet er grønt for committet.
- deploy-verify-timeout på et commit MED frontend-ændringer = tjek commit-status for
  rate-limit FØR fejlsøgning af ignoreCommand/kode.
- Recovery: 'Redeploy'-knappen i Vercel-dashboard genbygger det GAMLE deployments commit —
  brug `vercel deploy --prod` fra frontend/ (eller Create Deployment fra main) i stedet.
