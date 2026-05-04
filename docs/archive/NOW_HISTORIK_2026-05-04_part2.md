# NOW historik — 2026-05-04 session-batch (S-03 close-out)

Flyttet fra NOW.md ved S-03 close-out (token-disciplin: NOW.md maks 30 linjer).

## Senest leveret (frosset snapshot pre-S-03)
- 2026-05-04 (sen): **S-05 Indbakke-polish (v2.30)** — `backend/lib/inboxPending.js` + `GET /api/inbox/pending` + nyt "Skal handles"-tab i `NotificationsPage` med realtime-subscription på transfer/swap/loan-tabeller. Drift-fix: `activity_feed`-tabel committed til `schema.sql` + idempotent migration (`2026-05-04-activity-feed-schema-commit.sql`, applied via MCP — 467 rows bevaret). Orphan `ActivityFeedPage.jsx` slettet. 10/10 nye unit tests grønne; backend total 125/125
- 2026-05-04: **S-06 Webhook smoke-feedback (v2.28)** — Test-knap pr. webhook viser konkret status inline (✅ Discord 204 + tid / ❌ 404 webhook ikke fundet / ❌ 401 token revoket / ❌ 429 rate-limited). `sendTestEmbed` returnerer struktureret data; loading-key på id i stedet for URL
- 2026-05-04: **Auto-migrate workflow LIVE** — `SUPABASE_DB_URL` Session Pooler URL secret konfigureret (IPv4-krav for GHA)
- 2026-05-04: **UCI name-match fix (v2.27)** — token-set + æ/ø/å-norm + safety-gate; 14 ryttere restitueret
- 2026-05-04: **S-04 Admin-cancel (v2.26)** — `auctionCancellation.js`, 5 unit tests, `auction_cancelled` notification
- 2026-05-04: **S-01 GENERATED column (v2.25)** + **S-01.1 Auto-migrate** + Lint (v2.24.1) + S8.5 (v2.24) + S9a/b (v2.22-23)
