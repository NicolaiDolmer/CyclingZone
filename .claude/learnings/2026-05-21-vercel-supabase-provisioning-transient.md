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

## Permanent resolution (2026-05-29)

Fejlen var **ikke** transient anden gang den ramte (~2 uger senere). Diagnose viste root cause: der lå **to** Supabase-integrationer på `cycling-zone`-projektet i Vercel:

1. **Supabase (uden badge)** — OAuth-forbindelse til den rigtige selv-oprettede DB `ghwvkxzhsbbltzfnuhhz`. **Beholdt.**
2. **Supabase "Billed Via Vercel"** — Marketplace-provisioneret resource `supabase-orange-ferry` (Free Plan). Appen brugte den aldrig; den pausede af inaktivitet → Vercel's "Provision integrations"-step kunne ikke synke env fra et pauset projekt → **alle prod-deploys fejlede før build** (0 build events, <1 s ERROR). En redeploy reproducerede fejlen øjeblikkeligt — bekræftede ikke-transient.

**Bevis for sikker fjernelse (verificeret før sletning):**
- Live prod-bundle talte med `ghwvkxzhsbbltzfnuhhz`, ikke orange-ferry.
- App læser kun manuelt-satte vars: `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` (Railway-backend) + `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (frontend).
- Integration-injicerede vars (`POSTGRES_URL_NON_POOLING_*`, `NEXT_PUBLIC_*`): nul referencer i kode/CI/config. `NEXT_PUBLIC_*` er endda inert i en Vite-app.

**Fix:** slettede orange-ferry-integrationen i Vercel (Settings → Integrations → Supabase "Billed Via Vercel" → Delete). Redeploy gik READY på 37 s, prod 200, bundle peger stadig på `ghwvkxzhsbbltzfnuhhz`. Ryddede 3 forældreløse `NEXT_PUBLIC_SUPABASE_*`-vars (de ~22 `POSTGRES_URL_NON_POOLING_*` blev auto-fjernet ved sletningen).

**Forward-guard:** fejl-typen kan ikke længere opstå — den flaky provisioning-afhængighed er fjernet permanent. Hvis "Provisioning integrations failed" nogensinde ses igen, betyder det at en NY marketplace-integration er blevet tilføjet; tjek Vercel → Integrations for uventede "Billed Via Vercel"-resources.
