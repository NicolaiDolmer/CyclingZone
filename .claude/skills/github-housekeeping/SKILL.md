---
name: github-housekeeping
description: Grundig GitHub-issue-audit + state-maskine-cleanup. Trigger med "github audit", "issue cleanup", "ryd op i issues", "label hygiejne", "github housekeeping", "audit issues". Self-improving — hver kørsel slutter med en retro der foreslår konkrete forbedringer til denne skill selv. Bruger godkender ændringer; skillen bliver bedre over tid.
---

# GitHub Housekeeping (self-improving)

Grundig audit af GitHub-issues. Mål: ren label-state-maskine, fang forfaldne, opdag dependency-kæder, intet glemmer sig. **Konfirmér før mass-handling.** Slutter med self-improvement retro (Trin 9 — ALTID).

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
gh pr list --state merged --limit 100 --json number,title,mergedAt,body
gh pr list --state open --limit 30 --json number,title,isDraft,body
```

Limits: 300 åbne (repo har 150+; margin). 100 PRs (14 dage = ~30-50 typisk).

## Trin 2 — Cross-reference (systematisk)

**Per merged PR sidste 14 dage — TO separate regex:**
- `CLOSE_RE = (?:Closes|Fixes|Resolves)\s*#(\d+)` → close-intent (GitHub auto-close keywords)
- `REF_RE = (?:Refs|Updates|Implements|See)\s*#(\d+)` → informativ kun (epic-tracker eller context)
- Match mod åbne issues. **Kun CLOSE-refs flagger Kategori A** (mangler claude:done). REF-refs ignoreres for done-label-check fordi de er informative (typisk sub-PR mod epic).
- Parse PR-body Brugerverifikation-section: find `## Brugerverifikation`-header → tæl `- [x]` vs `- [ ]` checkboxes EFTER header → rapportér `X/Y checked`. _(Lektion 2026-05-20: tidligere regex `- [x] Brugerverifikation` matchede 0/100 PRs — real format er sektion-header med multiple underliggende boxes, ikke en enkelt checkbox-linje.)_
- Flag PRs UDEN nogen `#N`-ref (heller ikke parentes-shorthand `(#N)`) som Kategori J: orphan. Filtrer dependabot/chore-PRs fra orphan-rapporten.

