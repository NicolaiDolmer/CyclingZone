# Deadline Day S1–S4 — Code-level audit (2026-05-03)

**Formål:** Erstatte den del af manuel soak-gate som kan automatiseres. UI-visuel verifikation (fase-farver, ticker-scroll, badge-rendering) kræver browser+admin-auth og er udskudt til separat UI-smoke.

**Resultat (oprindelig):** 22 invarianter ✅ verificeret · 1 ❌ afviger (manglende DB-migration for `auctions.is_flash`) · 4 ⚠ pending UI-smoke.

**Resultat (efter follow-up 2026-05-04):** 23 invarianter ✅ verificeret · 0 ❌ · 4 ⚠ pending UI-smoke. Schema-divergens lukket via [database/2026-05-04-auctions-is-flash.sql](../../database/2026-05-04-auctions-is-flash.sql) + opdaterede `schema.sql` / `supabase_setup.sql` / `setup.py` + regression-test i [backend/lib/auctionSchemaContract.test.js](../../backend/lib/auctionSchemaContract.test.js) (`auction schema includes is_flash column for Deadline Day flash auctions`). Live Supabase havde allerede kolonnen (verificeret via `information_schema.columns` — `boolean NOT NULL DEFAULT false`); fixet er rent source-side så schema-driven setup + tests matcher live tilstand.

---

## S1 — Banner + admin-toggle

| Invariant | Status | Reference |
|---|---|---|
| Schema: `transfer_windows.closes_at` (timestamptz, nullable) | ✅ | [database/2026-05-02-deadline-day.sql:3](../../database/2026-05-02-deadline-day.sql) `ADD COLUMN IF NOT EXISTS closes_at TIMESTAMPTZ` |
| Schema: `auction_timing_config.deadline_day_override` (text/enum) | ✅ | [database/2026-05-02-deadline-day.sql:6-8](../../database/2026-05-02-deadline-day.sql) `TEXT NOT NULL DEFAULT 'auto' CHECK (deadline_day_override IN ('auto','on','off'))` |
| `GET /api/deadline-day/status` fase-aware afh. af `(closes_at - now)` | ✅ | [backend/routes/api.js:314-358](../../backend/routes/api.js). `computeDeadlineDayPhase`: chaos≤30min, pressure≤2h, anticipation≤24h |
| Override-håndtering: off→inactive, on→active+pressure-fallback, auto→åbent vindue + ≤24h | ✅ | [backend/routes/api.js:331-356](../../backend/routes/api.js) |
| `DeadlineDayBanner` rendres i `Layout` | ✅ | [frontend/src/components/Layout.jsx:318](../../frontend/src/components/Layout.jsx) (over Outlet, under header-row) |
| Banner-fase-class mapping (amber/rød/pulserende) | ⚠ pending UI-smoke | [DeadlineDayBanner.jsx:6-28](../../frontend/src/components/DeadlineDayBanner.jsx) — `anticipation`=bg-cz-accent (amber), `pressure`=bg-red-900, `chaos`=bg-red-950+animate-pulse. Code-mapping korrekt; visuel verifikation mangler |
| Admin: `PUT /api/admin/deadline-day/override` | ✅ | [backend/routes/api.js:2447-2459](../../backend/routes/api.js) — validerer `auto\|on\|off`, opdaterer `auction_timing_config` |
| Admin: `PUT /api/admin/transfer-window/closes-at` | ✅ | [backend/routes/api.js:2462-2474](../../backend/routes/api.js) — opdaterer seneste vindue |

**S1 status:** ✅ kode-niveau intakt; visuel banner-styling pending UI-smoke.

---

## S2 — Ticker + Panic Board

