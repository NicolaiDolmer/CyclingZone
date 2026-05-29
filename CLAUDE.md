# CLAUDE.md

> **GitHub-first start-rutine** (indført 2026-05-06 per [#70](https://github.com/NicolaiDolmer/CyclingZone/issues/70)). Token-baseline 2026-05-14: see `docs/metrics/token-baseline-before.json` (pre-Phase-1-4) og `docs/metrics/token-baseline-after-phase-1-4.json`.

## Hard rules (fælles — fuld tekst i AGENTS.md)

Gælder også Claude Code, selvom `AGENTS.md` ikke auto-loades her: verificér repo-root (`git rev-parse --show-toplevel`) før edit · delt context i GitHub/OneDrive, aldrig lokal-only · verificér runtime før du lister noget som TODO/bug · spørg ved tvivl (70-95%) · patch notes ved enhver brugerrettet ændring · auto-push efter commit · re-link OneDrive-hardlinks efter manuel edit (`scripts/link-onedrive-context.ps1`). Fuld tekst + slice-close-out-reglen: [`AGENTS.md`](AGENTS.md).

## Auto-loaded (intet at gøre)

- `~/.claude/.../memory/MEMORY.md` — HOT-tier auto-memory (~1,100 tok efter Phase 1 reduktion). Tier-disciplin i `memory/README.md`. WARM-tier: `MEMORY_REFERENCE.md` (on-demand).
- `.codex.local/SESSION_CONTEXT.md` — bounded, regenererbar cache af aktivt GitHub-issue (~500 tok) via `scripts/session-prefetch-issue.sh`. Ikke source of truth.

## Start (eksplicit)

1. Læs `docs/NOW.md` — kort status (**🎯 Next action** + **🤖 Working agent** øverst i "Aktiv styring", aktiv slice + næste session-noter). Hvis "Working agent" viser en anden aktiv session → STOP + spørg brugeren før pick-up (multi-AI claim, [#559](https://github.com/NicolaiDolmer/CyclingZone/issues/559)).
2. **Aktivt issue:** kan læses fra `SESSION_CONTEXT.md`, men sandheden er GitHub + `docs/NOW.md`. Stale eller mangler? `gh issue list --label "claude:todo" --state open --limit 10`
3. `docs/GUARDRAILS_CORE.md` læses KUN hvis issue-labels indeholder `needs-contract` eller `shared-refactor` (~80% af sessioner skipper).
4. **Frontend/i18n-PR pre-flight:** build + warning-budget + i18n-keys + `npx playwright test core-smoke.spec.js` (uden `--project`-flag — kører desktop-chromium + mobile-chromium + mobile-webkit) lokalt FØR push. Hvis du laver visuelle ændringer eller refresher snapshots, kør ALLE 3 projekter, ikke kun desktop. CI fejler ellers på mobile selv om desktop passer (#536 ramte denne fælde 2026-05-21). Loop-guard: 2 CI-fails på samme symptom → STOP + spørg. Se `.claude/learnings/2026-05-17-symptom-patching-loop-vs-root-cause.md`.
5. **Efter `git pull` der rør ved en `*package-lock.json`** → kør `npm run sync-deps` (eller `npm run doctor` → tjek `install-parity` row). `npm install` kan lyve med "up to date" mens direct deps er bagud lockfile (#616/#618). `npm ci` er eneste pålidelige sync.

## On-demand docs

Fuld doc-index: [`docs/META_DOCS_INDEX.md`](docs/META_DOCS_INDEX.md). Top-3 hits:
- `docs/GAME_INVARIANTS.md` — Economy-konstanter, finalization-paths, upload-grænser
- `docs/AI_OPS_DISABLE_PLAYBOOK.md` — MCP/skills disable-handlinger
- `docs/GITHUB_WORKFLOW.md` — Workflow, agent-loops, close-protocol
- `docs/AGENT_ARCHITECTURE.md` — Parallel-session safety, cross-agent failure-modes (auto-gen)
- `docs/WORKTREE_WORKFLOW.md` — Parallelle Claude Code-sessioner via git worktrees (`scripts/new-worktree.ps1`)
- `docs/AI_CHANNEL_ROUTING.md` — Kanal-til-task-matrix (Code vs chat vs Cowork vs Dispatch); læs ved tvivl om hvilken AI-kanal en task hører til
- `docs/VERDENSKLASSE_ROADMAP.md` — Konsolideret AI/Ops + skalerings-roadmap (Track A vs Epic #323); læs før du picker AI-ops/cross-PC/scaling-issues
- `docs/AI_COUNCIL.md` — Rolle-matrix, SLA, fallback-protokol for Claude/Codex/Manus; læs ved tvivl om hvem der ejer en beslutning ([#564](https://github.com/NicolaiDolmer/CyclingZone/issues/564))

## Close-out (per session)

1. **Issue:** `gh issue comment N --body "..."` eller `gh issue close N --reason completed` hvis verificeret. Bruger lukker selv per label-state-maskine i `GITHUB_WORKFLOW.md`.
2. **NOW.md:** opdatér hvis aktiv slice ændrer sig — maks 30 linjer. Trim gamle close-out-blokke **direkte** (historik bevares i git-log + issue-tråde); opret IKKE separate `docs/archive/NOW-*.md` — mappen er hard-beskyttet af #684-deny ([#750](https://github.com/NicolaiDolmer/CyclingZone/issues/750)). **Obligatorisk:** opdatér **🎯 Next action** (peg på næste session-kandidat eller nulstil) + nulstil **🤖 Working agent** til "Ingen aktiv session" ([#558](https://github.com/NicolaiDolmer/CyclingZone/issues/558)/[#559](https://github.com/NicolaiDolmer/CyclingZone/issues/559)).
3. **FEATURE_STATUS.md:** opdatér hvis kontrakter eller features ændret.
4. **PatchNotesPage.jsx:** opdatér ved enhver brugerrettet ændring (eller skriv hvorfor ikke).
5. **Postmortem:** ved bugfix → `.claude/learnings/<dato>-<slug>.md`.
6. **Token-hygiejne:** kør `pwsh -File scripts/check-agent-token-hygiene.ps1` ved lange sessioner.

Ingen lokal-only handoff: projekt-state, beslutninger og næste skridt skal være i GitHub (`docs/NOW.md`, issues, slice-docs) eller OneDrive-context. Lokale transcripts, Codex memories og `.codex.local/SESSION_CONTEXT.md` er caches/pointers.

## Session-rytme

- Signalér 🟢/🟡/🔴/🆕 ved naturlige break-points
- Tjekliste før commit; ÉN issue pr. session
- Foreslå "Næste session starter med #N..." ved close-out

## Token-budget

Master (inkl. aktuel baseline + #605-targets): [`docs/AI_OPS_TOKEN_BUDGET.md`](docs/AI_OPS_TOKEN_BUDGET.md) + [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605).

Per-PC harness-snapshot: `docs/metrics/harness-snapshot-<COMPUTERNAME>.json`. Refresh ved connector/plugin-ændring.
