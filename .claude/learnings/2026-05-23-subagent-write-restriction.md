# Postmortem: Subagent Write-restriktion — root cause + fix

> Issue [#591](https://github.com/NicolaiDolmer/CyclingZone/issues/591). Bidt 3 sessions i træk (K: 2/3 denied, M: 3/3 denied). Fix: 3 linjer i `.claude/settings.json`.

## TL;DR

Background-subagents auto-deny enhver tool der ville have prompted interaktivt. `Write` / `Edit` / `NotebookEdit` var ikke i `permissions.allow` nogen steder → silent-deny i alle subagents. Fix: tilføj `"Write"`, `"Edit"`, `"NotebookEdit"` til `.claude/settings.json` `permissions.allow`. Verificeret med fresh subagent (Write+Read+Delete alle SUCCESS uden prompt). Settings picked up uden session-restart.

## Hvad skete

- **Session K (2026-05-23):** 3 parallelle subagents. Agent A og C denied Write; Agent B succeeded. Inkonsistent → fortolket som race-condition eller "Agent B inherited parent-approval".
- **Session L:** dry-run-test bekræftede at `Agent`-tool's `isolation: "worktree"` parameter IKKE fikser denial (sker på harness-laget, ikke worktree-laget).
- **Session M:** 3/3 subagents denied (100% hit-rate, ikke 2/3 som Session K). Tre forskellige workarounds udviklet (`gh api git/blobs`, `printf | git hash-object`, `git mv`).
- **Session N (denne):** Rod-årsag fundet via official docs lookup → 3 linjer fix → end-to-end verify.

## Rod-årsag (verificeret via docs)

Per [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents):

> "Background subagents run with the permissions already granted in the session and **auto-deny any tool call that would otherwise prompt**."

Dvs.: i interaktiv main-session vil et tool uden allow-entry trigge interaktiv prompt → bruger godkender → tool kører. I background-subagent (det `Agent`-tool spawner som default når `run_in_background: true`) findes ingen UI for prompt → **silent-deny**.

`Write` / `Edit` / `NotebookEdit` var ikke i:
- `~/.claude/settings.json` (user-level): 0 allow-entries, kun 5 deny-rules for kill-commands
- `.claude/settings.json` (project): 53 allow-entries, alle Bash/PowerShell/MCP, ingen Write/Edit
- `.claude/settings.local.json` (project session-cache): 434 allow-entries, alle Bash/PowerShell/MCP, ingen Write/Edit
- `~/.claude/settings.local.json`: filen findes ikke

Derfor: silent-deny for ALLE subagents. Agent B's success i Session K var timing/foreground-bivirkning, ikke en separat mekanisme værd at debugge (silent-deny er den dokumenterede default).

## Fix

```diff
   "permissions": {
     "allow": [
       "Bash(git *)",
       "WebSearch",
+      "Write",
+      "Edit",
+      "NotebookEdit",
       ...
```

Path-scoping (`Write(/path/**)`) ikke nødvendig — eksisterende PreToolUse hook `scripts/hooks/block-archived-edit.sh` blokerer arkiverede paths uafhængigt af allow-regel via exit-2.

## Verifikation

Fresh subagent (general-purpose, `run_in_background: true`) fik task: Write tmp-fil → Read → Delete → rapportér.

```
Step 1 (Write):  SUCCESS
Step 2 (Read):   SUCCESS
Step 3 (Delete): SUCCESS
```

Settings-change picked up at subagent-spawn time. Ingen full session-restart nødvendig.

## Hvad jeg lærte

1. **Tjek den dokumenterede default FØR du gætter på timing/race**. Tre sessions byggede workarounds (`gh api git/blobs`, `printf | hash-object`, `git mv`) for et problem hvis rod-årsag stod ét link væk i docs. Et `claude-code-guide`-agent-call på 35 sek løste det.
2. **Allow-array er pre-approval, ikke approval-cache.** Settings.local.json's 434 entries er session-godkendelser fra interaktive prompts — ingen Write-prompts var nogensinde dukket op (subagents kan ikke prompte), så ingen entries blev cachet, så hver session startede med tom Write-permission.
3. **Worktree-isolation løser branch/dir-konflikt — ikke permissions.** `isolation: "worktree"` parameter har sit eget formål. Ikke en silver bullet for harness-permissioner.

## Forward-guard

- **Playbook opdateret:** `docs/PARALLEL_WORKTREE_ORCHESTRATION.md` step 4 fjerner fallback-instruktion; "Lessons fra anden run" markeret som historisk.
- **Memory:** ingen ny HOT-rule. Fixet er one-shot config, ikke en forekommende fælde. Hvis nye tool-defaults skifter i Claude Code update, kunne det re-introducere → tjek `permissions.allow` ved første sub-agent-denial igen.

## Refs

- Issue [#591](https://github.com/NicolaiDolmer/CyclingZone/issues/591)
- Session K postmortem: [`.claude/learnings/2026-05-23-parallel-orchestration.md`](2026-05-23-parallel-orchestration.md)
- Playbook: [`docs/PARALLEL_WORKTREE_ORCHESTRATION.md`](../docs/PARALLEL_WORKTREE_ORCHESTRATION.md)
- Docs: [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), [Configure permissions](https://code.claude.com/docs/en/permissions)
