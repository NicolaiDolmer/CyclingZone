# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Slice 09 — Race-pool katalog LIVE som v2.99 ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242))**. 97 løb er seedet i prod. Admin skal stadig vælge sæson 1-kalenderen via `Race-katalog` på `/admin`; klik ikke `Sæson-cyklus` før sæsonstart omkring 2026-05-15.

## Senest leveret
Historik 2026-05-08 til 2026-05-11 er arkiveret — se [`NOW_HISTORIK_2026-05-11.md`](archive/NOW_HISTORIK_2026-05-11.md), [`NOW_HISTORIK_2026-05-10-TOKEN-AUDIT.md`](archive/NOW_HISTORIK_2026-05-10-TOKEN-AUDIT.md), [`NOW_HISTORIK_2026-05-09-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-09-PRECOMPACT.md), og [`NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md).

- 2026-05-12: **#303 Gitleaks promoted til required check LIVE som v3.22** — `gh api PATCH` på `branches/main/protection/required_status_checks` efter 6 grønne PR-runs af `secret-scan.yml`. Required checks nu: `backend-tests` + `frontend-build` + `dependency-review` + `gitleaks`. Memory `reference_main_branch_protection.md` opdateret. Commit `bf23de5`.
- 2026-05-12: **#35 lukket** — affected bruger bekræftede reset-flow virker (mail → form → login). Postmortem bevaret i [`2026-05-11-password-reset-vercel-sso.md`](../.claude/learnings/2026-05-11-password-reset-vercel-sso.md).
- 2026-05-12: **claude-action max-turns 50→120 + scope-guard** — natlig #260-run fejlede med `error_max_turns` (audit-style refactor, 12 sub-tasks, $1.51 spildt, branch aldrig pushet). [.github/workflows/claude.yml](../.github/workflows/claude.yml) bumpet + SCOPE-GUARD-instruktion tilføjet så agenten blokerer up-front ved >8-fil scopes. #260 splittet til #315 (scaffolding) + #316 (rollout, blokeret indtil #315 merged). Postmortem: [`2026-05-12-claude-action-max-turns-large-refactor.md`](../.claude/learnings/2026-05-12-claude-action-max-turns-large-refactor.md).
- 2026-05-11: **#35 Password-reset + auth-bølge FIX som v3.21** — `LoginPage.jsx` pinner reset-redirect til `https://cycling-zone.vercel.app` (env-var override mulig via `VITE_PUBLIC_APP_URL`) så reset-link aldrig lander på et SSO-beskyttet preview/team-alias. Vercel Authentication disabled på projektet (alle `*.vercel.app`-domæner returnerer nu 200 i stedet for 401). Resterende: Supabase Site URL + redirect-allowlist konfigureres efter at supabase.com gives browser-extension-permission.
- 2026-05-11: **#137 Event-logging baseline klar som v3.20** — `player_events` tabel + RLS, `logEvent.js` helper (analytics-consent-gated), 10 events instrumenteret (5 game + 5 feature-impressions). Detector E (zero-impression-features) tilføjet til feature-liveness-audit; skipper PR-runs, kører ugentligt mandage 04:00 UTC. Beslutning: egen Supabase-tabel frem for PostHog så Detector E er én SQL-query og data kan joines med teams/seasons.

## Næste session (prioriteret)
1. **Sæson 1 race-udvælgelse på /admin** ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242)) — vælg sæson 1, race-dage 60, generér forslag, gem. **Deadline ~2026-05-15.**
2. **Sæson 1 LIVE-handling ca. 2026-05-15** — efter race-kalender er gemt: `/admin` → `Sæson-cyklus` → `Udfør sæsonskifte`.
3. **Aabne PRs kan kraeve gitleaks re-run** — #292, #277, #215, #213, #212, #211, #127 oprettet før gitleaks blev required. `gh pr checks` viser om job mangler; re-trigger via empty commit eller `gh workflow run secret-scan.yml --ref <branch>`.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
- Admin-resultatupload: `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.
