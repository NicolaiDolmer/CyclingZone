---
name: github-housekeeping
description: Grundig GitHub-issue-audit + state-maskine-cleanup. Trigger med "github audit", "issue cleanup", "ryd op i issues", "label hygiejne", "github housekeeping", "audit issues". Self-improving — hver kørsel slutter med en retro der foreslår konkrete forbedringer til denne skill selv. Bruger godkender ændringer; skillen bliver bedre over tid.
---

# GitHub Housekeeping (self-improving)

Grundig audit af GitHub-issues. **PRIMÆRT MÅL: LUK verificerede issues.** Sekundært: ren label-state-maskine, fang forfaldne, opdag dependency-kæder.

**Audit-success kriterium (lektion 2026-05-23):** En audit hvor 20 claude:done-issues blev scored men 0 lukket er en fejlet audit. Hvis arbejdet kan verificeres uafhængigt (commit på main, migration live via Supabase MCP, PR merged), skal det lukkes — IKKE udskydes pga. "skill regel kræver user-comment". Default: aggressive close, ikke defensive scoring.

**Konfirmér før mass-handling** (>5 closes). Slutter med self-improvement retro (Trin 9 — ALTID).

## Trin 0 — Setup

- Audit-ID: `audit-<YYYY-MM-DD>` (dagens dato)
- Tidsrammer: 14 dage for PR-cross-ref; 30 dage for stale-todo; 14 dage for forfaldne done
- Læs forrige audit hvis findes: `Glob .claude/audits/audit-*.md` → senest → diff Kategori C carry-forward

## Trin 1 — Data (parallelt, ét batch)

```bash
gh issue list --state open --limit 300 --json number,title,labels,updatedAt
gh issue list --state open --label "claude:done" --limit 100 --json number,title,labels,comments,updatedAt
gh issue list --state open --label "claude:blocked" --limit 50 --json number,title,labels,comments
gh issue list --state open --label "needs-user-action" --limit 50 --json number,title,updatedAt
gh issue list --state closed --limit 100 --json number,title,labels,closedAt
gh pr list --state merged --limit 200 --json number,title,mergedAt,body
gh pr list --state open --limit 30 --json number,title,isDraft,body
```

Limits: 300 åbne (repo har 150+; margin). 200 merged PRs (lektion 2026-05-23: 5 audits i træk ramte 100/100 inden for 14d — pace højere end antaget; 200 giver fuld dækning med marginal extra runtime).

## Trin 2 — Cross-reference (systematisk)

**Per merged PR sidste 14 dage — TO separate regex:**
- `CLOSE_RE = (?:Closes|Fixes|Resolves)\s*#(\d+)` → close-intent (GitHub auto-close keywords)
- `REF_RE = (?:Refs|Updates|Implements|See)\s*#(\d+)` → informativ kun (epic-tracker eller context)
- Match mod åbne issues. **Kun CLOSE-refs flagger Kategori A** (mangler claude:done). REF-refs ignoreres for done-label-check fordi de er informative (typisk sub-PR mod epic).
- Parse PR-body Brugerverifikation-section: find `## Brugerverifikation`-header → tæl `- [x]` vs `- [ ]` checkboxes EFTER header → rapportér `X/Y checked`. _(Lektion 2026-05-20: tidligere regex `- [x] Brugerverifikation` matchede 0/100 PRs — real format er sektion-header med multiple underliggende boxes, ikke en enkelt checkbox-linje.)_
- Flag PRs UDEN nogen `#N`-ref (heller ikke parentes-shorthand `(#N)`) som Kategori J: orphan. Filtrer dependabot/chore-PRs fra orphan-rapporten.

**Per `claude:done`-issue:** find seneste comment EFTER claude:done-label, score per Trin 3. _(Note: `claude:done` blev un-deprecated 2026-05-22 per workflow-revision. 2026-05-23-audit observerede 20 åbne done-issues (var 4 dagen før, +16 fra B-series + security batch). Label er aktiv del af state-maskine igen.)_

**Per `claude:blocked`-issue:** `gh issue view <blocker-N> --json state` — hvis blocker lukket → Kategori I.

**Per Kategori B-kandidat (STRONG, ≥24h) — uafhængig MCP cross-verify (lektion 2026-05-22):**
- **Vercel deployment match:** Hvis comment claimer commit-hash (`(commit X)` eller `mergeret som [X]`), brug Vercel MCP `get_deployment` / `list_deployments` på `cycling-zone.vercel.app` → verify deployment med samme hash er `READY`/`SUCCEEDED`. Mismatch eller `ERROR` → downgrade STRONG→MEDIUM + flag.
- **Supabase DB-claim:** Hvis comment indeholder SQL-resultat-tabel eller "X af Y rows har …", re-run query via Supabase MCP `execute_sql` (read-only) → verify samme tal. Mismatch → downgrade + flag.
- **Begrundelse:** Selvstændig verifikation hæver konfidens på auto-close. Hvis MCP-værktøjer ikke tilgængelige eller claim ikke specifik nok → skip uden penalty.

