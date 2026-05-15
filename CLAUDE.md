# CLAUDE.md

> **GitHub-first start-rutine** (indført 2026-05-06 per [#70](https://github.com/NicolaiDolmer/CyclingZone/issues/70)). Token-baseline 2026-05-14: see `docs/metrics/token-baseline-before.json` (pre-Phase-1-4) og `docs/metrics/token-baseline-after-phase-1-4.json`.

## Auto-loaded (intet at gøre)

- `~/.claude/.../memory/MEMORY.md` — HOT-tier auto-memory (~1,100 tok efter Phase 1 reduktion). Tier-disciplin i `memory/README.md`. WARM-tier: `MEMORY_REFERENCE.md` (on-demand).
- `.codex.local/SESSION_CONTEXT.md` — bounded, regenererbar cache af aktivt GitHub-issue (~500 tok) via `scripts/session-prefetch-issue.sh`. Ikke source of truth.

## Start (eksplicit)

1. Læs `docs/NOW.md` — kort status (aktiv slice + næste session-noter).
2. **Aktivt issue:** kan læses fra `SESSION_CONTEXT.md`, men sandheden er GitHub + `docs/NOW.md`. Stale eller mangler? `gh issue list --label "claude:todo" --state open --limit 10`
3. `docs/GUARDRAILS_CORE.md` læses KUN hvis issue-labels indeholder `needs-contract` eller `shared-refactor` (~80% af sessioner skipper).

## On-demand docs

Fuld doc-index: [`docs/META_DOCS_INDEX.md`](docs/META_DOCS_INDEX.md). Top-3 hits:
- `docs/GAME_INVARIANTS.md` — Economy-konstanter, finalization-paths, upload-grænser
- `docs/AI_OPS_DISABLE_PLAYBOOK.md` — MCP/skills disable-handlinger
- `docs/GITHUB_WORKFLOW.md` — Workflow, agent-loops, close-protocol

## Close-out (per session)

1. **Issue:** `gh issue comment N --body "..."` eller `gh issue close N --reason completed` hvis verificeret. Bruger lukker selv per label-state-maskine i `GITHUB_WORKFLOW.md`.
2. **NOW.md:** opdatér hvis aktiv slice ændrer sig — maks 30 linjer, historik til `docs/archive/`.
3. **FEATURE_STATUS.md:** opdatér hvis kontrakter eller features ændret.
4. **PatchNotesPage.jsx:** opdatér ved enhver brugerrettet ændring (eller skriv hvorfor ikke).
5. **Postmortem:** ved bugfix → `.claude/learnings/<dato>-<slug>.md`.
6. **Token-hygiejne:** kør `pwsh -File scripts/check-agent-token-hygiene.ps1` ved lange sessioner.

Ingen lokal-only handoff: projekt-state, beslutninger og næste skridt skal være i GitHub (`docs/NOW.md`, issues, slice-docs) eller OneDrive-context. Lokale transcripts, Codex memories og `.codex.local/SESSION_CONTEXT.md` er caches/pointers.

## Session-rytme

- Signalér 🟢/🟡/🔴/🆕 ved naturlige break-points
- Tjekliste før commit; ÉN issue pr. session
- Foreslå "Næste session starter med #N..." ved close-out

## Token-budget (efter Phase 1-4, 2026-05-14)

| Komponent | Tokens | Note |
|---|---|---|
| MEMORY.md (HOT auto) | ~1,100 | Skåret fra 4,400 (Phase 1) |
| SESSION_CONTEXT.md | ~500 | Bounded prefetch |
| CLAUDE.md (denne) | ~600 | Skåret fra ~1,000 (Phase 4) |
| NOW.md | ~600 | Maks 30 linjer |
| GUARDRAILS_CORE.md | ~1,100 (kun ~20% sess.) | Trigget af label |
| MCP+skills harness-blob | ~3,000-5,500 | Beror på Phase 2+3 disables |
| **Cold-start total** | **~6,000-9,000** | Down fra ~17,000 baseline |
