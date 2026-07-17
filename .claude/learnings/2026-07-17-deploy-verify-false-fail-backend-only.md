# Deploy-verify falsk ❌ på backend-only merges (Ignored Build Step)

**Dato:** 2026-07-17 · **PR:** #2559 · **Symptom-eksempel:** a7c63d41 (PR #2545)

## Root cause
`deploy-verify.yml` krævede ubetinget BÅDE Vercel- og Railway-success efter merge
til main. Men `frontend/vercel.json` har en `ignoreCommand` der bevidst canceller
Vercel-builds når `HEAD^..HEAD` ikke rører `frontend/` (deploy-quota guard).
Backend-only commits fik derfor aldrig en Vercel-deployment → 10-min-timeout →
exit 1 → falsk "❌ Deploy-verify FEJLEDE"-kommentar, selv om Railway var success
og alle smoke-tests grønne.

## Fix
Nyt step spejler ignoreCommand-logikken via commit'ets ændrede filer: Vercel
kræves kun ved `frontend/`-ændringer, Railway kun ved `backend/`-ændringer;
fallback = kræv begge hvis fil-listen ikke kan hentes. Sentry source-map-guarden
gates også på `need_vercel` (ingen Vercel-build = ingen ny release = 404 er
forventet).

## Læring
1. **To pipelines med hver sin skip-logik må ikke verificeres med én ubetinget
   AND-gate.** Når en deploy-platform har conditional builds (ignoreCommand,
   watch paths), skal verifikations-jobbet kende SAMME betingelse — ellers er
   "vent på begge" en tidsindstillet falsk alarm.
2. **Følgefejl-tjek ved gate-fixes:** at fjerne den første falske fejl (wait-
   loopet) ville have eksponeret den næste (Sentry-guard 404 på manglende
   frontend-release). Gennemgå ALLE downstream-steps der implicit antager at
   begge deploys skete.
3. Verificér den slags fixes i begge retninger mod rigtige commits via API
   (backend-only → grøn, frontend-only → kræver stadig Vercel) — kan gøres
   lokalt uden at vente på næste merge.
