# Nedlukningsvinduet var kosmetik i tre måneder (#4150)

**Dato:** 2026-08-31
**Issue:** #4150 (relateret: #4147, #4149)

## Symptom

Docs-commits redeployede backenden midt i løb. Hver genstart koster cirka 6 minutter i opstarts-sweeps før afviklingen kan fortsætte. 23/8 skete det fem gange mellem 17:58 og 18:32, midt i 18:00-heatet.

## Målt tilstand 30/8

De 25 seneste produktions-deploys: **16 rørte ikke én fil under `backend/`**. Elleve var rene docs- eller patch-notes-commits, fem var rene frontend-commits. `backend/railway.json` indeholdt ingen `build.watchPatterns`, så Railway byggede på alt.

## Rod-årsag, del 2 (den ikke-åbenlyse)

`backend/server.js` havde siden marts en pæn `gracefulShutdown` der ventede op til 30 sekunder på igangværende cron-ticks. Den ventetid har **aldrig** virket. Railways `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` har default **0**: SIGTERM følges af SIGKILL uden ophold. Processen blev dræbt længe før den nåede at vente.

Læringen: en graceful shutdown i koden er kun halvdelen. Den anden halvdel bor hos platformen, og hvis de to tal ikke kender hinanden, er koden ren dekoration. Ingen test og intet review fangede det, fordi begge halvdele så rigtige ud hver for sig.

## Andet fund undervejs

`gracefulShutdown` stoppede aldrig planlægningen af nye ticks. Den kaldte `server.close()` og ventede, men de cirka 30 `setInterval`-timere i `cron.js` blev ved med at fyre. Med et 0-sekunders drain var det usynligt. Havde vi bare hævet drain-vinduet til 150 sekunder uden at rette det, ville den gamle proces have fyret nye ticks i hele vinduet, parallelt med den nye proces, som Railway allerede havde gjort aktiv. Vi ville have byttet ét problem for et værre.

## Fix

1. `build.watchPatterns` i `backend/railway.json`: `**` efterfulgt af negationer for `docs/`, `pr-screens/`, `superpowers/`, `.claude/` og markdown i repo-roden. Bevidst konservativt. Frontend er ikke ekskluderet.
2. `deploy.drainingSeconds: 150` i `railway.json`, `SHUTDOWN_TIMEOUT_MS` hævet fra 30s til 120s i `server.js`. Et løb tager 90 til 110 sekunder. De 30 sekunders luft mellem de to tal sikrer at `process.exit(0)` altid vinder over SIGKILL.
3. `stopCronScheduling()` i `cron.js`, kaldt fra `gracefulShutdown` **før** ventetiden. Vagten sidder i `trackedTick`, så den dækker både intervaller og boot-run-kald ét sted.

## Forward-guard

`backend/railway.deployConfig.test.js`:

- `**` skal stå først, ellers matcher ingen negationer og backenden deployer aldrig igen
- hver exclude skal stå på en godkendt liste over runtime-irrelevante stier
- repræsentative backend-, database-, frontend- og lockfile-stier skal stadig udløse deploy
- `drainingSeconds` skal være **strengt større** end `SHUTDOWN_TIMEOUT_MS`, så de to tal ikke kan glide fra hinanden igen
- `SHUTDOWN_TIMEOUT_MS` skal dække et løb på 110 sekunder
- mønster-former testen ikke kender får den til at kaste, så et nyt mønster kræver at et menneske har taget stilling

`backend/cron.shutdownGuard.test.js` dækker at igangværende ticks gøres færdige, og at nye ikke startes efter SIGTERM.

## Det her løser ikke problemet

Sandsynligheden for at et deploy rammer et løb falder. Konsekvensen er uændret. De to ægte backend-deploys 23/8 ødelagde data på nøjagtig samme måde, og de ville stadig deploye i dag. Rigtig robusthed ligger i #4147. En deploy-vagt der afviser deploys i løbsvinduer (#4149) er stadig en åben ejer-beslutning.
