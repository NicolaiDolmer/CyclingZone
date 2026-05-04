# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Session lukket 2026-05-04 (sen).** Leveret: S-05 Indbakke-polish (v2.30) — 3 polish-bidder der lukker S-05 ærligt frem for at følge stale brief bogstaveligt.

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. **P0-status: 5/6 leveret (S-01, S-03, S-04, S-05, S-06).** Eneste P0 tilbage: S-02 Bestyrelse-redesign (kræver AskUserQuestion-spec-session først). Launch-dato: åben.

## Senest leveret
- 2026-05-04 (sen): **S-05 Indbakke-polish (v2.30)** — `backend/lib/inboxPending.js` + `GET /api/inbox/pending` + nyt "Skal handles"-tab i `NotificationsPage` med realtime-subscription på transfer/swap/loan-tabeller. Drift-fix: `activity_feed`-tabel committed til `schema.sql` + idempotent migration (`2026-05-04-activity-feed-schema-commit.sql`, applied via MCP — 467 rows bevaret). Orphan `ActivityFeedPage.jsx` slettet (redirect var allerede live). 10/10 nye unit tests grønne; backend total 125/125.
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-04_part2.md` + `NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **S-02 Bestyrelse-redesign — AskUserQuestion-spec-session** (sekventiel forhandling 5yr→3yr→1yr, sæson 0-lås, identity-feedback, auto-accept). Per `GUARDRAILS_CORE.md` skal komplekse feature-redesigns starte med dedikeret kravafklaring før kode. Brief: `docs/slices/02-board-redesign-sequential.md`
2. **Manuel smoke-verifikation** (S-03 + S-05) — admin lukker test-vindue + verificér "Skal handles"-tab modtager pending offers korrekt på beta

## Kritiske invarianter
- **Verificér runtime FØR claim** (etableret 2026-05-04) — grep koden før du listet noget som TODO/bug; brief-dokumenter kan være stale (S-05's "byg unified inbox fra scratch"-brief var stale: NotificationsPage var allerede ~80% færdig)
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `/profile` → `ProfilePage` — `ManagerProfilePage` er read-only view
- Economy v1.76 + v2.25: `SALARY_RATE = 0.10` i DB-formel, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- **`riders.salary` er GENERATED** — kan IKKE skrives fra app-kode efter v2.25; DB beregner fra `uci_points` + `prize_earnings_bonus`
- **UCI-sync må aldrig nulle high-value ryttere** — popularity ≥ 70 OR uci_points ≥ 100 auto-protected; token-set + æ/ø/å-norm i scraper + sheetsSync skal forblive byte-equivalent
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- **Squad limits håndhæves automatisk (S-03 v2.29)** — `processSquadEnforcementCron` claimer `transfer_windows.squad_enforcement_completed_at` atomisk. `riders.acquired_at` SKAL opdateres i ALLE write-paths der ændrer `team_id`. `season_standings.penalty_points` preserves på tværs af `updateStandings`-recompute fordi den ikke er i upsert-rows; ranking bruger `total - penalty`
- **Indbakke "Skal handles" (S-05 v2.30)** — `inboxPending.js` returnerer kun items hvor min team_id er den part der mangler at træffe valg (klassificeret via `classifyTransferOfferRole` / `classifySwapOfferRole`); auctions er bevidst UDE fordi current_bidder ikke er en stillestående beslutning
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
