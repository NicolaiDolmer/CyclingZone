# CLAUDE.md

> **GitHub-first start-rutine** (#70). Token-budget-master: se nederst.

## Hard rules (fælles — fuld tekst i AGENTS.md)

Gælder også Claude Code (AGENTS.md auto-loades ikke her): verificér repo-root før edit · delt context i GitHub/OneDrive, aldrig lokal-only · verificér runtime før TODO/bug · spørg ved tvivl (70-95 %) · patch notes ved brugerrettet ændring · auto-push efter commit · merge-kø én ad gangen: `scripts/merge-queue.ps1` (#4919) · **commit kun bag `guard-commit-branch.sh`** (hard rule 18; ved `git -C <dir>` gives guarden samme `<dir>`) · migrationer: apply post-merge per #2642 (auto-migrate.yml), Claude post-verificerer; destruktivt ejer-gated · re-link OneDrive-hardlinks efter manuel edit (`scripts/link-onedrive-context.ps1`). Fuld tekst: [`AGENTS.md`](AGENTS.md); cross-PC + session-rytme: [`docs/AI_OPS_REFERENCE.md`](docs/AI_OPS_REFERENCE.md).

## Orkestrator-standard (ejer 11/9, #5142)

Parallelt byggearbejde har ÉN indgang: `Workflow({ scriptPath: "C:\Dev\CyclingZone\.claude\workflows\wave.js", args: { tracks: [...] } })` (filen SKAL have LF-linjeskift; CRLF afvises af appen som kontroltegn, `.gitattributes` sikrer det, bidt 2x 11/9). Aldrig håndskrevne Agent-spawns; `scripts/hooks/guard-agent-spawn.sh` blokerer dem mens en bølge kører (fritaget: `WAVE-*:`-præfikser, `READ-ONLY:`, `Explore`/`Plan`). Loft: **4 laner**, verifikations-semafor 2 (`scripts/verify-lock.ps1 -Max 2 -- <kommando>`), maks 5 åbne PR'er, livstegn (draft-PR 30 min, push 15 min, timeout 60 min, recovery i samme worktree). Bekræftet frys stopper bølgen. Fuld tekst: [`docs/PARALLEL_WORKTREE_ORCHESTRATION.md`](docs/PARALLEL_WORKTREE_ORCHESTRATION.md).

## Page templates (binding — ejer-godkendt 23/7, #2849)

Enhver manager-app-side bruger én af de 3 kanoniske skabeloner i [`docs/design/PAGE_TEMPLATES.md`](docs/design/PAGE_TEMPLATES.md) — læs den FØR du bygger eller ændrer en side: T1 standard content (max-w-4xl), T2 wide data (cap 1600px), T3 profile/detail (hero + tabs, max-w-5xl). **Smagen** står i [`docs/design/TASTE.md`](docs/design/TASTE.md) (#4623): skabelonen er gulvet, TASTE er målet; enhver UI-PR skal kunne svare ja på tjeklisten. Opfind ALDRIG eget sidehoved, container-bredde, padding, radius, typografi-trin eller loading/empty/error-markup. Bindende: én gold primary-knap pr. view, hairline-borders (ingen skygger), 5px card-radius, tabular figures på al numerik, stroke-ikoner (aldrig emoji).

## Auto-loaded (intet at gøre)

- `~/.claude/.../memory/MEMORY.md` — HOT-tier auto-memory (gate >3.200 tok / >54 linjer; WARM: `MEMORY_REFERENCE.md`).
- **Security-advisors** (Supabase MCP `get_advisors`) tjekkes ved session-start; en WARN må aldrig stå over 7 dage (#5153).
- `.codex.local/SESSION_CONTEXT.md` — bounded, regenererbar cache af aktivt GitHub-issue (`scripts/session-prefetch-issue.sh`). Ikke source of truth.

## Start (eksplicit)

1. Læs `docs/NOW.md` — kort status (**🎯 Next action** + **🤖 Working agent** øverst, aktiv slice + session-noter). Viser "Working agent" en anden aktiv session → STOP + spørg brugeren før pick-up (#559).
2. **Aktivt issue:** `SESSION_CONTEXT.md` er cache; sandheden er GitHub + `docs/NOW.md`. Stale? `gh issue list --label "claude:todo" --state open --limit 10`
3. `docs/GUARDRAILS_CORE.md` læses KUN ved labels `needs-contract` eller `shared-refactor` (~80% af sessioner skipper).
4. **PR-preflight:** `pwsh -File scripts/preflight-pr.ps1` FØR push (PR-body-krav i headeren). `frontend/` rørt: også `npm run lint`, `node --test`, build. **TIER FULL** (backend, delte libs, i18n, config, >6 filer): `scripts/verify-local.ps1`; frontend/i18n: hele `npm run test:e2e`; snapshots: alle 3 Playwright-projekter (#536); små UI-diffs: `node scripts/verify-affected.mjs`. Loop-guard: 2 CI-fails på samme symptom → STOP + spørg. Tier-tabel: [`docs/AI_OPS_REFERENCE.md`](docs/AI_OPS_REFERENCE.md#pr-preflight-og-verifikations-tiers).
5. **Efter `git pull` der rør ved en `*package-lock.json`** → `npm run sync-deps`; kun `npm ci` synker pålideligt ([hvorfor](docs/AI_OPS_REFERENCE.md#dependency-sync-efter-git-pull)).

## On-demand docs

Fuld doc-index: [`docs/META_DOCS_INDEX.md`](docs/META_DOCS_INDEX.md). Top-hits:
- `docs/GAME_INVARIANTS.md` — economy-konstanter, finalization-paths, upload-grænser
- `docs/GITHUB_WORKFLOW.md` — issue-state-maskine, close-protocol, Refs vs Closes
- `docs/AGENT_ARCHITECTURE.md` — parallel-session safety, cross-agent failure-modes
- `docs/WORKTREE_WORKFLOW.md` — parallelle sessioner via `scripts/new-worktree.ps1`
- `docs/NIGHT_WAVE_RUNBOOK.md` — natbølge-protokol. Læs FØR enhver natbølge.
- `docs/AI_CHANNEL_ROUTING.md` — kanal-til-task-matrix; læs ved tvivl
- `docs/AI_OPS_SCALING_ROADMAP.md` — AI/Ops- + skalerings-roadmap
- `docs/AI_OPS_DISABLE_PLAYBOOK.md` — MCP/skills disable-handlinger
- `database/schema-snapshot.json` — kolonnenavne i `relations.<tabel>.columns`. Slå op FØR ad-hoc SQL via MCP; gæt fylder prod-loggen (#3769). `riders`: `firstname`/`lastname`/`birthdate`, ikke `name`/`age`.

## Close-out (per session)

1. **Issue:** `gh issue comment N --body "..."` eller `gh issue close N --reason completed` hvis verificeret. Bruger lukker selv per label-state-maskinen i `GITHUB_WORKFLOW.md`.
2. **NOW.md:** opdatér ved hvert merge; budget **maks ~1.200 tok** (#1275). Trim gamle blokke direkte (historik = git-log + issues); opret IKKE `docs/archive/NOW-*.md` (#684/#750). **Obligatorisk:** opdatér **🎯 Next action** + nulstil **🤖 Working agent** til "Ingen aktiv session" (#558/#559).
3. **MASTERPLAN.md:** opdatér hvis den prioriterede kø ændrede sig (budget ≤1.500 tok; rækkefølgen er ejer-godkendt — spørg før omprioritering). **FEATURE_REGISTRY.yml:** opdatér ved flag-flip, feature-luk eller ny kernefunktion, og kør `node scripts/generate-feature-status.mjs` (FEATURE_STATUS.md er genereret, aldrig håndredigeret).
4. **PatchNotesPage.jsx:** opdatér ved enhver brugerrettet ændring (eller skriv hvorfor ikke). Samme rutine for `help.json` (en+da) ved ny/ændret spilmekanik (#1171).
5. **Postmortem:** ved bugfix → `.claude/learnings/<dato>-<slug>.md`.
6. **Token-hygiejne (obligatorisk):** kør `pwsh -File scripts/check-agent-token-hygiene.ps1` — den `exit 1`'er hvis MEMORY.md/NOW.md/docs er over budget. Demotér nye lav-frekvens-HOT-entries til `MEMORY_REFERENCE.md` FØR du lukker.
7. **Boelge-processer:** `pwsh -File scripts/close-out-cleanup.ps1` (dry-run, `-Execute` ved fund — dræber efterladte `gh --watch`/vite/playwright-processer, #4920).

Ingen lokal-only handoff: state, beslutninger og næste skridt skal ligge i GitHub (`docs/NOW.md`, issues, slice-docs) eller OneDrive-context; transcripts, Codex memories og `SESSION_CONTEXT.md` er caches.

## Session-rytme

- Signalér 🟢/🟡/🔴/🆕 ved naturlige break-points
- Tjekliste før commit; ÉN issue pr. session
- Foreslå "Næste session starter med #N..." ved close-out

## Token-budget

Master: [`docs/AI_OPS_TOKEN_BUDGET.md`](docs/AI_OPS_TOKEN_BUDGET.md) + #605. Per-PC harness-snapshot: `docs/metrics/harness-snapshot-<COMPUTERNAME>.json` — refresh ved connector/plugin-ændring.
