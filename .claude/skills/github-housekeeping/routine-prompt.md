# Task: GitHub housekeeping — daily autonomous auto-close

> **Single source of truth** for `cyclingzone-github-housekeeping-weekly` routine-prompten.
> Git-tracked her så begge PC'er + cloud-routinen + fremtidige edits læser samme fil.
> Når denne fil ændres → **det er nok at committe + pushe til `main`.** Cloud-routinen (`trig_01S278iyGt4HtoydKb2JP3AR`) har en kort bootstrap-prompt der `Read`er denne fil fra det friskt-klonede repo ved hver kørsel; prompten er IKKE embedded i routine-config. Ingen `RemoteTrigger action=update` nødvendig (det beskrev et tidligere design hvor prompten lå i config; rettet 2026-05-31).
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

## Trin 1 — fallback-strategi (store MCP-resultater + cursor-FP)

Repoet har >200 åbne issues. `list_issues` (state=open, perPage=100) returnerer en `pageInfo`-blok med base64-paginerings-cursors (`Y3Vyc29y...`), og store outputs gemmes til disk i stedet for context. Begge ting bider routinen. Rækkefølge + fallbacks:

1. **Hent `audit-done.json` FØR `audit-open-all.json`.** `claude:done`-listen er typisk kun ~20 issues, overskrider sjældent token-grænsen, og er det direkte input til `score_done.py`. Sikr den først, så scoringen kan køre selv hvis open-all-hentet kræver fallback. Filtrér på label: `search_issues` `repo:NicolaiDolmer/CyclingZone is:issue is:open label:claude:done`.
2. **Hvis `list_issues` (state=open, perPage=100) giver >100 OG `hasNextPage=true`** — og paginerings-cursorene trigger sanitize-hooken (selv efter cursor-allowlist, fx ved en uventet cursor-form): **brug `search_issues` med `repo:NicolaiDolmer/CyclingZone is:issue is:open` i stedet.** `search_issues` returnerer items uden en `pageInfo`-blok med cursor-strenge, og kan filtreres per label (fx `label:cat:user-feature`, `label:auto-closed-by-routine`).
3. **Alternativ batch-paginering uden cursors:** hent `audit-open-all.json` i batches á 100 ved at bruge `search_issues` med et `created:<DATO`-filter (fx `created:<2026-05-01`, dernæst `created:2026-05-01..2026-05-31`) fremfor cursor-baseret pagination. Saml batchene til den samlede open-all-fil før scoring.

# Trin 2 — Scor + klassificér (kør scripts i --json)

```
PYTHONUTF8=1 python .claude/skills/github-housekeeping/scripts/score_done.py --json
PYTHONUTF8=1 python .claude/skills/github-housekeeping/scripts/crossref.py --json
PYTHONUTF8=1 python .claude/skills/github-housekeeping/scripts/labelcheck.py --json
PYTHONUTF8=1 python .claude/skills/github-housekeeping/scripts/staleblocked.py --json
```

- `score_done.py` → per done-issue: `score`, `tier` (1/2/3), `auto_close_candidate`, `needs_xverify`, `blockers`, `reason`.
- `crossref.py` → `close_intent_open` (åbne issues m. merged `Closes #N` PR — Tier-1-close-kandidater), `kategori_a_missing_done`, `kategori_k_forgotten_done` (**surface-only** — se Trin 5b), `orphan_prs`, `bv_stats`.
- `labelcheck.py` → label-konflikter + idle in-progress (Tier 3).
- `staleblocked.py` → stale done/todo (Tier 3 — eskalér, luk ALDRIG).

# Trin 3 — Auto-close-gate (det 100%-sikre subset)

**`score_done.py --json` er AUTORITATIVT for tier.** Du må KUN auto-lukke et issue hvor scriptet returnerer `auto_close_candidate: true`. Et issue scriptet markerer Tier 3 (`auto_close_candidate: false` — fx score WEAK/MEDIUM, work-pending, forbidden label) **må du ALDRIG lukke**, uanset hvad din egen cross-verify finder. Cross-verify kan kun **nedgradere** en kandidat til eskalering (hvis et claim ikke holder), ALDRIG **opgradere** en ikke-kandidat til close. Din rolle er at bekræfte scriptets kandidater — ikke at finde nye lukke-grunde det afviste.

For hver `auto_close_candidate: true` fra score_done **OG** hvert `close_intent_open`-element: **cross-verificér ALT i `needs_xverify` før du lukker.** Spring `auto-close-veto`/forbidden-labels over (scriptet markerer dem allerede Tier 3).

### Tier 1 — backend/docs/CI/security (mekanisk vandtæt)
Luk **kun** hvis ALLE er sande:
- `pr_merged`: find PR'en der refererer issuet (`Refs/Closes #N`). `pull_request_read` → `state == "MERGED"` og `mergedAt != null`. Hvis ingen merged PR findes og score var STRONG prod-evidens → migration/deploy-claim kan i stedet verificeres via Supabase `list_migrations` / Vercel. Hvis intet kan verificeres → eskalér.
- `commit_on_main`: PR'ens merge-commit / nævnt commit-hash findes på `main` (`get_commit` / `list_commits` på main). 
- Ingen blockers (scriptet har allerede filtreret neg/work-pending/forbidden).
→ **Luk.**

