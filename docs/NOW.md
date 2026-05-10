# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Slice 09 — Race-pool katalog LIVE som v2.99 ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242))**. 97 løb seedet i prod (61 ProSeries, 6 OtherWorldTourA, 14 OtherWorldTourB, 8 OtherWorldTourC, 5 Monuments, 2 GiroVuelta, 1 TourFrance). Sæson 1 kalender skal udvælges af admin via `🏁 Race-katalog` på `/admin` (default ekskluderer WT-klasser). Når kalender er gemt → admin klikker `🔄 Sæson-cyklus` for at gå live ~2026-05-15.

## Senest leveret
*(Historik før 2026-05-10 i [`docs/archive/NOW_HISTORIK_2026-05-09-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-09-PRECOMPACT.md). Endnu ældre i [`NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md`](archive/NOW_HISTORIK_2026-05-08-DX-PRECOMPACT.md).)*

- 2026-05-10: **#14 + #245 Banken → AI rename LIVE som v3.06** — team 'Banken' omdøbt til 'AI' i prod (samme række, `is_bank`-flag bevaret som intern routing-markør for guaranteed-sale-flowet). UI-strenge opdateret i `api.js`, `auctionFinalization.js`, `HelpPage`, `TeamPage`, `RiderStatsPage`, `AdminPage` + docs. #14's server-side blok mod direkte tilbud var allerede fixed i `13129ca` (2026-04-28); #245's pending_team_id-gate var allerede fixed i `814b5dc` (2026-05-09 via `getAuctionStartIssue`). 570/570 backend-tests grønne. Deploy verify success på SHA 97eb79d.
- 2026-05-10: **#270 Fjern rytter fra transferlisten LIVE som v3.05** — ny "🗑️ Fjern fra transferlisten"-knap i `TransferCard` når listingen er ejer-egen; `DELETE /api/transfers/:id` har eksisteret hele tiden, kun UI-knappen var aldrig bygget. Ny pure-helper `getListingCancelIssue` parallel til transfer/swap/loan-cancel-pattern. 570/570 backend-tests grønne. Deploy verify success på SHA b7b2d36.
- 2026-05-10: **#269 Race-window fix — bud efter calculated_end afvises LIVE som v3.04** — opdaget under Axel Zingle auktion (4b754d83) hvor bud landede 308 ms POST-expiry og udløste forlængelse #4 → #5. Fix: `BEFORE INSERT` trigger `reject_late_auction_bid` på `auction_bids`; app-laget oversætter `P0001` til 400 "Auktionen er udløbet" i alle 3 INSERT-sites. 569/569 backend-tests grønne (+8 nye).
- 2026-05-10: **#257 Auktioner forlænges kun ved reelt leder-skift LIVE som v3.03** — Discord-rapporteret bug fra friisisch+andreas311+.sredna+jeppek 2026-05-09 fixet. Ny `applyLeaderShiftExtension`-helper der kaldes EFTER `resolveProxyBids`-cascade og kun forlænger hvis `previousLeader != current_bidder_id`. Cascade-bids har `triggered_extension: false`. 561/561 backend-tests grønne (+6 nye).
- 2026-05-10: **#250 Forsidens squad-tæller tager højde for transfers LIVE som v3.02** — Dashboardets 'Ryttere'-tæller forudsiger fremtidens hold-størrelse (ejede MINUS pending-out PLUS pending-in PLUS aktive lån) i stedet for kun nuværende ejede. Ny pure-funktion `computeDashboardSquadStats` med 11 unit-tests. 16/16 frontend-tests grønne.
- 2026-05-10: **#254 Byd direkte fra rytter-profil LIVE som v3.01** — auktion-bud-flowet er nu tilgængeligt på `/riders/:id` med fuld feature-parity (bid-input, balance-gate #44, race-confirm-modal #194, BidConfirmModal, autobud-loft, status-badges, live pris-flash, overbid-toast, win-confetti). State-machinen trukket ud i delt `useAuctionBidding`-hook + `auctionLogic`-modul. 555/555 backend-tests grønne.

## Næste session (prioriteret)
1. **Sæson 1 race-udvælgelse på /admin** (Slice 09) — vælg sæson 1, race-dage 60, behold WT-eksklusion, generér forslag, gem. Klik IKKE '🔄 Sæson-cyklus' endnu. Bruger gør selv via UI.
2. **Manuel verifikation på prod af Slice 09** — `/races?tab=world` viser 97 løb m. klassefilter; preview returnerer 30-60 ProSeries-løb til sæson 1.
3. **Sæson 1 LIVE-handling ~2026-05-15** — efter race-kalender gemt OG dato rammet: '🔄 Sæson-cyklus' → 'Udfør sæsonskifte'.
4. **Slice 07e soak-gate** ([#83](https://github.com/NicolaiDolmer/CyclingZone/issues/83)) — genkør NULL-counter når der har været prod-finance-trafik siden 17:00 cutoff 2026-05-09.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Skaler for variabelt manager-tal; ingen hardcoded antal.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
