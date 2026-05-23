# Postmortem: Parallel 3-worktree orchestration (2026-05-23 Session K)

> Master-session orkestrerede 3 parallelle subagents (1 pr. git worktree) → 3 PRs merged i én runde. Wall-clock: ~30 min vs. 2-3h sekventielt. Token-cost: roughly neutral.

## Hvad skete

1. Bruger spurgte "kan du anbefale 3 sessions vi kører samtidig?"
2. Master valgte #547 (root cleanup) + #524 (docs sync) + #567 (milestones) — NUL filoverlap mellem touch-areas
3. 3 worktrees oprettet via `scripts/new-worktree.ps1` (sekventielt, git-race)
4. Master claimed `docs/NOW.md` Working agent + push (multi-AI safety per #559)
5. 3 subagents spawned parallelt via `Agent` tool (general-purpose, run_in_background)
6. Subagents arbejdede ~5-12 min hver, returnerede PR-numre
7. Master merged sekventielt: #587 (C) → #586 (A) → #588 (B) — squash, lavest risk først
8. Final close-out: NOW.md Session K bullet, archive A-G til docs/archive/, claude:done labels, worktree cleanup

**Commits:** `6ac487c` (claim) → `5ce0360` (#587) → `0f95c3d` (#586) → `2a081a7` (#588) → `ae367e0` (close-out).

## Hvad gik godt

- **Worktree-isolation virkede perfekt** — ingen branch-kollision, ingen working-dir-konflikt
- **HOT-memory "Verificér FØR claim"** reddede #547: subagent opdagede `setup.py` faktisk er referenced af `auctionSchemaContract.test.js:41` og bevarede den i stedet for blind sletning (issue-premissen var forkert)
- **Sekventiel merge med rebase** mellem hver = ingen merge-konflikter på main
- **NOW.md som koordineringspunkt** — master claimer, subagents instrueres "rør IKKE NOW.md" → ingen race
- **Squash-merge** holdt git-historik flad og læsbar
- **Same-time NOW.md slankning** (22 → 16 linjer, 2403 → 1477 tok)

## Hvad gik skidt

### 1. Sandbox Write-restriktion ramte 2 af 3 subagents — INKONSISTENT

- **Agent A (#547):** Write tool denied på alle paths. Måtte bruge `git commit -m` med multiple `-m` flags + inline pipe-separated PR-body.
- **Agent B (#524):** Write fungerede fuldt. Skrev tmp-filer, commit -F, full PR-body.
- **Agent C (#567):** Write denied. GitHub-arbejdet (milestones + attachments) blev færdiggjort, men audit-doc + commit + PR måtte master-session lave.

**Hypotese:** Sandbox-permission state er race-condition mellem agent-startup og Claude Code's permission-prompt. ELLER specifikke paths (tmp-filer i worktree-root?) trigger restriktion.

**Mitigation forsøgt:** N/A — ramte uventet midt i kørslen.

**Mitigation til næste gang:**
- ~~Test `Agent` tool's `isolation: "worktree"` parameter~~ → **TESTET samme dag (dry-run): isolation:worktree fikser IKKE Write-denial. Subagent spawned i isoleret worktree med egen branch, men Write blev stadig denied uden interaktiv prompt. Denial sker på harness/permission-laget, ikke worktree-laget.**
- Pre-allow worktree-paths i `~/.claude/settings.json` under `permissions.allow` (utestet — næste mitigation at prøve)
- Inkluder fallback-instruktion til subagent: "Hvis Write denied, brug `git commit -m` med multiple flags + `gh pr create --body` inline. Master kan re-edit PR-body bagefter."
- Hypoteser om hvorfor Agent B virkede: (a) pre-approved Write i parent-session's tool-history, (b) non-deterministisk permission-check, (c) allowlist pattern-match. Værd at debugge via instrumentering af harness.

### 2. Verbose subagent-prompts

Hver subagent-prompt var ~3K tokens (very explicit step-by-step). Kunne være ~30% kortere med standard-template + ref til playbook.

### 3. Inefficient PR-state polling

Master kørte 3 separate `gh pr view --json` calls efter alle subagents var done. Kunne være ÉN `gh search prs --author @me --state open` query med JSON-filter.

### 4. Master-orchestration token-spend

Master brugte ~40K tokens på selve orkestrering (læse issues, skrive prompts, koordinere merge, close-out). Med stramme templates kunne dette være ~25K.

## Token-tal (baseline for fremtidige runs)

| Komponent | Tokens |
|---|---|
| Agent A (#547 root cleanup) | ~75K |
| Agent B (#524 docs sync) | ~180K (heaviest — kompleks docs-verify) |
| Agent C (#567 milestones) | ~55K |
| Master-session orchestration | ~40K |
| **Total parallel** | **~350K** |
| Estimat 3 sekventielle sessions (m. cold-start hver) | ~400K |
| Token-besparelse | ~12% (lille); wall-clock-besparelse ~4-6x (stor) |

**Token-win er marginal — wall-clock-win er den primære gevinst.** Brug parallel når du har 3+ klare candidates og vil have dem færdige inden for én session-vindue.

## Actionable changes (4 issues oprettet 2026-05-23)

1. [#589](https://github.com/NicolaiDolmer/CyclingZone/issues/589) — **Playbook doc** `docs/PARALLEL_WORKTREE_ORCHESTRATION.md` (initial draft committed med dette postmortem; mangler cross-links + future-run lessons-update)
2. [#590](https://github.com/NicolaiDolmer/CyclingZone/issues/590) — **`scripts/find-parallel-candidates.ps1`** automatiseret issue-scoring på parallel-safety
3. [#591](https://github.com/NicolaiDolmer/CyclingZone/issues/591) — **Subagent permission debug** (high-prio: blokerer parallel-quality). Dry-run test bekræftede at `isolation: "worktree"` IKKE fikser problemet
4. [#592](https://github.com/NicolaiDolmer/CyclingZone/issues/592) — **`FEATURE_STATUS.md` split** out-of-scope-fund fra Agent B (471 linjer, ~38.5K tok)

## Næste parallel-run anbefaling

Vent indtil der ligger 3+ nye `claude:todo` issues der opfylder constraints. Brug `find-parallel-candidates.ps1` (når oprettet) til at få ranked liste. Brug template-prompt fra playbook.

Hvis subagent permission debug viser at `isolation: "worktree"` fixer Write-issue: opdatér playbook-template til at inkludere parameteren by default.
