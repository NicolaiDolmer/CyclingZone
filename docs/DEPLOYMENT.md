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
