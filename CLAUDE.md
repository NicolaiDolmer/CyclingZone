# CLAUDE.md

> **GitHub-first start-rutine** (#70). Token-budget-master: se nederst.

## Hard rules (fælles — fuld tekst i AGENTS.md)

Gælder også Claude Code, selvom `AGENTS.md` ikke auto-loades her: verificér repo-root (`git rev-parse --show-toplevel`) før edit · delt context i GitHub/OneDrive, aldrig lokal-only · verificér runtime før du lister noget som TODO/bug · spørg ved tvivl (70-95%) · patch notes ved enhver brugerrettet ændring · auto-push efter commit · **commit kun bag `guard-commit-branch.sh`** (hard rule 18; committer du via `git -C <dir>`, så giv guarden samme `<dir>` som 2. argument) · SQL/migrationer: Claude applier selv post-merge under #2642-rammer (idempotent + post-verify; destruktive klasser ejer-gated) — hard rule 9 i `AGENTS.md` · re-link OneDrive-hardlinks efter manuel edit (`scripts/link-onedrive-context.ps1`). Fuld tekst + slice-close-out-reglen: [`AGENTS.md`](AGENTS.md) (lean core). Cross-PC-detaljer, session-rytme-signaler + loops-quick-ref: [`docs/AI_OPS_REFERENCE.md`](docs/AI_OPS_REFERENCE.md) (WARM, on-demand — split per #733).

## Page templates (binding — ejer-godkendt 23/7, #2849)

Enhver manager-app-side bruger én af de 3 kanoniske skabeloner i [`docs/design/PAGE_TEMPLATES.md`](docs/design/PAGE_TEMPLATES.md) — læs den FØR du bygger eller ændrer en side: T1 standard content (max-w-4xl), T2 wide data (cap 1600px), T3 profile/detail (hero + tabs, max-w-5xl). **Smagen** (hvad verdensklasse er, forbudsliste, dommer-tjekliste ja/nej) står i [`docs/design/TASTE.md`](docs/design/TASTE.md) (#4623): skabelonen er gulvet, TASTE er målet; enhver UI-PR skal kunne svare ja på tjeklisten. Opfind ALDRIG eget sidehoved, container-bredde, padding, radius, typografi-trin eller loading/empty/error-markup. Bindende: én gold primary-knap pr. view, hairline-borders (ingen skygger), 5px card-radius, tabular figures på al numerik, stroke-ikoner (aldrig emoji). Artboards: `docs/design/design_handoff_page_templates/`.

## Auto-loaded (intet at gøre)

- `~/.claude/.../memory/MEMORY.md` — HOT-tier auto-memory. Gate: `check-agent-token-hygiene.ps1` fejler >3.200 tok / >54 linjer. Tier-disciplin: `memory/README.md`. WARM-tier: `MEMORY_REFERENCE.md`.
- `.codex.local/SESSION_CONTEXT.md` — bounded, regenererbar cache af aktivt GitHub-issue (`scripts/session-prefetch-issue.sh`). Ikke source of truth.

## Start (eksplicit)

1. Læs `docs/NOW.md` — kort status (**🎯 Next action** + **🤖 Working agent** øverst, aktiv slice + session-noter). Viser "Working agent" en anden aktiv session → STOP + spørg brugeren før pick-up (#559).
2. **Aktivt issue:** `SESSION_CONTEXT.md` er cache; sandheden er GitHub + `docs/NOW.md`. Stale? `gh issue list --label "claude:todo" --state open --limit 10`
3. `docs/GUARDRAILS_CORE.md` læses KUN ved labels `needs-contract` eller `shared-refactor` (~80% af sessioner skipper).
4. **PR-preflight (alle PR'er):** `pwsh -File scripts/preflight-pr.ps1` FØR push; PR-body-krav står i scriptets header. Rørte du `frontend/`: også `npm run lint`, `node --test` (i `frontend/`) og build. **TIER FULL — backend, delte lib-hooks, i18n, config eller >6 filer — kræver fuld lokal suite (`scripts/verify-local.ps1`).** Frontend/i18n → HELE `npm run test:e2e` lokalt; visuelle ændringer/snapshot-refresh → ALLE 3 playwright-projekter (CI fejler ellers på mobile, #536); små UI-diffs → `node scripts/verify-affected.mjs`. Loop-guard: 2 CI-fails på samme symptom → STOP + spørg. Tier-tabel, e2e-krav og begrundelser: [`docs/AI_OPS_REFERENCE.md`](docs/AI_OPS_REFERENCE.md#pr-preflight-og-verifikations-tiers).
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
2. **NOW.md:** opdatér hvis aktiv slice ændrer sig — budget **maks ~1.200 tok** (primær gate #1275; ≤30 linjer sekundært, lange linjer tæller). Trim gamle close-out-blokke **direkte**; historikken ligger i git-log + issue-tråde. Opret IKKE `docs/archive/NOW-*.md` (hard-beskyttet af #684-deny, #750). **Obligatorisk:** opdatér **🎯 Next action** + nulstil **🤖 Working agent** til "Ingen aktiv session" (#558/#559).
3. **MASTERPLAN.md:** opdatér hvis den prioriterede kø ændrede sig (budget ≤1.500 tok; rækkefølgen er ejer-godkendt — spørg før omprioritering). **FEATURE_STATUS.md:** opdatér ved ændrede kontrakter/features.
4. **PatchNotesPage.jsx:** opdatér ved enhver brugerrettet ændring (eller skriv hvorfor ikke). Samme rutine for `help.json` (en+da) ved ny/ændret spilmekanik (#1171).
5. **Postmortem:** ved bugfix → `.claude/learnings/<dato>-<slug>.md`.
6. **Token-hygiejne (obligatorisk):** kør `pwsh -File scripts/check-agent-token-hygiene.ps1` — den `exit 1`'er hvis MEMORY.md/NOW.md/docs er over budget. Demotér nye lav-frekvens-HOT-entries til `MEMORY_REFERENCE.md` FØR du lukker.

Ingen lokal-only handoff: state, beslutninger og næste skridt skal ligge i GitHub (`docs/NOW.md`, issues, slice-docs) eller OneDrive-context; transcripts, Codex memories og `SESSION_CONTEXT.md` er caches.

## Session-rytme

- Signalér 🟢/🟡/🔴/🆕 ved naturlige break-points
- Tjekliste før commit; ÉN issue pr. session
- Foreslå "Næste session starter med #N..." ved close-out

## Token-budget

Master: [`docs/AI_OPS_TOKEN_BUDGET.md`](docs/AI_OPS_TOKEN_BUDGET.md) + #605. Per-PC harness-snapshot: `docs/metrics/harness-snapshot-<COMPUTERNAME>.json` — refresh ved connector/plugin-ændring.
