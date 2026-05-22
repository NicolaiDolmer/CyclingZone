# 2026-05-21 — Vercel "Provisioning integrations failed" transient (3h ude af drift)

## Hvad skete der

Fra ca. 20:34 CEST og frem fejlede 4 på hinanden følgende Vercel-deployments med samme symptom: build state = `ERROR`, build-tid 600–900 ms, **0 build events** i deployment logs. Brugeren bemærkede det ved at sidens v3.85-fix (PR #537 deadline-day) ikke kom live efter merge.

Inspector-view i Vercel viste: "Build Failed — Provisioning integrations failed" med en rød prik ved `supabase-orange-ferry` og en gul prik ved "Supabase Preview Branch". Build-runneren startede aldrig — fejlen lå i "Provision integrations"-step der kører FØR builden.

Selve Supabase-projektet (`ghwvkxzhsbbltzfnuhhz`) var `ACTIVE_HEALTHY` hele tiden. Det var **Vercel↔Supabase OAuth-broen** der ikke kunne hente env-vars ved provisioning.

Fixet: et empty commit ~3 timer senere fik builden igennem uden ændringer i config eller integration. **Fejlen var transient** — formentlig en token-rotation eller midlertidig outage hos Vercel's marketplace-integration-side.

## Symptom-signatur — sådan genkendes det

En Vercel-deployment-ERROR er denne type hvis ALLE disse holder:

- `state: ERROR` i Vercel API
- Build-tid < 1 sekund (typisk 600–900 ms)
- `get_deployment_build_logs` returnerer **tom events-array** (`{"events": []}`)
- Inspector viser "Provisioning integrations failed" øverst, ikke en kode/build-fejl
- `previewUrl: ""` i Vercel-bot's GitHub-kommentar (base64-decode `[vc]: ...` for at se)
- Den samme commit byggede fint i en tidligere preview (ingen kode-årsag)

Hvis disse holder: det er **ikke** en kode-fejl, en quota-overskridelse, eller en build-runner-fejl. Det er provisioning-broen.

## Diagnose-trin (anbefalet rækkefølge)

1. **Først:** Vercel inspector → klik den røde integration-row. Den udfolder den faktiske besked (typisk "Authentication failed", "Resource not found", "Permission denied", "Rate limit").
2. **Verificér Supabase-projekt:** via `mcp__0447176e-...__get_project` — hvis `ACTIVE_HEALTHY`, så er problemet integrationen, ikke Supabase.
3. **Prøv en redeploy** (empty commit eller "Redeploy"-knap) før alt andet. Mange "Provisioning failed"-fejl er transient og selv-helbredende.
4. **Hvis stadig fejler:** Vercel → Settings → Integrations → Supabase → "Reauthorize" / "Reconnect". Det genfortæller OAuth-broen.
5. **Sidste udvej:** Disconnect integration + brug manuelle env-vars (kræver at `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` + service-role-key er sat manuelt i Project Settings — ellers brækker prod).

## Forward-guard

- **Hvis deploy-verify (GitHub Action) fejler med `Vercel: false` i 10+ minutter:** tjek inspector-row FØR du leder efter kode-fejl. Vi spildte 30+ minutter med at lede efter regression i `29056f5` (en docs-only commit).
- **GitHub deploy-verify monitorerer rigtigt** — den polled 10 min og fangede problemet. Når den fejler er det altid værd at åbne Vercel inspector manuelt, ikke kun stole på commit-status.
- **Prod URL kan FORTSAT virke** under denne fejl. Vercel serverer den seneste READY deployment. Et "live" site er ikke bevis på at nye fixes er deployed — tjek altid bundle-hash eller version-streng i bundle.

## Værktøjer der hjalp

- `mcp__dba1ab87-...__list_deployments` viste state per deployment
- `mcp__dba1ab87-...__get_deployment_build_logs` med tom events = stærkt signal om provisioning-fail
- Base64-decode af Vercel-bot's `[vc]: #...` GitHub-kommentar gav `previewUrl: ""` (definitivt tegn)
- `gh run view <deploy-verify-run-id> --log` viste polling-historikken
- `mcp__0447176e-...__get_project` udelukkede Supabase-side problem

## Memory-reference

Tilføjet WARM-tier memory: `feedback_vercel_provisioning_integration_transient.md` peger på denne læring som første-tjek når Vercel-deployments fejler med 0 build events.
