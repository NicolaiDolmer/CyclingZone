# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Slice 07b — TOCTOU + idempotency-keys** (M, ~2 sessioner). Foundation LIVE: Slice DX agent-loop (`c1a8970`) + Discord→GitHub bridge (`0d2b703`). Triage issues FØR 07b kick-off (live-tal i "Næste session" nedenfor) — flere overlapper med 07a-c work eller er allerede done. **Soak-gate: ikke aktiv.**

## Open beta status
**Open beta live siden 2026-05-04, sæson 1 aktiv, 0 sæsoner afsluttet.** ~19 managers. S-02 KOMPLET (S-02a–S-02j). 07a leveret som v2.50. Alle 3 pre-kode-beslutninger til 07 låst 2026-05-07: (1) sponsor=240K, (2) konkurs-mekanik=light, (3) 07f aktiverer automatisk fra sæson 2. Pre-launch dev-docs i archive/ refererer til "sæson 6/7" = test-DB FØR beta-reset; ignorér.

## Senest leveret
*(2026-05-06 og tidligere arkiveret til [`docs/archive/NOW_HISTORIK_2026-05-06.md`](archive/NOW_HISTORIK_2026-05-06.md))*

- 2026-05-07: **Slice 07a v2.50** — `backend/lib/economyConstants.js` med 7 delte konstanter; 299/299 backend-tests grønne. Doc-drift fix: 260K→240K i FEATURE_STATUS + FinanceFirstVisitHint.
- 2026-05-07: **Økonomi-audit** — 3 parallelle Explore-agents, 9 fund (4 P0/3 P1/2 P2), 8 slice-briefings 07a-h ([master](slices/07-economy-overhaul-MASTER.md), [audit](archive/ECONOMY_AUDIT_2026-05-07.md)).
- 2026-05-06: **Discord MCP cross-PC automation** (`2d4377c`). `scripts/setup-discord-mcp.ps1` henter `DISCORD_BOT_TOKEN` fra Railway via Railway CLI og skriver `.mcp.json` til main repo + alle 13 worktrees. Manuel setup → én kommando. Verificeret: bot connected som `Cycling Zone#8784`. Setup-guide: [`docs/DISCORD_MCP_SETUP.md`](DISCORD_MCP_SETUP.md).

## Næste session — især efter PC-skift
1. **På ny PC:** Pull main + følg [`docs/DISCORD_MCP_SETUP.md`](DISCORD_MCP_SETUP.md) for at recreate `.mcp.json` (gitignored, lokal-only fil med token).
2. **Triage 46 nye issues (#7-#52)** — bulk-close items done. `gh issue close <NUM> --reason completed --comment "Allerede løst i [version]"`. Især: bobby-brainstorm + #28 reset-til-sæson-0 + #45 mange-små-lån (dækkes af 07b). Nye 2026-05-06: #49 ryttertyper (afventer Q1–Q7-svar fra Nicolai før kodning), #50 admin UI-inddeling, #51 Deadline Day news feed (investigate), #52 Clarity-loop.
3. **Tier 4 Discord-arkivering:** 2 tråde manuel close (right-click → Close Thread) — `Rytter table i ønskeliste` (1500927555731984567) + `.sredna gældsloft falsk-positiv` (1501473256417267722).
4. Slice 07b kick-off først EFTER issue-triage er done.

## Kritiske invarianter
- **Verificér runtime FØR claim** — grep før TODO-claims
- **Skaler for variabelt manager-tal** — ingen hardcoded antal (vokser løbende fra ~19)
- **Build on top, don't replace** — bevar eksisterende strukturer, tilføj ved siden af
- Economy: SALARY_RATE=0.10 (DB-GENERATED, kan ikke skrives fra app), sponsor 240K (matcher DB-default; samlet i `backend/lib/economyConstants.js` siden v2.50), gældsloft D1/D2/D3=1.2M/900K/600K
- UCI-sync må aldrig nulle high-value ryttere (popularity≥70 OR uci_points≥100 auto-protected)
- `applyRaceResults` udbetaler IKKE præmier — kun `prizePayoutEngine.paySeasonPrizesToDate`
- AI/bank/frozen får ALDRIG board-state (members, identity_basis, dna, consequences) — manager-only per Q-batch 1A Q8
- **Discord-GitHub bridge:** images via `scripts/sync-discord-attachments.js` → commit + push → reference via `raw.githubusercontent.com`. Token i `.mcp.json` (gitignored). MCP-write-403 kendt — brug `gh` CLI fallback.
