# Discord-DMs døde tavst: token-drift + env-navn-mismatch + ingen alarm

**Dato:** 2026-06-03
**Symptom:** Ingen Discord-DMs til spillere (overbud, auktion vundet, transfertilbud) i ugevis. Ejer opdagede det tilfældigt.
**PR:** [#1002](https://github.com/NicolaiDolmer/CyclingZone/pull/1002) · **Refs:** #748, #449

## Rod-årsag (tre lag der ramte samtidig)

1. **Token-drift:** Railways `DISCORD_BOT_TOKEN` var ugyldigt (Discord svarede `openDm 401: Unauthorized`). Bot-token var blevet roteret/eksponeret (#745/#748) og den værdi der lå i Railway var død.
2. **Env-navn-mismatch:** Det gyldige token blev (under genopretningen) lagt i Infisical under det kanoniske navn `DISCORD_TOKEN` — men **production-backenden læste kun `DISCORD_BOT_TOKEN`** uden fallback. Alle scripts + MCP brugte allerede `DISCORD_TOKEN || DISCORD_BOT_TOKEN`; backenden var den eneste der var rigid.
3. **Ingen observability:** DM-fejl blev kun logget som `console.error` ([discordNotifier.js](backend/lib/discordNotifier.js)). Ingen Sentry-capture, ingen alarm → fejlen var usynlig indtil en bruger meldte den.

## Hvordan den blev fundet

- Railway-runtime-logs (`railway logs | grep discord-dm`) → `openDm 401`. #449's eksplicitte skip/error-logging gjorde diagnosen triviel.
- Verificerede token-gyldighed UDEN at lække værdien: `railway run -- node scripts/check-discord-bot-token.mjs` (Railway-env injiceret, scriptet printer kun HTTP-status + bot-navn). Samme trick mod Infisical: `infisical run --env=dev --recursive -- node ...`. Det afslørede at dev-Infisical havde et gyldigt token under `DISCORD_TOKEN`, mens prod-Railway havde et dødt under `DISCORD_BOT_TOKEN`.

## Fix

- `getBotToken()` = `DISCORD_BOT_TOKEN || DISCORD_TOKEN` i backenden → ét token under ét navn virker overalt.
- Ejer syncede den gyldige værdi til Railway native `DISCORD_BOT_TOKEN` (config-handling; `railway variables` er hook-blokeret for agenten — køres i ekstern terminal).
- **Forward-guard:** daglig cron (`runDiscordBotTokenCheck`, kører også ved boot) validerer token mod Discord + alerter via Sentry/webhook. Alert-kanalen er webhook-baseret → virker selv om bot-token er dødt.

## Lektioner

1. **Fail-loud på eksterne integrationer.** En `console.error` i en best-effort-sti er ikke observability. Kritiske udgående integrationer (DM, betaling, webhooks) skal have en aktiv health-check der alarmerer — ikke kun passiv logging.
2. **Ét navn, eller tolerér alle navne.** Når flere konsumenter (backend/scripts/MCP) deler ét secret, skal de læse det under samme navn ELLER alle have samme fallback-kæde. Én rigid konsument = tavs fejl.
3. **Verificér secrets uden at læse værdien:** `railway run` / `infisical run` + et status-only script er et sikkert, gentageligt mønster til at validere et token mod dets API uden at dumpe det til transcript.
4. **Config + kode hænger sammen ved rotation.** Token-rotation (#748) skal opdatere ALLE konsumenter atomisk; ellers driver de fra hinanden. En config-drift-guard mangler stadig (#748 step 4 i streng forstand).
