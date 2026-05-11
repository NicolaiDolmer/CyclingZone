# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Slice 09 — Race-pool katalog LIVE som v2.99 ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242))**. 97 løb er seedet i prod. Admin skal stadig vælge sæson 1-kalenderen via `Race-katalog` på `/admin`; klik ikke `Sæson-cyklus` før sæsonstart omkring 2026-05-15.

## Senest leveret
Historik før 2026-05-10 ligger i [`NOW_HISTORIK_2026-05-09-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-09-PRECOMPACT.md) og [`NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md). Leveringer fra 2026-05-10 v3.01-v3.10 er kompakteret i [`NOW_HISTORIK_2026-05-10-TOKEN-AUDIT.md`](archive/NOW_HISTORIK_2026-05-10-TOKEN-AUDIT.md).

- 2026-05-10: **#287 Backwards-audit 'deployed kode + 0 data' LIVE som v3.10** — `audit-feature-liveness.js`, PR #291 merged, deploy SHA `4d24c4d`.
- 2026-05-10: **#286 Brugerverifikation-gate i PR-template LIVE** — PR-template + workflow `pr-verification-check.yml`, PR #290 merged.
- 2026-05-10: **GitHub Projects/cleanup + transfer/auction fixes v3.01-v3.09 LIVE** — detaljer i arkivet nævnt ovenfor.
- 2026-05-10: **Token-audit session** — fandt at `NOW.md`, `SESSION_CONTEXT.md`, Claude memory/transcripts og unbounded issue-prefetch var største context-drivere; bounded prefetch indført.
- 2026-05-11: **#84 Slice 07f variabel sponsor implementeret som v3.12** — `sponsorEngine` deles af season-start payout, admin transition-preview og finance forecast. Sæson 1 fast 240K; sæson 2+ 200K base + 0-150K resultatvariabel før board/pullout-modifier. Backend 577/577 grøn, frontend build grøn.

## Næste session (prioriteret)
1. **Sæson 1 race-udvælgelse på /admin** ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242)) — vælg sæson 1, race-dage 60, behold WT-eksklusion, generér forslag, gem. Bruger klikker selv sæson-cyklus senere.
2. **Manuel prod-verifikation af Slice 09** — `/races?tab=world` viser 97 løb m. klassefilter; preview returnerer 30-60 ProSeries-løb til sæson 1.
3. **Sæson 1 LIVE-handling ca. 2026-05-15** — efter race-kalender er gemt og datoen rammer: `/admin` -> `Sæson-cyklus` -> `Udfør sæsonskifte`.
4. **Slice 07e soak-gate** ([#83](https://github.com/NicolaiDolmer/CyclingZone/issues/83)) — genkør NULL-counter når der har været prod-finance-trafik siden 2026-05-09 17:00 cutoff.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
