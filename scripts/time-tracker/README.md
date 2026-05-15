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

# Inkludér transcripts fra anden PC (efter OneDrive-sync)
node scripts/time-tracker/report.mjs \
  --extra-claude "$HOME/OneDrive/CyclingZone-context/claude-transcripts-NICOLAILAPTOP" \
  --extra-codex  "$HOME/OneDrive/CyclingZone-context/codex-sessions-NICOLAILAPTOP"
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

Claude/Codex transcripts synker IKKE automatisk via OneDrive (de ligger i `~/.claude/` og `~/.codex/`). Manuel option:

1. På PC2: kopiér `~/.claude/projects/C--dev-CyclingZone/` → `$HOME/OneDrive/CyclingZone-context/claude-transcripts-<PC>/`
2. På PC2: kopiér `~/.codex/sessions/` → `$HOME/OneDrive/CyclingZone-context/codex-sessions-<PC>/`
3. Kør `report.mjs` med `--extra-claude` og `--extra-codex` flag.

Automatiseres senere — Phase 2 (#390 follow-up).

## Begrænsninger (MVP)

- **Wall-clock med ~15 min præcision**: pauser mellem prompts tæller med. Sessioner >8t clampes til 8t.
- **Manus = fast budget**: 30 min/fil. Ikke ægte tid.
- **Ingen kalender-integration endnu**: kommer i Phase 2.
- **Ingen issue-ref → ukategoriseret**: konfigurationsfri brug kræver disciplin.

## Forbedringsidéer (Phase 2)

- Google Calendar API for non-kode `cat:founder`-arbejde
- HTML-dashboard med trend-graf
- Auto-attribuér via `git log` i session-window (find commits, hent `Refs #N`)
- Slack/Discord-notifikation søndag aften med ugens rapport
- Cron via `loop`-skill eller GitHub Actions
