# AGENTS.md

_Koordinerings-fil for AI-assistenter der arbejder i cycling-manager-repo'et. Single source of truth for hvem ejer hvad og hvilke discipliner alle skal følge._

---

## Hard rules (gælder ALLE AI'er — Claude, Codex, fremtidige)

1. **Repo-root verification:** Brug kun den aktuelle bekræftede repo-root fra `git rev-parse --show-toplevel`. Aldrig andre lokale kopier, sync-kopier eller zip-udpakninger. Hvis repo-root ikke matcher den workspace-mappe brugeren aktuelt har angivet → stop og bed om realignment.

2. **Verificér runtime FØR du listet noget som TODO/bug/mangler.** Dokumenter (Noter-til-spiller.txt, gamle session-notater, brugerens hukommelse) kan være måneder forældede mens koden er rettet. Grep mindst én relevant fil eller tjek `git log --grep=<keyword>` før du committer påstanden til en plan. Markér eksplicit "❓ ikke runtime-verificeret" på antagede status-stempler. Etableret 2026-05-04 efter Noter-fil-stale-incidenten.

3. **Bliv ved med at stille spørgsmål når i tvivl.** 70-95% sikkerhed → spørg, antag ikke. Også for proaktive forbedringsforslag. AskUserQuestion-tool foretrækkes til strukturerede valg.

4. **Patch notes er obligatoriske ved enhver brugerrettet ændring.** Opdatér `frontend/src/pages/PatchNotesPage.jsx` ELLER skriv eksplicit hvorfor det ikke er nødvendigt. Pre-push hook (loop B i AI_LOOPS.md) håndhæver dette.

5. **Slice close-out kræver:**
   - `docs/NOW.md` opdateret + relevante GitHub-issues lukket eller opdateret med status (`gh issue comment N --body "..."` / `gh issue close N --reason completed`)
   - `docs/FEATURE_STATUS.md` afstemt
   - PatchNotesPage opdateret
   - Postmortem-entry i `.claude/learnings/` hvis slice fiksede en bug (loop C)
   - Doc-drift sweep: grep for nye env vars, deploy-targets, route-navne, tabel-navne mod `ARCHITECTURE.md` og åbne issues

6. **Auto-push efter commit:** Push til GitHub automatisk efter hvert commit (Vercel deployer kun ved push).

7. **OneDrive-context hardlinks (siden 2026-05-07):** Memory, secrets (`*.env`, `.mcp.json`), og `.codex.local/SUPABASE_CONTEXT.md` + `supabase-readonly.env` er HARDLINKEDE til `~/OneDrive/CyclingZone-context/`, ikke kopier. Edit-tool BRYDER hardlinket → drift på næste PC. Efter manuel edit af disse filer: kør `pwsh -File scripts/link-onedrive-context.ps1` for at re-etablere. Ved drift-konflikt: læs INDHOLDET af begge versioner — antag ikke "nyeste timestamp vinder". Pure additive → tag den længere; sletning → STOP og spørg bruger. Default: OneDrive vinder. Detaljer: `docs/CROSS_PC_SETUP.md` + `docs/HOOKS.md`.

---

## Start-sekvens (hver session)

1. Kør `git rev-parse --show-toplevel` — bekræft repo-root
2. Kør `git fetch --prune origin && git status -sb` — hvis `[behind N]`, kør `git pull --ff-only` før edit (user-level SessionStart-hook gør dette automatisk hvis installeret)
3. Læs `.codex.local/SESSION_CONTEXT.md` hvis den findes (auto-genereret pre-fetched issue-kontekst — produceres af project-hook `scripts/session-prefetch-issue.sh` for Claude, og opdateres af Codex ved session-end)
4. Læs `docs/GUARDRAILS_CORE.md`
5. Læs `docs/NOW.md`
6. Aktivt issue: `gh issue list --label "claude:todo" --state open --limit 10` — første `#N` i NOW.md er typisk det aktive
7. Hvis arbejde matcher en slice i `docs/slices/<slug>.md` → læs den slice-brief (komplet kontrakt på 30-50 linjer)
8. Hvis nye loop-implementeringer → læs `docs/AI_LOOPS.md` afsnittet for den specifikke loop

---

## Token-effektiv kontekst

