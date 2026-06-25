# Slice 08 — AI-Autopilot Fase 2 — RETIRED (2026-06-25)

> **Denne slice er udfaset.** Målet var en "world-class AI-autopilot" med **Manus** som
> central orkestrator for Loop D (Auto-PR-review) og Loop F (Subagent-orkestrering). Med
> **solo Claude-operation** siden 2026-06-12 (ingen Manus) findes orkestratoren ikke.

Den bevarede del af visionen lever videre i en ny form:
- **Auto-PR-review** → CodeRabbit (Claude-model), `.coderabbit.yaml` (advisory), 2026-06-25.
- **Subagent-orkestrering** → Claude kører selv Explore/Plan-subagents + worktree-parallelisme
  (`docs/PARALLEL_WORKTREE_ORCHESTRATION.md`).
- **Invarianten** "ingen merge til main uden grønne tests" håndhæves uændret af CI.

Historik: `git log --follow docs/slices/08-ai-autopilot-fase-2.md`.
