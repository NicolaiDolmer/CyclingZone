# Plan: Verdens-klasse AI-opsætning med markant token-reduktion

## Context

CyclingZone's Claude Code-opsætning er funktionel men token-tung. Cold-start æder **~17-22K tokens** før første brugerbesked — primært drevet af MEMORY.md (4,400 tok, ikke 250 som CLAUDE.md hævder), deferred MCP-tool-liste (~3,750 tok), og skills-liste (~1,900 tok).

Brugeren har tre konkrete smerter:
1. **Cost (API-pris)** — hver session betaler dyrt for kontekst der i 80% af tilfælde er irrelevant
2. **Auto-compact rammer for tidligt** — lange sessioner mister kontekst pga. opblæst startbase
3. **Kvalitet dropper i fyldt kontekst** — signal drukner i støj sent i sessioner

Ønsket udfald: **Cold-start ned til ~5-8K tokens** (50-65% reduktion) UDEN at miste den verdens-klasse kvalitet og institutionel viden der er bygget op. Sustainable system, ikke et engangs-hack.

**Designfilosofi:**
- **Auto-load er hellig jord** — hver token her beskattes på HVER session. Vær brutal.
- **On-demand er gratis** — uendelig reference-mængde er OK så længe den ikke auto-loader
- **Signal-tæthed slår volumen** — 25 skarpe memories slår 80 vage
- **Livscyklus** — stale entries forringer kvalitet stille; aktiv pruning er ikke valgfri
- **Mål før-og-efter** — uden baseline ved vi ikke om vi vinder

---

## Phase 0 — Baseline-måling (engangs, 30 min)

**Mål:** Etablér et tal vi kan optimere imod, og en gentag-bar måling.

### Konkrete leverancer

1. **Token-baseline-script** — udvid `scripts/check-agent-token-hygiene.ps1` til at:
   - Tælle MEMORY.md, CLAUDE.md, NOW.md, SESSION_CONTEXT.md, GUARDRAILS_CORE.md
   - Tælle deferred-tools-blob (estimat: alle `mcp__*` + alle skill-navne)
   - Skrive resultat til `.codex.local/token-baseline.json` med dato
   - Tabel-output: `BEFORE | TARGET | CURRENT | DELTA`

2. **Quality-canary-tjekliste** (én fil: `docs/AI_OPS_QUALITY_CANARIES.md`):
   - 10 konkrete adfærd der MÅ ikke regressere efter cuts. Eksempler:
     - "AI auto-pusher efter commit" (memory: `feedback_git_push.md`)
     - "AI bumper PatchNotes ved brugerrettet commit"
     - "AI bruger `gh issue create --body-file`, ikke MCP issue_write fra main session"
     - "AI verificerer build lokalt før push ved dep-ændringer"
   - Bruges som regression-tjek efter hver fase

### Verifikation
- Kør script: rapporter siger fx `BEFORE=18,400 tok`
- Commit baseline.json som freeze-point

---

## Phase 1 — Memory-konsolidering (største enkelt-gevinst, ~2,500 tok)

**Mål:** MEMORY.md fra 109 linjer / 4,400 tok → ~30 linjer / ~1,200 tok. Slet ikke viden — konsolidér og tier-split.

### Strategi: 3-tier memory-arkitektur

```
MEMORY.md            (auto-load, ~1,200 tok)  → kun "hot" rules, max 30 linjer
MEMORY_REFERENCE.md  (on-demand)              → den fulde nuværende index
memory/*.md          (uændret, on-demand)     → eksisterende detail-filer
```

### Konsolideringsregler

1. **Merge tematiske dubletter** — flere entries på samme underliggende regel kombineres:
   - "Verification" cluster (6 entries: `runtime_verify_first`, `evidence_before_fix`, `manual_verification`, `rls_verify_authenticated`, `supabase_status_must_match_check`, `verify_issue_state_before_recommending`) → ÉN entry: *"Verificér kode/runtime/state FØR claim"* med 6 bullet-eksempler i detail-filen
   - "Session-rytme" cluster (7 entries) → ÉN top-line i MEMORY.md + bevarede detail-filer
   - "PowerShell/Bash heredoc" cluster (2 entries → 1)
   - "Branch-hygiejne" cluster (3 entries → 1)

