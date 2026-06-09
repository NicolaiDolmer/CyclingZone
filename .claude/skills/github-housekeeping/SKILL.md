---
name: github-housekeeping
description: Grundig GitHub-issue-audit + state-maskine-cleanup. Trigger med "github audit", "issue cleanup", "ryd op i issues", "label hygiejne", "github housekeeping", "audit issues". Self-improving — hver kørsel slutter med en retro der foreslår konkrete forbedringer til denne skill selv. Bruger godkender ændringer; skillen bliver bedre over tid.
---

# GitHub Housekeeping (self-improving)

Grundig audit af GitHub-issues. **PRIMÆRT MÅL: LUK verificerede issues.** Sekundært: ren label-state-maskine, fang forfaldne, opdag dependency-kæder.

**Autonom auto-close (2026-05-29, #627):** Den daglige cloud-routine **lukker nu selv** Tier 1+2 (se `## Routine integration` + `routine-prompt.md`). Den manuelle skill håndterer primært **Tier 3-eskaleringer** (dømmekraftsager), reopen-veto-review og Trin 9-retro. Tier-modellen er den fælles kontrakt — defineret i `routine-prompt.md` Trin 3, scoret af `score_done.py --json`.

**Audit-success kriterium (lektion 2026-05-23):** En audit hvor 20 claude:done-issues blev scored men 0 lukket er en fejlet audit. Hvis arbejdet kan verificeres uafhængigt (commit på main, migration live via Supabase MCP, PR merged), skal det lukkes — IKKE udskydes pga. "skill regel kræver user-comment". Default: aggressive close, ikke defensive scoring.

**Konfirmér før mass-handling** (>5 closes). Slutter med self-improvement retro (Trin 9 — ALTID).

## Trin 0 — Setup

- Audit-ID: `audit-<YYYY-MM-DD>` (dagens dato)
- Tidsrammer: 14 dage for PR-cross-ref; 30 dage for stale-todo; 14 dage for forfaldne done
- Læs forrige audit hvis findes: `Glob .claude/audits/audit-*.md` → senest → diff Kategori C carry-forward

## Trin 1 — Data (parallelt, ét batch)

```bash
gh issue list --state open --limit 500 --json number,title,labels,updatedAt > "$TEMP/audit-open-all.json"
gh issue list --state open --label "claude:done" --limit 100 --json number,title,labels,comments,updatedAt > "$TEMP/audit-done.json"
gh issue list --state open --label "claude:blocked" --limit 50 --json number,title,labels,comments > "$TEMP/audit-blocked-issues.json"
gh issue list --state open --label "needs-user-action" --limit 50 --json number,title,updatedAt > "$TEMP/audit-nua.json"
gh issue list --state closed --limit 100 --json number,title,labels,closedAt > "$TEMP/audit-closed.json"
gh pr list --state merged --limit 200 --json number,title,mergedAt,body > "$TEMP/audit-pr-merged.json"
gh pr list --state open --limit 30 --json number,title,isDraft,body > "$TEMP/audit-prs-open.json"
```

Filnavne matcher script-forventninger direkte (lektion 2026-05-26: 3 `cp`-kald per audit eliminerede). Scripts i `.claude/skills/github-housekeeping/scripts/*.py` læser fra `$TEMP/audit-open-all.json`, `audit-done.json`, `audit-pr-merged.json`, `audit-blocked-issues.json`.

Limits: **500 åbne** (lektion 2026-06-03: repo ramte 300-loftet med 313 åbne under TdF-launch-sprint → open-all cross-ref missede issues; 500 giver margin). 200 merged PRs (lektion 2026-05-23: 5 audits i træk ramte 100/100 inden for 14d — pace højere end antaget; 200 giver fuld dækning med marginal extra runtime).

## Trin 2 — Cross-reference (systematisk)

**Per merged PR sidste 14 dage — TO separate regex:**
- `CLOSE_RE = (?:Closes|Fixes|Resolves)\s*#(\d+)` → close-intent (GitHub auto-close keywords)
- `REF_RE = (?:Refs|Updates|Implements|See)\s*#(\d+)` → informativ kun (epic-tracker eller context)
- Match mod åbne issues. **Kun CLOSE-refs flagger Kategori A** (mangler claude:done). REF-refs flagger IKKE A — men de er IKKE længere ignoreret: de fødes ind i **Kategori K (glemt-done)**, se eget pass nedenfor.
- Parse PR-body Brugerverifikation-section: find `## Brugerverifikation`-header → tæl `- [x]` vs `- [ ]` checkboxes EFTER header → rapportér `X/Y checked`. _(Lektion 2026-05-20: tidligere regex `- [x] Brugerverifikation` matchede 0/100 PRs — real format er sektion-header med multiple underliggende boxes, ikke en enkelt checkbox-linje.)_
- Flag PRs UDEN nogen `#N`-ref (heller ikke parentes-shorthand `(#N)`) som Kategori J: orphan. Filtrer dependabot/chore-PRs fra orphan-rapporten.

**Glemt-done-pass — cross-ref ALLE åbne ikke-done-issues mod merged PR'er (lektion 2026-06-02 — REPO'ETS HYPPIGSTE BLIND VINKEL):** Tidligere audits cross-refede kun `claude:done`-issues + `Closes/Fixes`-intent. MEN dette repo bruger næsten altid `Refs #N` (per `feedback_github_close_protocol`), så et issue hvor kerne-arbejdet blev leveret via en merged `Refs #N`-PR, men hvor nogen glemte at markere done/lukke, **faldt igennem hver eneste audit**. Bruger flaggede direkte 2026-06-02: "Vi har ofte tit glemt at markere opgaver som done, selvom de faktisk allerede er lavet." `crossref.py` Kategori K surfacer nu kandidaterne: åbne ikke-done-issues (ekskl. epics + NUA/blocked) med ≥1 kvalificerende merged PR via enhver `#N`-ref, efter støj-filter (dependabot-changelog indeholder fremmede #-numre; `docs(now)`-close-outs nævner #N uden at levere; epic-milestone-PR'er lister sub-issues). **Scriptet kan IKKE skelne ægte levering fra delvis/incidentel** — for hver kandidat: dispatch parallelle sub-agenter der læser issuets AC mod PR'ens faktiske leverance. Falske positiver 2026-06-02: talkollision (#33↔PR #856 "Refs #855"), deferral ("→ deferred to #253"), dependency-note ("kobler til #266"), tracking-række i workflow-doc. Ægte fund: #532/#719/#646 (backend/tooling, lukket), #793/#19/#896 (dev-færdig user-feature/admin → claude:done + ejer-verify).

**Scope-verify — kalibrér adversarisk styrke pr. tiltænkt handling (lektion 2026-06-09):** Et ekstra adversarisk "prøv-at-afvise"-pass oven på scope-verify fanger delvise leverancer — men gaten SKAL skelne handlingstype, ellers fejl-blokerer den. `close` (backend/tooling, ~irreversibelt for backloggen) → **hård** adversarisk: afvis ved enhver tvivl. `move-to-done` (dev-færdig user-feature → `claude:done`) → afvis **kun** hvis et acceptkriterie er genuint umødt/delvist; en **normal ejer-verify-gate** (uafkrydset prod-checkbox i PR-body, "lukkes når ejer-verificeret", "afventer din verifikation") er IKKE en afvisningsgrund — den ER selve definitionen på `claude:done`. 2026-06-09: en uniform hård gate refuterede 13 verdikter, hvoraf ~10 bare var dev-færdige-afventer-ejer-verify (skulle være move-to-done) og kun 2 ægte delvise fund (#165 AC#3 manglede, #917 rest-DA-leak) — resten krævede manuel om-klassificering. Refute-prompten for move-to-done bør derfor eksplicit sige: "ejer-verify-gate ≠ ufærdig; afvis kun ved umødt/delvist AC."

**Glemt-done carry-forward-cache (lektion 2026-06-03):** `crossref.py` bruger ALLE merged PR'er (ingen 14d-cutoff — glemt-done akkumulerer), så de samme incidentelle omtaler (talkollision/deferral/dependency-note) dukker op i Kategori K **hver eneste dag** og koster sub-agent-runtime ved re-verify. Cachen `scripts/k-legit-open.json` (git-tracket) husker issues der allerede er verificeret legitimt-åbne. Print-mode separerer nu `N til verify` fra `N prev-legit` (sidstnævnte vises kun på en skip-linje). Et candidate re-flagges `[RE-VERIFY: ny PR]` hvis en NY kvalificerende PR er dukket op siden cache-verify (der kan være leveret noget nyt). **Efter audit:** kør `PYTHONUTF8=1 python crossref.py --mark-legit <kommasep. issues>` med dem du netop verificerede legitimt-åbne — så springer næste audit dem over. Writer-mode rydder selv cache-entries der er lukket / nu `claude:done`.

**Per `claude:done`-issue:** find seneste comment EFTER claude:done-label, score per Trin 3. _(Note: `claude:done` blev un-deprecated 2026-05-22 per workflow-revision. 2026-05-23-audit observerede 20 åbne done-issues (var 4 dagen før, +16 fra B-series + security batch). Label er aktiv del af state-maskine igen.)_

**Per `claude:done`-issue der citerer en PR — verify PR ER merged (lektion 2026-05-28):** Hvis seneste comment citerer `PR #N` / `pull/N` (især "## Leveret — PR #N" / "leveret i PR #N"-patterns), kør `gh pr view N --json state,mergedAt`. Hvis PR'en er `OPEN`/draft → **flag "claims delivered but PR #N still open — NOT close-eligible, carry-forward"** uanset hvor stærk comment-evidensen ellers er. Dette er den omvendte check af Trin 3's "Post-comment work-completion check" (comment siger pending, men PR merged efter): her siger comment _done_, men koden er ikke merget. Eksempel #706: comment "## Leveret — PR #713  Migration anvendt: … DB har nu 19/19" mens PR #713 var `OPEN` (not draft) — migration evt. live i DB, men close-protokol ufuldstændig til PR merges. Sparer manuel `gh pr view` per done-issue.

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

**AI-verify via Playwright-mock-login som accepteret user-feature-verifikation (lektion 2026-06-02):** Når bruger beder om "AI-verify" af en batch user-feature-issues (i stedet for at lukke blindt på merged+live), er den dokumenterede metode: skriv en engangs `frontend/tests/e2e/audit-verify.spec.js` der importerer `fixtures.js` (`installNetworkMocks` + `login` + `stabilizePage`), navigerer til de berørte sider og `page.screenshot({ fullPage: true })`. Kør `npx playwright test audit-verify --project=desktop-chromium`, inspicér screenshots med Read, **slet spec + test-results bagefter** (commit dem ikke). Setup-noter: worktree mangler typisk `node_modules` → `npm ci` i `frontend/` (playwright-browsere er globalt cachet, ingen download); verificér port 4173 fri før kørsel (memory: stale-server-fælde). **Et visuelt screenshot på main = prod-kode = gyldig feature-verify** → close-eligible.
- **Vigtig begrænsning:** `fixtures.js` returnerer **tomme arrays** for `race_results`, `season_standings`, `races`, `transfers` m.fl., og mock-brugeren har rolle `manager` (ikke admin). Data-afhængige sider (løbsresultat-historik, rangliste-rækker, kalender-sortering, admin-paneler) renderer derfor **tomt** og kan IKKE visuelt verificeres. For dem: kode/PR-verify + lad issuet stå som "couldn't-render carry-forward" (se Trin 6) med anbefaling om ejer-spot-check — luk IKKE blindt. 2026-06-02: #505 (admin-only), #780/#823 (tom race-data), #825 (tom rangliste + begge temaer) kunne ikke renderes; #670/#777/#796/#800/#801/#837/#855 blev visuelt bekræftet på /riders + /auctions og lukket.

**NO_COMMENTS + merged PR + backend-label → auto-suggest close (lektion 2026-05-24):** Hvis `claude:done`-issue har 0 comments OG der findes en merged PR via `Refs #N` / `Closes #N` / `(#N)` OG issue har en af labels `cat:infra` / `cat:ai-ops` / `type:docs` / `type:ci` / `backend-only` / `docs-only` UDEN `cat:user-feature` → behandl som **direkte close-eligible**, præcis som STRONG ≥24h. Begrundelse: 10/25 done-issues i 2026-05-24-audit havde 0 comments (typisk hurtig direct-close workflow hvor PR-merge + auto-labeling ikke producerede comment). Alle 10 havde merged PR + backend-label og blev lukket samme dag uden manuel investigation. Score-script bør markere `NO_COMMENTS + merged_pr + backend_label = AUTO_CLOSE` separat fra STRONG/MEDIUM/WEAK.

**Udvid til bare-label-issues (lektion 2026-06-02):** Reglen krævede en eksplicit backend-cat-label (`cat:infra`/`cat:ai-ops`/...). Men issues med **SLET ingen cat-label** (kun `type:bug` eller helt bar) der har en merged PR rammer ikke reglen og blev fejlagtigt T3-eskaleret af `score_done.py`. Eksempler 2026-06-02: #866/#868 (NO_COMMENTS, bare `type:bug`, merged PR #867/#869) + #804/#826 (bar label, merged PR). Ny regel: `(ingen cat:user-feature) + merged-PR + (type:bug ELLER ingen cat-label) = backend-close-kandidat` — behandl som backend-aggressive-close efter PR-merge-verify. Begrundelse: et bart `type:bug` uden `cat:user-feature` er per default en backend/data-correctness-fix (query, pagination, data-integritet), ikke en UI-ændring; manglende cat-label er triage-glemsel, ikke et UI-verify-signal. **Undtagelse:** hvis titlen tydeligt er UI/visuel ("farve", "kontrast", "layout", "sticky", "kolonne", "badge") → behandl som user-feature (UI-verify) trods bar label.

**Label-cleanup-på-close (lektion 2026-05-25):** Når STRONG-equiv evidens er stærk MEN issue har `needs-user-action` eller `manual:user` label, foreslå **fjern stale label OG luk** i samme handling. Bruger valgte denne audit at vente 3 issues (#348/#634/#635) udelukkende pga. labels — selvom evidens viste alle AC mødt + implementation live. Bidt 2x i samme audit. Pattern: `gh issue edit N --remove-label "needs-user-action"; gh issue close N --reason completed --comment "..."`. Hvis label er reel (fx user skal verificere UI), behold; hvis label er rest fra triage før implementation, fjern.

**Post-comment work-completion check (lektion 2026-05-20-pass2):** Hvis claude:done-issue's seneste comment matcher work-pending patterns (`Næste session`, `next session`, `bagudretter`, `efter merge`, `mangler X`) MEN der findes en merged PR med `Refs #N` til samme issue _efter_ comment-timestamp → flag som "comment likely outdated, work done via PR #M". Re-læs issue + PR #M for ægte status før scoring. Eksempel #508: comment 14:23Z sagde "Næste session bagudretter eksisterende ryttere", men PR #511 (Refs #508) merged 15:07Z udførte faktisk backwards-fix på 45 ryttere. Den outdated comment dictated WEAK-scoring; real state var "work done, awaiting user UI-verify".

## Trin 4 — Kategorisér (10 dimensioner)

**Primær:**
- **A. Mangler claude:done** — PR merged via Closes/Fixes + bruger-verify findes, label glemt
- **B. Klar til lukning** — claude:done + STRONG + ≥24 timer (præcis time-diff, ikke rundede dage)
- **C. Awaiting verify** — claude:done + MEDIUM/WEAK/BLOCKED (begrundelse per issue)
- **K. Glemt-done** — ÅBNE ikke-done-issues hvor en merged PR via `Refs #N` (eller `(#N)`) leverede kerne-arbejdet, men nogen glemte at markere done/lukke. **DETTE ER REPO'ETS HYPPIGSTE BLIND VINKEL** (lektion 2026-06-02): A fanger kun `Closes/Fixes`, men repo'et bruger næsten altid `Refs #N` → dev-færdige issues hober sig op i `claude:todo`. `crossref.py` Kategori K surfacer kandidaterne (filtrerer dependabot-changelog-støj, `docs(now)`-close-outs, epic-milestone-PR'er, epics, NUA/blocked fra). **Hver kandidat KRÆVER scope-verify** (script skelner ikke levering fra delvis/incidentel — brug parallelle sub-agenter til at læse issue-AC mod PR-leverance). Resultat: backend/tooling/test uden UI → **close**; user-feature/admin dev-færdig men ikke renderbar → **flyt claude:todo→claude:done** (fjern claude:todo!) + comment "afventer ejer-verify". 2026-06-02: #532/#719/#646 lukket, #793/#19/#896 → done; 14+ andre verificeret legitimt åbne (incidentelle omtaler).

**Bonus:**
- **D. Label-konflikter** — `claude:todo+done`, `claude:todo+blocked`, eller helt uden `claude:*`. **4-state-machine (lektion 2026-05-23):** Repo har de-facto 4 states (`claude:todo`, `claude:in-progress`, `claude:done`, `claude:blocked`). Hvis `claude:in-progress` persistent >24h efter en `Refs #N` PR er merged → label-cleanup-action (flyt til `claude:done`). Eksempel #558/#559: comment "venter på CI-grønt før merge" 15:47:28Z, PR #573 merged 15:47:48Z (20 sekunder senere), men `claude:in-progress` stadig sat dagen efter. Skill skal også tjekke 2-state-konflikter med in-progress (fx `claude:in-progress+done`). **Idle in-progress (lektion 2026-05-28):** `labelcheck.py` printer nu idle-timer (siden `updatedAt`) per in-progress issue og flagger >48h som `⚠️ STALE (resume/re-triage?)` — info-only, ingen auto-action. Genuint mid-flight sessioner kan parkere et par dage; men idle high-priority/launch-issues bør surfaces så de ikke stille staller. Eksempel #684 (55.7h) + #678 (49.8h, priority:high + slice:tdf-launch, lister selv remaining closeout-blockers). Nudge brugeren eller foreslå re-triage til sub-issues; flyt KUN til `claude:done` hvis en `Refs #N` PR faktisk repræsenterer completion (ikke når investigation/closeout genuint fortsætter).
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

**Skip-grund tracking (lektion 2026-05-25):** Når bruger vælger konservativ option for Tier-X i AskUserQuestion (fx skipper close pga. NUA/manual:user-labels), log eksplicit i artifact under Kategori C: `**Skipped pga. label:** #N — [label-name] — evidens var [STRONG-equiv|MEDIUM|...]`. Næste audit kan så foreslå **label-cleanup som første step** før re-vurdering. Bidt 2026-05-25: 3 backend-issues skipped pga. labels alene (#348 manual:user, #634 NUA, #635 ingen cat-label). Uden tracking glemmer næste audit at adressere label-conflict eksplicit.

## Trin 7 — Konfirmér + udfør

**Rollefordeling efter auto-close (#627):** Tier 1+2 (`score_done.py --json` → `auto_close_candidate: true` + bestået cross-verify) lukkes **autonomt af den daglige routine** — den manuelle skill behøver ikke re-bekræfte dem. Manuel skill fokuserer på: (a) **Tier 3-eskaleringer** fra digesten (dømmekraftsager: PR-open, user-feature uden maskin-verify, NUA), (b) **reopen-veto-review** (issues med `auto-close-veto` — var de reelt false-positives, eller skal kriteriet strammes?), (c) ad-hoc-close af ting routinen ikke nåede (cap). Tier-gates: se `routine-prompt.md` Trin 3.

Per memory `feedback_confirm_before_state_change.md`: pause før >5 handlinger.

Separate `AskUserQuestion` per kategori-gruppe (ikke alt-i-én):
1. Auto-close Kategori B (STRONG)?
2. Add claude:done til Kategori A?
3. Ryd label-konflikter D?
4. Triage stale backlog F (close/downgrade/keep)?
5. Unblock Kategori I (blocked → todo)?
6. Comment på orphan PRs J?
7. **Kategori K (glemt-done):** efter scope-verify — close backend/tooling-batch? + flyt dev-færdig user-feature til claude:done?

Idempotente parallelle batches:
```bash
gh issue close N --reason completed --comment "<citat + PR-link>"
gh issue edit N --add-label "claude:done"
gh issue edit N --remove-label "claude:todo"
gh issue edit N --add-label "claude:todo" --remove-label "claude:blocked"
# Kategori K dev-færdig user-feature → done (HUSK begge: undgå todo+done-konflikt):
gh issue edit N --add-label "claude:done" --remove-label "claude:todo"
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

## Routine integration — daily autonomous auto-close (#627)

Denne skill bliver fyret **dagligt 05:00 UTC** (07:00 CEST / 06:00 CET) af scheduled CCR-routinen `cyclingzone-github-housekeeping-weekly` (navnet er historisk — den kører dagligt nu; trigger-id `trig_01S278iyGt4HtoydKb2JP3AR`, resolvable via `RemoteTrigger action=list`). Routine-prompten er **single source of truth** i [`routine-prompt.md`](routine-prompt.md) (git-tracked — flyttet 2026-05-29 fra gitignored `.codex.local/routines-tmp/housekeeping-prompt.md` så cloud-routine + begge PC'er læser samme fil). **Når `routine-prompt.md` ændres → det er nok at committe + pushe til `main`.** Routine-configens `message.content` er kun en bootstrap-pointer der `Read`er `routine-prompt.md` fra den friske klon ved hver kørsel — selve playbooken er IKKE embedded i config. Ingen `RemoteTrigger action=update` nødvendig (det beskrev et tidligere design hvor prompten lå i config; rettet 2026-05-31, jf. note i `routine-prompt.md` linje 5).

**Routinen auto-lukker nu** (ikke recommend-only længere). Den udfører selv Tier 1+2-close, reopen-veto, label-drift og daglig digest — og eskalerer kun Tier 3.

**Forskelle mellem manuel kørsel og auto-pass:**

| Aspekt | Manuel (denne SKILL.md) | Auto-pass (routine) |
|---|---|---|
| Trigger | `github audit` / `issue cleanup` / etc. | Cron `0 5 * * *` (dagligt 05:00 UTC) |
| Reopen-loop | Manuel review af `auto-close-veto` | **Trin 0 — ALTID først.** Reopenede auto-closed = false-positives → `auto-close-veto` + circuit-breaker ved ≥3 |
| Close-handling | `AskUserQuestion` per kategori → bruger godkender → batch-close | **AUTO-CLOSE Tier 1+2** efter cross-verify (PR merged + commit på main; Tier 2 kræver Vercel/Supabase-match). Cap 20/run. Tier 3 → digest |
| Artifact | `.claude/audits/audit-<dato>.md` | Daglig digest-comment på ledger-issue **#627** (skip-create hvis 0 actions) |
| Trin 9 (retro) | Run interaktivt med bruger | SKIPPED i routine — kør manuel skill efter behov for retro-lessons + reopen-veto-review |
| GitHub-adgang | `gh` CLI lokalt | `mcp__github__*`-tools (gh ikke i CMA sandbox) |
| Connectors | Lokal (alle MCP) | GitHub + Vercel + Supabase + Sentry (read-only cross-verify) per routine-config |

**Hvornår skal man stadig køre skill manuelt?**

1. **Tier 3-eskaleringer fra digesten** — de issues routinen IKKE var 100% sikker på (PR-open, user-feature uden maskin-verify, NUA, cap-overskydende). Fyr skill manuelt → vurder + luk dem der reelt er færdige.
2. **Reopen-veto-review** — issues med `auto-close-veto` (routinen lukkede, du reopenede). Var det en ægte false-positive? → stram tier-gates i `routine-prompt.md`/`score_done.py`. Eller var det bevidst (du ville selv gøre noget)? → fjern veto igen.
3. **Ad-hoc audit** — hvis backlog vokser hurtigt eller en specifik PR-batch skal verificeres straks.
4. **Retro + self-improvement** (Trin 9) — kun manuel skill gør dette.

**Hvis routine fejler stille** (per `feedback_remote_routines`):

- Sandbox er ephemeral — write-fejl = arbejde tabt
- Verificér om morgenen: `gh issue view 627 --comments` (skal vise dagens digest-comment ELLER `0 actions, backlog clean`)
- Hvis ingen digest-comment: routinen fejlede stille. Check `https://claude.ai/code/routines/<trigger-id>` for transcript (grep efter `=== HOUSEKEEPING START ===` … `=== END ===`), OG `permitted_tools`/`mcp_connections` i routine-config (`RemoteTrigger action=get`). Tjek især `close_permission_failed` i metadata.
- Recovery: fyr manuel skill samme dag — den dækker samme workflow (med `gh` CLI close i stedet for MCP).
- **Auto-close sanity-check:** `gh issue list --state closed --label auto-closed-by-routine --limit 20` viser hvad routinen har lukket — scan for fejl, reopen hvis nødvendigt (fanges automatisk næste kørsel).

**Edge cases dokumenteret 2026-05-25 ved implementation:**

- **Routine kan ikke læse `~/.claude/projects/.../memory/`** (cloud sandbox-begrænsning). Skill antager HOT/WARM-tier disciplin men kan ikke verificere tier-flow fra cloud. Routine arbejder derfor kun ud fra SKILL.md + helper-scripts i repo.
- **Discord-bridge close-protocol** (per `feedback_discord_bridge_after_close`) kræver Discord-kanal-access. Routine har p.t. IKKE Discord-MCP attached (kun GitHub + Sentry). Hvis Discord-integration ønskes i fremtidige iterationer, tilføj Discord MCP til `mcp_connections` med eksplicit `permitted_tools`.
- **Cron kører i UTC**: 05:00 UTC = 07:00 CEST (apr-okt) / 06:00 CET (okt-mar). Acceptér som "Monday morning" eller opdatér cron ved DST-flip i sen oktober.

## Baked-in lessons (procedural — opdateres via retro)

- Brug `--limit 500` på open issues (repo ramte 300-loftet med 313 åbne 2026-06-03; 100 var for snævert 2026-05-17) — Lektion 2026-05-17 + 2026-06-03
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
- **Persistent scoring-scripts (lektion 2026-05-25):** Scoring/cross-ref/label/stale Python-scripts ligger nu i `.claude/skills/github-housekeeping/scripts/*.py`. Brug dem direkte i stedet for at inline ~120 linjer Python hver audit. Workflow: `gh issue list ... > $TEMP/audit-done.json && PYTHONUTF8=1 python .claude/skills/github-housekeeping/scripts/score_done.py`. Scripts: `score_done.py`, `crossref.py`, `labelcheck.py`, `staleblocked.py`. Tune STRONG_PATTERNS/NEG_KEYWORDS direkte i script-fil ved retro.

## Changelog

- **2026-06-09 — Multiagent-audit retro.** 13. kørsel via 57-agent Workflow (35 K-kandidater scope-verify + adversarisk refute + 6 launch deep-dives). 2 closes (#1124/#1155), 11 → claude:done, 22 cache-markeret. 1 accepteret edit: **kalibrér adversarisk refute-styrke pr. handling** — uniform hård gate refuterede 13 verdikter, men ~10 var bare dev-færdige-afventer-ejer-verify (move-to-done), kun 2 ægte delvise (#165/#917). Refute for `move-to-done` skal kun afvise ved umødt/delvist AC, ikke ved normal ejer-verify-gate. Bonus-lektion (Workflow-tooling): `args` kan ankomme som string → indlejr data-lister direkte i scriptet frem for via `args`.

- **2026-06-03 — Audit-housekeeping retro.** Lessons fra 12. kørsel — **13 handlinger** (5 closes: 4 Kategori K backend/data/tooling + 1 dup-close · 8 Kategori K todo→done). Kategori K leverede igen ALT (13/13). 3 accepterede edits:
  - **Trin 1 (open-limit 300→500):** Repo ramte 300-loftet med 313 åbne issues under TdF-launch-sprint → `audit-open-all.json` missede issues i cross-ref. Bumpet til 500 (+ baked-in lesson opdateret).
  - **crossref.py (glemt-done carry-forward-cache):** crossref bruger ALLE merged PRs (ingen cutoff), så de samme ~23 incidentelle K-omtaler (talkollision/deferral/dependency-note) dukkede op igen i dag og kostede sub-agent-runtime. Ny git-tracket cache `scripts/k-legit-open.json` + `--mark-legit`-writer husker verificeret-legitimt-åbne; print separerer nu `13 til verify` fra `23 prev-legit` (skip-linje) + `[RE-VERIFY: ny PR]` når en ny kvalificerende PR dukker op. Cache seedet med dagens 23 legit-open. Trin 2-note tilføjet.
  - **score_done.py (work-pending-guard for ejer-verify-markører):** `#19` (loan-buyout, `cat:bug`) blev fejl-flagget **Tier1 auto-close** trods seneste kommentar "Afventer kun din manuelle buyout-spot-check ... så lukkes denne". Den nye `type:bug`/bar-label-backend-close-regel (2026-06-02) respekterede ikke owner-verify-pending-markøren. Tilføjet til `WORK_PENDING_PATTERNS`: `afventer (kun) din/dit/ejer`, `spot-check`, `kun du kan`, `manuel(t) (ejer-)verif` → ned-grader til Tier3. Verificeret: #19 nu `T3 work-pending [PEND]`.

- **2026-06-02 (pass 2) — Glemt-done cross-ref (NY KATEGORI K).** Bruger flaggede direkte: "Kan du tjekke alle opgaver i github, også dem der ikke er markeret done... Vi har ofte tit glemt at markere opgaver som done, selvom de faktisk allerede er lavet. Hvis du har glemt det igen, så skal det ind i vores skill nu." Og jo — skillen HAVDE en systematisk blind vinkel: Kategori A + done-scoring cross-refede kun `claude:done`-issues + `Closes/Fixes`-intent, men repo'et bruger næsten altid `Refs #N` → dev-færdige issues hober sig op i `claude:todo` og falder igennem hver audit. Ændringer:
  - **Trin 4: ny Kategori K (glemt-done)** — 9→10 dimensioner. Åbne ikke-done-issues hvor en merged `Refs #N`/`(#N)`-PR leverede kerne-arbejdet men done/close blev glemt.
  - **Trin 2: nyt glemt-done-pass** — cross-ref ALLE åbne ikke-done-issues (ekskl. epics/NUA/blocked) mod alle 200 merged PR'er.
  - **`crossref.py`: ny `forgotten_done`-analyse** (Kategori K i print + JSON). Filtrerer false-positive-kilder fundet i dag: dependabot-changelog (fremmede #-numre, fx brace-expansion's #33-#92 via PR #494), `docs(now)`-close-outs, epic-milestone-PR'er. Bruger ALLE merged PR'er (ikke 14d-cutoff — glemt-done akkumulerer). **Surface kun, auto-luk ALDRIG** — kræver scope-verify via sub-agenter (script skelner ikke levering fra incidentel/deferral/talkollision).
  - **Trin 7: AskUserQuestion-punkt 7** for Kategori K + `--add-label done --remove-label todo` i ét (undgå todo+done-konflikt).
  - **Resultat 2026-06-02:** fandt 8+ glemt-done i `claude:todo`. Lukket #532/#719/#646 (backend/tooling, ingen UI). Flyttet #793/#19/#896 til claude:done (dev-færdig user-feature/admin, ikke renderbar i mock, afventer ejer-verify). 14+ verificeret legitimt åbne af 4 parallelle sub-agenter (alle var incidentelle omtaler — bekræfter at scope-verify er nødvendig, ikke blind close).

- **2026-06-02 — Audit-housekeeping retro.** Lessons fra 11. kørsel — **18 closes** (næststørste batch): 8 backend/data + 10 user-feature efter AI-verify. Bruger bad eksplicit om AI-verify frem for blind close af user-feature. 27 done-issues ophobet over 5 dage (alle merged, men ikke lukket). 2 accepterede edits, 1 afvist:
  - **Trin 3 (AI-verify via Playwright-mock-login):** Nyt afsnit. Dokumenterer metoden: engangs `audit-verify.spec.js` + `fixtures.js`-mocks + screenshots → visuelt screenshot på main = gyldig feature-verify. Med eksplicit begrænsning: `fixtures.js` har tomme `race_results`/`season_standings`/`races` + manager-rolle → data-afhængige/admin-sider renderer tomt og kan ikke verificeres (#505/#780/#823/#825 carry-forward), mens rytter-tabel/auktion-sider blev bekræftet + lukket (#670/#777/#796/#800/#801/#837/#855). Setup: `npm ci` i worktree-frontend (browsere globalt cachet), verificér port 4173 fri.
  - **Trin 3 (NO_COMMENTS-regel udvidet til bare-label):** `score_done.py` T3-eskalerede ALLE 27 done-issues fordi backend-close-reglen krævede eksplicit cat-label. #866/#868/#804/#826 havde merged PR men bar `type:bug`/ingen cat-label → ramte ikke reglen, måtte cross-ref'es manuelt. Ny regel: `(ingen cat:user-feature) + merged-PR + (type:bug ELLER ingen cat-label) = backend-close-kandidat`, med UI-titel-undtagelse (farve/kontrast/layout/sticky/kolonne/badge → user-feature).
  - **Afvist (se Rejected):** "Couldn't-render" som dedikeret carry-forward-kategori i Trin 6.

- **2026-05-29 — Autonom auto-close (#627).** Routinen gik fra recommend-only til at **lukke selv**. Bruger-mål: "Jeg er træt af selv at gennemgå og lukke — det skal ske af sig selv." Ændringer:
  - **3-tier tillidsmodel** (`routine-prompt.md` Trin 3): Tier 1 = backend/docs/CI/security + merged PR + commit på main + ≥24h → auto-close. Tier 2 = user-feature STRONG ≥24h + OBLIGATORISK Vercel/Supabase/Sentry-match → auto-close (ellers eskalér). Tier 3 = alt andet → digest. Forbidden zones: NUA/manual:user/needs-decision/manual-review/epic:*/åbne checkboxes/PR-open.
  - **Helper-scripts fik `--json`-mode** + `tier`/`auto_close_candidate`/`needs_xverify`/`blockers`/`reason` (score_done) + `close_intent_open` (crossref). Print-mode bevaret som default for manuel brug.
  - **Stateless reopen-loop** (Trin 0): `search_issues label:auto-closed-by-routine state:open` finder false-positives → `auto-close-veto` (filtreres permanent af score_done's FORBIDDEN_LABELS) + circuit-breaker ved ≥3 reopens (pauser Tier 2). GitHub er state — intet at miste i ephemeral sandbox.
  - **Cap 20/run** + audit-trail-comment per close + daglig digest på #627. Kadence ugentlig→dagligt.
  - **`routine-prompt.md` flyttet ind i repo** (git-tracked single-source) fra gitignored `.codex.local/...` så cloud + begge PC'er er i sync.

- **2026-05-28 — Audit-housekeeping retro.** Lessons fra 10. kørsel — **1 close (#649)**, ren lille batch (0 label-konflikter, 0 stale backlog, 4 legit blockers). 2 accepterede edits:
  - **Trin 2 (delivered-claim vs PR-open cross-check):** Nyt afsnit. For done-issues hvis seneste comment citerer `PR #N` (især "## Leveret — PR #N"): kør `gh pr view N --json state` → hvis OPEN/draft, flag "claims delivered but PR still open — NOT close-eligible". Omvendt check af Trin 3's post-comment work-completion. Citat #706: comment "## Leveret — PR #713  Migration anvendt: … DB har nu 19/19" mens PR #713 var OPEN — måtte manuelt `gh pr view 713` for at fange det. Automatiserer nu.
  - **Trin 4 Kategori D + labelcheck.py (idle in-progress flag):** `labelcheck.py` beregner nu idle-timer (siden `updatedAt`) per in-progress issue + flagger >48h som `⚠️ STALE (resume/re-triage?)`, info-only. #684 (55.7h) + #678 (49.8h, priority:high + slice:tdf-launch, lister selv remaining blockers) var begge idle 2 dage — forrige audit kaldte dem "legit aktive i dag", men idle-duration var ikke trackét. Flyt KUN til done hvis Refs-PR = completion; ellers nudge/re-triage.
  - **Standardiserede filnavne (2026-05-26 edit) gav 0 friction:** scripts kørte direkte uden rename.

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

- **2026-05-25 — Audit-housekeeping retro.** Lessons fra 8. kørsel — **10 closes** (2 STRONG + 3 i18n NO_COMMENTS + 5 backend), 3 backend-skipped pga. labels, 9 carry-forward.
  - **Trin 3 (Label-cleanup-på-close):** Nyt afsnit. Bruger valgte i dag at vente 3 issues (#348/#634/#635) udelukkende pga. labels (manual:user/NUA), selvom evidens var STRONG-equiv: alle AC mødt + commit på main + tests pass. Skill foreslår nu: hvis label er stale (fx NUA på issue der bygger user-action-prevention), fjern label + luk i samme handling. Hvis label er reel, behold + skip.
  - **Trin 6 (Skip-grund tracking):** Tilføjet. Når bruger vælger konservativ AskUserQuestion-option, log eksplicit i artifact: `**Skipped pga. label:** #N — [label] — evidens var [score]`. Næste audit kan så foreslå label-cleanup som dedicated first-step. Uden tracking glemmer næste audit at adressere conflict.
  - **Baked-in lesson (Persistent scoring-scripts):** Tilføjet. Scoring/cross-ref/label/stale Python-scripts genskrives ~120 linjer hver audit (token-kostbart). Nu persistent i `.claude/skills/github-housekeeping/scripts/`: `score_done.py`, `crossref.py`, `labelcheck.py`, `staleblocked.py`. Workflow: `gh ... > $TEMP/file.json && PYTHONUTF8=1 python <path>`. Edit script-filer ved retro for at tune patterns/lists.
  - **Brugerverifikation adoption-skift:** 46→73 PRs har sektion (+27, +59%). i18n Fase 3.5 epic kører PR-template konsekvent. Forfatter-disciplin er på vej op.

- **2026-05-26 — Audit-housekeeping retro.** Lessons fra 9. kørsel — **15 closes** (største batch til dato): 5 NOW.md-kandidater + 7 backend strong evidens + 3 label-cleanup. Codex' weekly housekeeping routine pre-screened via summary-issue #660.
  - **Trin 1 (Standardisér filnavne):** Match script-forventninger direkte i fetch-batch. Brug `audit-open-all.json`/`audit-pr-merged.json`/`audit-blocked-issues.json` fra første fetch (ikke `audit-open.json`/`audit-prs.json`). Sparer 3 `cp`-kald per audit. Bidt mig denne kørsel da scripts crashede med `FileNotFoundError` indtil rename.
  - **Co-orchestration validated:** Routine #627 producerede summary-issue #660 + recommended close på #578 mandag 2026-05-25 → manuel skill udførte close i dag. Routine pre-screening + manuel skill udførelse virker som designet. Bekræfter division-of-labor i Routine integration sektionen.
  - **Largest close-batch til dato (15):** Forrige rekord var 17 i 2026-05-24 (var ren batch); 2026-05-26 leverede 15 med mixed kategorier (NOW.md flagged + backend strong + label-cleanup). Aggressive default + persistent scripts + NOW.md pre-flagging optimerer flow-rate uden konfidens-tab. Afviste 2 retro-edits (Multi-phase issue detection + Scope-flow detection) — kun 1 issue (#327) matchede mønsteret denne audit.

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

- **2026-05-25 — NO_COMMENTS-rule 4h min-wait.** Foreslået: tilføj 4h min-wait til `NO_COMMENTS + merged PR + backend-label = AUTO_CLOSE`-rule for at give bruger chance for at se PR før auto-close. Bidt: lukkede #485/#486/#487 ~1h efter merge. Bruger afviste: direct-close samme dag som merge er normal procedure for backend/i18n; bruger valgte "Ja, luk alle 3" uden tøven. Hvis dette muster bider tilbage (close-back-out, regression-fund) → re-introducer som conservative wait-period.

- **2026-05-26 — Multi-phase issue detection (Trin 4) + Scope-flow detection (Trin 3).** Foreslået: (1) Markér issues med Phase X + spin-off comments som `MULTI_PHASE_LEGIT_CARRY_FORWARD` for at forhindre false-close-suggest på #327-lignende; (2) Flag scope-vandring info-only når issue modtager "B11-merge fra #555". Afvist denne kørsel: kun 1 issue (#327) matchede multi-phase-mønsteret + 1 issue (#449) matchede scope-flow. Lavt signal-volume + skill håndterer korrekt via NOW.md `manual:user`-label + carry-forward. Hvis flere multi-phase eller scope-mergede issues vokser frem, re-introducer som ny kategori.

- **2026-06-02 — "Couldn't-render" som dedikeret carry-forward-kategori (Trin 6/artifact).** Foreslået: tilføj en formel underkategori for user-feature der er merged men ikke visuelt renderbar i mock (adskilt fra genuint-pending), så næste audit ved de kun mangler ejer-spot-check. Bruger afviste: AI-verify-afsnittet (edit A) dokumenterer allerede couldn't-render-håndteringen inline, og artifact-skabelonen tillader frit-tekst carry-forward-noter — en ekstra formel kategori er over-strukturering for et mønster der først dukkede op denne ene audit. Hvis couldn't-render bliver tilbagevendende på tværs af flere audits, re-introducer som egen kategori med tæl-tracking.