### Tier 2 — cat:user-feature (kræver uafhængigt maskinsignal)
Kun relevant for issues scriptet allerede markerer `tier: 2, auto_close_candidate: true` (dvs. score = STRONG ≥24h). Et user-feature med score WEAK/MEDIUM eller work-pending er Tier 3 — luk det ALDRIG (se autoritativ-regel ovenfor).

Luk **kun** hvis `TIER2_PAUSED` er false OG ALLE er sande:
- Tier 1's `pr_merged` + `commit_on_main`, OG
- **`vercel_or_supabase_match` (OBLIGATORISK) — matchet skal bekræfte selve FEATURE-CLAIMET, ikke bare at koden er deployet:**
  - **Supabase** (stærkest): comment har konkret data-claim ("X af Y rows", "DB har nu N") → `execute_sql` (read-only) reproducerer samme tal. ELLER
  - **Sentry:** comment claimer "fejl X væk" → `search_issues`/`search_events` bekræfter resolved / 0 nye events. ELLER
  - **Vercel:** KUN gyldigt hvis comment-claimet i sig selv handler om deployment-status (fx "200 OK på prod-URL"). En `READY` deployment med matchende commit-hash beviser **kun at koden er live — IKKE at user-feature'en virker.** "Leveret (commit X)" / "PR merged" + Vercel READY er et DEPLOYMENT-bevis, **IKKE** et feature-bevis → eskalér. _(Lektion 2026-05-29: routinen lukkede #505/#529 forkert netop sådan.)_
- **Tommelfingerregel:** Kan claimet kun bekræftes ved at et MENNESKE åbner UI'en og ser at feature'en gør det rigtige → **eskalér, luk IKKE.** Maskinen kan verificere data + fravær-af-fejl, aldrig "UI'en gør det rigtige".
- **Kan matchet ikke gennemføres** (ingen konkret data-/fejl-claim, claim for vag, eller MCP viser mismatch/ERROR) → **eskalér, luk IKKE.**
→ **Luk** (kun ved konkret data-/fejl-match — aldrig deployment-alene).

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

# Trin 5b — Kategori K (glemt-done): SURFACE-ONLY — luk/label ALDRIG

`crossref.py --json` → `kategori_k_forgotten_done` = åbne ikke-done-issues hvor en merged PR (typisk `Refs #N`, repoets dominerende mønster) **kan** have leveret kerne-arbejdet, men done/close blev glemt. Scriptet har allerede filtreret støj (dependabot-changelogs, `docs(now)`-close-outs, epic-milestone-PR'er), men det kan **ikke** skelne ægte levering fra delvis/incidentel omtale — 2026-06-02 var 14+ af 23 kandidater incidentelle, ikke leverancer.

**Derfor: routinen må ALDRIG auto-lukke, add-done eller label-ændre et Kategori K-issue.** Scope-verify (issue-AC vs PR-diff) kræver dømmekraft → sub-agent/manuel-skill-opgave, ikke en mekanisk gate. Routinens eneste handling er at **surface** kandidaterne i digesten (Trin 6) så de ikke kun fanges ved en manuel audit. Et issue der OGSÅ er ægte `auto_close_candidate`/`close_intent_open` lukkes udelukkende via Trin 3-gaten — aldrig pga. Kategori K-listen.

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

### 🔎 Glemt-done — Kategori K ({K}) — surface-only, kræver scope-verify (routinen lukker IKKE)
- #N [{claude:state}] {titel ≤48 tegn} — PR {#M …}
(cap visning til ~15; "+ {rest} flere — kør manuel audit" hvis flere)

### Stale/blocked (info)
- F-todo >30d: {liste} · E-done >14d: {liste} · blocked: {liste}
```

**Skip-create:** Hvis alle action-sektioner (auto-lukket, reopened, eskaleret, label-drift) er tomme → post 1 linje på #627: `Housekeeping {dato}: 0 actions, backlog clean.` — men hæng altid Kategori K på hvis der er kandidater: `… · 🔎 Glemt-done (Kategori K, surface-only, kræver scope-verify): #N #M #… ({K}).` Så glemt-done er synlig dagligt, også på clean-backlog-dage. Er K også tom → kun 1-linjen. Stop derefter.

# Hard constraints

- **INGEN branches, commits, PRs, file-edits.** Read-only på git/kode. Eneste writes: `add_issue_comment`, `issue_write` (close + labels).
- Luk aldrig en forbidden-zone (Trin 3). Overskrid aldrig cap. Re-close aldrig et vetoet issue.
- Tier 2 kræver ALTID et matchende maskinsignal — pattern-match i en comment er ikke nok.
- **Kategori K (glemt-done) er surface-only** — aldrig auto-close/add-done/label-ændring (Trin 5b). Kun digest-surface.
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