| Doc | Læs hvornår |
|---|---|
| `docs/GUARDRAILS.md` (fuld) | Nye datakontrakter, IA/naming-valg, shared runtime-refactors |
| GitHub issues (`gh issue list --label "claude:todo"`) | Slice-start, close-out, status-afstemning (task-lag — backlog-fil arkiveret 2026-05-06) |
| `docs/FEATURE_STATUS.md` | Slice-close, og når runtime-state er usikker |
| `docs/ARCHITECTURE.md` | Cross-domain refactors |
| `docs/DOMAIN_REFERENCE.md` | Domænegrænse-spørgsmål |
| `docs/CONVENTIONS.md` | Naming/style-spørgsmål |
| `docs/TEST_SCENARIOS.md` | Skriver tests |
| `docs/DEPLOYMENT.md` | Deploy-relateret arbejde |
| `docs/LAUNCH_ROADMAP.md` | Pre-launch session — viser P0/P1/P2-prioritering |
| `docs/AI_LOOPS.md` | Implementerer en loop-slice |
| `docs/CROSS_PC_SETUP.md` | Cross-PC migration, OneDrive-context, drift-håndtering |
| `docs/HOOKS.md` | Project-level + user-level hooks (SessionStart/Stop/PreToolUse) |
| `docs/GITHUB_WORKFLOW.md` | Issue-state-maskine, `claude:todo`/`claude:done`-labels, Refs vs Closes |

Supabase-inspektion: start med målrettede `npm run db:ai:*` frem for brede dumps.

---

## Rolle-fordeling mellem AI-assistenter (Verdensklasse AI-Standard)

### Manus (The Architect & Coordinator)
**Primær brug:** Strategisk planlægning, orkestrering af komplekse workflows, og cross-domain koordinering. Manus er "ejeren" af den overordnede projekt-konfiguration.

**Stærk i:**
- Udarbejdelse af køreplaner og skalerings-strategier.
- Håndtering af projekt-niveau indstillinger og connectors.
- Sikre at alle agents følger `AGENTS.md` og `GUARDRAILS_CORE.md`.

### Claude (The Lead Developer)
**Primær brug:** Kernearkitektur, komplekse features, refactors, og dybdegående research. Claude er "ejeren" af kontrakt-sikkerhed.

**Stærk i:**
- Kompleks feature-redesign (AskUserQuestion-sessioner).
- Multi-tabel migrations og backend-logik.
- Udarbejdelse af `docs/slices/` kontrakter.

### Codex (The Speed Runner)
**Primær brug:** Hurtige bugfixes, UI-polish, og automatiserede tests. Codex sikrer høj hastighed uden at gå på kompromis med kvaliteten.

**Stærk i:**
- Single-file bugfixes og små UI-rettelser.
- Skrivning af unit- og integrationstests.
- Hurtig eksekvering af repetitive opgaver.

**AI-First Workflow:** Start altid komplekse opgaver hos Manus (Plan), lad Claude bygge (Build), og lad Codex validere/teste (Test).

