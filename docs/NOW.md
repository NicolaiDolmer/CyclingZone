# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Slice 07b — TOCTOU + idempotency-keys** ([#80](https://github.com/NicolaiDolmer/CyclingZone/issues/80), parent [#79](https://github.com/NicolaiDolmer/CyclingZone/issues/79), M ~2 sessioner). Foundation LIVE: Slice DX agent-loop (`c1a8970`) + Discord→GitHub bridge (`0d2b703`). Triage issues FØR 07b kick-off — flere overlapper med 07a-c work eller er allerede done. **Soak-gate: ikke aktiv.**

## Open beta status
**Open beta live siden 2026-05-04, sæson 1 aktiv, 0 sæsoner afsluttet.** ~19 managers. S-02 KOMPLET. 07a leveret som v2.50. Alle 3 pre-kode-beslutninger til 07 låst 2026-05-07: (1) sponsor=240K, (2) konkurs-mekanik=light, (3) 07f aktiverer automatisk fra sæson 2.

## Senest leveret
*(2026-05-06 og tidligere arkiveret til [`docs/archive/NOW_HISTORIK_2026-05-06.md`](archive/NOW_HISTORIK_2026-05-06.md))*

- 2026-05-06: **Cross-PC + workflow refactor** ([#67](https://github.com/NicolaiDolmer/CyclingZone/pull/67), commit `2265b33`) — preflight/migrate/setup-new-pc/install-user-hooks scripts + `cross-pc-stop-check.sh`. Bundlet med `#72` SessionStart-hook ([`scripts/session-prefetch-issue.sh`](../scripts/session-prefetch-issue.sh)) som pre-fetcher aktivt issue, `#68` migrerede PRODUCT_BACKLOG.md → 16 GitHub-issues (#79-#94), og `#70` GitHub-first CLAUDE.md cold-start ~800 tok (ned fra ~1500). User-hooks installeret på PC #2; migration på PC #1 mangler.
- 2026-05-07: **Slice 07a v2.50** — `backend/lib/economyConstants.js` med 7 delte konstanter; 299/299 backend-tests grønne.
- 2026-05-07: **Økonomi-audit** — 3 parallelle Explore-agents, 9 fund (4 P0/3 P1/2 P2), 8 slice-briefings 07a-h ([master](slices/07-economy-overhaul-MASTER.md), [audit](archive/ECONOMY_AUDIT_2026-05-07.md)).

## Næste session
1. **PC #1 cross-PC migration** (afventer): på OneDrive-PC'en, kør `pwsh -File scripts/preflight-check.ps1` → hvis grøn, `pwsh -File scripts/migrate-to-clean-location.ps1 -DryRun` → review → `-NoDryRun`. Derefter `pwsh -File scripts/install-user-hooks.ps1`. Runbook: [`docs/CROSS_PC_SETUP.md`](CROSS_PC_SETUP.md).
2. **Triage Discord-bridge issues** (#7-#52) — bulk-close items done. Især #28 reset-til-sæson-0 + #45 (dækkes af #80/07b).
3. **Slice 07b ([#80](https://github.com/NicolaiDolmer/CyclingZone/issues/80)) kick-off** efter triage. Briefing auto-loaded i `.codex.local/SESSION_CONTEXT.md` via SessionStart hook.
4. **Tier 4 Discord-arkivering:** 2 tråde manuel close (`1500927555731984567` + `1501473256417267722`).

## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — bevar eksisterende strukturer, tilføj ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 240K (matcher DB-default; samlet i `backend/lib/economyConstants.js` siden v2.50), gældsloft D1/D2/D3=1.2M/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- AI/bank/frozen får ALDRIG board-state (members, identity_basis, dna, consequences) — manager-only per Q-batch 1A Q8
- **Discord-GitHub bridge:** images via `scripts/sync-discord-attachments.js` → commit + push → reference via `raw.githubusercontent.com`. Token i `.mcp.json` (gitignored). MCP-write-403 kendt — brug `gh` CLI fallback.
