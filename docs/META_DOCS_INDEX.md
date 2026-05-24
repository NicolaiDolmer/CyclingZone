# Doc reference index (on-demand)

Læs disse docs på behov — de auto-loader ikke. Indekset er flyttet hertil fra `CLAUDE.md` (Phase 4 af `scalable-wobbling-blossom` plan, 2026-05-14) for at slanke cold-start.

| Doc | Læs hvornår |
|---|---|
| `docs/GUARDRAILS_CORE.md` | Issue har `needs-contract` eller `shared-refactor` label |
| `docs/GUARDRAILS.md` (fuld) | Nye datakontrakter · IA/naming-valg · shared runtime-refactors · features med flere plausible produktmodeller |
| `docs/HOOKS.md` | Hooks-konfiguration ændres |
| `docs/ARCHITECTURE.md` | Cross-domain refactor |
| `docs/DOMAIN_REFERENCE.md` | Domænegrænse-spørgsmål |
| `docs/FEATURE_STATUS.md` | Runtime-state usikker |
| `docs/CONVENTIONS.md` | Naming/style-spørgsmål |
| `docs/GITHUB_WORKFLOW.md` | GitHub-workflow eller agent-loop spørgsmål |
| `docs/GAME_INVARIANTS.md` | Game-balance konstanter (sponsor/balance/gældsloft/upload-grænser) |
| `docs/BUSINESS_STRATEGY.md` | Monetization-spørgsmål · tier-struktur · validation sprint · UCI/IP-risiko · dansk finansiering · fact-check krav |
| `docs/SPRINT_DASHBOARD.md` | Live status på 30-dages validation sprint · metrics-snapshot · uge-checkbox-tasks · founder-track · decision log |
| `docs/AGENT_ARCHITECTURE.md` | Cross-agent bug · parallel-session-setup · failure-mode lookup (auto-gen fra learnings) |
| `docs/WORKTREE_WORKFLOW.md` | Setup af parallelle Claude Code-sessioner via git worktrees · `new-worktree.ps1` / `remove-worktree.ps1` · node_modules-sharing · memory-junction · branch-collision gotchas |
| `docs/PARALLEL_WORKTREE_ORCHESTRATION.md` | 7-step protokol for parallel worktree-orchestration (3+ subagents, ~30 min wall-clock vs. 2-3h sekventielt) · candidate-selection · sub-agent prompt template · token-budget · pitfalls |
| `docs/AI_CHANNEL_ROUTING.md` | Tvivl om kanal-valg (Claude Code vs chat vs Cowork vs Dispatch) · use-case→kanal matrix · anti-patterns |
| `docs/AI_COUNCIL.md` | Tvivl om hvem (Claude/Codex/Manus) ejer en beslutning · SLA pr. rolle · fallback-protokol når en agent ikke leverer · issue→agent mapping (B12, [#564](https://github.com/NicolaiDolmer/CyclingZone/issues/564)) |
| `docs/DISPATCH_PLAYBOOK.md` | Før mobil→PC agentic dispatch (scheduled-tasks, Claude mobile app Dispatch, RemoteTrigger) · safe/forbidden tasks · pre-flight checklist · verification on return |
| `docs/VERDENSKLASSE_ROADMAP.md` | Konsolideret AI/Ops + skalerings-roadmap (Track A token-reduktion + cross-PC vs Track B Epic #323) · overlap-mapping · anbefalet eksekvering |
| `docs/AI_OPS_DISABLE_PLAYBOOK.md` | MCP/skills audit + disable-handlinger |
| `docs/AI_OPS_QUALITY_CANARIES.md` | Regression-tjek efter token-reduktion |
| `docs/AI_OPS_TOKEN_BUDGET.md` | Token-budget regler + tier-system |
| `docs/AI_OPS_BLIND_SPOTS.md` | Ops blind spots og fail-modes |
| `docs/AI_OPS_COST_MODEL.md` | Cost-baseline ved 5k/10k brugere |
| `docs/RUNBOOK_RESTORE_DRILL.md` | Supabase backup restore-drill cadence, procedure og smoke-tests |
| `docs/SEASON_TRANSITION_CHECKLIST.md` | Admin-checklist for sæson N→N+1 (sæt closes_at, cron-chain-tider, verifikation, abort-procedure) |
| `docs/slices/<slug>.md` | Slice har dedikeret brief |
| `docs/prompts/<type>.md` | Session-prompt templates: `bugfix.md` · `investigation.md` · `postmortem.md` · `mobile-to-code.md` · `ultrareview-economy.md` (B7/B8, [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561)/[#562](https://github.com/NicolaiDolmer/CyclingZone/issues/562)) |
| `gh issue view N --comments` | Behov for sessionshistorik på issue |
