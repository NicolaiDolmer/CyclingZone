# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Slice 09 — Race-pool katalog LIVE som v2.99 ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242))**. 97 løb er seedet i prod. Admin skal stadig vælge sæson 1-kalenderen via `Race-katalog` på `/admin`; klik ikke `Sæson-cyklus` før sæsonstart omkring 2026-05-15.

## Senest leveret
- 2026-05-12: **#63 /compare opdagelig som v3.24** — `RiderComparePage` accepterer nu deep-link via `?ids=uuid1,uuid2,...` (URL sync'er ved tilføj/fjern, max 3). `RiderStatsPage` har `⇄ Sammenlign`-knap ved siden af watchlist-stjernen. `RidersPage` + `WatchlistPage` har ny ⇄-kolonne pr. række + flydende `CompareBar` i bunden ved valg (delt `components/CompareSelection.jsx`). Ingen sidebar-tilføjelse — værktøjet bor dér hvor rytterbeslutningen tages. Frontend build grøn.
- 2026-05-12: **#316 TeamLink-rollout LIVE som v3.23** — `TeamLink`-komponenten (fra #315) rullet ud på alle 8 sider: StandingsPage, AuctionHistoryPage, RiderStatsPage (rider.team + BidTimeline + HistoryEvent), NotificationsPage, HallOfFamePage, RiderRankingsPage, RaceHistoryPage (+ query-fix for team.id), TransfersPage (Fra/Til + listing.seller, nested-link-fix). Holdnavne er nu klikbare links til holdets side overalt i appen.

Historik 2026-05-08 til 2026-05-11 er arkiveret — se [`NOW_HISTORIK_2026-05-11.md`](archive/NOW_HISTORIK_2026-05-11.md).

- 2026-05-12: **#315 TeamLink-scaffolding LIVE** — `frontend/src/components/TeamLink.jsx` (matches `RiderLink`-konvention, ikke verbose teamId/teamName-API) + `backend/lib/riderBidTimeline.js` udvidet med `team_id` på bid-entries og `winner_team_id`/`seller_team_id` på completed-payload.
- 2026-05-12: **#303 Gitleaks promoted til required check LIVE som v3.22** — Required checks nu: `backend-tests` + `frontend-build` + `dependency-review` + `gitleaks`.

## Næste session (prioriteret)
1. **Sæson 1 race-udvælgelse på /admin** ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242)) — vælg sæson 1, race-dage 60, generér forslag, gem. **Deadline ~2026-05-15.**
2. **Sæson 1 LIVE-handling ca. 2026-05-15** — efter race-kalender er gemt: `/admin` → `Sæson-cyklus` → `Udfør sæsonskifte`.
3. **[#316](https://github.com/NicolaiDolmer/CyclingZone/issues/316) TeamLink-rollout** — brug `TeamLink`-komponent på 8 sider.
4. **[#127](https://github.com/NicolaiDolmer/CyclingZone/pull/127) dotenv-bump genoptages efter launch** — `post-launch` label, åbnes ~2026-05-14+.
5. **Skalerings-audit & AI-Standard** — Implementér Loop A (Drift-monitor) og fjern OneDrive-afhængighed til secrets.

## Skalerings-Roadmap (Mod 100+ brugere)
- [ ] **Fase 1: Bulletproof Baseline** — Loop A (Drift-monitor) aktiv. Ingen trial-risici (Vercel/Supabase monitorering).
- [ ] **Fase 2: AI-Autopilot** — Automatiserede tests ved hvert push. Manus-orkestreret workflow.
- [ ] **Fase 3: Professional Secret Management** — Flyt fra OneDrive hardlinks til Infisical eller Supabase Vault.
- [ ] **Fase 4: UX-Insight** — Loop I (Clarity) aktiv for at fange 100-bruger feedback.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
- Admin-resultatupload: `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.
