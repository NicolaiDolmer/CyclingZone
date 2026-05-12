# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Slice 09 — Race-pool katalog LIVE som v2.99 ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242))**. 97 løb er seedet i prod. Admin skal stadig vælge sæson 1-kalenderen via `Race-katalog` på `/admin`; klik ikke `Sæson-cyklus` før sæsonstart omkring 2026-05-15.

## Senest leveret
- 2026-05-12: **#316 TeamLink-rollout LIVE som v3.23** — `TeamLink`-komponenten (fra #315) rullet ud på alle 8 sider: StandingsPage, AuctionHistoryPage, RiderStatsPage (rider.team + BidTimeline + HistoryEvent), NotificationsPage, HallOfFamePage, RiderRankingsPage, RaceHistoryPage (+ query-fix for team.id), TransfersPage (Fra/Til + listing.seller, nested-link-fix). Holdnavne er nu klikbare links til holdets side overalt i appen.

Historik 2026-05-08 til 2026-05-11 er arkiveret — se [`NOW_HISTORIK_2026-05-11.md`](archive/NOW_HISTORIK_2026-05-11.md), [`NOW_HISTORIK_2026-05-10-TOKEN-AUDIT.md`](archive/NOW_HISTORIK_2026-05-10-TOKEN-AUDIT.md), [`NOW_HISTORIK_2026-05-09-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-09-PRECOMPACT.md), og [`NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md).

- 2026-05-12: **#315 TeamLink-scaffolding LIVE** — `frontend/src/components/TeamLink.jsx` (matches `RiderLink`-konvention, ikke verbose teamId/teamName-API) + `backend/lib/riderBidTimeline.js` udvidet med `team_id` på bid-entries og `winner_team_id`/`seller_team_id` på completed-payload (privacy-whitelist #195 udvidet, proxy_max-invariant uændret). Backend 584/584 grøn. Squash `3478278` ([PR #320](https://github.com/NicolaiDolmer/CyclingZone/pull/320)). Internal/DX — ingen patch notes. #316 unblocked, klar til rollout.
- 2026-05-12: **PR-triage efter gitleaks-promotion (#303 follow-up)** — 4 åbne PRs merged (#292 gha-deps, #318/#319/#212 group-deps), 2 stale lukket (#213 duplikat, #277 ref-issue lukket), 1 holdt (#127 `post-launch`). Lærepenge gemt som memory: `@dependabot rebase` kan lukke + erstatte group-PRs hvis group-medlemskab er ændret. DX-only — ingen patch notes.
- 2026-05-12: **#303 Gitleaks promoted til required check LIVE som v3.22** — `gh api PATCH` på `branches/main/protection/required_status_checks` efter 6 grønne PR-runs af `secret-scan.yml`. Required checks nu: `backend-tests` + `frontend-build` + `dependency-review` + `gitleaks`. Memory `reference_main_branch_protection.md` opdateret. Commit `bf23de5`.
- 2026-05-12: **#35 lukket** — affected bruger bekræftede reset-flow virker (mail → form → login). Postmortem bevaret i [`2026-05-11-password-reset-vercel-sso.md`](../.claude/learnings/2026-05-11-password-reset-vercel-sso.md).
- 2026-05-12: **claude-action max-turns 50→120 + scope-guard** — natlig #260-run fejlede med `error_max_turns` (audit-style refactor, 12 sub-tasks, $1.51 spildt, branch aldrig pushet). [.github/workflows/claude.yml](../.github/workflows/claude.yml) bumpet + SCOPE-GUARD-instruktion tilføjet så agenten blokerer up-front ved >8-fil scopes. #260 splittet til #315 (scaffolding) + #316 (rollout, blokeret indtil #315 merged). Postmortem: [`2026-05-12-claude-action-max-turns-large-refactor.md`](../.claude/learnings/2026-05-12-claude-action-max-turns-large-refactor.md).
- 2026-05-11: **#35 Password-reset + auth-bølge FIX som v3.21** — `LoginPage.jsx` pinner reset-redirect til `https://cycling-zone.vercel.app` (env-var override mulig via `VITE_PUBLIC_APP_URL`) så reset-link aldrig lander på et SSO-beskyttet preview/team-alias. Vercel Authentication disabled på projektet (alle `*.vercel.app`-domæner returnerer nu 200 i stedet for 401). Resterende: Supabase Site URL + redirect-allowlist konfigureres efter at supabase.com gives browser-extension-permission.
- 2026-05-11: **#137 Event-logging baseline klar som v3.20** — `player_events` tabel + RLS, `logEvent.js` helper (analytics-consent-gated), 10 events instrumenteret (5 game + 5 feature-impressions). Detector E (zero-impression-features) tilføjet til feature-liveness-audit; skipper PR-runs, kører ugentligt mandage 04:00 UTC. Beslutning: egen Supabase-tabel frem for PostHog så Detector E er én SQL-query og data kan joines med teams/seasons.

## Næste session (prioriteret)
1. **Sæson 1 race-udvælgelse på /admin** ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242)) — vælg sæson 1, race-dage 60, generér forslag, gem. **Deadline ~2026-05-15.**
2. **Sæson 1 LIVE-handling ca. 2026-05-15** — efter race-kalender er gemt: `/admin` → `Sæson-cyklus` → `Udfør sæsonskifte`.
3. **[#316](https://github.com/NicolaiDolmer/CyclingZone/issues/316) TeamLink-rollout** — brug `TeamLink`-komponent på 8 sider (StandingsPage, AuctionHistoryPage, RiderStatsPage, NotificationsPage, HallOfFamePage, RiderRankingsPage, RaceHistoryPage, TransfersPage). Scaffolding fra #315 er på main; `claude:todo` klar til pick-up.
4. **[#127](https://github.com/NicolaiDolmer/CyclingZone/pull/127) dotenv-bump genoptages efter launch** — `post-launch` label, åbnes ~2026-05-14+. Sidste tilbageværende dependabot-PR fra gitleaks-promotion-bølgen.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
- Admin-resultatupload: `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.
