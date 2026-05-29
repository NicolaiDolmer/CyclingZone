# permissions.deny er den eneste hard-block der overlever acceptEdits + allow-list

**Dato:** 2026-05-29
**Issue:** [#684](https://github.com/NicolaiDolmer/CyclingZone/issues/684) (AC6 spin-off fra #385)
**CC-version:** 2.1.154
**Relaterede:** #591 (Write/Edit/NotebookEdit i allow), [anthropics/claude-code#18312](https://github.com/anthropics/claude-code/issues/18312)

## Symptom
PreToolUse hard-block-hooks (`block-archived-edit`, `check-now-md-edit`, `block-dangerous-secret`) fyrede korrekt og returnerede `exit 2`, men blokeringen blev ignoreret når tool'et stod i `permissions.allow` — eller når sessionen kørte i `acceptEdits`-mode. En autonom subagent kunne dermed redigere arkiverede docs trods guardrail.

## Hvad vi modbeviste (empirisk, friske sessioner)
- **Fix A** (hook returnerer JSON `permissionDecision: deny` i stedet for `exit 2`): bypasses lige så meget i acceptEdits. Write gik igennem.
- **Fix B** (fjern Write/Edit/NotebookEdit fra `permissions.allow` + kør acceptEdits): Write gik stadig igennem. acceptEdits auto-approve trumfer hook-blokering uanset allow-state.
- Konklusion: **ingen permission-mode** håndhæver hook-hard-blocks samtidig med prompt-fri subagent-writes. Hook-`exit 2` håndhæves kun i default-mode for ikke-allow-listede tools.

## Rod-årsag
Hook-baserede blokke (uanset `exit 2` eller JSON-deny) sidder *under* permission-laget i precedence. Både `permissions.allow` og `acceptEdits`-mode auto-approver FØR hookens afvisning vejes ind (CC ≥2.1.154, #18312). Hooks kan derfor advare/logge, men ikke hard-blocke et allow-listet/auto-approved tool-kald.

## Fix D (verificeret)
Statiske `permissions.deny`-globs sidder i permission-laget med precedence `deny > ask > allow` — de håndhæves FØR auto-approve. Modtest i frisk acceptEdits-session:
```
Write → docs/archive/_probe-deny.md
→ "File is in a directory that is denied by your permission settings"
→ filen nåede aldrig disken
```
Den relative glob `docs/archive/**` matchede den Windows-absolutte `file_path` CC sender (path-matching-bekymringen var ubegrundet — relativ glob virker).

Endelig opsætning i `.claude/settings.json`:
- `permissions.deny`: `Write/Edit/NotebookEdit(docs/archive/**)` (+ `./`-varianter).
- `permissions.allow`: `Write`/`Edit`/`NotebookEdit` re-added → prompt-fri writes alle andre steder (autonomi), mens deny vinder for arkiv-stier (guardrail). Begge på én gang.

## Tilbageværende gap (upstream-blokeret)
Guardrails der afhænger af *indhold* frem for *sti* kan ikke udtrykkes som statiske deny-globs:
- `check-now-md-edit` (NOW.md ≤30 linjer) — kræver at læse filens linje-antal.
- `block-dangerous-secret` (dynamisk secret-pattern i Bash-args) — kræver indholds-match.

Disse forbliver hook-only → afvæbnede for allow-listede tools i acceptEdits indtil #18312 fixes upstream. **Mitigation:** hold dem i menneske-review ved autonome parallel-runs.

## Læring (generaliserbar)
> Hard-blocks du vil have håndhævet mod autonome/allow-listede tools SKAL udtrykkes som `permissions.deny`-globs, ikke som PreToolUse-hook-`exit 2`. Hooks er til advarsler, logging og indholds-baseret heuristik — ikke til uomgængelig håndhævelse. Hvad der kan udtrykkes som en sti-glob, hører i `permissions.deny`.
