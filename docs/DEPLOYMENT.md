# DEPLOYMENT — Live Targets & Verification

---

## Platformer

| Del | Platform | Bemærkning |
|-----|----------|------------|
| Frontend | Vercel | GitHub-connected projekt |
| Backend | Railway | GitHub-connected service |
| Database/Auth | Supabase | Cloud-hosted |

---

## Aktuelle live-targets

Brug disse som nuværende reference, indtil setup ændres:

- Frontend projekt: `cycling-zone` på Vercel
- Frontend production alias: `https://cycling-zone-git-main-nicolai-dolmers-projects.vercel.app`
- Backend production URL: `https://cyclingzone-production.up.railway.app`
- Backend health route: `GET /health`
- Backend auth-check route: `GET /api/auctions` bør returnere `401 Unauthorized` uden token

Hvis Vercel-projekt, Railway-service eller domæner ændres, skal denne fil opdateres i samme arbejdsgang.

---

## Skew Protection (#2423 P1)

Vite-SPA'en serverer content-hashede chunks. Under et deploy kan en klient på den
gamle `index.html` ramme en edge-node der allerede kører den nye deployment, og
forespørge en chunk der er roteret væk — se #4595/#4545. **Skew Protection**
pinner asset-requests til den deployment klienten kører, og fjerner racet.