2. **Drop stale entries** (verificér før sletning):
   - `feedback_manager_rename_wizard.md` (droppet feature, 2026-04 → flyt til `.claude/learnings/archive/`)
   - `project_board_parallel_plans.md` (LIVE siden 2026-04-24, ikke længere "ongoing")
   - `project_beta_tools_priority.md` (afsluttet 2026-04-26)
   - `project_slice14_uci_history.md` (DONE 2026-05-10, kun nyttig som historisk note)
   - 2-3 andre kandidater identificeret i Phase 0 audit

3. **Tier-promotion-regel** (ny):
   - **HOT (auto-load):** kun rules der gælder >50% af sessioner ELLER har bidt brugeren 2+ gange
   - **WARM (on-demand):** alt nuværende memory-indhold
   - Default tier for nye memories: WARM. Kun eksplicit promovering til HOT.

### Konkrete filer
- Skriv: `C:\Users\emmas\.claude\projects\C--dev-CyclingZone\memory\MEMORY.md` (ny, slank)
- Skriv: `C:\Users\emmas\.claude\projects\C--dev-CyclingZone\memory\MEMORY_REFERENCE.md` (fuld index, til on-demand)
- Behold detail-filer som de er (de auto-loader ikke)
- Dokumentér regler i ny `memory/README.md` (kort, ~20 linjer)

### Verifikation
- Læs nye MEMORY.md i ny session, mål tokens
- Kør quality-canary-tjekliste — alle 10 punkter skal stadig være remembered
- Brugeren får et "hvad-jeg-har-fjernet" diff til godkendelse FØR commit

---

## Phase 2 — MCP-server audit & disable (~1,500-2,500 tok)

**Mål:** Identificér MCPs der sjældent bruges; disable for at fjerne deres deferred-tool-bidrag.

### Audit-metodologi
1. Søg seneste 30-dages session-transcripts (via `ccd_session_mgmt__search_session_transcripts`) for hvert MCP-prefix:
   - Antal kald
   - Sidste brug
   - Erstatningsmulighed (fx `gh CLI` for GitHub-MCP-features, `vercel.cmd` for Vercel)

### Forventede dispositioner (skal verificeres i auditen)

| MCP | Status | Anbefalet handling | Estimeret besparelse |
|-----|--------|---------------------|----------------------|
| GitHub (392d...) | Heavy use | **BEHOLD** men overvej slankere tool-allowlist | 0 |
| Supabase (0447...) | Core | **BEHOLD** | 0 |
| Vercel (dba1...) | Moderate | **BEHOLD** | 0 |
| Chrome (Claude_in_Chrome) | High-value | **BEHOLD** | 0 |
| Control_Chrome | Redundant m. Chrome | **DISABLE** | ~200 tok |
| Microsoft_Clarity | Aldrig brugt | **DISABLE** | ~200 tok |
| mcp-registry | Discovery, rarely needed | **DISABLE** | ~150 tok |
| Calendar (56a7...) | Lav brug | **DISABLE** (re-enable hvis behov) | ~400 tok |
| Gmail (749f...) | Lav brug | **DISABLE** | ~500 tok |
| Drive (7d4d...) | Lav brug | **DISABLE** | ~400 tok |
| Discord | Brugt for bridge | **BEHOLD** men evaluér slankere tool-set | -100 tok (slim) |
| Vercel-preview (Claude_Preview) | Lav brug | **EVALUÉR** — eventuelt disable | ~400 tok |
| scheduled-tasks | Sjælden | **BEHOLD** (billig) | 0 |
| ccd_* | Core | **BEHOLD** | 0 |

**Forventet total: ~2,000-2,500 tokens.**

### Implementation
- MCPs styres ikke fra `.claude/settings.json` direkte — de er harness-niveau. Brug `/mcp` slash-command eller `~/.claude.json` til at disable per user-scope.
- Lever paste-ready disable-instruktioner til brugeren (ikke automatisk handling — det er high-blast-radius)

### Verifikation
- Ny session efter disable: tæl deferred-tools i system-reminder
- Quality-canary: bekræft at no-disable MCPs (GitHub, Supabase, Vercel, Chrome) stadig virker

---

## Phase 3 — Skills audit & trim (~800-1,200 tok)

