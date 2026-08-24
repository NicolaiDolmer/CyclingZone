# Postmortem · 2026-08-23 · Docs-commits redeployede backenden midt i løbsheatet

## Hvad skete der?

Ejeren spurgte hvorfor 18:00-etaperne var voldsomt forsinkede. Division 14 og 15 kørte først 45 minutter efter deres slot, og Gran Premio de Llanera division 9 stod i 25 minutter med 168 resultater, `stages_completed=1` og `status='scheduled'` samtidig. Mistanken var databasen.

## Root cause

**Ikke databasen.** Supabase var i tomgang under hele forløbet: 2 aktive forbindelser, ingen ventende låse, p95 108 ms, 0 fejl på 1,07 mio. requests i døgnet.

Backenden blev redeployet **5 gange mellem 17:58 og 18:32**, midt i heatet:

```
17:58:56  696c415cb  docs(cutover): fire fund til aftenens S2->S3-prompt
18:05:51  5a3e11212  docs(agents): hard rule 29
18:26:07  660ceb17f  docs(cutover): rettet raekkefoelge
18:27:39  2f1ded1fa
18:32:11  cc5eda862
```

Tre af de fem var **rene docs-commits**. `backend/railway.json` har ingen watch paths, så Railway bygger og redeployer på alt der lander på main. Hver genstart koster ~6 minutter i opstarts-sweeps før afviklingen fortsætter.

Graceful shutdown findes i `backend/server.js:106` og venter op til 30s på igangværende cron-ticks, men deployment `e230f2c3` logger:

```
16:26:49  [shutdown] SIGTERM received
16:26:49  [shutdown] venter på 2 cron-tick(s) (timeout 30000ms)
16:26:49  [shutdown] HTTP server lukket
```

og aldrig den afsluttende `alle cron-ticks afsluttet` eller `timeout`-linje som de øvrige deploys skriver. Railway dræbte processen før dens egen ventetid var udløbet. Og 30s ville alligevel ikke have rakt: et løb tager 90-110s at afslutte.

**Forstærkende faktor:** afslutningen er langsom fordi den er netværksbundet, ikke CPU-bundet. 148.681 backend-requests til Supabase på én time (28.990 GET race_results, 25.562 PATCH riders, 13.934 GET teams) mens Railway-CPU'en lå på 16 %. Jo længere et løb tager, jo større er sandsynligheden for at en genstart rammer midt i det.

## Fix

Ingen kode ændret. Diagnosen er omsat til fire issues med målingerne indlejret:

- **#4147** løbs-afslutning er ikke atomar (`priority:high`, `needs-decision`)
- **#4148** profilér de 148.681 requests/time før optimering (`priority:high`)
- **#4149** adskil race-motor fra web-API (`priority:low`, venter bevidst på 4147+4148)
- **#4150** watch paths + nedlukningsvindue (`priority:med`)

Division 9 blev **ikke** repareret manuelt. Ejeren gav go, men da rækken blev hentet for at vise før-og-efter, havde status allerede flippet selv, og auto-prize-sweep'en betalte løbet 18:57:41. Ingen prod-mutation kørt.

## Forhindret-fremover

Watch paths (#4150) er den billige del. Den fjerner 3 af dagens 5 genstarter og tager fem minutter.

**Men den må ikke føles som løsningen.** De 2 resterende deploys var ægte backend-ændringer, og de ødelagde data på nøjagtig samme måde. Watch paths sænker sandsynligheden; konsekvensen er uændret. Robusthed ligger i #4147: en genstart skal være en ikke-begivenhed, uanset om den kommer fra en deploy, et nedbrud, OOM eller Railway-vedligehold.

## Læring

**Tre ting værd at tage med:**

1. **"Databasen er langsom" var forkert i tre led.** DB'en var i tomgang, backenden var CPU-idle, og flaskehalsen var antallet af netværks-rundture. Mål alle tre lag før du peger på ét. Symptomet lå i Supabase-loggen, årsagen lå i Railways deploy-historik.

2. **Vores egen close-out-regel var årsagen.** Reglen om at committe og pushe docs efter hver session udløste tre af de fem genstarter. En proceshygiejne-regel blev til en driftsforstyrrelse fordi ingen havde forbundet "docs-commit" med "backend-deploy". Værd at spørge om andre af vores rutiner har utilsigtede driftskonsekvenser.

3. **Vent med prod-mutationen til du har hentet rækken.** Der var go til at rette division 9. Rutinen "hent rækken først, så ejeren kan se før-og-efter" fangede at problemet havde løst sig selv. Uden det skridt var der kørt en unødvendig UPDATE på prod under et cutover.
