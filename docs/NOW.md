# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Ingen aktiv kode-slice.** Slice 07a leveret som v2.50 (2026-05-07). Næste i 07-rækken: **07b TOCTOU-fixes + idempotency-keys** (M, ~2 sessioner, kræver migration). Master: [07-economy-overhaul-MASTER.md](docs/slices/07-economy-overhaul-MASTER.md).

## Soak-gate
**Ikke aktiv.** Audit er docs-only, ingen kode-ændringer.

## Open beta status
**Open beta live siden 2026-05-04, sæson 1 aktiv, 0 sæsoner afsluttet.** ~19 managers. S-02 KOMPLET (S-02a–S-02j). Slice 07-økonomi ny prioritet baseret på 3-bugs-på-én-dag-mønsteret 2026-05-06. Alle 3 pre-kode-beslutninger låst 2026-05-07: (1) sponsor=240K, (2) konkurs-mekanik=light (kun forvarsel-lag, ingen auto-actions), (3) 07f aktiverer automatisk fra sæson 2 (sæson 1 = introsæson uændret). NB: pre-launch dev-docs i archive/ refererer til "sæson 6/7" — det var test-DB FØR beta-reset; ignorér de sæson-numre.

## Senest leveret
- 2026-05-07: **Slice 07a stale fallbacks + 260K/240K-drift v2.50** — `teamProfileEngine.js:6` hardkodede `sponsor_income: 260000` ved oprettelse af nye hold, mens DB-default + alle 5 v2.49-fix callsites brugte 240K. Drift fra v1.76 hvor in-code default blev hævet uden ledsagende migration. Prod-DB-snapshot: alle 19 hold = 240K, så ingen back-fix kompensering nødvendig (de 4 nye managers oprettet 30. apr - 3. maj havde 240K i DB — koden mistede 260K-værdien et eller andet sted, eller team-creation-stien tog DB-default i stedet). Fix: ny [economyConstants.js](backend/lib/economyConstants.js) med 7 delte konstanter (SPONSOR_INCOME_BASE 240K, INITIAL_BALANCE 800K, MARKET_VALUE_MULTIPLIER 4000, MIN_UCI_POINTS_FOR_VALUE 5, PRIZE_PER_POINT 1500, NEGATIVE_BALANCE_INTEREST_RATE 0.10, DEBT_CEILING_BY_DIVISION). teamProfileEngine + 2 stragglers i api.js + 1 i boardGoals.js (`?? 0` → `?? SPONSOR_INCOME_BASE`); loanEngine.js `?? 0.15` erstattet med fail-fast hvis loan_config mangler emergency-row (verificeret prod har alle 3 divisioner). DEFAULT_SPONSOR_INCOME re-eksporteret som alias for backward compat. 2 nye regression-tests (sponsor-default lock + emergency-loan fail-fast). 299/299 backend, frontend build + lint grøn. Doc-drift fix: FEATURE_STATUS.md, FinanceFirstVisitHint.jsx 260K→240K.
- 2026-05-07: **Økonomi-audit leveret** — 3 parallelle Explore-agents kortlagde write-paths, stale konstanter og audit-trail-huller. 9 fund (4 P0/3 P1/2 P2). 8 slice-briefings 07a-h ([master](docs/slices/07-economy-overhaul-MASTER.md), [audit](docs/archive/ECONOMY_AUDIT_2026-05-07.md)).
- 2026-05-06: **Sponsor-fallback fix v2.49** — 5 callsites brugte `team.sponsor_income ?? 100` (stale fra pre-skalering). En D3-manager fik 100 CZ$ ved sæsonstart i stedet for 240K. Fix: ny `DEFAULT_SPONSOR_INCOME = 240000`-konstant. Manuel kompensering +239.900 CZ$. 297/297 backend grønne.
- 2026-05-06: **Gældsloft off-by-fee fix v2.48** — `createLoan` tjekkede `currentDebt + principal` men indsatte `principal + origination_fee`. Lån kunne smutte over loftet med præcis fee-beløbet. Fix: fee i sammenligning. 2 regression-tests, 299/299 grønne. Eksisterende 54 CZ$-overskridelse ikke rørt.
- 2026-05-06: **QoL-batch v2.47** — 5 polish-fix: refresh + tidsstempel på ActivityPage; HeadToHead try/catch/finally + retry-UI; autoSuggest Hold A; "Ingen hold fundet"-state; console.warn i ActivityPage. 295/295 grønne.
- 2026-05-06: **Auktion race condition fix v2.46** — TOCTOU i POST /api/auctions; dobbeltklik gav 3 auktioner på samme rytter. Partial index `uniq_auctions_one_active_per_rider` blokkerer nu dubletter; backend mapper 23505→409. 4 duplikater ryddet. 295/295 grønne.
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
Start **07b TOCTOU-fixes + idempotency-keys** (M, ~2 sessioner). Migration `2026-05-07-economy-idempotency.sql` opretter 4 partial unique indices + `related_loan_id`-kolonne; backend wrapper i `create_loan_atomic`-RPC + soft debt_ceiling-tjek i `createEmergencyLoan` (light konkurs-mekanik per beslutning 2026-05-07). Master: [07-economy-overhaul-MASTER.md](docs/slices/07-economy-overhaul-MASTER.md).
## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests/Members/Consequences`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 240K (matcher DB-default; konstanter samlet i `backend/lib/economyConstants.js` siden v2.50), gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- AI/bank/frozen får ALDRIG board-state (members, identity_basis, dna, consequences) — manager-only per Q-batch 1A Q8