**Mål:** ~75 skills auto-listes — mange er aldrig invokeret.

### Audit
- For hvert skill-plugin (`product-management`, `marketing`, `design`, `data`, `code-modernization`, `anthropic-skills`, `claude-code-setup`, `engineering`, `productivity`):
  - Antal session-invocations seneste 30 dage
  - Behov for CyclingZone (solo-udvikler-managerspil)

### Forventede dispositioner
| Plugin | Anbefalet handling | Begrundelse |
|--------|---------------------|-------------|
| `engineering:*` | **BEHOLD** | code-review, debug, system-design, deploy-checklist relevant |
| `claude-code-setup:*` | **BEHOLD** | konfig-værktøjer |
| `anthropic-skills:skill-creator` | **BEHOLD** | aktiv brug |
| `anthropic-skills:consolidate-memory` | **BEHOLD** | bruges netop nu |
| `anthropic-skills:pdf/docx/pptx/xlsx` | **DISABLE** | aldrig brugt på CyclingZone |
| `product-management:*` | **DISABLE** | ikke matchet workflow |
| `marketing:*` | **DISABLE** | ikke aktivt |
| `design:*` | **DISABLE** | brugeren laver ikke design-arbejde |
| `data:*` | **EVALUÉR** | sql-queries / analyze måske nyttig — kun behold de 2 |
| `productivity:*` | **DISABLE** | TASKS.md mønster bruges ikke |
| `code-modernization:*` | **DISABLE** | greenfield projekt |

**Forventet total: ~800-1,200 tokens** (plugin-disable er aggressiv men reversibel).

### Implementation
- Plugins styres via `~/.claude/settings.json` `enabledPlugins` map. I dag har brugeren:
  ```json
  "enabledPlugins": {
    "claude-code-setup@claude-plugins-official": true,
    "code-modernization@claude-plugins-official": true
  }
  ```
- Skills loades via plugins eller `~/.claude/skills/`. Lever paste-ready settings-diff.

---

## Phase 4 — Hooks & on-demand-doks (~300-500 tok)

**Mål:** Slank de docs der auto-loades, behold fuld viden on-demand.

### Konkrete cuts

1. **NOW.md** (currently 28 linjer / 830 tok) — allerede inden for 30-linjers regel men byte-dense. Mål: <600 tok. Tjek for redundans med SESSION_CONTEXT.md.

2. **CLAUDE.md** (62 linjer / 990 tok) — kan trimmes til ~40 linjer. Den lange reference-tabel kan flyttes til `docs/META_DOCS_INDEX.md` (on-demand). Behold kun:
   - Auto-load oversigt (3 linjer)
   - Start-rutine (5 linjer)
   - Hot-references (top 4 docs)
   - Close-out (5 linjer)
   - Token-budget snapshot (opdateret med ÆGTE tal)

3. **SESSION_CONTEXT.md prefetch** — er allerede bounded (900 char body / 450 char comment). Verificér at den ikke ofte rammer loftet. Hvis bounds ramt >50% af tid, sænk til 600/300.

4. **GUARDRAILS_CORE.md auto-load-condition** — i dag triggers den på `needs-contract` eller `shared-refactor` labels. Verificér at labels faktisk anvendes systematisk; ellers ryger den 700-token-omkostning på 0%-relevant kontekst.

### Verifikation
- Ny session: tæl alle auto-loaded docs igen
- Læs CLAUDE.md i nye session — ingen "hvor finder jeg X?"-momenter

---

## Phase 5 — Sustainable system (process > one-shot)

**Mål:** Sikre at gevinsterne holder i 6+ måneder.

### Konkrete artefakter

1. **`docs/AI_OPS_TOKEN_BUDGET.md`** (~50 linjer, IKKE auto-loaded):
   - Token-budget pr. fil-kategori
   - Promotion-regel HOT/WARM/COLD
   - Auditeringsfrekvens (månedlig)
   - Konkrete numbers: "MEMORY.md må ikke >40 linjer", "CLAUDE.md må ikke >50 linjer"

2. **Pre-commit guard** (i `scripts/check-agent-token-hygiene.ps1`):
   - FAIL hvis MEMORY.md >40 linjer ELLER NOW.md >30 linjer ELLER CLAUDE.md >50 linjer
   - WARN hvis nogen overstiger 80% af loft
   - Integrér i Stop-hook så jeg signalerer ved close-out

