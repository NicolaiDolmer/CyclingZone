# Slice S-06 · Webhook smoke-verifikation

**Status:** ✅ P0 smoke-tool leveret v2.28 (2026-05-04). Runtime-verificeret 2026-05-05. Health-check cron er ikke leveret og er P1/Drift-monitor.

## Leveret og verificeret

- Commit: `9396a6f Feat: S-06 Webhook smoke-feedback (v2.28)`.
- Backend: `backend/routes/api.js` har `POST /api/admin/discord/test`, som kalder `sendTestEmbed(webhook_url)`.
- Discord helper: `backend/lib/discordNotifier.js` har `sendTestEmbed(webhookUrl)` med struktureret `{ ok, status, error }` feedback.
- Frontend: `frontend/src/pages/AdminPage.jsx` læser `discord_settings`, viser Test-knap pr. webhook-row, kalder `/api/admin/discord/test` og formatterer 404/401/403/429-resultater inline.
- Syntax-check 2026-05-05: `node --check backend/routes/api.js` og `node --check backend/lib/discordNotifier.js` grønne.

**Ikke leveret:** daglig webhook health-check i `cron.js`. `git grep` finder kun health-check-beskrivelsen i denne slice-doc, ikke runtime-kode. Den er derfor ikke P0-done; den hører til P1 Drift-monitor/ops.

---

## Original brief (bevaret som historik)

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

1. **Backend `POST /api/admin/discord/test`:**
   - Runtime-note 2026-05-05: leveret endpoint tager `webhook_url` i body; original id-baseret route blev ikke brugt.
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

### P1 Sundhed-check (ikke leveret i S-06)

5. **Ikke leveret i runtime 2026-05-05:** daglig webhook health-check i `backend/cron.js`
   - For hver webhook i `discord_settings`: ping Discord API GET /webhooks/:id (returnerer 200 hvis valid)
   - Hvis fejler 2x i træk → admin-notifikation in-app + DM (hvis konfigureret) + log entry
   - Forhindrer "stille død" som vi havde mistanke om

## Verification path

1. **I AdminPage:** Test-knap fyrer testbesked → verificér i Discord
2. **Negativt:** Indsæt forkert URL i discord_settings → verificér at Test-knap viser konkret Discord-fejl
3. **P1 separat:** Health-check kræver ny Drift-monitor slice før cron/manual health-table-verifikation kan køres

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
