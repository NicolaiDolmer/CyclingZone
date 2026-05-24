# Postmortem: Subagent worktree-path sandbox-boundary — root cause + fix

> Issue [#617](https://github.com/NicolaiDolmer/CyclingZone/issues/617). Followup til [#591](https://github.com/NicolaiDolmer/CyclingZone/issues/591). Bidt Session 2026-05-24-G (parallel run #4: 2 af 3 subagents blokeret på worktree-paths, master måtte overtage). Fix: 3 linjer i `.claude/settings.json`.

## TL;DR

Subagents arver project-root sandbox-boundary fra master-sessionen. Git worktrees ligger under `C:\dev\CyclingZone-worktrees\` (SIBLING til project root `C:\dev\CyclingZone`), ikke under det → alle tool-calls med worktree-path som argument silent-denied. Fix: tilføj `permissions.additionalDirectories: ["../CyclingZone-worktrees/"]` til `.claude/settings.json`. Verificeret 8/8 tool-typer (Read, Glob, Grep, Write, Edit, Bash `cd`, PowerShell, Bash `rm`).

## Hvad skete

- **Session 2026-05-24-G (parallel run #4):** 3 subagents spawnet mod 3 separate worktrees i `C:\dev\CyclingZone-worktrees\*`.
  - Agent #598: **BLOCKED.** Read/Glob/Grep/Write/Edit/PowerShell/Bash alle denied for worktree-path. Master overtog.
  - Agent #608: **BLOCKED.** Samme symptom — kun `git -C <worktree>` virkede (Bash(git *) pre-approved). Master overtog.
  - Agent #607: **WORKAROUND.** Editede filer i `C:\dev\CyclingZone` (main repo!), generede patch med `git diff`, applied med `git apply` i worktree. Det fungerede, men brød eksplicit prompt-instruktion "DU MÅ IKKE arbejde i C:\dev\CyclingZone".
- **Session 2026-05-24-L (denne):** Rod-årsag identificeret via official docs lookup → 3 linjer fix → end-to-end test (8/8 SUCCESS) → docs + postmortem.

## Rod-årsag (verificeret via [Claude Code permissions docs](https://code.claude.com/docs/en/permissions))

Per ["Working directories"-sektionen](https://code.claude.com/docs/en/permissions#working-directories):

> "By default, Claude has access to files in the directory where it was launched. You can extend this access ... `additionalDirectories` in [settings files]."
>
> "Files in additional directories follow the same permission rules as the original working directory: they become readable without prompts, and file editing permissions follow the current permission mode."

Default sandbox-boundary = cwd ved session-start. Subagents arver det fra master. Worktrees som `C:\dev\CyclingZone-worktrees\<slug>` er udenfor → alle path-baserede tool-calls (Read/Glob/Grep/Write/Edit) silent-denied i background-subagent (samme mekanisme som #591: subagents auto-deny enhver tool-call der ville prompte interaktivt).

Bash/PowerShell rammes også: per [read-only commands-sektion](https://code.claude.com/docs/en/permissions#read-only-commands) er `cd` ind i path "inside your working directory or an additional directory" auto-allowed; `cd` udenfor prompter → silent-deny i subagent.

Hypoteser i issue:
1. ❌ Subagent cwd-inheritance — ikke rod-årsag, men korrekt observation (cwd arves fra master).
2. ✅ **Permission allow-list dækker kun project-root** — KORREKT diagnose, men fix ligger i `additionalDirectories`, ikke `allow`-array path-scoping.
3. ❌ Race-condition mellem `new-worktree.ps1` og permission-grant — ikke rod-årsag.

## Fix

```diff
 "permissions": {
+  "additionalDirectories": [
+    "../CyclingZone-worktrees/"
+  ],
   "allow": [
     "Bash(git *)",
```

Path-format: relativ til project root (per docs). Trailing slash matcher mappe-præfiks for alle worktrees.

## Verifikation

Test-worktree oprettet: `chore/617-sandbox-verify` i `C:\dev\CyclingZone-worktrees\chore-617-sandbox-verify`. Fresh background-subagent kørte 8 tests:

| Step | Test | Result |
|---|---|---|
| 1 | Read absolut path (`README.md` i worktree) | SUCCESS |
| 2 | Glob (`*.md` i worktree) | SUCCESS |
| 3 | Grep (`CyclingZone` i worktree) | SUCCESS |
| 4 | Write tmp-fil i worktree | SUCCESS |
| 5 | Edit tmp-fil i worktree | SUCCESS |
| 6 | Bash `cd <worktree> && ls -la` | SUCCESS |
| 7 | PowerShell `Get-ChildItem -Path <worktree>` | SUCCESS |
| 8 | Bash `rm <worktree>/.tmp` (cleanup) | SUCCESS |

Subagent-observation: worktree's `CLAUDE.md` blev auto-injected som system-reminder ved første tool-call mod worktree-path (forventet adfærd jf. docs — `additionalDirectories` loader CLAUDE.md kun hvis `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` er sat; vi har det ikke sat, så injection var via parent-cwd-discovery — ikke et problem).

Settings-change picked up at subagent-spawn time. Ingen session-restart nødvendig.

## Hvad jeg lærte

1. **Tjek docs FØR du gætter** (igen — samme lesson som #591). 35 sek `claude-code-guide`-agent-call + 1 WebFetch til [permissions docs](https://code.claude.com/docs/en/permissions) → rod-årsag fundet. Issue #617's hypoteser var rimelige men gættede på cwd-inheritance / race-condition i stedet for at læse "Working directories"-sektionen.
2. **`permissions.allow` ≠ `permissions.additionalDirectories`.** `allow` styrer hvilke tools/patterns der ikke kræver prompt. `additionalDirectories` udvider hvor tools må operere på filer. Tom `Write`-allow + worktree-path → silent-deny (tool er allowed, men path-boundary fejler). Vice-versa: ikke-allowed tool + project-root path → silent-deny (path er OK, men tool kræver prompt).
3. **Worktree-orkestrering kræver eksplicit setup.** `git worktree add` placerer worktrees udenfor project root by design (for at undgå `.git/`-konflikt). Det er en GOOD git-praksis men en sandbox-fælde for Claude Code subagents. Enhver workflow der bruger `scripts/new-worktree.ps1` SKAL parres med `additionalDirectories`-whitelist.

## Forward-guard

- **Settings:** `additionalDirectories` tilføjet til `.claude/settings.json`. Indtjekket i git → alle PCs får fixet automatisk efter `git pull`.
- **Playbook opdateret:** `docs/PARALLEL_WORKTREE_ORCHESTRATION.md` Common Pitfalls #1 udvidet med worktree-boundary bullet; step 3 nu noterer at `additionalDirectories` er pre-condition (verificér FØR du orkestrerer).
- **Memory:** Ingen ny HOT-rule. Fixet er one-shot config. Future regression vil vise sig som "subagent silent-denied" → tjek `permissions.additionalDirectories` ved første sub-agent-denial (samme rytme som #591 tjek af `permissions.allow`).

## Refs

- Issue [#617](https://github.com/NicolaiDolmer/CyclingZone/issues/617)
- Forrige investigation: [#591](https://github.com/NicolaiDolmer/CyclingZone/issues/591) (Write-restriction LØST 2026-05-23-N)
- Session 2026-05-24-G master-transcript (parallel run #4)
- Playbook: [`docs/PARALLEL_WORKTREE_ORCHESTRATION.md`](../docs/PARALLEL_WORKTREE_ORCHESTRATION.md)
- Docs: [Claude Code permissions — Working directories](https://code.claude.com/docs/en/permissions#working-directories)
