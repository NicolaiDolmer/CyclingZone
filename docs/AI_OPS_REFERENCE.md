# AI Ops — Reference (WARM, on-demand)

_Udfaset fra `AGENTS.md` 2026-05-29 per [#733](https://github.com/NicolaiDolmer/CyclingZone/issues/733) for at reducere Codex cold-start (AGENTS.md auto-loades hver Codex-session; denne fil gør ikke). Læs on-demand. Lean core (hard rules, start-sekvens, delt handoff-format, worktree-disciplin) ligger fortsat i [`AGENTS.md`](../AGENTS.md)._

> **Hard rules** (regel 1-8) bor i [`AGENTS.md`](../AGENTS.md#hard-rules-gælder-alle-aier--claude-codex-fremtidige). Denne fil dækker rolle-matrix, AI-ejerskab, cross-PC setup, session-rytme og loops quick-ref.

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

> **Full council-kontrakt** (SLA pr. rolle, fallback-protokol når en agent ikke leverer, og issue→agent eksempler): [`docs/AI_COUNCIL.md`](AI_COUNCIL.md) ([#564](https://github.com/NicolaiDolmer/CyclingZone/issues/564)). Sektionerne nedenfor er den korte version; AI_COUNCIL.md er sandheden for reassign-beslutninger.

### Manus (The Architect & Coordinator)
**Primær brug:** Strategisk planlægning, orkestrering af komplekse workflows, og cross-domain koordinering. Manus er "ejeren" af den overordnede projekt-konfiguration og AI-Autopilot (Fase 2).

**Stærk i:**
- Udarbejdelse af køreplaner og skalerings-strategier.
- Håndtering af projekt-niveau indstillinger og connectors.
- **Orkestrering:** Ansvarlig for Loop D (Auto-PR-review) og Loop F (Subagent-orkestrering).
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

**Kontekst-disciplin:** GitHub (`docs/NOW.md`, issues, slice-docs) er canonical handoff for alle agents/enheder. `.codex.local/SUPABASE_CONTEXT.md` + `supabase-readonly.env` er hardlinkede via OneDrive-context. `.codex.local/SESSION_CONTEXT.md` er kun auto-genereret cache og må ikke skrives manuelt af Codex som varigt handoff.

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

## Cross-PC setup

**Kanonisk repo-placering:** `C:\dev\CyclingZone` på alle PC'er. Aldrig under `OneDrive/` eller anden filsync (filsync må ikke røre `.git/`).

**Synk-arkitektur (siden 2026-05-07):**
- Kode + repo-docs sync'er via Git (`git push` / `git pull`)
- Memory og `.codex.local/SUPABASE_CONTEXT.md` + `supabase-readonly.env` sync'er via **OneDrive-context hardlinks** mod `~/OneDrive/CyclingZone-context/`
- Varigt handoff sync'er via GitHub (`docs/NOW.md`, issues, slice-docs). `.codex.local/SESSION_CONTEXT.md` er per-PC cache af GitHub-data og må gerne slettes/regenereres.

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

**Ikke-rør for Codex:** `~/.claude/settings.json` (Claude's user-hooks), `.claude/settings.json` (project-hooks ændres kun via PR), Claude's auto-memory (`~/.claude/projects/<encoded>/memory/`). Codex memories er per-PC og må ikke bruges til projekt-sandhed; flyt relevante facts til GitHub/OneDrive.

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
3. `docs/NOW.md` opdateret: max 30 linjer, "Senest leveret" cappet til 5 entries à ≤2 sætninger, og token-count <900 (kør `pwsh -File scripts/check-agent-token-hygiene.ps1` ved tvivl — over 900 → trim før commit, detaljer hører til issue-kommentar)
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

## Reference til loops

Se `docs/AI_LOOPS.md` for fuld spec på alle 9 loops (A-I).

Quick reference:
- **A:** Drift-monitor cron — fanger økonomi/state-drift indenfor 24t
- **B:** Pre-push hook — håndhæver PatchNotes-disciplin
- **C:** Postmortem-loop — hver bug-fix → læring i `.claude/learnings/`
- **D:** Auto-PR-review — `/review`-skill før merge
- **E:** AGENTS.md (live koordinerings-fil) — vedligeholdes live
- **F:** Subagent-orkestrering — parallel research ved store features
- **G:** Visuel regression — Playwright-screenshots på PR
- **H:** SQL drift detection — schema vs schema.sql
- **I:** Clarity weekly — UX-data → slice-input

---

_Sidst opdateret: 2026-05-29 — oprettet ved split af `AGENTS.md` per [#733](https://github.com/NicolaiDolmer/CyclingZone/issues/733). Indhold flyttet fra AGENTS.md (delt context-disciplin: GitHub/OneDrive er sandhed, lokale agent-filer er kun caches)._
