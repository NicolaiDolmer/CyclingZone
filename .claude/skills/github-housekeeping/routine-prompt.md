# Task: GitHub housekeeping — daily autonomous auto-close

> **Single source of truth** for `cyclingzone-github-housekeeping-weekly` routine-prompten.
> Git-tracked her så begge PC'er + cloud-routinen + fremtidige edits læser samme fil.
> Når denne fil ændres → opdatér routine-config via `RemoteTrigger action=update` (job_config.ccr.events[0].data.message.content = denne fils indhold).
> Erstatter den tidligere `.codex.local/routines-tmp/housekeeping-prompt.md` (gitignored, kun på én PC).

Repo: NicolaiDolmer/CyclingZone (already cloned in your sandbox).

Du er en **autonom housekeeping-routine** der kører dagligt. Din opgave: gennemgå ALLE åbne issues, og **luk selv dem du er 100% sikker på er færdige og leverede** efter close-protokollen. Eskalér kun gråzonen til maintaineren. Du er ikke recommend-only længere — du lukker.

# Værktøjer

- GitHub: `mcp__github__*` (gh CLI er IKKE i sandbox). Read: `list_issues`, `list_pull_requests`, `issue_read`, `pull_request_read`, `list_commits`, `get_commit`, `search_issues`, `search_pull_requests`. Write: `add_issue_comment`, `issue_write` (lukker via `state=closed, state_reason=completed`; sætter labels via fuld `labels`-liste).
- Vercel: `mcp__*__get_deployment`, `list_deployments` (Tier 2 cross-verify — deployment READY m. commit-hash).
- Supabase: `mcp__*__execute_sql` (read-only), `list_migrations` (Tier 2/1 cross-verify — migration live / DB-claim).
- Sentry: `search_issues`, `search_events` (verificér "error X er væk"-claims).
- Python helpers via Bash: `PYTHONUTF8=1 python .claude/skills/github-housekeeping/scripts/<script>.py --json`.

# Trin 0 — Reopen-feedback-loop (ALTID FØRST, self-healing)

1. `search_issues`: `repo:NicolaiDolmer/CyclingZone is:issue is:open label:auto-closed-by-routine`
2. Hvert resultat = et issue du tidligere auto-lukkede som maintaineren har **reopenet** = en false-positive.
   - Hvis det ikke allerede har `auto-close-veto`: tilføj labelen (`issue_write`, behold eksisterende labels + tilføj). Det forhindrer at du nogensinde auto-lukker det igen — kun manuel close herefter.
   - Medtag i digestens "Reopened siden sidst"-sektion med issue-nr.
   - **Rør det ikke yderligere.** Ingen re-close, ingen comment udover veto-label.
3. **Circuit-breaker:** Lad `reopened_count` = antal resultater. Hvis `reopened_count >= 3` → sæt `TIER2_PAUSED = true` for denne kørsel (Tier 1 fortsætter; Tier 2 user-feature auto-close springes over og eskaleres i stedet). Noter det i digest-metadata.

# Trin 1 — Hent data (byg $TEMP-filer i den shape scriptsene forventer)

Scriptsene læser JSON fra `$TEMP`. Byg filerne via MCP (gh findes ikke). Match shapes præcist:

- **`$TEMP/audit-open-all.json`** — alle åbne issues. `list_issues` (state=open, paginer til alle ~200). Shape per element: `{"number":N,"title":"...","labels":[{"name":"..."}],"updatedAt":"ISO"}`.
- **`$TEMP/audit-done.json`** — kun `claude:done`-issues, MED comments. Filtrér open-all på label `claude:done`; for hver: `issue_read` (inkl. comments). Shape: `{"number":N,"title":"...","labels":[{"name":"..."}],"updatedAt":"ISO","comments":[{"body":"...","createdAt":"ISO","author":{"login":"..."}}]}`. (Typisk kun ~8 — billigt.)
- **`$TEMP/audit-pr-merged.json`** — merged PRs sidste 14d. `list_pull_requests` (state=closed; behold kun `mergedAt != null`). Shape: `{"number":N,"title":"...","mergedAt":"ISO","body":"..."}`.

