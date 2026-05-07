# CLAUDE.md

> **GitHub-first start-rutine** (indført 2026-05-06 per [#70](https://github.com/NicolaiDolmer/CyclingZone/issues/70)).
> Cold-start token-budget: ~700 (ned fra ~800-1500). Tidligere version: [`docs/archive/CLAUDE-2026-05-06.md`](docs/archive/CLAUDE-2026-05-06.md).

## Auto-loaded (intet at gøre)

Disse loader sig selv ved session-start — undgå at re-læse manuelt:
- `~/.claude/.../memory/MEMORY.md` — auto-memory (~250 tok). Sync'er cross-PC via OneDrive (junction til `~/OneDrive/CyclingZone-context/memory/`). Hvis junction mangler: `pwsh -File scripts/link-onedrive-context.ps1`.
- `.codex.local/SESSION_CONTEXT.md` — pre-fetched aktivt issue (titel, body, labels, seneste 3 comments) genereret af `scripts/session-prefetch-issue.sh` SessionStart hook (~400 tok). Dokumenteret i [`docs/HOOKS.md`](docs/HOOKS.md).

## Start (eksplicit, ~150-300 tok)

1. Læs `docs/NOW.md` — kort status-snapshot (aktiv slice + næste session-noter).
2. **Aktivt issue** kommer fra `SESSION_CONTEXT.md` (auto-loaded). Hvis filen mangler eller er stale, hent manuelt:
   ```
   gh issue list --label "claude:todo" --state open --limit 10
   ```
3. **Læs `docs/GUARDRAILS_CORE.md` KUN hvis** issue-labels indeholder `needs-contract` eller `shared-refactor` (~0 tok i 80% af tilfælde). For trivielle bugfix og isolerede features springes dette over.

## Reference på behov (on-demand)

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
| `docs/slices/<slug>.md` | Slice har dedikeret brief |
| `gh issue view N --comments` | Behov for sessionshistorik på issue |

## Close-out (per session)

Ingen `docs/PRODUCT_BACKLOG.md` mere — task-laget bor i GitHub issues siden 2026-05-06 ([#68](https://github.com/NicolaiDolmer/CyclingZone/issues/68)).

1. **Issue-status:** `gh issue comment N --body "..."` med opsummering, eller `gh issue close N --reason completed` hvis done og verificeret. Brugeren lukker selv issues efter manuel verifikation per label-state-maskinen i `docs/GITHUB_WORKFLOW.md`.
2. **NOW.md:** kort opdatering hvis aktiv slice ændrer sig — maks 30 linjer, historik flyttes til `docs/archive/` i samme session.
3. **FEATURE_STATUS.md:** opdatér hvis kontrakter eller features ændret.
4. **PatchNotesPage.jsx:** opdatér ved enhver brugerrettet ændring (eller skriv eksplicit hvorfor ikke). Pre-push hook kan håndhæve det.
5. **Postmortem:** ved bugfix → entry i `.claude/learnings/<dato>-<slug>.md`.

## Session-rytme

- Signalér 🟢/🟡/🔴/🆕 ved naturlige break-points — bruger behøver ikke selv huske at lukke
- Kør close-out-tjekliste før commit
- Foreslå "Næste session starter med #N..." ved close-out
- Tommelfingerregel: ÉN issue pr. session

## Token-budget snapshot

| Trin | Tokens | Hvornår |
|---|---|---|
| Auto-load (MEMORY + SESSION_CONTEXT) | ~650 | Hver session |
| Læs NOW.md | ~150 | Hver session |
| Læs GUARDRAILS_CORE.md | ~700 | KUN hvis label kræver det (~20% af sessioner) |
| **Cold-start total** | **~800** typisk · **~1500** ved kontrakt-arbejde | |
