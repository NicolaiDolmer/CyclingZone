# 2026-10-07 — Cron-heartbeat-alarmen sprængte Discords felt-grænse (CYCLINGZONE-94)

**Symptom:** 6/10 kl. 15:48 (dansk tid) fangede Sentry `Discord webhook 400 (persistent config/routing error)` fra `runCronHeartbeatSweepCron`. Alarmen om forsinkede cron-jobs nåede aldrig #ops.

**Rod-årsag:** Supabase var nede ~15:50 (522/525 via Cloudflare), backend genstartede 15:33, og mange af de 55 overvågede jobs missede check-in samtidig. `buildOverdueEmbed` lagde én linje (~100 tegn) pr. job i ét embed-felt uden loft. Over ~10 jobs sprænger feltet Discords grænse på 1024 tegn, og Discord svarer 400. Fejlteksten "persistent config/routing error" pegede forkert mod en død webhook. Webhooken virker fint.

**Fix:** Linjerne fyldes nu op med hele linjer til grænsen, og resten samles i halen `…og N flere (M i alt)`. Hele payloaden går desuden gennem `clampEmbedPayload` som sidste sikring. Regressionstesten bruger 55 overskredne jobs.

**Læring:** En vagt, der rapporterer mange fejl, skal kunne tåle sit eget værste tilfælde. Det er netop under et bredt udfald, at listen bliver lang. Alle embeds med variabel længde bør gå gennem `discordEmbedLimits.js`. `sendWebhook` klipper ikke selv.
