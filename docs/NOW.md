# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Polish-sprint frem til open beta (#178)** — auktions-tillidssprint (#183 + #174) shipped; auctions-cluster (#192, #193, #194, #44) afventer kun manuel verifikation på prod. Næste fokus: mobile UX + onboarding friction-audit. DX-laget er hærdet via #201.

## Senest leveret
*(Fuld historik før denne komprimering er arkiveret i [`docs/archive/NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md).)*

- 2026-05-08: **#183 + #174 Auctions-tillidssprint LIVE** — silent-failure-mode i proxy-bidding fjernet: `resolveProxyBids` sletter nu stale winner-proxy (max < currentPrice) fra `auction_proxy_bids` så UI ikke viser "Auto-by max ..."-badge for udmattet proxy. Team-lookup hærdet med `.maybeSingle()` (RLS race-safety). Frontend `handleSaveProxy` i AuctionRow + AuctionCard render'er nu backend-fejlbeskeder ("Du kan ikke sætte auto-bud på din egen rytter", "Max-loft skal være mindst...") i stedet for kun "Fejl"-knap. v2.74 patch notes. 363/363 backend-tests grønne (+1 ny test for stale-proxy-delete).
- 2026-05-08: **#44 Balance-gates på alle user-spend-paths LIVE** ([PR #204](https://github.com/NicolaiDolmer/CyclingZone/pull/204), commit [2083521](https://github.com/NicolaiDolmer/CyclingZone/commit/2083521)) — `computeWorstCaseCommitment` gates POST /bid (proxy_max), PATCH /proxy, resolveProxyBids auto-eskalering, repayLoan, PATCH /loans buyout + accept, transfer-offer accept, swap-cash. UI viser raw + tilgængelig + låst-i-bud i AuctionsPage og FinancePage. Cancellation-safety-net i auctionFinalization bevaret som race-fallback. v2.73 patch notes. 359/359 backend-tests grønne (+20 nye).
- 2026-05-08: **#194 Race-confirm-modal LIVE** ([PR #202](https://github.com/NicolaiDolmer/CyclingZone/pull/202), commit [6db90d8](https://github.com/NicolaiDolmer/CyclingZone/commit/6db90d8)) — backend returnerer 409 ved stale `expected_current_price`; ny `RacePriceModal` viser ny pris/min-bud med Annullér + Byd-knapper; v2.72 patch notes; 339/339 backend-tests grønne (+3 nye for `isExpectedPriceStale`).
- 2026-05-08: **DX-hærdning LIVE** ([PR #201](https://github.com/NicolaiDolmer/CyclingZone/pull/201), commit [d361c5c](https://github.com/NicolaiDolmer/CyclingZone/commit/d361c5c)) — branch protection (backend-tests + frontend-build + dependency-review), secret scanning + push protection, hærdet pre-push hook, agent-doctor.ps1, deterministisk claude-triage, bounded claude-review, `.env` fjernet fra Git og erstattet med `.env.example`. **POST-MERGE: roter Supabase keys fra git-historikken.**
- 2026-05-08: **#193 Reserved-balance off-by-one for proxies LIVE** ([PR #200](https://github.com/NicolaiDolmer/CyclingZone/pull/200), commit [20edc43](https://github.com/NicolaiDolmer/CyclingZone/commit/20edc43)) — `computeReservedBalance` bruger nu `MAX(current_price, own_proxy_max)` per auktion. Backend-only, ingen patch notes.
- 2026-05-08: **#192 Auktions-safety-pakke LIVE** ([PR #199](https://github.com/NicolaiDolmer/CyclingZone/pull/199), commit [a747404](https://github.com/NicolaiDolmer/CyclingZone/commit/a747404)) — owner-check på proxy, logging af silent error paths og Discord DM kun ved udmattet proxy.

## Næste session (prioriteret) — polish-sprint #178
1. **Manuel verifikation på prod** — v2.66 + v2.68 + #193 + #194 (race-confirm-modal: 2 Chrome-tabs, byd nær-samtidigt, modal vises med ny pris/min-bud).
2. **Roter Supabase keys** — service key + anon key blev historisk committed (fjernet i #201, men lå i Git-historikken).
3. **Mobile UX audit:** [#163](https://github.com/NicolaiDolmer/CyclingZone/issues/163) + [#181](https://github.com/NicolaiDolmer/CyclingZone/issues/181) ved 360px viewport.
4. **Onboarding session-1 audit** — start som ny manager og noter friction.
5. **Dependabot post-launch bucket:** #114, #127, #141, #142 efter open beta launch ~2026-05-14.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Skaler for variabelt manager-tal; ingen hardcoded antal.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
