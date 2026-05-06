# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Slice 07b — TOCTOU + idempotency-keys** (M, ~2 sessioner). Slice DX Lag 1+2+3 LIVE på `c1a8970` 2026-05-06: `claude.yml` (@claude-trigger via Pro-subscription `CLAUDE_CODE_OAUTH_TOKEN`), `claude-review.yml` (auto PR-review opus-4-7), `claude-triage.yml` (auto issue-triage sonnet-4-6). Lag 8 (MCP write-fix) cosmetic — påvirker kun terminal-MCP, ikke automation. Lag 4-7 udskudt til ad-hoc.

## Soak-gate
**Ikke aktiv.** DX foundation er infrastruktur (templates/labels/perms) — ingen runtime-ændringer.

## Open beta status
**Open beta live siden 2026-05-04, sæson 1 aktiv, 0 sæsoner afsluttet.** ~19 managers. S-02 KOMPLET (S-02a–S-02j). 07a leveret som v2.50 (samlet `economyConstants.js`). Slice 07-økonomi sat på pause til efter DX Lag 1-3 (handler om setup, ikke bugs). Alle 3 pre-kode-beslutninger til 07 låst 2026-05-07: (1) sponsor=240K, (2) konkurs-mekanik=light, (3) 07f aktiverer automatisk fra sæson 2. Pre-launch dev-docs i archive/ refererer til "sæson 6/7" = test-DB FØR beta-reset; ignorér.

## Senest leveret
- 2026-05-06: **Slice DX Lag 1+2+3 — agent-loop live** (`c1a8970`). 3 workflows: `claude.yml` (@claude-trigger, OAuth via Pro-subscription), `claude-review.yml` (opus-4-7), `claude-triage.yml` (sonnet-4-6). PR #5+#6 squashed. OIDC-token verifikation via PR #5's eget run = App+secret confirmed live. End-to-end-test (`@claude hello` på issue #4) udestår hos Nicolai.
- 2026-05-06: **GitHub-workflow foundation (Slice DX Lag 0)** — `f26f2e5`. 4 issue templates + PR template + 12 labels + MCP perms + CLAUDE.md step 0d. Demo-issue #3 verificerer `gh` CLI write-path.
- 2026-05-07: **Slice 07a stale fallbacks v2.50** — `teamProfileEngine.js` hardkodede 260K, mens DB-default + alle 5 v2.49-fix callsites brugte 240K. Prod-DB: alle 19 hold = 240K, ingen back-fix nødvendig. Fix: ny `backend/lib/economyConstants.js` med 7 delte konstanter (SPONSOR_INCOME_BASE 240K, INITIAL_BALANCE 800K, MARKET_VALUE_MULTIPLIER 4000, etc.). loanEngine.js `?? 0.15` erstattet med fail-fast. 2 nye regression-tests, 299/299 backend grønne. Doc-drift fix: FEATURE_STATUS.md + FinanceFirstVisitHint 260K→240K.
- 2026-05-07: **Økonomi-audit leveret** — 3 parallelle Explore-agents, 9 fund (4 P0/3 P1/2 P2), 8 slice-briefings 07a-h ([master](docs/slices/07-economy-overhaul-MASTER.md), [audit](docs/archive/ECONOMY_AUDIT_2026-05-07.md)).
- 2026-05-06: **v2.46-v2.49 batch** (Auktion race-cond, QoL, gældsloft off-by-fee, sponsor-fallback `?? 100`→240K) — detaljer i [archive/NOW_HISTORIK_2026-05-06.md](archive/NOW_HISTORIK_2026-05-06.md) (oprettes ved næste close-out).

## Næste session — start med
Slice 07b (TOCTOU + idempotency-keys) — kick-off med audit-briefing i [docs/slices/07-economy-overhaul-MASTER.md](slices/07-economy-overhaul-MASTER.md). DX agent-loop er live; brug `@claude` direkte i issues hvis du vil starte en cloud-session i stedet.
## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests/Members/Consequences`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 240K (matcher DB-default; konstanter samlet i `backend/lib/economyConstants.js` siden v2.50), gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- AI/bank/frozen får ALDRIG board-state (members, identity_basis, dna, consequences) — manager-only per Q-batch 1A Q8