3. **Månedlig memory-audit-routine** (via `anthropic-skills:consolidate-memory`):
   - Spawn'es som scheduled task hver 1. mandag
   - Output: "kandidater til arkivering" PR-draft
   - Brugeren reviewer 5 min, merger eller afviser

4. **Quality-canary-regression-tjek** (`docs/AI_OPS_QUALITY_CANARIES.md` etableret i Phase 0):
   - Liste opdateres ved hver ny "memory promote to HOT"
   - Køres manuelt af bruger første gang ved tvivl

5. **Promotion-disciplin (ny memory-regel):**
   - Default tier for nye memories: WARM (detail-fil + reference, ikke i MEMORY.md index)
   - Kun promotion til HOT (MEMORY.md index) hvis bruger eksplicit siger "husk det her som top-prioritet" ELLER reglen har bidt 2+ gange
   - Gem dette som memory: `feedback_memory_tier_default.md`

---

## Verifikation (samlet acceptance)

Efter alle 5 faser:

1. **Token-mål:** Cold-start <8K tokens, målt med `scripts/check-agent-token-hygiene.ps1`
2. **Quality-canary-tjekliste:** Alle 10 punkter "Pass" i en frisk session
3. **End-to-end-test:** Bruger laver én fuld feature-cycle (issue-pickup → kode → PR → merge → close) i ny session og rapporterer:
   - Følte AI nogensinde at vigtigt context manglede? → Hvis ja, hvilken memory burde være HOT?
   - Var session-rytme intakt (signalering, close-out)? → Hvis nej, hvilken regel?
4. **Cost-måling:** Sammenlign API-cost for 3 sessioner FØR vs 3 sessioner EFTER (samme opgavetype) — forventet 40-55% reduktion

---

## Faseafhængigheder & rækkefølge

```
Phase 0 (Måling)  ← FØRST, kan ikke springes
   ↓
Phase 1 (Memory) ──┐
                    ├─→ Phase 4 (Hooks/docs)
Phase 2 (MCPs)   ──┤        ↓
                    ├─→ Phase 5 (Sustainable)
Phase 3 (Skills) ──┘
```

Phase 1, 2, 3 er uafhængige og kan tages i den rækkefølge der giver mest værdi for brugeren. **Anbefalet rækkefølge:** 0 → 1 → 3 → 2 → 4 → 5 (start med højeste sikre gevinst, ende med proces).

---

## Kritiske filer der ændres

- `C:\Users\emmas\.claude\projects\C--dev-CyclingZone\memory\MEMORY.md` (slank ned)
- `C:\Users\emmas\.claude\projects\C--dev-CyclingZone\memory\MEMORY_REFERENCE.md` (NY, on-demand)
- `C:\Users\emmas\.claude\projects\C--dev-CyclingZone\memory\README.md` (NY, regler)
- `C:\Users\emmas\.claude\settings.json` (enabledPlugins-diff, deferred til bruger)
- `C:\dev\CyclingZone\CLAUDE.md` (slank til <50 linjer)
- `C:\dev\CyclingZone\docs\META_DOCS_INDEX.md` (NY, flyttet reference-tabel)
- `C:\dev\CyclingZone\docs\AI_OPS_TOKEN_BUDGET.md` (NY, process)
- `C:\dev\CyclingZone\docs\AI_OPS_QUALITY_CANARIES.md` (NY, regression-tjek)
- `C:\dev\CyclingZone\scripts\check-agent-token-hygiene.ps1` (udvid med pre-commit-guard)

## Rejected alternatives (kort)

- **"Bare brug auto-compact mere aggressivt"** — kompaktering mister altid signal. Bedre at starte med mindre kontekst.
- **"Disable alle MCPs"** — for stort kvalitetstab. GitHub/Supabase/Vercel/Chrome er core-værdi.
- **"Erstat MEMORY.md med en RAG-database"** — over-engineering. Memory er allerede effektiv som filer; problemet er kun tier-disciplin.
- **"Lad CLAUDE.md auto-loade alt"** — det modsatte af hvad vi vil; auto-load er hellig jord.
