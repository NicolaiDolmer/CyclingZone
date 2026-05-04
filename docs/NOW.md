# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Session lukket 2026-05-04 (sen).** Leveret: Ønskeliste-polish (v2.31) — paginering 50/side, sticky header og fuld bredde matcher rytterside. Mobil rytterside ensrettet til tabel.

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. **P0-status: 5/6 leveret (S-01, S-03, S-04, S-05, S-06).** Eneste P0 tilbage: S-02 Bestyrelse-redesign (kræver AskUserQuestion-spec-session først). Launch-dato: åben.

## Senest leveret
- 2026-05-04 (sen 2): **Ønskeliste-polish (v2.31)** — [WatchlistPage.jsx](frontend/src/pages/WatchlistPage.jsx) får client-side paginering (50/side, page reset ved filter-skift), sticky thead + `overflow-auto max-h-[calc(100vh-220px)]`, og `max-w-5xl` → `max-w-full` (matcher [RidersPage.jsx](frontend/src/pages/RidersPage.jsx)). Ryttersiden på mobil skiftet fra kort-layout til samme tabel som desktop — død kode fjernet (`RiderCard`, `MOBILE_STATS`, `isMobile`-state, resize-listener). Verificeret i preview med 53 watchlist-entries: side 1 viser 1–50, side 2 viser 51–53, sticky header bekræftet (`theadStuckToTop: true` efter 400px scroll inden i container). Build grøn.
- Ældre (S-05 v2.30, S-03 v2.29, S-06 v2.28, UCI v2.27 m.fl.) → `docs/archive/NOW_HISTORIK_2026-05-04_part2.md` + `NOW_HISTORIK_2026-05-03.md`

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
