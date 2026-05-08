# NOW — Aktuel arbejdsstatus

## Aktiv slice
**DX/AI-workflow hardening** — Codex-session 2026-05-08 på branch `codex/github-workflow-hardening`. Scope: GitHub Actions, local hooks, security posture, token-effektiv docs og agent-doctor. Dette er DX-only og ændrer ikke gameplay-runtime.

## Senest leveret
*(Fuld historik før denne komprimering er arkiveret i [`docs/archive/NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md).)*

- 2026-05-08: **#193 Reserved-balance off-by-one for proxies LIVE** ([PR #200](https://github.com/NicolaiDolmer/CyclingZone/pull/200), commit [20edc43](https://github.com/NicolaiDolmer/CyclingZone/commit/20edc43)) — `computeReservedBalance` bruger nu `MAX(current_price, own_proxy_max)` per auktion; 336/336 backend-tests grønne. Backend-only, ingen patch notes.
- 2026-05-08: **#192 Auktions-safety-pakke LIVE** ([PR #199](https://github.com/NicolaiDolmer/CyclingZone/pull/199), commit [a747404](https://github.com/NicolaiDolmer/CyclingZone/commit/a747404)) — owner-check på proxy, logging af silent error paths og Discord DM kun ved udmattet proxy.
- 2026-05-08: **Mobile-first ship-loop LIVE** — auto-merge label, deploy-verify, Dependabot auto-merge og branch protection på `main` er live. Denne DX-slice hærder næste lag ovenpå.

## Næste session (prioriteret) — polish-sprint #178
1. **Manuel verifikation af v2.66 + v2.68 + #193 på prod** — match-pris/+1-step, stale winner-proxy og reserved-balance scenariet fra #193.
2. **Auktions-overhaul cluster:** [#194](https://github.com/NicolaiDolmer/CyclingZone/issues/194) Race-confirm-modal ved tæt bid-race. #192 + #193 er shipped, manuel verifikation udestår.
3. **Mobile UX audit:** [#163](https://github.com/NicolaiDolmer/CyclingZone/issues/163) + [#181](https://github.com/NicolaiDolmer/CyclingZone/issues/181) ved 360px viewport.
4. **Onboarding session-1 audit** — start som ny manager og noter friction.
5. **Dependabot post-launch bucket:** #114, #127, #141, #142 efter open beta launch ~2026-05-14.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Skaler for variabelt manager-tal; ingen hardcoded antal.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