Hvis en MCP-shape afviger: transformér til ovenstående før du skriver filen. Hvis et helper-script fejler trods korrekt shape → fald tilbage til inline scoring og notér `helpers_failed:[...]` i digest-metadata.

# Trin 2 — Scor + klassificér (kør scripts i --json)

```
PYTHONUTF8=1 python .claude/skills/github-housekeeping/scripts/score_done.py --json
PYTHONUTF8=1 python .claude/skills/github-housekeeping/scripts/crossref.py --json
PYTHONUTF8=1 python .claude/skills/github-housekeeping/scripts/labelcheck.py --json
PYTHONUTF8=1 python .claude/skills/github-housekeeping/scripts/staleblocked.py --json
```

- `score_done.py` → per done-issue: `score`, `tier` (1/2/3), `auto_close_candidate`, `needs_xverify`, `blockers`, `reason`.
- `crossref.py` → `close_intent_open` (åbne issues m. merged `Closes #N` PR — Tier-1-close-kandidater), `kategori_a_missing_done`, `orphan_prs`, `bv_stats`.
- `labelcheck.py` → label-konflikter + idle in-progress (Tier 3).
- `staleblocked.py` → stale done/todo (Tier 3 — eskalér, luk ALDRIG).

# Trin 3 — Auto-close-gate (det 100%-sikre subset)

For hver `auto_close_candidate: true` fra score_done **OG** hvert `close_intent_open`-element: **cross-verificér ALT i `needs_xverify` før du lukker.** Spring `auto-close-veto`/forbidden-labels over (scriptet markerer dem allerede Tier 3).

### Tier 1 — backend/docs/CI/security (mekanisk vandtæt)
Luk **kun** hvis ALLE er sande:
- `pr_merged`: find PR'en der refererer issuet (`Refs/Closes #N`). `pull_request_read` → `state == "MERGED"` og `mergedAt != null`. Hvis ingen merged PR findes og score var STRONG prod-evidens → migration/deploy-claim kan i stedet verificeres via Supabase `list_migrations` / Vercel. Hvis intet kan verificeres → eskalér.
- `commit_on_main`: PR'ens merge-commit / nævnt commit-hash findes på `main` (`get_commit` / `list_commits` på main). 
- Ingen blockers (scriptet har allerede filtreret neg/work-pending/forbidden).
→ **Luk.**

### Tier 2 — cat:user-feature (kræver uafhængigt maskinsignal)
Luk **kun** hvis `TIER2_PAUSED` er false OG ALLE er sande:
- Tier 1's `pr_merged` + `commit_on_main`, OG
- **`vercel_or_supabase_match` (OBLIGATORISK):** Et uafhængigt signal der MATCHER comment-claimet:
  - Vercel: comment nævner commit-hash → `get_deployment`/`list_deployments` på cycling-zone.vercel.app viser deployment med samme hash = `READY`. ELLER
  - Supabase: comment har SQL-resultat/"X af Y rows" → `execute_sql` (read-only) reproducerer samme tal. ELLER
  - Sentry: comment claimer "error væk" → `search_issues`/`search_events` bekræfter resolved/0 events.
- **Kan matchet ikke gennemføres** (ingen hash, claim for vag, eller MCP viser mismatch/ERROR) → **eskalér, luk IKKE.** En routine kan ikke se om en UI-feature virker; uden maskinbekræftelse er du ikke 100% sikker.
→ **Luk** (kun ved match).

### Forbidden zones — auto-luk ALDRIG (uanset evidens)
`needs-user-action`, `manual:user`, `needs-decision`, `manual-review`, `auto-close-veto`, `epic:*`, åbne `- [ ]`/`🟡`/`⚠️` i seneste comment, eller en citeret "## Leveret — PR #N" hvor `pull_request_read` viser PR'en stadig OPEN/draft. Alle → Tier 3.

# Trin 4 — Cap + udfør closes

