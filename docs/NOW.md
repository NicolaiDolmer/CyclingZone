# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Session lukket 2026-05-04.** Leveret: S-06 Webhook smoke-feedback (v2.28). Test-knap pr. webhook returnerer struktureret status (✅ leveret/❌ 404/401/429-diagnose + tidsstempel) inline pr. row. Backend `sendTestEmbed` returnerer `{ok,status,error}` i stedet for at kaste. Health-check cron flyttet til P1 Drift-monitor.

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. **P0-status: 2/6 leveret (S-04, S-06).** Launch-dato: åben.

## Senest leveret
- 2026-05-04: **S-06 Webhook smoke-feedback (v2.28)** — Test-knap pr. webhook viser konkret status inline (✅ Discord 204 + tid / ❌ 404 webhook ikke fundet / ❌ 401 token revoket / ❌ 429 rate-limited). `sendTestEmbed` returnerer struktureret data; loading-key på id i stedet for URL. Manuel verifikation: admin klikker Test pr. webhook i AdminPage → fixer evt. dårlige URLs i samme session
- 2026-05-04: **Auto-migrate workflow LIVE** — `SUPABASE_DB_URL` Session Pooler URL secret konfigureret (IPv4-krav for GHA)
- 2026-05-04: **UCI name-match fix (v2.27)** — token-set + æ/ø/å-norm + safety-gate; 14 ryttere restitueret
- 2026-05-04: **S-04 Admin-cancel (v2.26)** — `auctionCancellation.js`, 5 unit tests, `auction_cancelled` notification
- 2026-05-04: **S-01 GENERATED column (v2.25)** + **S-01.1 Auto-migrate** + Lint (v2.24.1) + S8.5 (v2.24) + S9a/b (v2.22-23)
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **Manuel smoke-kvittering S-06** — admin klikker Test på alle live webhooks i AdminPage; fix evt. fejl samme session
2. **S-03 Trupstørrelse-håndhævelse** (D1 20-30, D2 14-20, D3 8-10) — kræver `riders.acquired_at` migration først (5 min)

## Kritiske invarianter
- **Verificér runtime FØR claim** (etableret 2026-05-04) — grep koden før du listet noget som TODO/bug
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76 + v2.25: `SALARY_RATE = 0.10` (nu i DB-formel), sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- **`riders.salary` er GENERATED** — kan IKKE skrives fra application-kode efter v2.25-deploy; DB beregner fra `uci_points` + `prize_earnings_bonus`
- **UCI-sync må aldrig nulle high-value ryttere** — popularity ≥ 70 OR uci_points ≥ 100 er auto-protected; token-set-match + æ/ø/å-norm i `scripts/uci_scraper.py` + `backend/lib/sheetsSync.js` skal forblive byte-equivalent
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits: D1 20-30, D2 14-20, D3 8-10 — håndhæves S-03
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
