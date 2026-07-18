# AGENTS.md

_Arbejdsregler for Claude i cycling-manager-repo'et. Single source of truth for de discipliner hver session skal følge. (Tidligere multi-AI-koordineringsfil; solo Claude-operation siden 2026-06-12 — Codex/Manus udfaset.)_

> **Lean core (split 2026-05-29, [#733](https://github.com/NicolaiDolmer/CyclingZone/issues/733)).** Denne fil holder kun det der reelt skal i HVER session — hard rules (fuld tekst), start-sekvens og delt handoff-format. Rolle-matrix, cross-PC-detaljer, session-rytme-signaler, token-effektivitets-vejledning og loops-quick-ref er flyttet til **[`docs/AI_OPS_REFERENCE.md`](docs/AI_OPS_REFERENCE.md)** (WARM, on-demand). Intet indhold er slettet — kun flyttet.

---

## Hard rules

> **Håndhævelse:** 🔒 = mekanisk håndhævet (hook/CI — kan ikke glemmes). ✍️ = honor-system (prosa; afhænger af disciplin — disse er dem der drifter, hold dem korte).
> Pr. regel nedenfor: 1 ✍️ · 2 ✍️ · 3 ✍️ · 4 ✍️ · 5 🔒 (pre-push hook + `leak-check` CI) · 6 ✍️ · 7 ✍️ (auto-push hook hvis installeret) · 8 ✍️ · 9 ✍️ (idempotens-delen 🔒 via migration-idempotency-CI).

1. **Repo-root verification:** Brug kun den aktuelle bekræftede repo-root fra `git rev-parse --show-toplevel`. Aldrig andre lokale kopier, sync-kopier eller zip-udpakninger. Hvis repo-root ikke matcher den workspace-mappe brugeren aktuelt har angivet → stop og bed om realignment.

2. **Delt context er GitHub/OneDrive — aldrig lokal-only.** Varig projekt-state, handoff, beslutninger, næste skridt og læringer skal ligge i GitHub (issues, `docs/NOW.md`, `docs/slices/`, repo-docs) eller i OneDrive-context-hardlinks. Lokale agent-filer (`.codex.local/SESSION_CONTEXT.md`, Claude transcripts, Codex memories, tool caches) er kun regenererbare caches/pointers og må aldrig være eneste sted et fremskridt findes. Hvis du opdager lokal-only context, migrér den til GitHub/OneDrive før session-slut.

3. **Verificér runtime FØR du listet noget som TODO/bug/mangler.** Dokumenter (Noter-til-spiller.txt, gamle session-notater, brugerens hukommelse) kan være måneder forældede mens koden er rettet. Grep mindst én relevant fil eller tjek `git log --grep=<keyword>` før du committer påstanden til en plan. Markér eksplicit "❓ ikke runtime-verificeret" på antagede status-stempler. Etableret 2026-05-04 efter Noter-fil-stale-incidenten.

4. **Bliv ved med at stille spørgsmål når i tvivl.** 70-95% sikkerhed → spørg, antag ikke. Også for proaktive forbedringsforslag. AskUserQuestion-tool foretrækkes til strukturerede valg.

5. **Patch notes er obligatoriske ved enhver brugerrettet ændring.** Opdatér `frontend/src/pages/PatchNotesPage.jsx` ELLER skriv eksplicit hvorfor det ikke er nødvendigt. Pre-push hook (loop B i AI_LOOPS.md) håndhæver dette. **Samme rutine for Hjælp/FAQ** (#1171): ændrer eller tilføjer slicen en spilmekanik spillere skal forstå, opdatér `frontend/public/locales/{en,da}/help.json` (+ `HelpPage.jsx` SECTION_DEFS/FAQ_KEYS ved nye blokke) eller skriv hvorfor ikke. **i18n leak-guard (#1068):** `scripts/i18n-check-leaks.mjs` (CI-job `leak-check` + pre-commit via lint-staged) blokerer NYE danske strenge i EN-locale-værdier og player-facing kode. Kendte leaks ligger i `scripts/i18n-leaks-baseline.json` — en ratchet der kun må skrumpe: fix leaks og stram med `node scripts/i18n-check-leaks.mjs --update-baseline` i en dedikeret commit; udvid den ALDRIG med nye leaks. Legitimt dansk (admin-flader, dual-page privacy, PatchNotes-data, brand-termer) tilføjes i stedet til LOCALE_ALLOWLIST/EXEMPT i scriptet med begrundelse.

6. **Slice close-out kræver:**
   - `docs/NOW.md` opdateret + relevante GitHub-issues lukket eller opdateret med status (`gh issue comment N --body "..."` / `gh issue close N --reason completed`)
   - `docs/FEATURE_STATUS.md` afstemt
   - PatchNotesPage opdateret
   - Postmortem-entry i `.claude/learnings/` hvis slice fiksede en bug (loop C)
   - Doc-drift sweep: grep for nye env vars, deploy-targets, route-navne, tabel-navne mod `ARCHITECTURE.md` og åbne issues

7. **Auto-push efter commit:** Push til GitHub automatisk efter hvert commit (Vercel deployer kun ved push).

8. **OneDrive-context hardlinks (siden 2026-05-07, scope reduceret 2026-05-12 per #327):** Memory og `.codex.local/SUPABASE_CONTEXT.md` + `supabase-readonly.env` er HARDLINKEDE til `~/OneDrive/CyclingZone-context/`, ikke kopier. Edit-tool BRYDER hardlinket → drift på næste PC. Efter manuel edit af disse filer: kør `pwsh -File scripts/link-onedrive-context.ps1` for at re-etablere. Ved drift-konflikt: læs INDHOLDET af begge versioner — antag ikke "nyeste timestamp vinder". Pure additive → tag den længere; sletning → STOP og spørg bruger. Default: OneDrive vinder. **Produktionssecrets (`*.env`, `.mcp.json`) er IKKE længere OneDrive-hardlinked** — bootstrappes nu via Infisical (`infisical export --env=dev > backend/.env`); se `docs/decisions/secret-management-adr.md`. Detaljer: `docs/CROSS_PC_SETUP.md` + `docs/HOOKS.md`.

9. **SQL/migrations-mandat (ejer 18/7, [#2642](https://github.com/NicolaiDolmer/CyclingZone/issues/2642)) — afløser "ejer applier"-reglen:** Claude kører selv SQL/migrationer mod prod (`apply_migration`/`execute_sql`) under disse rammer:
   - **Rækkefølge:** migration committes i PR → PR merges → apply. Aldrig apply af u-merget SQL (eneste undtagelse: additiv/idempotent fil hvor featuren ellers er brudt live — dokumentér i issue/PR).
   - **Idempotens:** alle filer følger `IF NOT EXISTS`/`DROP POLICY IF EXISTS`-mønstret (håndhævet af migration-idempotency-CI).
   - **Post-apply-verifikation:** read-only-tjek (`information_schema`/`pg_*`) + notér resultatet i issue- eller PR-kommentar.
   - **Destruktive klasser er FORTSAT ejer-gated pr. tilfælde:** `DROP TABLE`/kolonne, masse-DELETE/UPDATE af spillerdata, RLS-lempelser — jf. "ejer ser live-tilstand før atombomber".
   - **Mekanik:** filer i `database/2026-*.sql` (top-niveau) auto-applies desuden af `auto-migrate.yml` ved push til main (~3 min delay). MCP-apply bruges til at fremrykke/verificere en merged migration samt til one-off data-SQL under rammerne ovenfor — begge veje er idempotente via `schema_migrations`-tracking hhv. filkonventionen.
   - **Backup-forudsætning:** Supabase-org er på Pro-plan (daglige automatiske backups) — verificeret 2026-07-18. PITR-add-on-status kan ikke aflæses via MCP; ejer bekræfter i dashboard.

### §LOKAL lokal-only-state (legacy — Codex-æra)

`.codex.local/`-whitelisten og `cross-pc-forensic-audit.ps1` blev bygget til at fange lokal-only state Codex efterlod på tværs af PC'er. Med solo Claude-operation er rutinen ikke længere en per-session-gate — kør kun auditen ad hoc hvis du mistænker drift (fx efter længere ophold på en sekundær PC). Detaljer: [`docs/CROSS_PC_LOCAL_STATE.md`](docs/CROSS_PC_LOCAL_STATE.md).

---

## Start-sekvens (hver session)

1. Kør `git rev-parse --show-toplevel` — bekræft repo-root
2. Kør `git fetch --prune origin && git status -sb` — hvis `[behind N]`, kør `git pull --ff-only` før edit (user-level SessionStart-hook gør dette automatisk hvis installeret)
3. Læs `.codex.local/SESSION_CONTEXT.md` hvis den findes, men behandl den som regenererbar cache fra GitHub-issues — ikke som source of truth. Hvis den er stale/mangler, brug `docs/NOW.md` + `gh issue list/view`.
4. Læs `docs/GUARDRAILS_CORE.md` KUN hvis issue-labels indeholder `needs-contract` eller `shared-refactor` (~80% af sessioner skipper — samme regel som CLAUDE.md "Start (eksplicit)" trin 3; alignet per #1097)
5. Læs `docs/NOW.md`
6. Aktivt issue: `gh issue list --label "claude:todo" --state open --limit 10` — første `#N` i NOW.md er typisk det aktive
7. Hvis arbejde matcher en slice i `docs/slices/<slug>.md` → læs den slice-brief (komplet kontrakt på 30-50 linjer)
8. Hvis nye loop-implementeringer → læs `docs/AI_LOOPS.md` afsnittet for den specifikke loop

**Token-effektiv kontekst-tabel** (hvilken doc læses hvornår) + **cold-start-recipe** + anti-patterns: [`docs/AI_OPS_REFERENCE.md §Token-effektiv kontekst`](docs/AI_OPS_REFERENCE.md#token-effektiv-kontekst).

---

## Delt handoff-format (alle agents)

Varigt handoff skrives i GitHub/OneDrive, ikke lokal-only. Brug denne form i `docs/NOW.md`, en GitHub issue-kommentar eller en slice-doc ved session-slut, maks 15 linjer.

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

## Worktree-disciplin (Claude-specifik)

- Worktrees i `.claude/worktrees/<navn>/` cleanes efter ship via SessionStart-hook
- Manuel fallback hvis hook fejler: `git worktree remove <path>` + `git branch -D <branch>` på PC'en der oprettede worktreen
- Per-PC handling — gentages på den anden PC ved næste session der
- **Parallel-sessions samme PC:** se [`docs/AGENT_ARCHITECTURE.md §Parallel-session-safety`](docs/AGENT_ARCHITECTURE.md#parallel-session-safety-samme-pc-flere-claude-sessions-samtidigt) for kollisions-matrix + worktree-recipe
- ⚠️ **Sti-baserede hard-blocks SKAL stå i `permissions.deny`, ikke kun hooks (#684):** På Claude Code ≥2.1.154 bypasser `permissions.allow` PreToolUse-hookenes `exit 2` OG JSON-`permissionDecision: deny` ([anthropics/claude-code#18312](https://github.com/anthropics/claude-code/issues/18312)). Fix D (verificeret 2026-05-29 i frisk acceptEdits-session): statiske `permissions.deny`-globs overlever allow-listen (`deny > allow`-precedence) — `Write`/`Edit`/`NotebookEdit(docs/archive/**)` er nu i `permissions.deny`, så arkiv-beskyttelsen håndhæves selvom de tre tools er allow-listede (#591). **Tilbageværende gap:** indholds-baserede guardrails (NOW.md 30-linjers-grænse, dynamisk secret-pattern) kan ikke udtrykkes som deny-globs → stadig hook-only og afvæbnede for allow-listede tools indtil #18312. Hold dem i menneske-review ved autonome parallel-runs — se [`docs/PARALLEL_WORKTREE_ORCHESTRATION.md`](docs/PARALLEL_WORKTREE_ORCHESTRATION.md) top-note.

---

## On-demand reference (ikke auto-load)

Resten af AI-ops-disciplinen er flyttet til **[`docs/AI_OPS_REFERENCE.md`](docs/AI_OPS_REFERENCE.md)** — læs efter behov:

- **Token-effektiv kontekst** — doc-til-trigger-tabel + cold-start-recipe + anti-patterns
- **Rolle-fordeling mellem AI-assistenter** — Manus / Claude / Codex / Clarity (kort version; fuld council-kontrakt i [`docs/AI_COUNCIL.md`](docs/AI_COUNCIL.md))
- **Hvornår skifter AI-ejerskab** — scenarie→AI-tabel + konflikt-resolution
- **Cross-PC setup** — repo-placering, synk-arkitektur, drift-protokol, ikke-rør-for-Codex
- **Session-rytme & token-effektivitet** — 🟢/🟡/🔴/🆕-signaler, close-out-tjeklister, hvornår man starter ny session
- **Reference til loops** — quick-ref A-I (fuld spec: [`docs/AI_LOOPS.md`](docs/AI_LOOPS.md))

---

_Sidst opdateret: 2026-05-29 — split i lean core + `docs/AI_OPS_REFERENCE.md` per [#733](https://github.com/NicolaiDolmer/CyclingZone/issues/733) (token-reduktion; Codex cold-start). Indhold bevaret, kun flyttet._