- Saml alle verificerede close-kandidater. Sortér: Tier 1 før Tier 2; inden for tier ældste comment først.
- **Cap = 20 closes/run.** Luk de første 20; resten → eskalér med note "cap nået (kører igen i morgen)".
- For hvert issue du lukker:
  1. `add_issue_comment` (audit-trail):
     ```
     🤖 Auto-closed af housekeeping-routinen (Tier {1|2}).
     Evidens: "{≤100-tegn citat fra seneste comment}"
     Cross-verify: {PR #M merged + commit abc123 på main | Vercel READY commit abc123 | Supabase 19/19 rows | Sentry 0 events}
     Forkert? Reopen issuet — næste kørsel fanger det automatisk og auto-lukker det aldrig igen.
     ```
  2. `issue_write`: `state=closed`, `state_reason=completed`, og `labels` = eksisterende labels + `auto-closed-by-routine` (− evt. `claude:in-progress`/`claude:todo`).

# Trin 5 — Label-drift (Tier 3, ryd — luk ikke)

Fra `labelcheck.py`: ryd 2-state-konflikter via `issue_write` labels (fx `todo+done` → behold `done`; `in-progress+done` der har merged Refs-PR → `done`). Idle in-progress >48h: medtag i digest som nudge, rør ikke. Stale/dødt todo: eskalér til triage, luk aldrig.

# Trin 6 — Daglig digest

Post ÉN comment på ledger-issue **#627** (ikke et nyt issue per dag):

```markdown
## 🤖 Housekeeping {YYYY-MM-DD} (Europe/Copenhagen; CEST=UTC+2)
Scannet: {N} åbne · Merged PRs 14d: {M} · closes: {X}/20 cap{ · ⚡TIER2 PAUSED (≥3 reopens) hvis relevant}

### ✅ Auto-lukket ({X})
| # | Tier | Titel | Evidens + cross-verify |
|---|---|---|---|
(tom tabel OK)

### ⚠️ Reopened siden sidst ({Y}) — false-positives, nu auto-close-veto
- #J — {kort hvorfor det var forkert, hvis udledeligt}

### 📋 Eskaleret til dig ({Z})
- #P — {grund: PR open / user-feature uden verifikation / NUA / cap nået / STRONG <24h}

### 🏷️ Label-drift ryddet ({W})
- #R — {todo+done → done}

### Stale/blocked (info)
- F-todo >30d: {liste} · E-done >14d: {liste} · blocked: {liste}
```

**Skip-create:** Hvis alle action-sektioner (auto-lukket, reopened, eskaleret, label-drift) er tomme → post i stedet 1 linje på #627: `Housekeeping {dato}: 0 actions, backlog clean.` og stop.

# Hard constraints

- **INGEN branches, commits, PRs, file-edits.** Read-only på git/kode. Eneste writes: `add_issue_comment`, `issue_write` (close + labels).
- Luk aldrig en forbidden-zone (Trin 3). Overskrid aldrig cap. Re-close aldrig et vetoet issue.
- Tier 2 kræver ALTID et matchende maskinsignal — pattern-match i en comment er ikke nok.
- Ved tvivl → eskalér, luk ikke. False-eskalering koster maintaineren 10 sek; en forkert close koster tillid.

# Failure handling

- Sandbox er ephemeral. Hvis `issue_write` fejler permission på close: stop med at lukke, output hele digesten i din sidste besked så den kan recoveres, og notér `close_permission_failed` i metadata.
- Retry ALDRIG en fejlende write. Rapportér og fortsæt til digest.
- Hvis et helper-script fejler: inline-fallback + notér i metadata.

# Transcript-markers (print verbatim, så maintaineren kan grep'e)

- `=== HOUSEKEEPING START === {ISO}`
- `=== REOPEN-LOOP === reopened={Y} tier2_paused={true|false}`
- Per close: `=== AUTO-CLOSED === #{N} tier={1|2}`
- `=== DIGEST POSTED === #627` (eller `=== SKIPPED === backlog clean`)
- `=== HOUSEKEEPING DONE === closed={X} escalated={Z} reopened={Y}`
- Afslut med `=== END ===`
