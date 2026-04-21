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

1. Verificér lokale checks for berørt scope
2. Commit ændringerne
3. Push til `origin/main`
4. Bekræft at Vercel har bygget seneste commit til `READY`
5. Bekræft at Railway-backenden svarer på `GET /health` og mindst én auth-gatet route

Denne fil beskriver den nuværende praksis. Hvis release-flowet flyttes væk fra GitHub-connected auto-deploys, er denne fil stale og skal opdateres.

---

## Hurtig live-verifikation

### Frontend
- Find seneste production deployment for Vercel-projektet `cycling-zone`
- Bekræft commit SHA og commit message matcher den push, der lige er lavet
- Bekræft deployment state = `READY`

### Backend
- `GET https://cyclingzone-production.up.railway.app/health` bør returnere succes eller app-specifik status
- `GET https://cyclingzone-production.up.railway.app/api/auctions` uden auth bør returnere `401 Unauthorized`
- Hvis en auth-gatet route returnerer `404` eller `5xx`, er deploy ikke godkendt

### App smoke
- Frontend loader uden blank page
- Login virker
- Minst ét berørt flow kan sanity-checkes mod live backend

---

## Standard noter ved deploy

- Vercel fortæller typisk hurtigst, om frontend-committen er live
- Railway skal verificeres separat; en vellykket Vercel-deploy er ikke bevis for at backend-fixet er live
- For backend-bugfixes bør en live deploy først betragtes som verificeret, når Railway svarer som forventet
