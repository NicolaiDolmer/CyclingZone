# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Session lukket 2026-05-05.** Leveret: Ønskeliste-stjerne flyttet til egen kolonne efter rytter-navn (v2.32) + Ønskeliste-polish (v2.31).

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. **P0-status: 5/6 leveret (S-01, S-03, S-04, S-05, S-06).** Eneste P0 tilbage: S-02 Bestyrelse-redesign (kræver AskUserQuestion-spec-session først). Launch-dato: åben.

## Senest leveret
- 2026-05-05: **Ønskeliste-stjerne (v2.32)** — ny delt komponent [WatchlistStar.jsx](frontend/src/components/WatchlistStar.jsx) erstatter inline `StarButton` i [RidersPage](frontend/src/pages/RidersPage.jsx) og bruges også i [WatchlistPage](frontend/src/pages/WatchlistPage.jsx) + [ActivityPage](frontend/src/pages/ActivityPage.jsx). Stjernen sidder nu i sin egen smalle kolonne lige efter Rytter-kolonnen — flyttet fra sidste kolonne efter alle 14 stats. Ønskelistens "★ Fjern"-knap fjernet fra Handling-kolonnen (stjernen alene er nok); Handling viser nu kun "Start auktion" for fri agents. ActivityPage's Ønskeliste-tab har nu fjern-stjerne med lokal state-update. Build grøn.
- Ældre (v2.31 polish, S-05 v2.30, S-03 v2.29, S-06 v2.28, UCI v2.27 m.fl.) → `docs/archive/NOW_HISTORIK_2026-05-04_part2.md` + `NOW_HISTORIK_2026-05-03.md`

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
