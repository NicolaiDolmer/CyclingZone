# Slice S-06 · Webhook smoke-verifikation

**Status:** P0, ikke startet. Opdateret 2026-05-04. Downgraded fra "fix" til "smoke-test" efter brugeren bekræftede at de ikke har set webhook fejle for nylig.

## Mål
Verificér at alle Discord-webhooks fungerer end-to-end på live-system. Fejler en → fix samme session.

## Runtime-evidens
- [backend/lib/discordNotifier.js](backend/lib/discordNotifier.js) — webhook + DM-funktioner
- [backend/routes/api.js](backend/routes/api.js) — admin webhook CRUD endpoints
- [database/2026-04-23-discord-settings.sql](database/2026-04-23-discord-settings.sql) — `discord_settings`-tabel med types `general` og `transfer_history`
- Webhooks fyrer ved: ny auktion (general), gennemført transfer (transfer_history), final whistle (general), sæson-events (general), DD-warnings (general)
- Audit-fund 2026-05-04: cron.js bruger discordNotifier med `.catch(() => {})`-pattern → fejl-håndtering er stille (ingen alarm hvis webhook 404'er)

## Invariant der beskyttes
- Webhook-fejl må aldrig blokere business transaction (best-effort try/catch).
- Discord DM-fejl må aldrig blokere transaction (eksisterende invariant fra NOW.md).

## Minimal change

### Smoke-test-værktøj (lever altid, ikke kun nu)

1. **Backend `POST /api/admin/discord-webhooks/:id/test`:**
   - Allerede eksisterende `POST /api/me/discord-dm-test` kan genbruges som mønster
   - Send test-embed til den specifikke webhook URL
   - Returner `{ok: true, status: 200}` eller `{ok: false, error: "Discord 404"}`
2. **Frontend `AdminPage.jsx` Discord-sektion:**
   - Pr. webhook-row: "Test"-knap der kalder endpointet
   - Vis resultat (✅ med timestamp eller ❌ med fejlmeddelelse)

### Smoke-tjek (kører ÉN gang som verifikation)

3. **Manuelt:** Admin trykker Test på alle webhooks → verificerer at hver type lander i korrekt Discord-kanal
4. **Hvis fejler:**
   - 404 → webhook-URL er forældet → admin opdaterer
   - 401/403 → token revoket → admin opdaterer
   - Andet → log error → fix iterativt

### Sundhed-check (loop)

5. **`backend/cron.js`** ny `processWebhookHealthCheck` (kører dagligt):
   - For hver webhook i `discord_settings`: ping Discord API GET /webhooks/:id (returnerer 200 hvis valid)
   - Hvis fejler 2x i træk → admin-notifikation in-app + DM (hvis konfigureret) + log entry
   - Forhindrer "stille død" som vi havde mistanke om

## Verification path

1. **I AdminPage:** Test-knap fyrer testbesked → verificér i Discord
2. **Health-check:** Kør cron manuelt → verificér health-table opdateres
3. **Negativt:** Indsæt forkert URL i discord_settings → verificér health-check alarmerer

## Out of scope
- Webhook-rotation/auto-renewal (Discord webhooks udløber ikke).
- Multiple webhook-targets pr. type (allerede understøttet via `discord_settings`).

## Forudsætninger
- Ingen.

## Risiko og mitigation
- **Risiko:** Health-check rate-limiter os hos Discord.
- **Mitigation:** Daglig (ikke 5-min) cron, max 5 webhooks samlet → langt under rate-limit.

## Estimat
0.5 session for smoke-tool. +0.5 session hvis fix nødvendig. Total max 1 session.
