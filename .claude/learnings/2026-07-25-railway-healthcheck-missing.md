# 2026-07-25 — Railway healthcheckPath manglede, brækkede deploys blev promoveret

## TL;DR
`backend/railway.json` havde kun `startCommand` — intet `healthcheckPath`. Railway
erklærer et deploy sundt så snart containeren binder porten, uanset om appen reelt
kan svare på requests. `/health` fandtes allerede (`server.js:61`) men blev aldrig
kaldt af Railway. Fundet i driftsaudit 25/7 (#2899) ved simpel grep: 0 hits på
`healthcheckPath` i hele repoet.

## Rod-årsag
Config-as-code (`railway.json`) blev sat op med kun `startCommand` da backend først
blev deployet til Railway — healthcheck blev aldrig tilføjet efterfølgende, og intet
i CI/audit fangede fraværet før den manuelle driftsaudit.

## Fix
1. `backend/railway.json`: tilføjet `deploy.healthcheckPath: "/health"` +
   `deploy.healthcheckTimeout: 60` (Railways config-as-code-schema, verificeret mod
   `docs.railway.com/config-as-code/reference`).
2. `backend/server.js`: `/health` er udvidet til at lave en triviel Supabase
   round-trip (`HEAD`-count mod `app_config`) med 3s per-forsøg-timeout via
   `AbortController`, så en død DB-forbindelse rent faktisk fanges (issuets
   sekundære forslag). Uden DB-round-trip ville en proces uden DB-adgang stadig
   have svaret 200.

## Trade-off / scope-guard
Railway poller `/health` gentagne gange under et deploy indtil enten 200 eller
`healthcheckTimeout` udløber — det er IKKE continuous monitoring
(`docs.railway.com/deployments/healthchecks`). Den korte 3s interne DB-timeout
sikrer at ét enkelt langsomt DB-kald aldrig hænger et forsøg; det 60s
`healthcheckTimeout`-vindue giver Railway ~20 gen-forsøg, så en midlertidigt
langsom (men i bund og grund sund) DB ikke fejler deployet permanent — kun en
DB der er nede/utilgængelig i hele 60s-vinduet gør.

## Forward-guard
- Enhver ny Railway-service bør have `healthcheckPath` sat i `railway.json` fra
  dag 1 — tilføj til deploy-checklisten hvis flere services kommer til.
- Health-endpoints der ikke rører DB skjuler "proces kører men er reelt død"-
  fejl; foretræk en let round-trip med kort intern timeout frem for en ren
  "process alive"-check.

## Bør i HOT memory?
Nej — engangs-ops-gap, ikke et gentaget mønster endnu.