| Invariant | Status | Reference |
|---|---|---|
| `GET /api/deadline-day/ticker` returnerer event-array | ✅ | [backend/routes/api.js:361-408](../../backend/routes/api.js). Henter bids/sold/transfers seneste 24h, sorterer descending timestamp, returnerer max 20 events |
| `GET /api/deadline-day/squads` returnerer status grøn/gul/rød | ✅ | [backend/routes/api.js:411-431](../../backend/routes/api.js). Returnerer `critical\|warning\|ok` (semantisk rød/gul/grøn). Frontend mapper til `cz-danger`/`cz-warning`/`cz-success` ([DeadlineDayBoard.jsx:7-11](../../frontend/src/pages/DeadlineDayBoard.jsx)) |
| `DeadlineDayTicker` poll = 10s | ✅ | [DeadlineDayTicker.jsx:49](../../frontend/src/components/DeadlineDayTicker.jsx) — `setInterval(fetchTicker, 10_000)` (status-poll separat på 60s) |
| `DeadlineDayBoard` (`/deadline-day` route) poll = 30s | ✅ | [DeadlineDayBoard.jsx:79](../../frontend/src/pages/DeadlineDayBoard.jsx) — `setInterval(load, 30_000)` |
| `/deadline-day` route registreret | ✅ | [frontend/src/App.jsx:140](../../frontend/src/App.jsx) — `<Route path="deadline-day" element={<DeadlineDayBoard />} />` |
| Ticker scroll-animation rendres som `animate-ticker` | ⚠ pending UI-smoke | [DeadlineDayTicker.jsx:59](../../frontend/src/components/DeadlineDayTicker.jsx). Klassen findes; visuel scroll-effekt kræver browser |

**S2 status:** ✅ kode-niveau intakt; ticker-scroll-effekt pending UI-smoke.

---

## S3 — Flash Auction + hastebudsignal

| Invariant | Status | Reference |
|---|---|---|
| **`auctions.is_flash` kolonne** | **✅ rettet 2026-05-04** | Live Supabase havde allerede kolonnen (`boolean NOT NULL DEFAULT false`). Source-divergens lukket: [database/2026-05-04-auctions-is-flash.sql](../../database/2026-05-04-auctions-is-flash.sql) (idempotent `ADD COLUMN IF NOT EXISTS`) + `is_flash` tilføjet til [database/schema.sql](../../database/schema.sql), [database/supabase_setup.sql](../../database/supabase_setup.sql), [setup.py](../../setup.py). Regression-test sikrer at alle tre schema-filer beholder kolonnen ([backend/lib/auctionSchemaContract.test.js](../../backend/lib/auctionSchemaContract.test.js) — `auction schema includes is_flash column for Deadline Day flash auctions`). Tidligere koderef. står stadig: INSERT i [backend/routes/api.js:725](../../backend/routes/api.js); SELECT i [AuctionsPage.jsx:417](../../frontend/src/pages/AuctionsPage.jsx) |
| Guard i `POST /api/auctions`: kun under aktiv DD → `is_flash=true` + 30 min varighed | ✅ | [backend/routes/api.js:609-624](../../backend/routes/api.js) — afviser med 403 hvis DD ikke aktiv. [api.js:679-681](../../backend/routes/api.js): `flash_auction ? new Date(Date.now() + 30 * 60 * 1000) : calculateAuctionEnd(...)` |
| Hastebudsignal: 🚨-badge på offers når sælgerhold ≤ divisionsminimum (rødt) | ✅ | Server beregner `seller_squad_critical` ([api.js:1107-1129](../../backend/routes/api.js)) ved `riderCounts[teamId] <= SQUAD_MINS[division]` (D1=20, D2=14, D3=8). Badge rendres på sendte ([TransfersPage.jsx:71-73](../../frontend/src/pages/TransfersPage.jsx)) og modtagne ([:225-227](../../frontend/src/pages/TransfersPage.jsx)) tilbud |
| Flash-badge `⚡ Flash` på auktioner | ✅ | [AuctionsPage.jsx:152, :297](../../frontend/src/pages/AuctionsPage.jsx) — rendres bag `auction.is_flash` |

**Fix shippet 2026-05-04:** [database/2026-05-04-auctions-is-flash.sql](../../database/2026-05-04-auctions-is-flash.sql) (`ADD COLUMN IF NOT EXISTS`) + tre schema-filer opdateret (schema.sql, supabase_setup.sql, setup.py) + regression-test i auctionSchemaContract.test.js. Live-DB-tilstand var allerede `boolean NOT NULL DEFAULT false` (verificeret før fix); migrationen er no-op mod live, men nødvendig for fresh setups + schema-tooling.

**S3 status:** ✅ schema-divergens lukket; resten af S3 ✅ intakt.

---

## S4 — Notifikationer + Final Whistle