**Kontekst-fil:** `.codex.local/` (gitignored). `SUPABASE_CONTEXT.md` + `supabase-readonly.env` er hardlinkede via OneDrive-context (sync mellem PC'er); `SESSION_CONTEXT.md` er per-PC og auto-genereres af project-hook ved Claude-sessions, eller skrives manuelt af Codex ved session-end.

### Microsoft Clarity (UX analytics, IKKE en AI)
**Primær brug:** Runtime user-behavior data → input til Claude/Codex via loop I i AI_LOOPS.md.

**Output:** Heatmaps, session recordings, dead/rage-click rapporter → konverteres til slices i ugentlig review.

---

## Hvornår skifter AI-ejerskab

| Scenario | Foreslået AI |
|---|---|
| Multi-file refactor med kontrakt-implikationer | Claude |
| Single-file bugfix med klar root cause | Codex |
| Ny feature med uklar spec | Claude (AskUserQuestion-session) |
| Tilføj test til eksisterende feature | Codex |
| Migration der rører >2 tabeller | Claude |
| Lint-fix, formattering | Codex |
| Audit-session der spænder kodebasen | Claude (med Explore-subagents) |
| Implementér loop fra `docs/AI_LOOPS.md` | Claude (kompleks) eller Codex (simpel B/C) |

**Konflikt-resolution:** Hvis begge AI'er har rørt samme fil i samme session → den AI der ejede slice-doc'en vinder; den anden's ændringer flyttes til separat slice.

---

## SESSION_CONTEXT.md format (Codex-specifikt)

Fil: `.codex.local/SESSION_CONTEXT.md` — opdatér ved session-slut, maks 15 linjer.

```
# Session context — [dato]

Aktiv slice: [slice-navn / slug fra docs/slices/]
Status: [in_progress | completed]

Seneste handlinger:
- [hvad der blev gjort]

Næste handlinger:
- [konkret næste skridt]

Kritiske facts:
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10
- [andet relevant for næste session]
```

---

## Cross-PC setup

**Kanonisk repo-placering:** `C:\dev\CyclingZone` på alle PC'er. Aldrig under `OneDrive/` eller anden filsync (filsync må ikke røre `.git/`).

**Synk-arkitektur (siden 2026-05-07):**
- Kode + repo-docs sync'er via Git (`git push` / `git pull`)
- Memory, secrets, og `.codex.local/SUPABASE_CONTEXT.md` + `supabase-readonly.env` sync'er via **OneDrive-context hardlinks** mod `~/OneDrive/CyclingZone-context/`
- `.codex.local/SESSION_CONTEXT.md` er per-PC (auto-genereres af session-prefetch-hook eller skrives af Codex)

**Daglig flow:**
- Session-start: `git fetch --prune origin && git status -sb` (user-hook gør det automatisk). Hvis `[behind N]` → `git pull --ff-only`
- Session-end: user-hook `cross-pc-stop-check.sh` advarer ved uncommitted/unpushed work
- Efter manuel edit af hardlinkede filer: `pwsh -File scripts/link-onedrive-context.ps1` for at re-etablere link

**Drift-protokol** ved konflikt mellem lokal og OneDrive-version:
1. Læs INDHOLDET af begge — antag ikke "nyeste timestamp vinder"
2. Pure additive (én side er strict superset) → tag den længere
3. Sletning af noget meningsfuldt → STOP, fortæl bruger HVAD der forsvinder, lad bruger beslutte
4. Default ved tvivl: OneDrive vinder (den anden PC's seneste arbejde)

**Ny PC (engangs-setup):** følg `docs/CROSS_PC_SETUP.md` — preflight + migrate-script + `install-user-hooks.ps1` + `link-onedrive-context.ps1`.

**Ikke-rør for Codex:** `~/.claude/settings.json` (Claude's user-hooks), `.claude/settings.json` (project-hooks ændres kun via PR), Claude's auto-memory (`~/.claude/projects/<encoded>/memory/`).

---

## Session-rytme & token-effektivitet

_AI'en skal proaktivt signalere session-tilstand. Brugeren behøver ikke selv huske at lukke en session — AI'en forslår det ved naturlige break-points._

### Signaler AI'en skal give brugeren under en session

| Signal | Hvornår | Hvad AI'en siger |
|---|---|---|
| 🟢 **Klar til close-out** | Slicens verification-path er gennemført | "Slicen er klar til at lukkes — tjekliste:" + checklist nedenfor |
| 🟡 **Naturligt break-point** | Logisk underopgave færdig (research, design, kode-blok), men slice ikke helt færdig | "Vi nærmer os et naturligt break-point. Vil du lukke her eller fortsætte?" |
| 🔴 **Kontekst-vinduet tungt** | Mange tool-resultater af kode-læsning der ikke længere er relevant | "Kontekst-vinduet bliver tungt af X. Anbefaler vi lukker her og starter ny session for Y" |
| 🆕 **Scope-skift** | Brugeren får idé/bug-fund der ikke hører til aktiv slice | "Det her hører ikke til aktiv slice — vil du lukke og starte ny session, eller skal jeg flagge det som spawn-task?" |

### Tjekliste — kode-slice klar til close-out

Alle skal være ✅ før commit + push:
1. Verification-path fra `docs/slices/<slug>.md` gennemført (tests grønne, manuel smoke kørt)
2. `frontend/src/pages/PatchNotesPage.jsx` opdateret med ny version (eller eksplicit hvorfor ikke)
3. `docs/NOW.md` opdateret + under 30 linjer
4. `docs/FEATURE_STATUS.md` opdateret hvis kontrakter/features ændret
5. Relevante GitHub-issues lukket eller opdateret med kommentar (task-lag — backlog-fil arkiveret 2026-05-06)
6. Hvis bug-fix: postmortem-entry i `.claude/learnings/<dato>-<slug>.md`
7. Slice-doc i `docs/slices/` enten markeret done eller flyttet til `docs/archive/slices/`
8. Doc-drift sweep: nye env vars, deploy-targets, route-navne, tabel-navne afstemt mod ARCHITECTURE og åbne issues

### Tjekliste — planlægnings-/audit-session klar til close-out

1. Output-doc(s) skrevet (roadmap, audit-rapport, design)
2. `docs/NOW.md` opdateret med næste session's konkrete startpunkt
3. Eventuelle nye memory-entries oprettet for læringer
4. Commit + push

### Hvornår man bør STARTE en ny session (kold start)

| Signal | Hvorfor |
|---|---|
| Slice committed + pushed | Ny slice = ren context, ingen rester |
| Brugeren skifter emne mid-session | Bevarer fokus, undgår scope-creep |
| Kontekst-vindue er fyldt med uddateret kode-læsning | Kostbart at re-læse, billigere at /clear |
| Soak-gate kvitteres | Smoke-test deserves cold start med fokus |
| Tids-skift (timer/dage mellem) | Friske øjne ved næste tilgang |
| Slice-doc kræver subagent-orkestrering | Hovedagent kan starte med ren context |

**Tommelfingerregel:** ÉN slice pr. session. Hvis du beder mig om noget der ikke matcher aktiv slice, vil jeg bede dig om at lukke og starte ny.

### Hvad AI'en gør AKTIVT i close-out

I rækkefølge før jeg foreslår commit:
1. Verificer alle tjekliste-punkter ovenfor
2. Læs NOW.md, opdater hvis ikke gjort
3. Tjek `git status` for orphaned filer eller forglemte ændringer
4. Foreslå commit-message i projektets stil
5. Vent på godkendelse → commit + push
6. Foreslå "Næste session starter med..."-linje for næste cold start

### Token-effektivitet pr. session

- Læs kun `slice-doc + 2-3 kerne-filer` ved start — ikke hele FEATURE_STATUS
- Brug `Explore`-subagent til store search/audit-tasks (75%+ token-besparelse)
- Skriv NOW-update sidst, ikke undervejs
- Hvis NOW.md kommer over 40 linjer: arkivér historik FØR push
- Memory-filer læses kun ved første session eller eksplicit behov

### Cold-start-recipe (ny session)

```
1. git rev-parse --show-toplevel  → bekræft repo
2. Read AGENTS.md + GUARDRAILS_CORE.md + NOW.md (fast trio)
3. Hvis næste session-prioritet matcher en slice-doc:
   Read docs/slices/<slug>.md  (komplet kontrakt)
4. Read 2-3 specifikke kode-filer slice-doc citerer
5. Begynd arbejde — ingen bredere læsning før konkret behov opstår
```

**Anti-pattern:** Læs FEATURE_STATUS, GUARDRAILS-fuld, PRODUCT_BACKLOG ved hver session — det spiser 30%+ af kontekstvinduet før første kode-linje.

---

## Worktree-disciplin (Claude-specifikt)

- Worktrees i `.claude/worktrees/<navn>/` cleanes efter ship via SessionStart-hook
- Manuel fallback hvis hook fejler: `git worktree remove <path>` + `git branch -D <branch>` på PC'en der oprettede worktreen
- Per-PC handling — gentages på den anden PC ved næste session der

---

## Reference til loops

Se `docs/AI_LOOPS.md` for fuld spec på alle 9 loops (A-I).

Quick reference:
- **A:** Drift-monitor cron — fanger økonomi/state-drift indenfor 24t
- **B:** Pre-push hook — håndhæver PatchNotes-disciplin
- **C:** Postmortem-loop — hver bug-fix → læring i `.claude/learnings/`
- **D:** Auto-PR-review — `/review`-skill før merge
- **E:** AGENTS.md (denne fil) — vedligeholdes live
- **F:** Subagent-orkestrering — parallel research ved store features
- **G:** Visuel regression — Playwright-screenshots på PR
- **H:** SQL drift detection — schema vs schema.sql
- **I:** Clarity weekly — UX-data → slice-input

---

_Sidst opdateret: 2026-05-07 — cross-PC OneDrive-context + drift-protokol + GitHub-issue task-lag indarbejdet._
