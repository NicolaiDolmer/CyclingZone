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

## Rolle-fordeling mellem AI-assistenter — RETIRED (2026-06-25)

> **Solo Claude-operation siden 2026-06-12.** Ingen Codex, ingen Manus. Claude ejer alle
> beslutninger og al eksekvering; der er ingen council-roster, AI-ejerskabs-tabel eller
> reassign-protokol mere. Den fulde historiske 3-AI-kontrakt er gravsten i
> [`docs/AI_COUNCIL.md`](AI_COUNCIL.md) (+ git-historik).
>
> **Microsoft Clarity** (UX-data → slice-input via loop I i `AI_LOOPS.md`) er ikke en AI og er uberørt.
>
> **Konflikt-resolution gælder nu kun parallelle Claude-sessioner samme PC** (worktrees):
> se [`docs/AGENT_ARCHITECTURE.md §Parallel-session-safety`](AGENT_ARCHITECTURE.md).

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
3. `docs/NOW.md` opdateret: budget **~1.200 tokens (primær gate, jf. #1275)**, ≤30 linjer sekundært; close-out-blokke cappet til 5 entries à ≤2 sætninger. Over budget → trim gamle blokke **direkte** før commit (historik bevares i git-log + issue-tråde; opret IKKE `docs/archive/NOW-*.md`, jf. #750). Kør `pwsh -File scripts/check-agent-token-hygiene.ps1` ved tvivl
4. `docs/FEATURE_STATUS.md` opdateret hvis kontrakter/features ændret
5. Relevante GitHub-issues lukket eller opdateret med kommentar (task-lag — backlog-fil arkiveret 2026-05-06)
6. Hvis bug-fix: postmortem-entry i `.claude/learnings/<dato>-<slug>.md`
7. Slice-doc i `docs/slices/` markeret done (flyt IKKE filer til `docs/archive/` — mappen er #684-deny-beskyttet, jf. #750)
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
- Hvis NOW.md er over budget (~1.200 tok / 30 linjer): trim historik direkte FØR push — git-log + issue-tråde ER arkivet (#750)
- Memory-filer læses kun ved første session eller eksplicit behov

### Cold-start-recipe (ny session)

```
1. git rev-parse --show-toplevel  → bekræft repo
2. Read AGENTS.md + NOW.md (fast par). GUARDRAILS_CORE.md KUN ved
   needs-contract/shared-refactor-issues (samme regel som CLAUDE.md Start
   trin 3 — ~80% af sessioner skipper og sparer ~1.100 tok)
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