| Invariant | Status | Reference |
|---|---|---|
| Schema: `transfer_windows.final_whistle_sent_at` (timestamptz) for atomic claim | ✅ | [database/2026-05-02-deadline-day-final-whistle.sql:5](../../database/2026-05-02-deadline-day-final-whistle.sql) |
| Notifications.type CHECK udvidet med `deadline_day_warning` | ✅ | [database/2026-05-02-deadline-day-final-whistle.sql:9-18](../../database/2026-05-02-deadline-day-final-whistle.sql) |
| Pure funcs i `backend/lib/deadlineDayReport.js` | ✅ | `getDueWarningSteps` ([:17-23](../../backend/lib/deadlineDayReport.js)), `buildWarningPayload` ([:25-37](../../backend/lib/deadlineDayReport.js)), `computeFinalWhistleReport` ([:39-92](../../backend/lib/deadlineDayReport.js)), `formatFinalWhistleEmbed` ([:94-141](../../backend/lib/deadlineDayReport.js)) — alle eksporteret, ingen DB-afhængighed |
| Unit-tests grønne | ✅ | `node --test backend/lib/deadlineDayReport.test.js` → 10/10 pass (warnings, biggest deal, most active, panic, embed, cron-flow, atomic claim guard) |
| Orkestrering i `backend/cron.js` med 5-min interval | ✅ | [backend/cron.js:179-185](../../backend/cron.js) — `setInterval(runDeadlineDayCron, 5 * 60 * 1000)` |
| `processDeadlineDayCron` afgrener på vindue-status | ✅ | [deadlineDayReport.js:281-311](../../backend/lib/deadlineDayReport.js) — open+closes_at→fireWarnings; closed+!sent→fireWhistle |
| Dedupe-key (window_id, step-titel) | ✅ | [notificationService.js:42-58](../../backend/lib/notificationService.js) — `notifyUser` slår op på (user_id, type, title, message, related_id) i 24h-vindue. `title` varierer per step ("Deadline Day om 24/2/30 …"); `relatedId=window.id`. Effektiv dedupe-key = (user_id, window_id, step-titel) som specificeret |
| Atomic claim på `final_whistle_sent_at` | ✅ | [deadlineDayReport.js:250-257](../../backend/lib/deadlineDayReport.js) — `UPDATE … SET final_whistle_sent_at=now WHERE id=? AND final_whistle_sent_at IS NULL RETURNING id` (Postgres-row-level-conditional-update). Test `processDeadlineDayCron skips Final Whistle when already claimed` ✅ |
| `notifyTeamOwner` kaldes med korrekte payload-felter | ✅ | [deadlineDayReport.js:234-241](../../backend/lib/deadlineDayReport.js) → `notifyTeamOwnerShared` ([notificationService.js:76-110](../../backend/lib/notificationService.js)) → `notifyUser`. Felter: teamId, type=`deadline_day_warning`, title, message, relatedId=window.id |
| Discord-embed: største handel + mest aktive manager + panik-handler | ✅ | [deadlineDayReport.js:94-141](../../backend/lib/deadlineDayReport.js) — title "🏁 Final Whistle — Sæson N", inline-fields for totalDeals/volumen/panicCount, blok-fields for 🏆 største handel / 🔥 mest aktive / 🚨 panikhandler-samples (max 3) |
| Final Whistle DM-leveret via Discord | ⚠ pending UI-smoke | [deadlineDayReport.js:268-275](../../backend/lib/deadlineDayReport.js) bruger `getDefaultWebhookFn` + `sendDiscordWebhookFn`. Default webhook + Discord-embed-rendering kræver live-test |

**S4 status:** ✅ kode-niveau intakt; live Discord-leveringscheck pending UI-smoke.

---

## Side-noter (out-of-scope, ikke blokerende for soak)

- **`transfer_windows`-tabel-DDL findes ikke i source** — kun de to ALTER-migrations. Tabellen er live i Supabase (refereret af S1/S4-migrations samt `season-events-mapping.md` som "✅ Tabel eksisterer"), men hverken `schema.sql` eller `supabase_setup.sql` indeholder `CREATE TABLE transfer_windows`. Pre-eksisterende source-divergens; uden for S1-S4 scope.
- **`transfer_windows.season_id` og `created_at`** refereres af `deadlineDayReport.js:264, :146`. Antages eksisterende i live-DB (ellers ville cron-fetch fejle ved `select`).

---

## Konklusion (efter 2026-05-04 follow-up)

| | Antal |
|---|---|
| ✅ verificeret | 23 (+1 fra `is_flash`-fix) |
| ❌ afviger | 0 |
| ⚠ pending UI-smoke | 4 (banner-faser, ticker-scroll, Flash-badge, Final Whistle Discord-render) |

**Status:** Code-level audit er fuldt grøn. UI-smoke (4 punkter) afventer brugerens browser+admin-test, men er ikke blokerende for soak — alle invarianter med kode-evidens er verificeret.