Vite/Vite-SPA har ikke indbygget support (kun Next.js/SvelteKit/Nuxt-adapters har
det). Wiret manuelt i `frontend/vite.config.js` via Vites
`experimental.renderBuiltUrl`-hook: når Vercel sætter `VERCEL_SKEW_PROTECTION_ENABLED=1`
+ `VERCEL_DEPLOYMENT_ID` på build-containeren, bærer hver bygget asset-URL
(entry-HTML'ens `<script>`/`<link>` OG chunk-preload-koden bag dynamic `import()`)
`?dpl=<deployment-id>` — Vercels egen dokumenterede mekanisme
(https://vercel.com/docs/skew-protection). Uden begge env-variabler er buildet
100 % uændret.

- **Ejer-skridt (kræves, ikke automatiseret):** slå "Skew Protection" til i
  Vercel-projektets settings → Advanced. Kræver Pro-plan (projektet er allerede
  på Pro).
- **Forward-guard:** `npm run check:skew-protection` (script
  `scripts/check-skew-protection.mjs`) kører efter et build med env sat og
  verificerer at entry-HTML'en (`app.html`/`index.html`) og mindst én dynamisk
  chunk-reference bærer `dpl=`.
- Vercels `headers`/`rewrites`-regler i `frontend/vercel.json` matcher på sti,
  ikke på query-string, så `?dpl=` ødelægger ikke `/assets/(.*)`-cache-headeren
  eller SPA-catch-all-rewriten.
- **Effekt måles:** deploy-verifys chunk-fejl-rate-gate (budget 25/24t,
  `.github/workflows/deploy-verify.yml`) + Sentry CYCLINGZONE-56 en uge efter
  ejerens Vercel-setting er slået til.

---

## Observability env vars

Sentry er canonical error-tracking for browser- og Node-runtime errors. GitHub Actions er canonical for CI/deploy/audit-status, og Supabase audits er canonical for DB/RLS/liveness drift.

| Platform | Env vars |
|---|---|
| Railway backend | `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `SENTRY_RELEASE` eller Railway commit SHA, `SENTRY_TRACES_SAMPLE_RATE` |
| Vercel frontend runtime | `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT=production`, `VITE_SENTRY_RELEASE`, `VITE_SENTRY_TRACES_SAMPLE_RATE`, `VITE_SENTRY_REPLAY_SAMPLE_RATE`, `VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE` |
| Vercel build/source maps | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, optional `SENTRY_RELEASE` |

Source maps uploades kun når alle tre build-secrets (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) er sat. Ellers bygges frontend uden sourcemaps-upload.

---

## Forventet release-path

1. Kør `pwsh -File scripts/verify-local.ps1` fra repo-root
2. Commit ændringerne
3. Push til `origin/main`
4. Kør `pwsh -File scripts/verify-deploy.ps1`
   - Scriptet bekræfter at `HEAD` er `origin/main`
   - Poller GitHub Actions for den aktuelle commit
   - Poller GitHub deployments for Vercel + Railway success
   - Smoke-tester backend `/health` og `/api/auctions`
   - Tjekker at frontend-aliaset svarer (Vercel kan være auth-protected)

Denne fil beskriver den nuværende praksis. Hvis release-flowet flyttes væk fra GitHub-connected auto-deploys, er denne fil stale og skal opdateres.

---

## Lokal verifikation

- `pwsh -File scripts/verify-local.ps1`
- `pwsh -File scripts/agent-doctor.ps1`
- `npm run check:warnings`
- Scriptet stopper hvis mappen ikke er en rigtig git-worktree
- Scriptet kører backend-tests via `node --test`
- Scriptet bygger frontend hvis `frontend/node_modules` findes lokalt
- Hvis frontend-dependencies ikke er installeret lokalt, er GitHub Actions den kanoniske build-gate

---

## Hurtig live-verifikation

Standardkommando:

```powershell
pwsh -File scripts\verify-deploy.ps1
```

Brug `-Sha <commit>` hvis en ældre production-commit skal verificeres eksplicit.

### Frontend
- Find seneste production deployment for Vercel-projektet `cycling-zone`
- Bekræft commit SHA og commit message matcher den push, der lige er lavet
- Bekræft deployment state = `READY`
- Bekræft at frontend-build job i GitHub Actions er grønt for samme commit

### Backend
- `GET https://cyclingzone-production.up.railway.app/health` bør returnere succes eller app-specifik status
- `GET https://cyclingzone-production.up.railway.app/api/auctions` uden auth bør returnere `401 Unauthorized`
- Hvis en auth-gatet route returnerer `404` eller `5xx`, er deploy ikke godkendt
- Bekræft at backend-test job i GitHub Actions er grønt for samme commit

### App smoke
- Frontend loader uden blank page
- Login virker
- Minst ét berørt flow kan sanity-checkes mod live backend

---

## Standard noter ved deploy

- Vercel fortæller typisk hurtigst, om frontend-committen er live
- Railway skal verificeres separat; en vellykket Vercel-deploy er ikke bevis for at backend-fixet er live
- For backend-bugfixes bør en live deploy først betragtes som verificeret, når Railway svarer som forventet

---

## Hvornår Railway deployer (watch paths, #4150)

Alt styres fra `backend/railway.json`. Før 30/8 stod der ingen filtrering, så **hver** commit på main rev backenden ned og byggede den igen. Målt på de 25 seneste produktions-deploys 30/8 rørte 16 af dem ikke én fil under `backend/`.

`build.watchPatterns` er gitignore-lignende mønstre. De evalueres fra **repo-roden**, også selvom servicens root directory er `/backend` (Railways egen dokumentation: "if a Root Directory is provided, patterns still operate from `/`").

| Mønster | Betydning |
|---------|-----------|
| `**` | Deploy på alt. Skal stå **først** |
| `!/docs/**` | Ikke deploy på docs |
| `!/pr-screens/**` | Ikke deploy på PR-screenshots |
| `!/superpowers/**` | Ikke deploy på planer og specs |
| `!/.claude/**` | Ikke deploy på agent-config og learnings |
| `!/*.md` | Ikke deploy på markdown i repo-roden (AGENTS.md, CLAUDE.md, README.md ...) |

To regler der ikke må brydes:

1. **`**` skal blive stående som første mønster.** Railway: "negations will only work if you include files in a preceding rule". Fjernes den, matcher intet, og backenden deployer aldrig igen.
2. **Exclude-listen udvides kun med stier der beviseligt ikke læses af backend-runtime.** Er du i tvivl, så lad være. En manglende deploy koster mere end en overflødig. Frontend-ændringer er bevidst **ikke** ekskluderet.

Begge regler er testdækket i `backend/railway.deployConfig.test.js`, som også afviser mønster-former den ikke kender.

### Hvis en deploy udebliver

Symptom: en backend-ændring er merget til main, men Railway viser ingen ny deployment.

1. Se om der overhovedet er en ny deployment (Railway, service CyclingZone, fanen Deployments). Ingen ny betyder at watch paths har filtreret den fra.
2. Rollback: fjern `build`-blokken fra `backend/railway.json` og push. Så er adfærden præcis som før 30/8, altså deploy på alt.
3. Hastende alternativ uden kode-ændring: tryk Redeploy på servicen i Railway. Dashboard-feltet Settings, Build, Watch Paths bruges kun når `railway.json` ikke sætter feltet, så det skal ikke bruges til at overstyre.

---

## Nedlukningsvindue ved deploy (#4150)

Ved et deploy sender Railway SIGTERM til den gamle proces, så snart den nye er aktiv. To tal styrer hvor længe den gamle må gøre sit arbejde færdigt:

| Tal | Sted | Værdi |
|-----|------|-------|
| `deploy.drainingSeconds` | `backend/railway.json` | 150 sekunder, fra SIGTERM til SIGKILL |
| `SHUTDOWN_TIMEOUT_MS` | `backend/server.js` | 120 sekunder, hvor længe koden venter på cron-ticks |

Railways default for drain er **0 sekunder**: SIGTERM blev fulgt af SIGKILL uden ophold, så de 30 sekunder server.js ventede på cron-ticks aldrig nåede at betyde noget. Et løb tager 90 til 110 sekunder at afslutte, derfor 120 i koden, og 150 hos Railway så processens eget `process.exit(0)` altid vinder over SIGKILL. Beviset i deploy-loggen er linjen `[shutdown] alle cron-ticks afsluttet`.

De 150 sekunder er samtidig et vindue hvor den gamle og den nye proces kører side om side. Derfor stopper `gracefulShutdown` planlægningen af nye cron-ticks (`stopCronScheduling()` i `backend/cron.js`) **før** den venter. Igangværende ticks gøres færdige, nye startes ikke. Rækkefølgen er testdækket i `backend/cron.shutdownGuard.test.js`.

**Kendt gæld:** Railways config-as-code (`railway.json`) er markeret deprecated med udløb 2026-12-01 til fordel for Infrastructure as Code. Begge felter ovenfor skal migreres inden da, ellers falder de tilbage til dashboard-værdierne.