## Trin 3 — Verifikations-score (EKSPLICITTE regler)

| Score | Kriterie | Auto-handling |
|---|---|---|
| **STRONG** | Bruger-kommentar EFTER done-label med specifik prod-evidens (se patterns nedenfor) | Foreslå **auto-close** hvis ≥24 timer |
| **MEDIUM** | "Lokal Chrome MCP grøn", "CI grøn", "PR åbnet — leveret per AC", implementations-status uden prod-verify | Vent. Escalér comment hvis ≥7 dage |
| **WEAK** | Kun AI-kommentar, eller bruger ✅-emoji uden detaljer | Vent. Escalér comment hvis ≥14 dage |
| **BLOCKED** | Kommentar nævner åben sub-issue / manuel handling / "venter på X" | Lad være. Verificér blocker stadig åben |

**Age-precision (lektion 2026-05-20):** brug `hours_since_comment` (`datetime.now(timezone.utc) - comments[-1].createdAt`), IKKE rundet `days`. Tærskel er 24 timer ikke "1 dag" — ellers misser kommentarer kl. 08:46 på dag N når audit kører kl. 11:00 på dag N+1 (faktisk 27h, men `days`-rounding giver 1d eller 0d afhængig af clock-start).

**Author-tracking (lektion 2026-05-23):** STRONG kriteriet siger eksplicit "**Bruger-kommentar** EFTER done-label". Score-script SKAL tracke `comments[-1].author.login` og afvise STRONG hvis author er AI-agent (`Claude` / `Codex` / `Manus` / `nicolaidolmer-mikkelsen[bot]` el.lign.). I 2026-05-23-audit havde 20/20 done-issues AI-authored latest comments — derfor 0 STRONG kandidater. Tidligere audits (2026-05-22) brugte denne regel implicit ved at citere "Bruger-citat 'kan lukke issuet'" (#515). Mangler i automatiseret scorer = systematisk over-promotion til STRONG. Pattern-match alene er ikke nok.

**MEN: Author-tracking har begrænset signal i CyclingZone-repo (lektion 2026-05-24):** Alle commits + de fleste comments er forfattet som `NicolaiDolmer` (AI-agenter committer via lokal git-config). Author-login KAN derfor ikke bruges til at skelne "bruger vs AI" i denne setup. Konsekvens: score baseret på `author.login == AI_BOT` filtrerer kun rene bot-comments (`github-actions[bot]`, `dependabot[bot]`) og er ikke et pålideligt user-vs-AI-signal generelt. Primært signal er i stedet: (1) comment-INDHOLD (specifikke prod-claims/commit-hashes), (2) cross-verify via git log/PR/MCP, (3) `cat:user-feature`-label som proxy for "UI-verify er nødvendig". 2026-05-24-audit lukkede 17 issues uden at bruge author-tracking — close-grundlag var commit-på-main + ingen UI-label. Skill bør ikke gate aggressive close på author-tracking når backend/docs/CI-evidens er stærk.

**MEN: AI-author er IKKE close-blocker for backend/docs-only (lektion 2026-05-23-pass2):** Pass1 lukkede 0 issues fordi strict author-tracking blokerede alle. Bruger flaggede direkte: "Det vigtigste ved denne skill og opgave du lige har kørt, det er at du gennemgår alle opgaver. Vurdere om opgaverne allerede er løst eller ej. Og hvis opgaverne er løst sikkert allerede og du er 100% sikker på, at de er løst, så skal du lukke opgaverne." Strict author-tracking gælder primært **cat:user-feature**-issues hvor UI-verify er den meningsfulde test. For backend/docs/CI er uafhængig verifikation tilstrækkelig:
- **Docs-only** (cat:ai-ops/type:docs): commit på main = done (ingen UI at verify)
- **Backend security**: Supabase MCP `list_migrations` viser version + applied_at = done (eksempel #517: migration 20260522091534 live i prod ✓)
- **CI/tooling**: commit på main + CI grøn = done
- **PR merged**: `gh pr view N --json mergedAt` + commit på main = done

Konkret 2026-05-23-pass2 lukkede 15 issues efter MCP-cross-verify uden brug af user-comment. Default for backend/docs: aggressive close med evidens-link.

**STRONG-patterns (regex, case-insensitive):**
- `verify-deploy\.ps1\s*OK`
- `verificeret\s+(?:på\s+)?prod` | `verified\s+on\s+prod`
- `deploy(?:ment)?[\s-]*OK` | `prod\s+OK`
- `\bHTTP\s+200\b.*prod`
- `prod[-\s]*verifikation` | `prod[-\s]*verification` _(2026-05-20: "Post-merge prod-verifikation")_
- `[Ll]ive\s+verificeret` | `verificeret\s+live` _(2026-05-20: tabel-kolonne "Live verificeret ✓")_
- `200\s*OK.*\bcycling-zone\.vercel\.app\b` (begge retninger) _(2026-05-20: "(200 OK)" mod prod-URL)_
- `merget\s+til\s+main.*deployet\s+til\s+prod` _(2026-05-20: "## LIVE — fixet er merget til main + deployet til prod")_
- `(?:Migration\s+)?anvendt\s+p[åa]\s+prod` _(2026-05-23: "Migration anvendt på prod 2026-05-22 ~11:00" på #517 — prod-evidens men fanges ikke af "verificeret prod"-pattern)_

**STRONG-test:** ✅-emoji alene = ikke STRONG. Skal nævne PROD eller deploy-script eller commit-hash.

**STRONG negative-keyword exclusion:** Hvis kommentaren matcher prod-evidens MEN også indeholder en af følgende → nedgrad til MEDIUM:
- `klar til din verifikation`, `awaiting verification`, `please verify`, `bør tage ~XX min`
- `🟡` emoji (= "yellow / pending"-konvention)
- Issue har `needs-user-action` label
- Tjekliste-pattern: `- [ ]` checkbox i kommentar (= ting brugeren mangler at gøre)
- _(2026-05-20)_ Outstanding-manual-work markører: `⚠️` emoji, `kræver user-action`, `kan ikke ... via API`, `kun gøres manuelt`, `resterende cleanup`

**Backend-only undtagelse til NEG-checkbox-regel (lektion 2026-05-22):** Hvis issue har labels `cat:infra` / `security` / `type:investigation` / `type:refactor` UDEN `cat:user-feature` → **ignorer** `- [ ]` Brugerverifikation-checkboxes som NEG-keyword. Backend-only changes (DB-migrations, security policies, infra-refactors) har sjældent user-facing UI at verify; deres "prod-verify" er typisk advisor-tabel / DB-query / deployment-status, ikke checklists. Eksempel: #525 Supabase advisor hardening — STRONG-evidens "Phase A complete (advisor 33→15)" bør IKKE downgraderes til MEDIUM af "ingen Brugerverifikation-checkboxes ticked" når der ikke er UI at verify. Andre NEG-keywords (`🟡`, `klar til din verifikation`, `⚠️`) gælder stadig.

Begrundelse: "verificeret prod" kan referere til _deploy-verification_ ("HTTP 200 OK på prod-URL") snarere end _feature-verification_ ("feature virker for brugeren"). NEG-keywords fanger to subtle pitfalls: (a) feature er teknisk live men brugeren mangler manuel UI-cleanup (`⚠️ kan ikke ... via API`); (b) merge er live men afventer eksplicit user-verify (`🟡 klar til din verifikation`).

**NO_COMMENTS + merged PR + backend-label → auto-suggest close (lektion 2026-05-24):** Hvis `claude:done`-issue har 0 comments OG der findes en merged PR via `Refs #N` / `Closes #N` / `(#N)` OG issue har en af labels `cat:infra` / `cat:ai-ops` / `type:docs` / `type:ci` / `backend-only` / `docs-only` UDEN `cat:user-feature` → behandl som **direkte close-eligible**, præcis som STRONG ≥24h. Begrundelse: 10/25 done-issues i 2026-05-24-audit havde 0 comments (typisk hurtig direct-close workflow hvor PR-merge + auto-labeling ikke producerede comment). Alle 10 havde merged PR + backend-label og blev lukket samme dag uden manuel investigation. Score-script bør markere `NO_COMMENTS + merged_pr + backend_label = AUTO_CLOSE` separat fra STRONG/MEDIUM/WEAK.

**Post-comment work-completion check (lektion 2026-05-20-pass2):** Hvis claude:done-issue's seneste comment matcher work-pending patterns (`Næste session`, `next session`, `bagudretter`, `efter merge`, `mangler X`) MEN der findes en merged PR med `Refs #N` til samme issue _efter_ comment-timestamp → flag som "comment likely outdated, work done via PR #M". Re-læs issue + PR #M for ægte status før scoring. Eksempel #508: comment 14:23Z sagde "Næste session bagudretter eksisterende ryttere", men PR #511 (Refs #508) merged 15:07Z udførte faktisk backwards-fix på 45 ryttere. Den outdated comment dictated WEAK-scoring; real state var "work done, awaiting user UI-verify".

## Trin 4 — Kategorisér (9 dimensioner)

**Primær:**
- **A. Mangler claude:done** — PR merged + bruger-verify findes, label glemt
- **B. Klar til lukning** — claude:done + STRONG + ≥24 timer (præcis time-diff, ikke rundede dage)
- **C. Awaiting verify** — claude:done + MEDIUM/WEAK/BLOCKED (begrundelse per issue)

**Bonus:**
- **D. Label-konflikter** — `claude:todo+done`, `claude:todo+blocked`, eller helt uden `claude:*`. **4-state-machine (lektion 2026-05-23):** Repo har de-facto 4 states (`claude:todo`, `claude:in-progress`, `claude:done`, `claude:blocked`). Hvis `claude:in-progress` persistent >24h efter en `Refs #N` PR er merged → label-cleanup-action (flyt til `claude:done`). Eksempel #558/#559: comment "venter på CI-grønt før merge" 15:47:28Z, PR #573 merged 15:47:48Z (20 sekunder senere), men `claude:in-progress` stadig sat dagen efter. Skill skal også tjekke 2-state-konflikter med in-progress (fx `claude:in-progress+done`).
- **E. Forfaldne pendings** — `claude:done` >14 dage uden bruger-interaktion
- **F. Stale backlog** — `claude:todo` >30 dage uden `updatedAt`-bevægelse (close/downgrade-kandidat)
- **H. `needs-user-action` reality-check** — sample 3-5, er handlingen muligvis udført?
- **I. Dependency unblock** — `claude:blocked` hvor blocker er lukket
- **J. Orphan PRs** — merged uden `Refs #N`

_(Tidligere G "State-brud" fjernet 2026-05-20-pass2 — per workflow 2026-05-18 er direct-close kanonisk og 2 audits i træk gav 0 actions. Behold som info-only pattern i baked-in lessons, ikke i kategori-listen.)_

## Trin 5 — Epic + duplikat-rollup (info-only, lav prioritet)

**Per `epic:*`-label:** tæl åbne sub-issues. Hvis 0 → "EPIC-READY-TO-CLOSE". Hvis epic-body checklist er ude af sync → foreslå opdatering.

**Duplikat-detection:** grep titler for substrings ≥4 ord; tjek "lignende #N" / "forskellig fra #N"-referencer for begge-åbne tilfælde.

**Bemærkning (lektion 2026-05-23):** 5 audits i træk = 0 EPIC-READY-TO-CLOSE-actions. Trinet behold som info-only (epic-count + dominans-fordeling er nyttigt for backlog-overblik), men under-prioriteres i præsentationen. Spring detail-print over hvis ingen action.

## Trin 6 — Præsentér (severity-sorted)

Per kategori, sortér: `priority:high` → `med` → `low`; inden for priority: ældste først.

Tabel-format:
```
| # | Pri | Titel | PR/Blocker | Evidens (≤100 tegn citat + comment-dato + author) |
```

Brug `[#N](https://github.com/NicolaiDolmer/CyclingZone/issues/N)` for alle issue-links.

**STRONG <24h-kandidater — eksplicit "vent til" timestamp (lektion 2026-05-24):** I Kategori B-sektion, for hver STRONG-kandidat med `hours_since_comment < 24`, print eksplicit `→ close-eligible efter [ISO-timestamp = comment_created + 24h] (= [HH:MM lokaltid])`. Næste audit kan checke "er klokken efter X?" uden at re-score hele issue-set. Eksempel: `#577 STRONG 6.1h → close-eligible efter 2026-05-25T01:38Z (= 03:38 Europe/Copenhagen)`. Sparer re-scoring i næste audit-kørsel hvis kun timing er ændret.

## Trin 7 — Konfirmér + udfør

Per memory `feedback_confirm_before_state_change.md`: pause før >5 handlinger.

Separate `AskUserQuestion` per kategori-gruppe (ikke alt-i-én):
1. Auto-close Kategori B (STRONG)?
2. Add claude:done til Kategori A?
3. Ryd label-konflikter D?
4. Triage stale backlog F (close/downgrade/keep)?
5. Unblock Kategori I (blocked → todo)?
6. Comment på orphan PRs J?

Idempotente parallelle batches:
```bash
gh issue close N --reason completed --comment "<citat + PR-link>"
gh issue edit N --add-label "claude:done"
gh issue edit N --remove-label "claude:todo"
gh issue edit N --add-label "claude:todo" --remove-label "claude:blocked"
```

## Trin 8 — Artifact + diff

Skriv `.claude/audits/audit-<YYYY-MM-DD>.md`:

```markdown
# Audit <dato>
- Åbne: X | Lukket sidste 14d: Y | PRs merged: Z

## Handlinger
- Lukket: #N — "<citat>" (PR #M)
- Labels: ...

## Carry-forward (Kategori C)
- #N — claude:done siden YYYY-MM-DD — score: MEDIUM/WEAK/BLOCKED — afventer: ...

## Diff mod forrige audit
- C→B: #N (verificeret nu)
- C→C: #N (stadig pending, X dage)
- Nyt: #N

## Stale backlog status
- F-kandidater: X issues >30d
- E-forfaldne: Y issues >14d

## Brugerverifikation-adoption (trend)
- PRs med sektion: X/Y (Z%)  ← diff vs forrige audit
- Fully checked: A | Partial: B | All-unchecked: C  ← diff vs forrige audit
```

**Brugerverifikation-trend (lektion 2026-05-22):** Tracker forfatter-disciplin over tid. Pass2 sagde "11/100 fully-checked sidste 14d (var 2 ved forrige audit)" men manglede section-coverage. Tilføjet til template for at fange tendensen: stiger % af PRs der har sektionen overhovedet, og % der får alle bokse checket post-merge.

Slut-opsummering til user: maks 8 linjer. Tæl udført / carry-forward / nye fund. Link til artifact.

## Trin 9 — Self-improvement retro (ALTID — sidste skridt)

Reflektér ærligt over kørslen:

1. **Hvad blev sprunget over?** Trin du valgte at ignorere — hvorfor?
2. **Hvor var du i tvivl?** Decision-rules der gav flip-flop (fx STRONG/MEDIUM-grænse)
3. **Hvad missede vi?** Audit-dimensioner der burde være med (fx ny label-konvention)
4. **Hvad var for meget?** Trin der var bortspildt tid for dagens scope
5. **Hvad bed dig?** Friktion i kommandoer, output-format, AskUserQuestion-flow

Foreslå **konkrete edits** til denne SKILL.md med linje-præcision (ikke vagt "forbedre Trin 3" — i stedet: "Trin 3 STRONG-kriterie: tilføj 'sentry-event referenced' som accepteret prod-evidens"). Brug `AskUserQuestion` med multiSelect for at få godkendelse per ændring.

For hver godkendt ændring:
- `Edit` SKILL.md direkte
- Append til `## Changelog` med dato, ændring, grund (citat fra dagens kørsel)

For afviste ændringer: append til `## Rejected suggestions` (med dato + grund). Stop med at foreslå det samme to gange.

Output efter retro: 1 linje per accepted/rejected. Hvis ingen ændringer foreslået: "Skill kørte rent, ingen forbedringer denne gang."

## Baked-in lessons (procedural — opdateres via retro)

- Brug `--limit 300` på open issues (repo har 150+, 100 er for snævert) — Lektion 2026-05-17
- STRONG kræver prod-evidens, ikke ✅-emoji alene — Lektion 2026-05-17
- Skriv artifact selv ved 0 handlinger — næste audit har brug for diff-baseline
- Bruger lukker normalt selv (`feedback_github_close_protocol.md`), MEN: STRONG + ≥24h = auto-close OK. _(Update 2026-05-23: `claude:done` blev un-deprecated; 20 åbne done-issues observeret. STRONG-auto-close er aktivt værktøj igen.)_
- Multi-step `AskUserQuestion` per kategori beats én stor (færre fejlklik)
- Stop ikke ved label-cleanup — backlog-stale, dep-graph, epic-rollup giver mest værdi
- **JSON-parsing:** `jq` er installeret (winget jqlang.jq). Brug `jq` for kompakte filtre; fallback Python json+re for komplekse joins (epic-rollup, score-logic). Hvis `jq` ikke på PATH efter `winget install jqlang.jq --silent`: brug fuld path `/c/Users/ndmh3/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe/jq` eller `export PATH="$PATH:<den path>"` i hver Bash-kald — PATH-ændring kræver shell-restart for automatisk pickup _(lektion 2026-05-20: winget tilføjer til Windows PATH men `bash`-tool læser PATH ved shell-start)._
- **Refs vs Closes (lektion 2026-05-18):** `Refs #N` er informativt (typisk sub-PR mod epic), `Closes/Fixes/Resolves #N` er close-intent. Hold dem adskilt i regex.
- **Python UTF-8 på Windows (lektion 2026-05-20-pass2 + 2026-05-24):** Default `cp1252`-codec fejler på emojis/UTF-8 i `gh`-output OG i `print()`. Brug altid `open(path, encoding='utf-8')` for input, OG sæt `PYTHONUTF8=1` env-var ved hver `python`-call for at fixe stdout-encoding: `PYTHONUTF8=1 python script.py`. Bidt igen 2026-05-24 (orphans.py crashede på `→`-emoji i `print()` — `open(..., encoding='utf-8')` alene løser ikke print-side). Også: `subprocess.run(['gh', ...])` direkte fra Python på Windows returnerer typisk empty stdout — workaround er at skrive `gh`-output til fil via Bash først (`gh issue view N --json ... > /tmp/issue-N.json`) og læse fra fil i Python.
- **Python TEMP-path på Windows (lektion 2026-05-22):** Bash-tool oversætter `/tmp/` → `C:\Users\<USER>\AppData\Local\Temp\` automatisk, men Python gør IKKE. `with open('/tmp/foo.json')` → `FileNotFoundError`. Brug `import os; TMP = os.environ.get('TEMP', '/tmp')` ELLER hardkod `r'C:/Users/emmas/AppData/Local/Temp'` i Python-scripts. Bidt 2 audits i træk.
- **State-brud-detection deprecated (lektion 2026-05-20-pass2):** Kategori G fjernet fra Trin 4 — 2 audits i træk gav 0 actions (direct-close kanonisk per workflow 2026-05-18). Hvis pattern dukker op igen som relevant, re-introducer som ny kategori.

## Changelog

- **2026-05-17 — Initial version.** Baseret på første audit-kørsel + retro. Lessons baked in:
  - `--limit 100` ramte loftet på repo med 150+ issues
  - STRONG-definition var upræcis (jeg flip-floppede på #75/76/77/73)
  - Manglede stale-todo, state-brud, orphan-PR, dep-unblock, epic-rollup dimensioner
  - Manglede artifact-output → kan ikke diffe forfaldne over tid
  - Én stor multiSelect-AskUserQuestion vs per-kategori → mindre fejlklik

- **2026-05-18 — Audit-housekeeping retro.** Lessons fra 2. kørsel:
  - **Trin 2:** Splittet `REF_RE` og `CLOSE_RE`. Citat: "Kategori A producerede 8 false positives (epics med Refs-sub-PRs)". Kun close-intent flagger Kategori A.
  - **Trin 3:** Tilføjet STRONG negative-keyword exclusion. Citat fra #361: "'verificeret prod' matchede regex, men kommentar var '🟡 Klar til din verifikation' — false positive."
  - **Trin 2/4/Baked-in:** Noted at `claude:done` blev deprecated denne audit. Skill skal med tiden re-tænke Kategori B/E/G — direct-close er nu kanonisk flow.
  - **Baked-in lessons:** `jq` installeret (winget jqlang.jq). Defaultér til jq for simple filtre, Python for komplekse joins.

- **2026-05-20 — Audit-housekeeping retro.** Lessons fra 3. kørsel:
  - **Trin 2 (Brugerverifikation parsing):** Tidligere regex `- [x] Brugerverifikation` matchede **0/100 PRs**. Real PR-format er `## Brugerverifikation`-sektion med multiple `- [x]` / `- [ ]` underliggende boxes. Skill opdateret til at finde section-header + tælle checkboxes EFTER header → rapportér `X/Y checked` per PR.
  - **Trin 3 STRONG_PATTERNS:** Udvidet med 5 reelle bruger-patterns fra denne kørsel: `prod-verifikation`, `Live verificeret`, `200 OK ... cycling-zone.vercel.app`, `Landet YYYY-MM-DD (commit X, vN)`, `merget til main + deployet til prod`. Citat fra #412: "Post-merge prod-verifikation 2026-05-19 ... 200 OK" — matchede ingen oprindelige STRONG-pattern men er klar STRONG-evidens. Citat fra #470: "## LIVE — fixet er merget til main + deployet til prod 🟢" — samme.
  - **Trin 3 NEG_KEYWORDS:** Udvidet med outstanding-manual-work indicators: `⚠️`, `kræver user-action`, `kan ikke ... via API`, `kun gøres manuelt`, `resterende cleanup`. Citat fra #416: "## ✅ Done (verificeret live 2026-05-18) ... ⚠️ 2 orphan-kanaler ... kan ikke slettes via API ... Resterende cleanup (kræver user-action via Discord UI)" — feature er live men 3 unfinished items kræver manuel UI-handling, ikke ægte STRONG.
  - **Age-precision:** Brug `hours_since_comment >= 24` ikke `days >= 1`. `today = datetime(2026, 5, 20, ...)` med midnatten gav #412 = `0 days` mens den var 27 timer (≥24h tærskel). Korrekt clock-start er `datetime.now(timezone.utc)`.
  - **Trin 2/4 Kategori G re-definition:** Per workflow 2026-05-18 er direct-close kanonisk. "Lukket uden claude:* nogensinde" sidste 14d gav 1 issue (#495 GitHub Actions billing) — info-only, ingen action. Bekræfter forrige audit's re-definition.
  - **`jq` PATH-issue:** Winget tilføjer `jq` til Windows PATH, men bash-tool's PATH er læst ved shell-start, så `jq` er først tilgængelig næste session. Workaround: brug fuld path eller `export PATH=...` i hver Bash-kald.

- **2026-05-20-pass2 — Audit-housekeeping retro (anden kørsel samme dag).** Lessons fra 4. kørsel — reneste state observed (0 actions på alle 10 kategorier efter morgenens deep-cleanup).
  - **Trin 3 (Post-comment work-completion check):** Nyt afsnit tilføjet. Citat fra #508: comment 14:23Z sagde "Næste session bagudretter eksisterende ryttere" → scored WEAK. Men PR #511 (Refs #508) merged 15:07Z udførte faktisk backwards-fix på 45 ryttere — den outdated comment dictated forkert score. Skill checker nu efter `Refs #N` PRs merged _efter_ comment-timestamp + flagger som "comment likely outdated, re-læs PR for ægte status".
  - **Trin 4 (Kategori G fjernet):** Per 2 audits i træk med 0 actions er Kategori G "State-brud" deprecated. Skill simplificeret fra 10 → 9 dimensioner. Direct-close er kanonisk per workflow 2026-05-18; ingen action mulig fra audit-siden.
  - **Trin 7 renummerering:** AskUserQuestion-tjekliste gik fra 7 → 6 items.
  - **Baked-in lesson (Python UTF-8):** `open(..., encoding='utf-8')` påkrævet på Windows — default `cp1252` fejler på emojis i `gh`-output. Bidt 3x i denne kørsel (`UnicodeDecodeError: 'charmap' codec can't decode byte 0x8f`). Også: `subprocess.run(['gh', ...])` fra Python returnerer empty stdout på Windows — workaround er Bash-write-to-file → Python-read-from-file.
  - **Brugerverifikation parsing virker (validation):** 11/100 PRs all-checked sidste 14d (var 2 ved forrige audit-pass). Forfattere udfylder sektionen mere konsekvent siden skill-fix.

- **2026-05-24 — Audit-housekeeping retro.** Lessons fra 7. kørsel — **17 closes** (største batch til dato), 1 label-cleanup (#521 todo+done), 1 escalation-ping (#505). 0 STRONG ≥24h (3 STRONG <24h vent), 5 carry-forward.
  - **Trin 3 (Author-tracking begrænset signal i denne repo):** Tilføjet undtagelse. Alle commits + de fleste comments er forfattet som `NicolaiDolmer` (AI-agenter committer via lokal git-config). Author-login KAN derfor ikke bruges til at skelne "bruger vs AI". 2026-05-24-audit lukkede 17 issues uden author-tracking — close-grundlag var commit-på-main + ingen UI-label. Skill bør ikke gate aggressive close på author-tracking når backend/docs/CI-evidens er stærk. Trin 3-tekst sagde "afvise STRONG hvis author er AI-agent" — denne regel filtrerer i praksis kun rene bot-comments (`github-actions[bot]`, `dependabot[bot]`).
  - **Trin 3 (NO_COMMENTS + merged PR + backend-label → auto-suggest close):** Nyt afsnit. 10/25 done-issues i dag havde 0 comments (typisk hurtig direct-close workflow hvor PR-merge + auto-labeling ikke producerede comment). Alle 10 havde merged PR via `Refs #N` og backend/docs/CI-label. Behandl som direkte close-eligible uden at re-score per STRONG/MEDIUM/WEAK. Score-script bør markere `NO_COMMENTS + merged_pr + backend_label = AUTO_CLOSE`.
  - **Trin 6 (STRONG <24h — eksplicit "vent til" timestamp):** Tilføjet. I dag: 3 STRONG <24h-kandidater (#577 6.1h, #578 5.6h, #579 6.1h). Artifact listede dem som "vent" men sagde ikke hvornår. Skill foreslår nu: print `→ close-eligible efter [ISO + 24h]` per kandidat. Næste audit kan skip re-scoring hvis kun timing var ændret.
  - **Baked-in lesson (Python UTF-8 udvidet):** `open(..., encoding='utf-8')` alene fixer ikke `print()`-emoji-crashes. Skill foreslår: brug `PYTHONUTF8=1 python script.py` ved hver call. Bidt igen 2026-05-24 (orphans.py crashede på `→`-emoji i print).

- **2026-05-23-pass2 — Post-audit korrektion.** Bruger flaggede pass1 som fejlet: "Det vigtigste ved denne skill og opgave du lige har kørt, det er at du gennemgår alle opgaver. Vurdere om opgaverne allerede er løst eller ej. Og hvis opgaverne er løst sikkert allerede og du er 100% sikker på, at de er løst, så skal du lukke opgaverne. Har du overhovedet gjort det?" Lessons:
  - **Header (Audit-success kriterium):** Tilføjet eksplicit. En audit hvor 20 done-issues blev scored men 0 lukket = fejlet audit. PRIMÆRT mål er at lukke, ikke at score.
  - **Trin 3 (AI-author IKKE close-blocker):** Tilføjet undtagelse. Strict author-tracking (pass1's regel) gjorde alle 20 done-issues til WEAK. Pass2 lukkede 15 via uafhængig MCP/git/PR-verifikation: 9 docs (commit på main / PR merged) + 3 security (Supabase MCP `list_migrations` viste migrations live i prod) + 2 CI/tooling (commit på main + CI grøn) + 1 backend setup (Infisical Phase 1).
  - **Memory (feedback):** Skrevet `feedback_audit_close_aggressive.md` + tilføjet til HOT-tier MEMORY.md. Default: aggressive close for backend/docs, defensive for user-feature.

- **2026-05-23 — Audit-housekeeping retro.** Lessons fra 6. kørsel — 7 actions (2 label-cleanup + 5 NUA-pings), 0 STRONG, 16 nye done-issues siden gårsdagens audit (+ B-series & security batch).
  - **Trin 1 (PR-loft bump):** Bumpet `gh pr list --state merged --limit` fra 100 til 200. 5 audits i træk har ramt 100/100 inden for 14d → indikerer PR-pace er højere end antaget; 200 giver fuld 14d-dækning uden at miste data.
  - **Trin 3 (STRONG_PATTERNS):** Tilføjet `(?:Migration\s+)?anvendt\s+p[åa]\s+prod`. Citat fra #517 (P0 RLS-lockdown): "Migration anvendt på prod 2026-05-22 ~11:00:" — klar prod-evidens men fanges ikke af "verificeret prod"-pattern. Stadig WEAK fordi author-tracking endnu ikke er aktiv i scoreren, men patternen er nu klar til når author-tracking lander.
  - **Trin 3 (Author-tracking):** Tilføjet eksplicit afsnit. Skill-tekst sagde "Bruger-kommentar EFTER done-label" men scorer trackede ikke author. 2026-05-23-audit: 20/20 åbne done-issues havde AI-authored latest comments → derfor 0 STRONG-kandidater systematisk. Yesterday's audit (2026-05-22) brugte reglen implicit ved at citere "Bruger-citat 'kan lukke issuet'" — men det var manuel filtrering. Næste audit skal automatisere: tjek `comments[-1].author.login` og afvis STRONG hvis AI.
  - **Trin 4 (Kategori D — 4. state):** Tilføjet `claude:in-progress` til state-machine. Skill antog 3 states; repo har 4. Citat: #558 + #559 havde `claude:in-progress` med comment "venter på CI-grønt før merge" 15:47:28Z, men PR #573 merged 15:47:48Z (20 sekunder senere). State var stale dagen efter. Ny regel: hvis `claude:in-progress` >24h efter en `Refs #N` PR mergede → cleanup-action til `claude:done`.
  - **Trin 5 (Epic-rollup downgrade):** Markeret som "info-only, lav prioritet". 5 audits i træk = 0 EPIC-READY-TO-CLOSE actions. Behold info-output men forenkl præsentation når ingen action.
  - **Baked-in lessons opdatering:** Fjernet "claude:done deprecated"-note (un-deprecated 2026-05-22).

- **2026-05-22 — Audit-housekeeping retro.** Lessons fra 5. kørsel — 2 STRONG auto-close (#515, #525), 4 carry-forward, 4. ren state i træk.
  - **Trin 2 (MCP cross-verify):** Nyt afsnit. For Kategori B-kandidater (STRONG, ≥24h): brug Vercel MCP `get_deployment` til at verify commit-hash matcher prod-deploy, og Supabase MCP `execute_sql` til at re-run DB-claims. Citat fra #515: "Read-only Supabase-query 2026-05-20 ... 26/26 sæson 1-løb har edition_year" — jeg stolede på user-citat, men kunne have re-run query selv via MCP for uafhængig STRONG-confirmation. Citat fra #525: "migration 20260520201822 live i prod" — Vercel MCP kunne bekræfte deployment-status. Verdens-klasse = selvstændig verifikation, ikke kun proxy-evidens.
  - **Trin 3 (Backend-only NEG-undtagelse):** Tilføjet. Citat fra #525: STRONG-text "Phase A er complete (advisor 33 → 15)" + scope split + forfatter-anbefaling "luk #525". Ingen Brugerverifikation-checkboxes (= 0 unchecked, 0 checked). Den nuværende NEG-regel "`- [ ]` checkbox = downgrade" ramte IKKE her (0 checkboxes overhovedet), men hvis issue HAVDE haft tomme placeholder-bokse ville den fejlagtigt downgrade til MEDIUM. Backend-only changes (security, infra, refactor uden user-feature label) har sjældent user-UI at verify — NEG-checkbox-regel suspenderes for dem.
  - **Trin 8 (Brugerverifikation-trend i artifact):** Tilføjet til template. Vi har nu 2 datapunkter (pass2: 11/100 fully; 2026-05-22: 46/100 har sektion, 11 fully, 29 partial, 6 all-unchecked) men forrige audits manglede "har sektion"-tallet. Tracker forfatter-disciplin over tid.
  - **Baked-in lesson (Python TEMP-path):** Tilføjet. Bash-tool's `/tmp/` virker IKKE i Python på Windows. Bidt denne audit (`FileNotFoundError`); fix: `os.environ['TEMP']` eller hardkod `C:/Users/emmas/AppData/Local/Temp`.

## Rejected suggestions

- **2026-05-20-pass2 — Whitelist permanent trackers i Kategori D.** Foreslået: ekskludér issues med `docs-only` + `cat:ai-ops`-labels fra "no claude:* state"-rapportering (eksempel: #499 Weekly time-reports cron-tracker). Afvist fordi: kun 1 issue i hele backloggen matcher mønstret → lavt signal, høj brittleness-risiko hvis labels ændrer sig. Hvis flere permanente trackers dukker op senere, re-introducer som ny whitelist-mekanisme.
