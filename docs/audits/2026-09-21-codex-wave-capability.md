# Codex wave capability probe, 21 September 2026

Authority: #5467, owner's second comment on 21 September; explicit request to probe then build the full entry. Owner granted a one-task exception to the already exceeded PR cap for building #5467. The shipped admission policy has no such bypass.

SSOT: [agent architecture](../AGENT_ARCHITECTURE.md), [parallel orchestration](../PARALLEL_WORKTREE_ORCHESTRATION.md). No product data or production mutations were used.

| Probe | Positive observation | Limit |
|---|---|---|
| Native desktop child | Spawned, ran arithmetic and reported completion; list_agents showed completed | Inherited main cwd; no per-child cwd/sandbox parameter. Git in the explicit worktree hit dubious ownership. Shell exit 0 did not reflect the failed Git commands |
| Installed CLI | codex-cli 0.153.4; `-C` selected the requested worktree; JSON events and terminal exit 0 observed | Version-specific local evidence, not a universal Codex promise |
| Live fixture wave | Two CLI workers, two fresh reviewers, two correct arithmetic results. Four recorded process exits were 0. Own marker absent after completion | Read-only arithmetic in synthetic temporary repositories, not a production issue pilot |
| Interruption | Both fixture workers stopped, both rows blocked, zero reviews, own marker removed | Windows taskkill scoped to each spawned process tree; parent hard-crash recovery is conservative/manual |
| Read-only boundary | One Set-Content attempt in a fixture cwd failed with access denied and exit 1; no file created | Proves this read-only sandbox, not all worker permissions or connector restrictions |
| Shared policy fixtures | Competing runtimes, full queue, malformed/expired marker, failed GitHub read, foreign cleanup and overlap cases tested | Direct commands outside the admitted entries are not intercepted by this policy |
| Claude hook | Full shell chain: 30 scenarios passed, including canonical scriptPath dry-run and refusal against existing marker | Runtime-specific hook trust still has to be enabled. Positive fresh admission through a fake gh executable is also wired into Linux CI |
| Claims | Actual PowerShell claim create/repeat/remove tested in synthetic Git repo; another session's claim retained. Python reader sees Codex claims and waves | Project hooks were not installed/reloaded into the owner's currently running Claude session |

Implementation choice: the main Codex task remains architect. `scripts/codex-wave.mjs` controls CLI child processes with explicit cwd, sandbox and structured results. It reuses `new-worktree.ps1`, `make-wave-brief.mjs`, `verify-lock.ps1` through generated briefs, and `wave-freeze.mjs`. Merges remain a separate owner-authorized call to `merge-queue.ps1`.

Mechanical gates: atomic wave admission, shared five-PR count/reservation, plan overlap rejection, bounded lane count, separate reviewer process, recorded child closure and owned marker cleanup. Verify-lock mechanically limits wrapped commands only. File-ownership validation is after-the-fact, not a filesystem ACL. Claude setup reporting, correct test wrapping, no prod/merge commands inside a worker, and durable sanitized handoff still require brief/review discipline.

The independent reviewer found four defects during development: the canonical Claude entry could block itself; broad ownership could include reserved paths; rebases polluted the initial-base diff; failed process termination could wait indefinitely. All four were corrected and re-reviewed. Session claim removal was also moved from turn-level Stop to SessionEnd, following [official hook semantics](https://learn.chatgpt.com/docs/hooks).

No throughput improvement is claimed. Time to merged PR is unmeasured because nothing was merged; owner-active minutes were not measured. The fixture is capability evidence, not the owner-selected production pilot in #5467.

## Follow-up to Claude review on #5468, 21 September

Owner decision: PR_LIMIT is now 8, including every parked draft. Hook timeout is 60 seconds. Marker replacement is atomic, legacy markers fail explicitly, and a single `wave-policy.mjs recover` command checks ownership and liveness. Same-boot historical descendant absence cannot be proved from a process snapshot, so recovery after dispatch requires an observed Windows reboot. Before dispatch, an observed dead owner is sufficient. The recovery lock is boot-qualified, and old watch PIDs are never killed after reboot.

The actual Claude client test remains a post-merge gate: no active wave at merge, explicit owner merge instruction, then one harmless docs track and checks of session_id and own WAVE-prefixed agents. Rollback instructions are in the PR body and orchestration SSOT. This is not reported as already tested in Claude.

Follow-up verification: concurrent marker writers preserve all 40 updates; a post-spawn process-record failure was injected into two real CLI children, both observed stopped before release. CodeRabbit reported three issues: marker serialization and Git-derived merge checks were fixed; deferring dispatchStarted until AI-worker start was rejected because setup already launches worktree/install subprocesses. There was one authorized CodeRabbit CLI round.
