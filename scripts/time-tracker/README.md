# Time-tracker

Kategoriseret tids-rapport på tværs af Claude Code, Codex og Manus. Issue: [#390](https://github.com/NicolaiDolmer/CyclingZone/issues/390).

## Quick start

```bash
# Denne uges rapport (skriver docs/metrics/time-YYYY-Www.md)
node scripts/time-tracker/report.mjs

# Specifik uge
node scripts/time-tracker/report.mjs --week 2026-W19

# All-time
node scripts/time-tracker/report.mjs --all

# Andre PCs' transcripts auto-discovers fra OneDrive (default ON siden #391).
# Override hvis du kun vil have lokal PC:
node scripts/time-tracker/report.mjs --no-onedrive

# Manuel ekstra-sti (sjældent nødvendigt — auto-discovery håndterer normale tilfælde)
node scripts/time-tracker/report.mjs \
  --extra-claude "$HOME/OneDrive/CyclingZone-context/claude-transcripts-OTHERPC" \
  --extra-codex  "$HOME/OneDrive/CyclingZone-context/codex-sessions-OTHERPC"
```

## Kategorier

| Label | In/On | Beskrivelse |
|---|---|---|
| `cat:user-feature` | In | Features brugere ser (UI, gameplay, økonomi) |
| `cat:bug` | In | Regressioner, fejlretning, postmortems |
| `cat:infra` | In | Backend, deploy, RLS, tests, refactor uden UI |
| `cat:community` | In | Beta-feedback, Discord-support, interview-syntese |
| `cat:ai-ops` | Meta | AI-dev-loop, tokens, hooks, harness, docs-meta |
| `cat:founder` | On | Strategi, marketing, økonomi, planlægning |

## Hvordan tid bliver attribueret

1. Hver `.jsonl`-session = én bucket. Varighed = sidste minus første timestamp (clamped 1 min – 8t).
2. Issue-refs (`#NNN`) udtrækkes fra session-tekst. Hyppigste ref vinder.
3. Issue slås op via `gh issue list` → `cat:*`-label på issue afgør kategori.
4. Manus-noter: én fil = 30 min, default `cat:founder` (override hvis filnavn matcher `#N`).

**Ingen ref + ingen `cat:*`-label → "ukategoriseret"**. Tilføj `Refs #N` i en prompt eller commit, eller sæt `cat:*`-label på issuet.

## Cross-PC

Automatiseret per #391 Phase 2. Hver PC pusher sine transcripts til OneDrive ved Stop-hook; `report.mjs` auto-discovers sibling-PC dirs ved kørsel.

**Hvordan det virker:**

1. `scripts/cross-pc-stop-check.sh` (Stop-hook) trigger `cross-pc-sync.sh` i background.
2. `cross-pc-sync.sh` mirror'er `~/.claude/projects/C--dev-CyclingZone/` → `$HOME/OneDrive/CyclingZone-context/claude-transcripts-<COMPUTERNAME>/` og `~/.codex/sessions/` → `codex-sessions-<COMPUTERNAME>/`. Idempotent (`cp -ru`).
3. OneDrive synker mellem PCs automatisk.
4. `report.mjs` scanner `~/OneDrive/CyclingZone-context/` for `claude-transcripts-*` og `codex-sessions-*` der ikke matcher `$COMPUTERNAME` → inkluderes som ekstra-kilder. Override med `--no-onedrive`.

**Log:** `~/.claude/cross-pc-sync.log` (roterer ved 1MB).

**Manuel sync** (debugging / fresh setup):
```bash
bash scripts/cross-pc-sync.sh   # synkron, output i log
```

## Begrænsninger (MVP)

- **Wall-clock med ~15 min præcision**: pauser mellem prompts tæller med. Sessioner >8t clampes til 8t.
- **Manus = fast budget**: 30 min/fil. Ikke ægte tid.
- **Ingen kalender-integration endnu**: kommer i Phase 2.
- **Ingen issue-ref → ukategoriseret**: konfigurationsfri brug kræver disciplin.

## Forbedringsidéer (Phase 2)

- ✅ ~~Cross-PC merge via OneDrive-sync~~ (#391 — done 2026-05-19)
- Google Calendar API for non-kode `cat:founder`-arbejde
- HTML-dashboard med trend-graf
- Auto-attribuér via `git log` i session-window (find commits, hent `Refs #N`)
- Slack/Discord-notifikation søndag aften med ugens rapport
- Cron via `loop`-skill eller GitHub Actions
