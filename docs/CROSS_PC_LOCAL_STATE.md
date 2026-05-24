# Cross-PC lokal-only state — whitelist + forensisk audit

> Håndhævelse af `AGENTS.md` regel 2: "Delt context er GitHub/OneDrive — aldrig lokal-only."
>
> Reglen om "intet lokal-only" har historisk været for abstrakt — Codex efterlod 19 lokal-only filer (Discord-issue-drafts, token-baselines, vite-logs) som var usynlige for anden PC. Denne fil gør reglen konkret. Flyttet fra `AGENTS.md` §LOKAL 2026-05-15 per [#378](https://github.com/NicolaiDolmer/CyclingZone/issues/378) for at lette token-load (læses kun ~10-20% af sessioner).

## Whitelist — KUN disse må persistere lokalt i `.codex.local/`

- `SESSION_CONTEXT.md` — regenererbar fra GitHub via `scripts/session-prefetch-issue.sh`
- `SUPABASE_CONTEXT.md` — hardlinked til OneDrive (managed)
- `supabase-readonly.env` — hardlinked til OneDrive (managed)
- `preflight-state.json` — kortlivet health-check artefakt
- Pattern: `commit-msg*.txt`, `commit-N.txt`, `commitmsg-*.txt`, `pr*-body.md`, `pr-body-*.md` — **levetid < 1 time**, slet efter `git commit -F` / `gh pr create --body-file`

**Alt andet i `.codex.local/` er en fejl.** Tilsvarende for `~/.codex/AGENTS.md` (skal være tom eller hardlinket) og `~/.codex/memories/` (skal være tom eller junctioned). `~/.manus/` må kun have `logs/`.

## Decision tree — hvor skal ad-hoc indhold hen?

| Type | Destination | Kommando |
|---|---|---|
| Issue-draft fra Discord/feedback | GitHub issue | `gh issue create --body-file <fil>` → slet fil |
| Decision / ADR / postmortem | Repo (`docs/decisions/`, `.claude/learnings/`) | Commit + push |
| Memory om bruger/projekt | OneDrive memory | `~/OneDrive/CyclingZone-context/memory/<navn>.md` + opdatér MEMORY.md-index |
| Session-noter til "næste session" | `docs/NOW.md` eller GitHub issue | Commit + push |
| PR-body draft | Direkte til `gh pr create --body-file <fil>` | Slet fil efter create |
| Commit-message draft | `.codex.local/commit-msg*.txt` buffer → `git commit -F` → slet | Levetid < 1 time |
| Build/run-logs du undersøgte | Behold IKKE. Skriv konklusion til issue/PR-kommentar | `Refs #N` |
| Token-baselines / metrics-snapshots | Repo (`docs/metrics/`) eller issue-kommentar | Commit + push |

**Tommelfingerregel: GitHub > OneDrive > lokal.** I tvivl → GitHub.

## Forensisk audit (kør automatisk session-start, og når du er i tvivl)

```bash
pwsh -File scripts/cross-pc-forensic-audit.ps1          # human-læsbar
pwsh -File scripts/cross-pc-forensic-audit.ps1 -Json    # maskine-læsbar
pwsh -File scripts/cross-pc-forensic-audit.ps1 -Strict  # fail ogsaa paa warnings
pwsh -File scripts/cross-pc-forensic-audit.ps1 -AutoFix # auto-cleanup (se nedenfor)
```

Exit 1 = der ligger lokal-only state der ikke skulle. Adressér før session-slut.

### `-AutoFix` — forward-guard for [#522](https://github.com/NicolaiDolmer/CyclingZone/issues/522)

Sletter automatisk lokal-only filer hvor indholdet aldrig var unikt:

- **stale-ephemeral** (>1h gamle `commit-msg*.txt`, `pr-body-*.md` etc.): slettes ubetinget — buffers efter `git commit -F` / `gh pr create --body-file` skal aldrig overleve.
- **local-only-content** med parsbart issue/PR-nummer i filename: tjekker via `gh issue view N` / `gh pr view N` om matchende GitHub-state findes. Hvis ja → slettes. Hvis nej → beholdes som ERROR (agent skal manuelt verificere).
- Andre kategorier (`hardcoded-user-path`, `codex-global-*`, `manus-*`, `git-*`) rører den ikke — kræver manuelt fix eller `install-user-hooks.ps1` re-run.

Filename-patterns der parses:
- `issue-N-*.md` → issue#N
- `pr-N-*.md`, `prN-body.md` → pr#N
- `pr-body-N.md`, `pr-body-N-M.md` → pr#N (+ pr#M)
- `comment-N.md`, `N-*.md` → issue eller pr#N (begge tjekkes)

Filer uden parsbart nummer (fx `issue-body-brand-identity.md`) skippes — agent skal manuelt afgøre destination.