**Per `claude:done`-issue:** find seneste comment EFTER claude:done-label, score per Trin 3. _(Note: `claude:done` blev deprecated 2026-05-18 per audit-housekeeping → fremtidige audits ser sandsynligvis 0 done-issues. Trin 2's done-scan kan med tiden fjernes hvis label er retired.)_

**Per `claude:blocked`-issue:** `gh issue view <blocker-N> --json state` — hvis blocker lukket → Kategori I.

**Per lukket issue sidste 14 dage:** havde den `claude:done` før close? Hvis ej → Kategori G (state-brud). _(Note: Per workflow 2026-05-18 er direct-close fra todo/in-progress nu kanonisk → Kategori G bør re-defineres som "lukkede uden nogen `claude:*` label nogensinde", ikke "uden done". Behold som info-pattern, ikke action.)_

## Trin 3 — Verifikations-score (EKSPLICITTE regler)

| Score | Kriterie | Auto-handling |
|---|---|---|
| **STRONG** | Bruger-kommentar EFTER done-label med specifik prod-evidens (se patterns nedenfor) | Foreslå **auto-close** hvis ≥24 timer |
| **MEDIUM** | "Lokal Chrome MCP grøn", "CI grøn", "PR åbnet — leveret per AC", implementations-status uden prod-verify | Vent. Escalér comment hvis ≥7 dage |
| **WEAK** | Kun AI-kommentar, eller bruger ✅-emoji uden detaljer | Vent. Escalér comment hvis ≥14 dage |
| **BLOCKED** | Kommentar nævner åben sub-issue / manuel handling / "venter på X" | Lad være. Verificér blocker stadig åben |

**Age-precision (lektion 2026-05-20):** brug `hours_since_comment` (`datetime.now(timezone.utc) - comments[-1].createdAt`), IKKE rundet `days`. Tærskel er 24 timer ikke "1 dag" — ellers misser kommentarer kl. 08:46 på dag N når audit kører kl. 11:00 på dag N+1 (faktisk 27h, men `days`-rounding giver 1d eller 0d afhængig af clock-start).

**STRONG-patterns (regex, case-insensitive):**
- `verify-deploy\.ps1\s*OK`
- `verificeret\s+(?:på\s+)?prod` | `verified\s+on\s+prod`
- `deploy(?:ment)?[\s-]*OK` | `prod\s+OK`
- `\bHTTP\s+200\b.*prod`
- `prod[-\s]*verifikation` | `prod[-\s]*verification` _(2026-05-20: "Post-merge prod-verifikation")_
- `[Ll]ive\s+verificeret` | `verificeret\s+live` _(2026-05-20: tabel-kolonne "Live verificeret ✓")_
- `200\s*OK.*\bcycling-zone\.vercel\.app\b` (begge retninger) _(2026-05-20: "(200 OK)" mod prod-URL)_
- `merget\s+til\s+main.*deployet\s+til\s+prod` _(2026-05-20: "## LIVE — fixet er merget til main + deployet til prod")_

**STRONG-test:** ✅-emoji alene = ikke STRONG. Skal nævne PROD eller deploy-script eller commit-hash.

**STRONG negative-keyword exclusion:** Hvis kommentaren matcher prod-evidens MEN også indeholder en af følgende → nedgrad til MEDIUM:
- `klar til din verifikation`, `awaiting verification`, `please verify`, `bør tage ~XX min`
- `🟡` emoji (= "yellow / pending"-konvention)
- Issue har `needs-user-action` label
- Tjekliste-pattern: `- [ ]` checkbox i kommentar (= ting brugeren mangler at gøre)
- _(2026-05-20)_ Outstanding-manual-work markører: `⚠️` emoji, `kræver user-action`, `kan ikke ... via API`, `kun gøres manuelt`, `resterende cleanup`

Begrundelse: "verificeret prod" kan referere til _deploy-verification_ ("HTTP 200 OK på prod-URL") snarere end _feature-verification_ ("feature virker for brugeren"). NEG-keywords fanger to subtle pitfalls: (a) feature er teknisk live men brugeren mangler manuel UI-cleanup (`⚠️ kan ikke ... via API`); (b) merge er live men afventer eksplicit user-verify (`🟡 klar til din verifikation`).

## Trin 4 — Kategorisér (10 dimensioner)

**Primær:**
- **A. Mangler claude:done** — PR merged + bruger-verify findes, label glemt
- **B. Klar til lukning** — claude:done + STRONG + ≥24 timer (præcis time-diff, ikke rundede dage)
- **C. Awaiting verify** — claude:done + MEDIUM/WEAK/BLOCKED (begrundelse per issue)

**Bonus:**
- **D. Label-konflikter** — `claude:todo+done`, `claude:todo+blocked`, eller helt uden `claude:*`
- **E. Forfaldne pendings** — `claude:done` >14 dage uden bruger-interaktion
- **F. Stale backlog** — `claude:todo` >30 dage uden `updatedAt`-bevægelse (close/downgrade-kandidat)
- **G. State-brud** — lukkede issues uden forudgående `claude:done`
- **H. `needs-user-action` reality-check** — sample 3-5, er handlingen muligvis udført?
- **I. Dependency unblock** — `claude:blocked` hvor blocker er lukket
- **J. Orphan PRs** — merged uden `Refs #N`

## Trin 5 — Epic + duplikat-rollup

**Per `epic:*`-label:** tæl åbne sub-issues. Hvis 0 → "EPIC-READY-TO-CLOSE". Hvis epic-body checklist er ude af sync → foreslå opdatering.

**Duplikat-detection:** grep titler for substrings ≥4 ord; tjek "lignende #N" / "forskellig fra #N"-referencer for begge-åbne tilfælde.

## Trin 6 — Præsentér (severity-sorted)

Per kategori, sortér: `priority:high` → `med` → `low`; inden for priority: ældste først.

Tabel-format:
```
| # | Pri | Titel | PR/Blocker | Evidens (≤100 tegn citat + comment-dato + author) |
```

Brug `[#N](https://github.com/NicolaiDolmer/CyclingZone/issues/N)` for alle issue-links.

## Trin 7 — Konfirmér + udfør

Per memory `feedback_confirm_before_state_change.md`: pause før >5 handlinger.

Separate `AskUserQuestion` per kategori-gruppe (ikke alt-i-én):
1. Auto-close Kategori B (STRONG)?
2. Add claude:done til Kategori A?
3. Ryd label-konflikter D?
4. Triage stale backlog F (close/downgrade/keep)?
5. Unblock Kategori I (blocked → todo)?
6. Patch state-brud G (add claude:done før close, retro)?
7. Comment på orphan PRs J?

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
```

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
- Bruger lukker normalt selv (`feedback_github_close_protocol.md`), MEN: STRONG + ≥24h = auto-close OK _(post-2026-05-18: `claude:done` deprecated → ingen kandidater forventes)_
- Multi-step `AskUserQuestion` per kategori beats én stor (færre fejlklik)
- Stop ikke ved label-cleanup — backlog-stale, dep-graph, epic-rollup giver mest værdi
- **JSON-parsing:** `jq` er installeret (winget jqlang.jq). Brug `jq` for kompakte filtre; fallback Python json+re for komplekse joins (epic-rollup, score-logic). Hvis `jq` ikke på PATH efter `winget install jqlang.jq --silent`: brug fuld path `/c/Users/ndmh3/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe/jq` eller `export PATH="$PATH:<den path>"` i hver Bash-kald — PATH-ændring kræver shell-restart for automatisk pickup _(lektion 2026-05-20: winget tilføjer til Windows PATH men `bash`-tool læser PATH ved shell-start)._
- **Refs vs Closes (lektion 2026-05-18):** `Refs #N` er informativt (typisk sub-PR mod epic), `Closes/Fixes/Resolves #N` er close-intent. Hold dem adskilt i regex.

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

## Rejected suggestions

_(Tom — append her hvis bruger afviser forbedringsforslag, så vi ikke gentager dem)_
