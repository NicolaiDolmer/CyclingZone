# Railway: deploy backenden fra GHCR-image (#7034)

**Status:** imaget bygges og pushes af `.github/workflows/backend-image.yml`. Railway-servicen bygger stadig selv fra GitHub. **Skiftet nedenfor kræver ejerens go.**

## Hvorfor

Railway pausede alle builds fra 21/10 (sikkerhedshændelse, #7029). Backenden kørte videre, men ingen rettelse kunne komme ud. Når GitHub bygger imaget, skal Railway kun hente og starte det. Det rammer ikke de builders, der var nede.

## Hvad findes nu

| Del | Hvor |
|---|---|
| Dockerfile | `backend/Dockerfile.ghcr` (hedder ikke `Dockerfile`, så Railway ikke skifter builder af sig selv) |
| Workflow | `.github/workflows/backend-image.yml`: PR = byg + røgtest, main = byg + røgtest + push |
| Tags | `ghcr.io/nicolaidolmer/cyclingzone-backend:<commit-sha>` og `:main` |
| Røgtest | Node-version = `engines.node`, hele runtime-modulgrafen loader uden devDependencies, kører som brugeren `node` |

## Skiftet (ejer-go pr. skridt)

1. **Gør pakken offentlig** (GitHub → Packages → `cyclingzone-backend` → Package settings → Change visibility → Public). Koden er i forvejen offentligt læsbar, og imaget indeholder ingen hemmeligheder (de kommer som miljøvariabler ved runtime). En offentlig pakke kræver ingen registry-adgangskode i Railway. Det betyder noget her, fordi Railways hændelse også omfattede private registry-credentials. Alternativet er en privat pakke med et GitHub-token i Railway, som skal roteres. *Ikke verificeret:* om Railway-planen tillader private registries.
2. **Notér fallback:** den nuværende kilde (GitHub-repo, root `/backend`) og den aktive deployments commit.
3. **Railway → service CyclingZone → Settings → Source → Docker Image:** `ghcr.io/nicolaidolmer/cyclingzone-backend:<sha>` for den nyeste `<sha>` i GHCR-pakken (se Packages-listen). Commits fra før #7035 har ingen image, og ikke alle commits får ét: workflowet springer commits uden `backend/`-ændringer over, og en hurtig række merges kan erstatte ventende kørsler. **Første skift ruller derfor også den backend-kode ud, som ikke er deployet siden Railway-pausen.** Det er ikke "samme kode, kun ny vej", så kør det som en almindelig deploy med verifikation (skridt 5).
4. **Sæt deploy-indstillingerne manuelt.** `backend/railway.json` læses ikke, når kilden er et image:
   - Healthcheck path `/health`, timeout 60 s
   - Draining 150 s (skal være længere end `SHUTDOWN_TIMEOUT_MS` = 120 s i `server.js`, #4150)
   - Start command: tom (imagets `CMD` er `node --import ./instrument.mjs server.js`)
   - Miljøvariabler: uændrede (de hører til servicen, ikke kilden). `RAILWAY_GIT_COMMIT_SHA` findes ikke ved image-kilde; imaget sætter i stedet `SENTRY_RELEASE` til commit-SHA'en, så Sentry stadig kan knytte fejl til en commit. Sæt ikke `SENTRY_RELEASE` på servicen, så overskrives imagets værdi.
   - Node-patchversionen kan skifte: imaget er låst til 24.22.1 (digest-pinnet), mens Railway i dag selv vælger en 24.x.
5. **Deploy og verificér:** `/health` 200, Sentry uden nye fejl de første 15 min, næste etape-tick afvikles, cron-logs i Railway viser normal start.
6. **Rollback:** sæt Source tilbage til GitHub-repo med root `/backend`. Så gælder `railway.json` igen.

## Efter skiftet (separat ejer-go)

Nye deploys sker ikke af sig selv, når `:main` opdateres. *Ikke verificeret:* om Railway kan auto-opdatere et GHCR-tag. Den sikre vej er et deploy-trin i workflowet, der efter push sætter imaget til `:<sha>` og deployer via Railways API med et nyt `RAILWAY_TOKEN` (det gamle blev ugyldiggjort 22/10). Det bygges først, når skiftet har kørt stabilt. Indtil da: skift tag manuelt i Railway, eller brug "Deploy Latest" på tagget.

Merge-køens deploy-verify (`deploy-verify.yml`) matcher Railways deployment mod commit-SHA. Efter skiftet skal den matche image-tagget. Tjek det ved første merge efter skiftet.
