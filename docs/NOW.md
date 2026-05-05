# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Ingen aktiv kode-slice.** Seneste arbejde: v2.49 sponsor-fallback fix (Above & Beyond Cancer Cycling kompenseret 239.900 CZ$). S-02 er komplet (10/10 slices). Master-roadmap: [02-board-redesign-MASTER.md](docs/slices/02-board-redesign-MASTER.md).

## Soak-gate
**Ikke aktiv** — nuværende arbejde er docs/status-afstemning uden ny domænelogik.

## Open beta status
**Alle launch-gates ✅, 6/6 P0 leveret.** S-02 KOMPLET (S-02a–S-02j, 10/10 slices). ~19 managers live. Næste: vælg ny product-slice fra [PRODUCT_BACKLOG.md](docs/PRODUCT_BACKLOG.md).

## Senest leveret
- 2026-05-06: **Sponsor-fallback fix v2.49** — 5 callsites (`economyEngine.js`, `betaResetService.js`, `boardAutoAccept.js`, `api.js`) brugte `team.sponsor_income ?? 100` som fallback. Værdien 100 var stale fra pre-skalerings-æraen (før ×4000 i april). Mindst én manager (Above & Beyond Cancer Cycling, oprettet 3. maj) endte med `sponsor_income = 100` og fik kun 100 CZ$ ved sæson-start i stedet for 240K. Fix: ny eksporteret konstant `DEFAULT_SPONSOR_INCOME = 240000` (matcher DB-default), alle 5 fallbacks bruger den nu. Manuel kompensering: JeppeK's `sponsor_income` opdateret til 240K + balance +239.900 CZ$ med `sponsor`-transaktion synlig i Finanser. 297/297 backend grønne.
- 2026-05-06: **Gældsloft off-by-fee fix v2.48** — `createLoan` i [loanEngine.js](backend/lib/loanEngine.js) tjekkede `currentDebt + principal` mod loftet, men det indsatte `amount_remaining` var `principal + origination_fee`. Resultat: hvert lån kunne smutte over loftet med præcis fee-beløbet (5% short/long, 10% emergency). En D3-manager (Above & Beyond Cancer Cycling) stablede mange små lån oven på et 600K-lån og endte 54 CZ$ over 600K-loftet. Fix: fee beregnes nu før tjek og indgår i sammenligning. 2 nye regression-tests, 299/299 backend grønne, frontend build grøn. Eksisterende prod-overskridelse (54 CZ$) ikke rørt.
- 2026-05-06: **QoL-batch v2.47** — 5 polish-fix: (1) refresh-knap + "Sidst opdateret"-tidsstempel på [ActivityPage.jsx](frontend/src/pages/ActivityPage.jsx); (2) [HeadToHeadPage.jsx](frontend/src/pages/HeadToHeadPage.jsx) `loadStats()` try/catch/finally + error-UI med "Prøv igen" (fixede evig spinner ved Promise.all-fejl); (3) `autoSuggest` på Hold A; (4) "Ingen hold fundet"-state i TeamSearch; (5) `console.warn` i ActivityPage `.catch()` der før skjulte API-fejl tavst. 295/295 tests + build grønne.
- 2026-05-06: **Auktion race condition fix v2.46** — POST /api/auctions havde TOCTOU-race i SELECT-then-INSERT-tjekket; dobbeltklik 5. maj gav 3 auktioner på Gianni Moscon + 2 hver på Silvan Dillier og Morné van Niekerk. Ny migration ([2026-05-06-auctions-unique-active-rider.sql](database/2026-05-06-auctions-unique-active-rider.sql)) tilføjer `uniq_auctions_one_active_per_rider` partial index — DB blokkerer nu enhver dublet og backend mapper 23505 → 409. 4 duplikat-rows ryddet i prod (ingen pengebevægelse). 295/295 tests + frontend build grønne.
- 2026-05-05: **Indbakke ønskeliste-auktionslink v2.45** — `watchlist_rider_auction` adskiller ønskeliste-auktioner fra ønskeliste-transferlistinger, så Indbakke klik går til `/auctions`. Legacy-fallback routes gamle `watchlist_rider_listed` auktion-notifikationer korrekt. Backend 294/294 + frontend build grønne.
- 2026-05-05: **Docs status-drift sweep** — `NOW.md`, `PRODUCT_BACKLOG.md`, `LAUNCH_ROADMAP.md`, S-03 og S-06 slice-docs afstemt mod runtime. S-03 verificeret via `backend/lib/squadEnforcement.js` + cron + migration + 7/7 målrettede tests. S-06 smoke-tool verificeret via backend endpoint + AdminPage callsite; health-check cron er ikke leveret og står som P1.
- 2026-05-05: **Menu IA v2.44** — venstremenuen samlet i fire mentale rum, `/races` flyttet til Sæson & Resultater, `/deadline-day` label ændret til Deadline Day, HelpPage/PatchNotes/FEATURE_STATUS afstemt.
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
Vælg næste slice fra PRODUCT_BACKLOG.md. Undgå S-03/S-06 som "åbne P0" — de er runtime-verificeret leveret; S-06 health-check er separat P1.
## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests/Members/Consequences`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 260K, gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- AI/bank/frozen får ALDRIG board-state (members, identity_basis, dna, consequences) — manager-only per Q-batch 1A Q8
