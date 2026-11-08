# 2026-11-04: hook-advarsler naaede kun ejeren

**Symptom:** Ejeren sendte fem skaermbilleder af hook-advarsler (PREFLIGHT-GUARD, CLOSE-OUT REMINDER, cross-PC sync, CI-FAIL-LOOP-GUARD, MULTI-AI GATE), som Claude aldrig havde reageret paa.

**Rodaarsag:** Alle fem brugte kun `systemMessage`, som vises for ejeren, ikke for modellen. Claude pushede derfor uden preflight efter merge-commits, lod MEMORY.md gaa over budget og lod main ligge foran origin. Desuden: CI-vagten talte `cancelled` (afloest af et nyere push) som fejl, preflight-/CI-vagten tjekkede sessionens cwd i stedet for det worktree, `cd X && git push` pushede fra, og Codex' SessionEnd fjernede ikke altid sit claim (syv claims fra 14.-28/10).

**Forebyggelse:**
- PreToolUse-vagterne afviser nu pushet med en begrundelse til Claude (`permissionDecision: deny`), med eksplicit undtagelse (`PREFLIGHT_SKIP=` / `CI_FAIL_ACK=`).
- Stop-hooks sender `decision: block` + reason (loop-vaern: dedupe pr. session og `stop_hook_active`).
- SessionStart-gaten sender ogsaa `additionalContext`.
- Codex giver livstegn pr. tur (`-Mode beat`); claims uden livstegn i over 48 t taeller ikke i gaten og ryddes med `-Mode prune` (arkiveres).
- Memory: `feedback_hooks_must_reach_claude.md`.
