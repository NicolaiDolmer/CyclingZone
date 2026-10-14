# Merget er ikke live (13-14/10)

**Hvad skete:** Fire separate fejl samme aften/morgen, hvor "PR merget + CI grøn" blev læst som "ude hos spillerne":

1. **Vercel-prod-build fejlede på Supabase Storage 520** under `release-assets:upload` (#6585). Buildet fejler bevidst (#5162). Appen var ikke live i ~30 min trods merge.
2. **Tabte webhooks under GitHub-502:** Vercel oprettede intet prod-deploy for #6592 og annullerede det forrige. Løst med manuelt deploy via Vercel MCP (`create_deployment` med `gitSource` sha).
3. **Merge-køen læste GitHub-502 som "main rød"** (`gh run watch --exit-status` exiter != 0 ved API-fejl). To falske stop. Rettet i #6593 (læser run status/conclusion med retry).
4. **Ny `public/404.html` (#6578) blev serveret for manglende chunks** (404 text/html). Asset-miss-proben (#4545) fangede det i deploy verify. Rettet i #6600 (rewrite `/assets/:path*` → `/api/asset-miss`, 404 text/plain no-store; Vercel tjekker filsystemet før rewrites).

**Rod-årsag (fælles):** verifikation stoppede ved CI/merge i stedet for at bekræfte det faktiske prod-deploy og dets adfærd.

**Regel fremover:**
- Efter merge af frontend: bekræft at der FINDES et Vercel-prod-deploy for commit-SHA'en (statuses/`list_deployments`), at det er READY, og test den konkrete ændring live (curl/browser).
- Ved Vercel-status "failure": læs build-loggen (`list_deployment_events`) før antagelser; transient upstream (520/502) → nyt deploy.
- En ny `404.html` i `frontend/public` ændrer svaret for ALLE ukendte stier, også `/assets/` — kør `scripts/check-asset-miss-behaviour.mjs --base=<preview>` før merge.

Refs #6585 #6592 #6593 #6578 #6600 #4545
