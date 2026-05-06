# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Slice DX — GitHub-integration tier-up** (Lag 0 ✅ done; Lag 1+8 pending hos Nicolai; Lag 2+3 venter). Foundation merged til main 2026-05-06: issue templates, 12 labels, PR-template, MCP perms, CLAUDE.md step 0d. Vision + status: [GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md). Backlog-entry: PRODUCT_BACKLOG.md "Slice DX". Slice 07 (økonomi) sættes på pause indtil DX er igennem Lag 1-3 — næste 07-slice er **07b TOCTOU + idempotency-keys** (M, ~2 sessioner).

## Soak-gate
**Ikke aktiv.** DX foundation er infrastruktur (templates/labels/perms) — ingen runtime-ændringer.

## Open beta status
**Open beta live siden 2026-05-04, sæson 1 aktiv, 0 sæsoner afsluttet.** ~19 managers. S-02 KOMPLET (S-02a–S-02j). 07a leveret som v2.50 (samlet `economyConstants.js`). Slice 07-økonomi sat på pause til efter DX Lag 1-3 (handler om setup, ikke bugs). Alle 3 pre-kode-beslutninger til 07 låst 2026-05-07: (1) sponsor=240K, (2) konkurs-mekanik=light, (3) 07f aktiverer automatisk fra sæson 2. Pre-launch dev-docs i archive/ refererer til "sæson 6/7" = test-DB FØR beta-reset; ignorér.

## Senest leveret
- 2026-05-06: **GitHub-workflow foundation (Slice DX Lag 0)** — `f26f2e5`. 4 issue templates + PR template + 12 labels (`claude:*`/`priority:*`/`type:*`) + MCP perms + CLAUDE.md step 0d (auto-tjek `claude:todo` ved session-start) + [docs/GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md) (vision + 8-lag-tabel). Demo-issue #3 verificerer skriv-vej via `gh` CLI. MCP write returnerer 403 indtil Nicolai disconnect/reconnect'er claude.ai-connector (Lag 8). Næste 4 lag (App, review, triage, MCP-fix) har handoff-issue i `claude:todo`.
- 2026-05-07: **Slice 07a stale fallbacks v2.50** — `teamProfileEngine.js` hardkodede 260K, mens DB-default + alle 5 v2.49-fix callsites brugte 240K. Prod-DB: alle 19 hold = 240K, ingen back-fix nødvendig. Fix: ny `backend/lib/economyConstants.js` med 7 delte konstanter (SPONSOR_INCOME_BASE 240K, INITIAL_BALANCE 800K, MARKET_VALUE_MULTIPLIER 4000, etc.). loanEngine.js `?? 0.15` erstattet med fail-fast. 2 nye regression-tests, 299/299 backend grønne. Doc-drift fix: FEATURE_STATUS.md + FinanceFirstVisitHint 260K→240K.
- 2026-05-07: **Økonomi-audit leveret** — 3 parallelle Explore-agents, 9 fund (4 P0/3 P1/2 P2), 8 slice-briefings 07a-h ([master](docs/slices/07-economy-overhaul-MASTER.md), [audit](docs/archive/ECONOMY_AUDIT_2026-05-07.md)).
- 2026-05-06: **v2.46-v2.49 batch** (Auktion race-cond, QoL, gældsloft off-by-fee, sponsor-fallback `?? 100`→240K) — detaljer i [archive/NOW_HISTORIK_2026-05-06.md](archive/NOW_HISTORIK_2026-05-06.md) (oprettes ved næste close-out).

## Næste session — start med
Cross-PC handoff aktiv: Nicolai fortsætter fra anden PC. Start med `git fetch --prune` og læs **§Status & næste skridt** i [GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md). Handoff-issue ligger i `claude:todo` med præcis recipe. Når Lag 1+8 er udført af Nicolai → Claude dropper Lag 2+3 workflows. Slice 07b (TOCTOU) er næste når DX-loop er bevist end-to-end.
## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — board: bevar `boardConstants/Goals/Evaluation/Identity/Requests/Members/Consequences`, tilføj nye filer + tabeller ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 240K (matcher DB-default; konstanter samlet i `backend/lib/economyConstants.js` siden v2.50), gældsloft D1/D2/D3=1200K/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits (v2.29) + Indbakke "Skal handles" (v2.30) håndhæves automatisk; Discord DM-fejl må aldrig blokere tx
- AI/bank/frozen får ALDRIG board-state (members, identity_basis, dna, consequences) — manager-only per Q-batch 1A Q8
