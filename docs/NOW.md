# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Ingen aktiv kode-slice.** Audit-rapport leveret: 9 økonomi-fund (4 P0, 3 P1, 2 P2) drevet ud i 8 backlog-slices. Master: [07-economy-overhaul-MASTER.md](docs/slices/07-economy-overhaul-MASTER.md). Audit: [ECONOMY_AUDIT_2026-05-07.md](docs/archive/ECONOMY_AUDIT_2026-05-07.md). Anbefalet næste slice: **07a stale fallbacks + 260K/240K-drift** (S, ~30-60 min, ingen DB-migration).

## Soak-gate
**Ikke aktiv.** Audit er docs-only, ingen kode-ændringer.

## Open beta status
**Open beta live siden 2026-05-04, sæson 1 aktiv, 0 sæsoner afsluttet.** ~19 managers. S-02 KOMPLET (S-02a–S-02j). Slice 07-økonomi ny prioritet baseret på 3-bugs-på-én-dag-mønsteret 2026-05-06. Alle 3 pre-kode-beslutninger låst 2026-05-07: (1) sponsor=240K, (2) konkurs-mekanik=light (kun forvarsel-lag, ingen auto-actions), (3) 07f aktiverer automatisk fra sæson 2 (sæson 1 = introsæson uændret). NB: pre-launch dev-docs i archive/ refererer til "sæson 6/7" — det var test-DB FØR beta-reset; ignorér de sæson-numre.

## Senest leveret
- 2026-05-07: **Økonomi-audit leveret** — 3 parallelle Explore-agents kortlagde write-paths, stale konstanter og audit-trail-huller. 9 fund (4 P0/3 P1/2 P2): `?? 0` + `?? 0.15`-fallbacks i 4 callsites; 260K vs 240K-drift; TOCTOU i createLoan/payDivisionBonuses/processLoanInterest; createEmergencyLoan uden debt_ceiling; 16 ikke-atomic balance-writes; admin_log-tabel mangler; finance_transactions mangler audit-kolonner. 8 slice-briefings 07a-h ([master](docs/slices/07-economy-overhaul-MASTER.md), [audit](docs/archive/ECONOMY_AUDIT_2026-05-07.md)).
- 2026-05-06: **Sponsor-fallback fix v2.49** — 5 callsites brugte `team.sponsor_income ?? 100` (stale fra pre-skalering). En D3-manager fik 100 CZ$ ved sæsonstart i stedet for 240K. Fix: ny `DEFAULT_SPONSOR_INCOME = 240000`-konstant. Manuel kompensering +239.900 CZ$. 297/297 backend grønne.
- 2026-05-06: **Gældsloft off-by-fee fix v2.48** — `createLoan` tjekkede `currentDebt + principal` men indsatte `principal + origination_fee`. Lån kunne smutte over loftet med præcis fee-beløbet. Fix: fee i sammenligning. 2 regression-tests, 299/299 grønne. Eksisterende 54 CZ$-overskridelse ikke rørt.
- 2026-05-06: **QoL-batch v2.47** — 5 polish-fix: refresh + tidsstempel på ActivityPage; HeadToHead try/catch/finally + retry-UI; autoSuggest Hold A; "Ingen hold fundet"-state; console.warn i ActivityPage. 295/295 grønne.
- 2026-05-06: **Auktion race condition fix v2.46** — TOCTOU i POST /api/auctions; dobbeltklik gav 3 auktioner på samme rytter. Partial index `uniq_auctions_one_active_per_rider` blokkerer nu dubletter; backend mapper 23505→409. 4 duplikater ryddet. 295/295 grønne.
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-05.md`

## Næste session — start med
Start **07a stale fallbacks** (S, ~30-60 min, ingen migration). Alle pre-kode-beslutninger låst i [07-economy-overhaul-MASTER.md](docs/slices/07-economy-overhaul-MASTER.md). Anden Claude/Codex-session: læs masteren først; behold rangering medmindre nye runtime-bugs ændrer billedet.
## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests/Members/Consequences`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 260K, gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- AI/bank/frozen får ALDRIG board-state (members, identity_basis, dna, consequences) — manager-only per Q-batch 1A Q8
