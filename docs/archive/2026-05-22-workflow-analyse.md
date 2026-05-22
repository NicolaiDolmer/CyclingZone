# Workflow analyse — Cycling Zone AI/Ops grundig gennemgang

**Dato:** 2026-05-22
**Forfatter:** Claude (mobil/PC chat-session, ikke Claude Code)
**Til verifikation af:** Claude Code-session på PC (du sender denne videre med instruktion)
**Status:** UDKAST — skal krydstjekkes på PC mod kode, OneDrive og GitHub før noget bliver til endelige issues
**Tracking issue:** #555 (oprettet i samme session som dette dokument)

---

## Hurtig oversigt for Claude Code

Læs dette dokument fuldt før du gør noget. Det indeholder:

1. Hvad analysen er bygget på (sektion 0)
2. Hvilke filer jeg IKKE har set, som du skal krydstjekke mod (sektion 0)
3. Hvad eksisterende infrastruktur indeholder (sektion 1)
4. 24 forslag (12 B-forslag for workflow + 12 G-forslag for GitHub) (sektion 5, 7)
5. 10 anti-forslag (ting du IKKE skal foreslå at gøre) (sektion 5C)
6. Eksplicit instruktion til dig om hvordan du klassificerer forslagene (sektion 13)
7. Appendix A med kort-form af alle 24 forslag

**Tracking issue #555 har samme indhold + checkbox-tabel. Du opdaterer dén når du klassificerer hvert forslag.**

---

## 0. Hvad jeg har gennemgået (vs. en tidligere v1)

**v1** baseret på 3 docs (NOW, GUARDRAILS_CORE, MEMORY) + 30 issues.

**v2 (denne)** tilføjer:
- Epic #323 child-issues (#324-#334, #339, #346, #455)
- `epic:ai-workflow` issues (#78, #383, #385, #386, #388, #135)
- `epic:dx-hardening` issues (#87, #88)
- `epic:quality-hardening` issues (#288, #346, #377)
- Multi-AI labels (`agent:claude`, `agent:codex`, `agent:manus`)
- Risk-labels (`risk:low/med/high`), needs-labels (`needs-ai-triage`, `needs-decision`, `needs-user-action`)
- Time-tracking labels (`cat:infra`, `cat:user-feature`, `cat:ai-ops`, `cat:founder`)
- Quality Inbox-bot output (#346) — viser 13 åbne warnings i agent-doctor

**Hvad jeg STADIG ikke har set** (krav for endelig vurdering, opgave til Claude Code-session):
- `docs/AI_OPS_TOKEN_BUDGET.md`
- `docs/AI_OPS_QUALITY_CANARIES.md`
- `docs/AI_OPS_DISABLE_PLAYBOOK.md`
- `docs/CROSS_PC_SETUP.md`
- `docs/GITHUB_WORKFLOW.md`
- `docs/HOOKS.md`
- `docs/decisions/secret-management-adr.md`
- `docs/decisions/` (hvilke ADRs eksisterer?)
- `docs/archive/plans/2026-05-14-ai-setup-world-class-plan.md` (refereret i #385, #388)
- `.claude/settings.json` (det er nu git-tracked per #383/#385)
- `scripts/hooks/` (committed scripts)
- `scripts/cross-pc-forensic-audit.ps1`
- `scripts/agent-doctor.ps1`
- AGENTS.md (refereret i #524)
- CLAUDE.md (refereret i #386)

**Konsekvens:** Forslag i denne analyse skal krydstjekkes mod disse filer. Sandsynligvis dækker flere allerede 30-50% af mine forslag.

---

## 1. Hvad du allerede har (uden at jeg har set koden)

Baseret på issue-references og MEMORY.md kan jeg slutte at infrastrukturen indeholder:

### Automation
- **Hooks** (PreToolUse, SessionStart, Stop) i `.claude/settings.json` — håndhæver gh-lint, archive-block, NOW.md 30-linje, auto-archive ved Stop
- **Cross-PC sync** via OneDrive-hardlinks + scripts (`link-onedrive-context.ps1`)
- **Agent-doctor bot** posterer ugentlige sundheds-rapporter (#346)
- **Time-tracker** med søndags-rapporter på #499 + Phase 2 i #391 (Google Calendar, HTML-dashboard, cron)
- **Memory-konsolidering** planlagt som ugentlig cron (#78)
- **Auto-migrate** workflow til database migrations (refereret i #551, #552)
- **Quality Inbox bot** (`agent-doctor` GitHub Action) på #346

### Multi-AI orchestration
- **Eksplicitte rolle-labels:** `agent:claude`, `agent:codex` (sandsynligvis også `agent:manus` baseret på #327)
- **Claim-mekanisme via labels:** `claude:todo` → `claude:done`
- **Verifikations-gate:** `needs-user-action` label + brugerverifikation-issues (#459-stil)
- **Risk-baseret auto-merge:** `risk:low` → auto-merge eligible, `risk:high` + `manual-review` → human gate

### Token-hygiejne
- **Cold-start baseline** målt og tracked (#357: target <8.000 tok, allerede ned fra 17.046)
- **MCP-connector disable** (#355: 7 ubrugte connectors disconnected)
- **Skill-portefølje per slice** planlagt (#388)
- **Quality canaries** dokumenteret (`docs/AI_OPS_QUALITY_CANARIES.md`)

### Verdensklasse-plan EKSISTERER ALLEREDE
- `docs/archive/plans/2026-05-14-ai-setup-world-class-plan.md` (refereret i #385, #388, #386)
- **Step 2:** Settings 3-lag split (#385)
- **Step 3:** Path-audit forward-guard (#385)
- **Step 4:** Bootstrap-script til ny PC (#386)
- **Step 7:** Skill-portefølje per slice (#388)

**Det er kritisk:** Brugeren har ikke spurgt "hvordan bygger jeg verdensklasse-setup". Brugeren har spurgt "hvordan FÆRDIGGØR jeg det verdensklasse-setup jeg allerede har planlagt". Det er en helt anden opgave.

---

## 2. Nuværende status af "verdensklasse-plan"

Baseret på issue-bodies (ikke verificeret mod faktisk implementering):

| Step | Issue | Status | Owner | Effort |
|---|---|---|---|---|
| 1 | (sandsynligvis #356) | Sandsynligvis lukket | Claude | - |
| 2 | #385 (settings.json 3-lag) | TODO | Claude | M |
| 3 | #385 (path-audit forward-guard) | TODO | Claude | M |
| 4 | #386 (bootstrap-script) | TODO | Claude | M |
| 5 | (ikke fundet) | ? | ? | ? |
| 6 | (ikke fundet) | ? | ? | ? |
| 7 | #388 (skill-portefølje per slice) | TODO | Claude | L |

**Plus parallel epic #323 (4 faser):**

| Fase | Status | Blocker |
|---|---|---|
| 0 — Gør gates reelle (#324) | TODO | Lokale hooks aktivering |
| 1 — Supabase audits (#325) + docs sync (#326) | DELVIST | #325 marked claude:done, #326 unknown |
| 2 — Secret mgmt (#327), rate limit (#328), Playwright (#329) | #327 IN PROGRESS (#339 Phase 1), #328/#329 ukendt | Infisical-projekt skal oprettes manuelt |
| 3 — Realtime (#333), cron multi-instance (#330), cache (#334), loadtest (#331) | TODO | Ikke startet |
| 4 — Fuldtidsdrift playbook (#332) | TODO | Manus skal levere ADR-doc |

**Diagnose:** Brugeren har 2 parallelle "verdensklasse"-spor (Step 2-7 cross-PC + Epic #323 skalerings-roadmap). De er ikke krydsreferencerede konsistent. Det er det vigtigste enkelte fund.

---

## 3. Kanal-rolle realitet (ikke teori)

Brugerens oprindelige spørgsmål: hvordan bruger jeg chat, dispatch, cowork, Claude Code optimalt på PC1, PC2 og mobil.

Lad mig være konkret om hvad hver gør GODT vs DÅRLIGT, baseret på faktisk produkt-kapacitet:

### Claude Code (PC1 + PC2)
**Hvad den er rigtig god til:**
- Multi-fil edits i kodebasen med fuld kontekst
- Git operations, npm, tests, builds
- Hooks-håndhævelse (brugeren har allerede dette setup)
- Plan mode (Shift+Tab) for komplekse opgaver

**Hvad den er DÅRLIG til (ofte misforstået):**
- Strategi-samtaler der kræver bredt overblik — Claude Code optimerer mod kodebase-fokus
- Lange research-tasks (web search kører bedre i chat)
- Visuel review (chat har image_search; Code har ikke)

**Anbefalet brug:** Implementation når plan er klar. Aldrig som første kontakt med ny feature.

### Claude chat fra PC (web/desktop app)
**Hvad den er rigtig god til:**
- Project Knowledge søgning (du har 50+ docs der er bedst at navigere fra chat)
- Strategi, prioritering, beslutninger om retning
- Web search + research om eksterne biblioteker/services
- Issue-grooming (denne session er et eksempel)
- Generere ready-to-paste Claude Code-prompts

**Hvad den er DÅRLIG til:**
- Direkte fil-edits (filsystem-adgang via container er forskelligt fra dit faktiske setup)
- Lange agentiske workflows (Cowork gør det bedre)

**Anbefalet brug:** ALT der ikke er kode-implementation. Inklusiv: dette workflow-review.

### Claude chat fra mobil
**Hvad den er rigtig god til:**
- Mens du venter (køen, kaffe, transport)
- Læse status, godkende plans, mini-beslutninger
- Tænke højt om strategi når du ikke kan kode
- Dispatch-trigger (mobil → PC-task)

**Hvad den er DÅRLIG til:**
- Lange kodeblokke (læsbarhed på telefon)
- Multi-fil context (skærmen er for lille)
- Komplekse prompts (typing-friction)

**Anbefalet brug:** Tænk-arbejde og dispatch. Aldrig implementation.

### Claude Cowork (desktop, agentic)
**Hvad den er rigtig god til** (verificeret via web search):
- Filsystem-arbejde der IKKE er kode-implementation
- Excel/Sheets manipulation (du har Excel-import af race results)
- Screenshot/dokument-organisering
- Multi-step tasks der involverer lokale filer + connectors
- "Set it and forget it" workflows

**Hvad den er DÅRLIG til:**
- Kode-implementation i en kodebase (det er Claude Codes domæne)
- Tasks der kræver din løbende beslutning
- Hurtige one-off spørgsmål

**Status:** Cowork er stadig "research preview" → "early compared to Claude's ability to code or interact with text" per Anthropics egen warning. Wait for stability før kritiske workflows.

**Anbefalet brug:** Ikke-kode lokale filer. Patch notes-draft, doc-formatering, Excel-arbejde.

### Dispatch (mobil → PC, agentic)
**Hvad den er rigtig god til:**
- Du sidder i en møde og kommer i tanke om "kør tests og post resultat"
- Du er på vej hjem og vil have agent-doctor til at audit memory
- Asynkrone tasks der ikke kræver din input

**Hvad den er DÅRLIG til (kendt):**
- Tasks der involverer beslutninger undervejs
- Tasks med high blast radius (deploy, migrations, sletninger)
- Tasks hvor du ikke kan verificere outcome når du kommer tilbage

**Anbefalet brug:** Low-risk asynkrone fetches og audits. Aldrig kritiske ændringer.

---

## 4. Det grundige kanal-billede (matrix)

Hver "use case" mapped til den optimale kanal:

| Use case | Optimal kanal | Alternative | Aldrig brug |
|---|---|---|---|
| Læs NOW.md status | Mobil-chat | PC-chat | Cowork (overkill) |
| Tag beslutning om next slice | PC-chat | Mobil-chat | Claude Code |
| Skriv Claude Code-prompt | PC-chat | Mobil-chat | Claude Code |
| Implementer feature (multi-fil) | Claude Code PC1/PC2 | - | Chat, Cowork |
| Bugfix (1 fil) | Claude Code | PC-chat (planning only) | Mobil |
| Investigation / kode-audit | Claude Code (plan mode) | PC-chat (read-only) | Mobil, Cowork |
| Update PatchNotesPage | Cowork (draft) + Claude Code (commit) | Claude Code direkte | Mobil |
| Excel race results import | Cowork (lokalt) + Claude Code (DB) | Claude Code direkte (manuel kopi) | Chat, Mobil |
| Audit memory drift (#78) | Dispatch (asynk) | PC-chat manuel | Mobil direkte |
| Review PR | PC-chat | Mobil-chat (skim) | Claude Code |
| Tjek deploy-status efter push | Mobil-chat (Vercel MCP) | PC-chat | Claude Code (overkill) |
| Generér postmortem efter incident | PC-chat (kontekst-tung) | Claude Code (læser logs) | Mobil, Cowork |
| Strategisk overvejelse (fuld-tid?) | PC-chat (lang dialog) | Mobil-chat (tænk-arbejde) | Claude Code |
| Doc-konsolidering (fx 3 epics → 1) | PC-chat (planning) + Claude Code (commits) | Claude Code direkte | Mobil |
| Tjek "hvor var jeg?" efter pause | Mobil-chat (NOW.md læsning) | Claude Code SessionStart-hook | - |
| Brand-marketing-tekst | PC-chat | Cowork (hvis lokale filer) | Claude Code |

**Det vigtige indsigt:** De fleste tasks involverer 2 kanaler, ikke 1. PC-chat planlægger → Claude Code implementerer er det mest almindelige mønster.

---

## 5. Hvad mangler at gøre verdensklasse (gap-analyse)

Klassificeret efter hvad der allerede er planlagt vs. nye huller:

### A. Allerede planlagt — bare "do the work"

| Hul | Eksisterende issue | Status | Vurdering |
|---|---|---|---|
| Settings.json 3-lag split | #385 | TODO | **DO NOW** — high prio, M effort, blokerer #386 og bootstrap |
| Bootstrap-script ny PC | #386 | TODO | DO efter #385 |
| Settings reconciliation pc1 | #383 | TODO | DO på næste pc1-session |
| Hooks live-verifikation begge PC'er | #455 | TODO | DO efter #383 |
| Skill-portefølje per slice | #388 | TODO | Defer — nice-to-have, L effort |
| Memory frontmatter-fix (2 filer) | #454 | TODO | Trivial — 5 min |
| Cold-start <8K verifikation | #357 | TODO | DO når Phase 1-5 disables er færdige |
| Infisical setup Phase 1 | #339 | TODO (kræver manual) | **DO denne uge** — sikkerhedsrelevant |
| Branch protection + auto-merge | #88 | TODO | DO efter #383 |
| GitHub Projects v2 board | #87 | TODO | DO (10 min, men giver overblik over 186 issues) |
| Time-tracker Phase 2 | #391 | TODO | Defer — Phase 1 (#499) leverer allerede 80% værdi |
| Player-behavior instrumentation | #135 | TODO | **STRATEGIC** — koblet til full-time decision |
| Cron multi-instance | #330 | TODO | Defer indtil >5 brugere (har 17) |
| Loadtest baseline | #331 | TODO | Defer indtil pre-launch |
| Incident playbook | #332 | TODO (Manus) | DO før fuldtidsdrift |

### B. Reelle huller (nye forslag der ikke er dækket)

| # | Forslag | Begrundelse | Effort | Prio |
|---|---|---|---|---|
| B1 | `docs/AI_CHANNEL_ROUTING.md` — kanal-matrix som lov | Ingen kilde dækker hvilken kanal hvilken task. Du beslutter implicit hver gang. Du har 6 kanaler nu. | S | HIGH |
| B2 | `docs/DISPATCH_PLAYBOOK.md` — safe/forbidden tasks | Dispatch er nyt produkt. Du har lært RemoteTrigger den hårde vej (MEMORY.md). Dispatch fortjener samme due diligence FØR du bruger den til kritiske tasks. | S | HIGH |
| B3 | `docs/COWORK_PLAYBOOK.md` — testede use cases | Cowork er installeret(?) men jeg ser ingen brugs-evidens i issues. Risiko: du bruger den ikke fordi mental model er "AI = Claude Code". | M | MED |
| B4 | NOW.md "next-action" felt | Handoff PC1 → mobil → PC2 mangler eksplicit "fortsæt her". Ofte tab af kontekst. | XS | HIGH |
| B5 | "Working agent + channel" felt i NOW.md | Multi-AI claim-mechanism light. Nuværende: claude:todo → claude:done. Mangler: "Claude Code arbejder på dette LIGE NU på PC2". | XS | MED |
| B6 | Konsolider 2 verdensklasse-spor til 1 | Step 2-7 cross-PC plan og Epic #323 er ikke krydsreferencerede. Risiko: arbejde ikke koordineret. | M | HIGH |
| B7 | Prompt-bibliotek `docs/prompts/` | Du har 5-linjers brief i GUARDRAILS som koncept men ikke som genbrugbare templates. | M | MED |
| B8 | Mobil-→-Claude-Code task-templating | Når du planlægger på mobil og PC tager over, mangler standard-format. | XS | MED |
| B9 | "Verdensklasse audit" månedlig skill | Du har enkelte audits (cross-pc-forensic, agent-doctor) men ikke samlet "holistic check". Risiko: drift over uger. | M | LOW |
| B10 | OneDrive secret-folder decommission accelereret | #327 Phase 7 venter på Phase 1-5. Hvis du går fuld-tid, bliver OneDrive-hardlinks fra ikke-OK til kritisk. | M | HIGH (afhænger af fuld-tid timing) |
| B11 | Discord-til-issue bot polish | Du har Discord-rapporter (#449, #452) men ikke automatiseret. Manuel oversættelse koster tid. | M | LOW |
| B12 | "AI Council" meta-doc | Hvis du bruger Manus + Codex + Claude reelt — hvilken AI ejer hvilken type beslutning? Det er dokumenteret i #323 men ikke som standalone reference. | S | MED |

### C. Hvad du IKKE skal gøre (proaktivt anti-forslag)

| # | Anti-forslag | Begrundelse |
|---|---|---|
| C1 | Sync `~/.claude/` mellem PC'er | Du har planlagt at SLETTE OneDrive `claude-settings/` i #385. Don't reverse course. |
| C2 | Migrér til Cursor/Aider/anden AI-IDE | Du har stærk Anthropic-stack. Switching cost > marginal gain. |
| C3 | Indfør "AI flertal-stemme" | Du er solo-dev. Manus/Claude/Codex som 3 specialiserede roller > "council". |
| C4 | Custom orkestrationslag (oven på GitHub) | GitHub som koordineringslag fungerer. Mere abstraktion = mere fragilitet. |
| C5 | Cron multi-instance NU | Du har 17 brugere. Single-instance virker. Defer indtil >100 active. |
| C6 | Skill-portefølje per slice (#388) NU | Token-besparelse er marginal (500-1500 tok). Andre ting har højere ROI. |
| C7 | Player-behavior instrumentation (#135) som DX-task | Det er PRODUCT, ikke DX. Behandl det som product-roadmap, ikke AI-ops. |
| C8 | Time-tracker Phase 2 (#391) NU | Phase 1 leverer 80% værdi. Diminishing returns. |
| C9 | OneDrive → fjernet helt | Du bruger den til mere end secrets (context-sync, hardlinks). Decommission KUN secret-folder. |
| C10 | Tilføj mere automation før eksisterende er testet | Du har 6 åbne issues om "verificér at hooks virker" (#454, #455). Test før build. |

---

## 6. Det grundige anbefalede roadmap (prioriteret)

### Fase A — Denne uge (5 issues, ~6-8 timer total)

**Mål:** Få cross-PC reproducibility til 100%. Det er fundamentet for alt andet.

1. **#383** — Cross-PC settings.json reconciliation (~2h, Claude Code PC1) — **BLOKERER alt andet**
2. **#385** — Settings.json 3-lag split + path-audit (~1h, efter #383) — **BLOKERER #386**
3. **#454** — Memory frontmatter (~5 min) — trivial cleanup
4. **#455** — Live-verifikation hooks begge PC'er (~30 min, kræver brugerens test)
5. **#339** — Infisical Phase 1 (kun manual del, ~30 min) — sikkerhedsrelevant

**Hvorfor først:** Indtil cross-PC er solid, er enhver anden investering ustabil. Det er hvad #383→#385→#455 cementer.

### Fase B — Næste 2 uger (4 nye issues + 2 eksisterende)

**Mål:** Dokumentér kanal-routing og lukke "hvor var jeg?"-friktion.

6. **NY: B1** — `docs/AI_CHANNEL_ROUTING.md` (~1h)
7. **NY: B4** — NOW.md "next-action" felt + B5 "working agent" felt (~30 min docs + GUARDRAILS update)
8. **NY: B2** — `docs/DISPATCH_PLAYBOOK.md` (~1h) — DO FØR du bruger Dispatch i produktion
9. **NY: B8** — Mobil-→-Code task-templating (~30 min, lille)
10. **#386** — Bootstrap-script ny PC (~2h, kan deferes hvis ikke ny PC venter)
11. **#88** — Branch protection + auto-merge (~30 min)

### Fase C — Næste måned (3 issues)

**Mål:** Konsolidering + nye AI-kanal-test.

12. **NY: B6** — Konsolider Step 2-7 + Epic #323 til ét roadmap (~2-3h)
13. **NY: B3** — `docs/COWORK_PLAYBOOK.md` med 3 testede use cases (~2-4h, inkl. testing)
14. **NY: B7** — Prompt-bibliotek MVP (3 templates: bugfix, investigation, postmortem) (~2h)
15. **#87** — GitHub Projects v2 board (~30 min)

### Fase D — Næste kvartal (3-4 issues)

**Mål:** Verdensklasse-niveau aspekter der kræver længere soak-tid.

16. **NY: B12** — AI Council meta-doc (~1h)
17. **NY: B9** — Månedlig verdensklasse-audit (~3h script)
18. **#388** — Skill-portefølje per slice (KUN hvis cold-start stadig >8K efter #357 verificeret)
19. **#332** — Fuldtidsdrift incident playbook (Manus opgave)

### Anti-roadmap (gør IKKE i Q3 2026)

- Cron multi-instance (#330) — vent på >100 brugere
- Loadtest baseline (#331) — vent på pre-launch
- Redis cache (#334) — vent på loadtest fund
- Player-behavior instrumentation (#135) som DX — behandl som product

---

## 7. GitHub setup-vurdering

Brugerens spørgsmål: "GitHub opsætning skal også være verdensklasse"

### Hvad du allerede har (verdensklasse-niveau)

- Label-system med 5 dimensioner: priority, type, risk, category, agent, status
- Issue-templates med "Claude-instruks" sektion (set i #517, #518)
- Sub-issues (`GitHub:sub_issue_write` virker)
- Multi-AI assignment via labels (`agent:claude`, `agent:codex`)
- Verifikations-gate (`needs-user-action`)
- Auto-bot der posterer sundhed (#346)
- Quality Inbox (gh-actions → issue-comments)
- Auto-delete merged branches (per MEMORY.md)
- Postmortem-format dokumenteret (`.claude/learnings/`)
- PatchNotes obligatorisk regel (GUARDRAILS_CORE.md)

### Hvad mangler

- **GitHub Projects v2 board** (#87 åben, ikke gjort) — 186 issues uden kanban er praktisk umuligt at navigere
- **Branch protection rules** (#88 åben) — main kan brækkes uden review
- **Issue-templates som .github/ISSUE_TEMPLATE/** — du har implicit format men ikke håndhævet
- **Saved searches/filters** — søgning på "claude:todo high priority not security" er hyppig men ikke gemt
- **Milestones** — du har epics som labels, ikke milestones. Milestones giver visuel progress-bar
- **CODEOWNERS** — multi-AI workflow ville have gavn af at signalere "Claude reviewer denne fil-pattern"
- **GitHub Actions workflow templates** — du har #530 (workflow-template) som åben issue
- **PR-templates** — set i #538 "Brugerverifikation efter ship"-pattern, men ikke i `.github/PULL_REQUEST_TEMPLATE.md`

### GitHub-specifikke forslag (12 nye, hvoraf G1, G2, G8 allerede er tracked)

| # | Forslag | Effort | Prio |
|---|---|---|---|
| G1 | Aktivér #87 Projects v2 board | XS | HIGH |
| G2 | Aktivér #88 branch protection | XS | HIGH |
| G3 | Opret `.github/ISSUE_TEMPLATE/` (bugfix, feature, investigation, security) | S | MED |
| G4 | Opret `.github/PULL_REQUEST_TEMPLATE.md` med Brugerverifikation-sektion | S | MED |
| G5 | Opret `CODEOWNERS` der mapper file patterns → AI-rolle | S | LOW |
| G6 | Milestones for hver fase af #323 og verdensklasse-plan | XS | MED |
| G7 | Saved searches dokumenteret i `docs/GITHUB_WORKFLOW.md` | XS | LOW |
| G8 | GitHub Actions workflow template (per #530) | S | MED |
| G9 | "Quality Inbox" → label tilbage til kilde-issue | S | LOW |
| G10 | GitHub Discussions for "AI feedback til AI" patterns | S | LOW |
| G11 | GitHub repo description + topics opdateret med "AI-first" | XS | LOW |
| G12 | Repo README opdateret med "How AIs work here" sektion | M | LOW |

---

## 8. Multi-AI realitet: Manus + Codex + Claude

Brugeren nævner i prompt at primært Claude bruges. Lad mig være ærlig om hvad det betyder:

### Hvis "Claude primært" i praksis

**Implikation:** Brugeren bruger Manus til strategiske docs (#327, #332) og Codex til hurtige fixes (#324, #329) som **specialer**, mens Claude bærer 80%+ af volumen.

**Optimal fordeling:**
- **Claude:** Backend implementation, frontend implementation, runtime-kontrakter, debugging, postmortems
- **Codex:** QA-runs, docs-afstemning, test-coverage, hurtige bugs (5-15 min)
- **Manus:** Strategiske ADRs, platform-beslutninger, secret management, incident playbooks

**Hvad det betyder for routing:**
- 90% af "claude:todo" forbliver Claude
- "agent:codex" labels for tasks der er <30 min og kan auto-merge på risk:low
- "agent:manus" KUN for tasks med "ADR-leverance før kode"

### Hvis Manus/Codex er bremset eller forsinket

**Praktisk fund baseret på issues:** #327 (Manus ADR) er åben siden 2026-05-12. Det er 10 dage. Hvis Manus ikke har leveret, blokerer det #339 (Infisical Phase 1) som blokerer #327 Phase 2-5.

**Forslag:** Sæt deadlines pr. agent-role. Hvis Manus ikke leverer ADR inden X dage → reassign til Claude. Det er hvad "AI Council"-doc skal definere (B12).

### Brug `agent:codex` mere aggressivt

For tasks der er:
- <30 min effort
- risk:low
- Ikke kræver beslutning (kun execution)

Eksempler fra åbne issues:
- #454 (memory frontmatter) → codex (5 min)
- #377 (ESLint warning debt) → codex (har allerede `agent:codex` label)
- #547 (stale root-filer cleanup) → codex (30 min)

Claude tager: arkitektur-beslutninger, alle bugs der ikke er trivielle, alle features.

---

## 9. Cowork specifikt — hvor passer den ind?

### Cowork i CyclingZone-kontekst — top 5 use cases

**1. Patch notes-draft (HIGH værdi)**
- Trigger: efter PR merged
- Input: `git log <last-tag>..main` + commit messages
- Output: draft `PatchNotesPage.jsx`-entry
- ROI: 2-5 min sparet per PR × ~3-5 PRs/uge = 10-25 min/uge

**2. Excel race results → CSV (MED værdi)**
- Trigger: ny race-uge
- ROI: 15-30 min sparet per race-uge

**3. Discord feedback → struktureret backlog (MED værdi)**
- Trigger: når du har samlet 5-10 stk feedback i Discord
- ROI: 30-60 min/uge

**4. Postmortem-formatering (LAV værdi)**
- ROI: 10-15 min/incident (måske 1/måned)

**5. Brand-marketing kopi (LAV værdi, contextual)**

**Total potentiel besparelse:** ~30-90 min/uge når den kører pålideligt.

### Risici ved Cowork-adoption nu

1. **"Research preview"-status** — funktionalitet kan ændre sig
2. **Filsystem-adgang er kraftfuld** — giv KUN specifikke foldere, aldrig hele OneDrive
3. **Ingen Cowork-erfaring i issues** — start med low-risk task (#1 patch notes)

### Cowork-onboarding (foreslået)

1. **Uge 1:** Test #1 patch notes-draft. Mål: 1 succesfuld kørsel.
2. **Uge 2:** Hvis #1 virker, test #2 Excel-import.
3. **Uge 3:** Hvis #1+#2 virker, skriv `docs/COWORK_PLAYBOOK.md`.
4. **Uge 4:** Beslut: keep / drop.

---

## 10. Mobil-arbejde specifikt

### Top 10 mobil-use cases

1. Check NOW.md mens du venter
2. Læs Discord-feedback
3. Tag beslutning om next slice
4. Generér Claude Code-prompt
5. Læs PR-status
6. Dispatch en audit
7. Skim seneste agent-doctor rapport (#346)
8. Læs en åben investigation-issue før møde
9. Strategi-samtale om full-time/marketing/branding
10. Tjek Vercel deploy-status efter push

### Mobil anti-patterns

1. Skriv 200-linjers kode
2. Multi-fil diff review
3. Lange terminal-output
4. Sensitive operations (deploy, migrate, delete)

### Mobil-optimerings-forslag

**M1: "Mobile-friendly response" preferences** — du har dette aktivt. Behold det.

**M2: Quick-actions på mobil** — gem prompts som "templates" der kan tappes:
- "Status check": læs NOW.md + agent-doctor seneste + top 3 åbne high-prio
- "Discord ingest": kopier link → forslag til issues
- "Dispatch tests": kør backend tests + post resultat

**M3: Voice input** — hvis du dikterer, sæt `userPreferences` til "tolerér typos, fortolk intent".

---

## 11. Verdensklasse vs. "bare godt"

### Verdensklasse-kriterier (8 dimensioner)

1. **Reproducibility** — ny dev/AI/PC kan onboarde fra git clone på <30 min
2. **Observability** — du kan svare "hvor står X?" inden for 1 minut uden at åbne kode
3. **Reversibility** — enhver ændring kan rulles tilbage uden datatab
4. **Routing-klarhed** — du ved hvilken kanal/AI hvilken task hører til uden at tænke
5. **Compound learning** — fejl bliver til regler, ikke gentages
6. **Asynkron arbejde** — du kan komme tilbage efter 1 uge og være produktiv på 5 min
7. **Multi-environment** — PC1, PC2, mobil giver konsistent oplevelse
8. **Trust budget** — du stoler på at automation-systemet ikke vil ødelægge produktion

### Hvor brugeren står (mit gæt)

| Dimension | Score | Begrundelse |
|---|---|---|
| 1. Reproducibility | 6 | #386 mangler. Bootstrap er manuel. |
| 2. Observability | 8 | NOW.md, agent-doctor, time-tracker. Solidt. |
| 3. Reversibility | 9 | Git-disciplin, postmortems, rollback-patterns. Verdensklasse. |
| 4. Routing-klarhed | 4 | Du har implicit viden. Ingen `AI_CHANNEL_ROUTING.md`. **Største hul.** |
| 5. Compound learning | 9 | `.claude/learnings/` + MEMORY.md + GUARDRAILS. Verdensklasse. |
| 6. Asynkron arbejde | 7 | NOW.md 30-linje + soak-gate. Mangler "next-action"-felt. |
| 7. Multi-environment | 5 | PC1/PC2 i gang via #383/#385. Mobil ikke optimeret. Cowork ikke testet. |
| 8. Trust budget | 8 | Hooks + permissions.deny + auto-merge gates. Næsten verdensklasse. |

**Sammenlagt: 56/80 = 70% verdensklasse.**

### De 3 ting der vil flytte mest mod verdensklasse

1. **Lukke routing-hullet** (B1, B2, B3, B4, B5) → flytter dim 4 fra 4 til 9, dim 7 fra 5 til 8. **Estimat: 4-6 timer.**
2. **Lukke cross-PC reproducibility** (#383, #385, #386, #455) → flytter dim 1 fra 6 til 10, dim 7 fra 5 til 9. **Estimat: 6-10 timer.**
3. **Konsolider 2 verdensklasse-roadmaps til 1** (B6) → flytter koordinering fra implicit til eksplicit. **Estimat: 2-3 timer.**

**Total til verdensklasse-niveau: 12-19 timer.**

---

## 12. Skeptiske noter (hvor jeg ikke er sikker)

1. **Cowork er installeret?** Jeg har set ingen brugs-evidens i issues eller MEMORY. Verificér på PC.
2. **Manus' faktiske aktivitet:** #327 åben siden 2026-05-12 uden ADR-doc. Er Manus stadig aktiv?
3. **Codex' faktiske aktivitet:** Jeg ser `agent:codex` på #377, #524. Bruges Codex aktivt, eller er det aspirational?
4. **Step 2-7 plan vs Epic #323:** Det ARKIVEREDE plan-dokument er måske superseded af Epic #323. Verificér.
5. **Mine effort-estimater:** ±50% off på flere af dem. Claude Code kan refinere.
6. **`docs/AI_OPS_TOKEN_BUDGET.md` overlap:** Ikke set indholdet. Hvis det dækker B7 eller B1, fjern duplikater.
7. **Mobil-app preferences:** Verificér konsistens.
8. **Sentry DSN warning** (#346) — produkt-observability ikke AI-ops, men højere prio end nogen workflow-forbedring.

---

## 13. Anbefalet handling FOR Claude Code-sessionen

Kære Claude Code-session,

**Trin 1:** Læs alle 15 filer listet under sektion 0 "Hvad jeg STADIG ikke har set" først. Krydsreferér deres indhold mod mine 12+12 forslag (B1-B12 og G1-G12).

**Trin 2:** For hvert forslag, klassificér:

- **A** (lav som ny issue) — der er reelt hul
- **B** (merge til eksisterende issue) — overlap med #XX, supplér med detaljer
- **C** (drop) — duplikat eller ikke værdifuldt
- **D** (modificer scope) — koncept er rigtigt men formulering ikke ideal

**Trin 3:** Opdater tracking-issue **#555** med din klassificering. Format:

```
B1: A — vil oprette som ny issue med labels: claude:todo, type:docs, priority:high, cat:ai-ops, epic:ai-workflow
B2: A — vil oprette
B3: D — scope reduceres til kun patch notes test først
...
B12: B (#X) — merge til eksisterende AI-roller-doc
G1: C — allerede tracked i #87
G2: C — allerede tracked i #88
...
```

**Trin 4:** For forslag klassificeret som A: opret som GitHub issue med korrekt label-set baseret på Nicolais label-konvention.

**Trin 5:** For forslag klassificeret som B: post comment på eksisterende issue der refererer #555 og foreslår scope-udvidelse.

**Trin 6:** For C og D: opdater #555 med kort forklaring.

**Trin 7:** Foreslå en revideret prioritering hvis du har bedre information end mig.

**Trin 8 (vigtigt):** Når du er færdig med klassificering og issue-oprettelse, merge denne branch (`claude/workflow-analyse-2026-05-22`) til main så `docs/archive/2026-05-22-workflow-analyse.md` er permanent gemt. Tilføj note til `MEMORY.md` om at denne analyse eksisterer og dens placering.

---

## 14. Slutnoter

### Det vigtigste i én sætning

Brugeren har 70% af et verdensklasse-setup. De resterende 30% kommer primært ved at lukke routing-hullet (kanal-matrix + dispatch playbook + cowork onboarding + NOW.md next-action) og fuldføre cross-PC reproducibility (#383→#385→#386→#455). Alt andet er nice-to-have.

### Proaktivt spotlight (uden for workflow)

**Sentry uden DSN** er en real produktion-blocker. Hvis Cycling Zone har 17 brugere nu og sigter mod 5-10K, så vil incidenter ske, og uden Sentry har du ingen observability. Det burde være højere prio end nogen workflow-forbedring.

Specifikt: Sæt `SENTRY_DSN` på Railway + `VITE_SENTRY_DSN` på Vercel (per #346 og #348). Det er en 15-minutters task der låser op for incident-response-kapacitet.

### Brugerens prioriterede handling

1. **I dag:** Sentry DSN på Railway + Vercel (15 min)
2. **Denne uge:** #383 + #385 + #455 (cross-PC stabilitet)
3. **Næste uge:** B1 + B4 + B5 (routing-matrix + NOW.md felter)
4. **Næste 2 uger:** B2 + B3 (Dispatch + Cowork playbooks)
5. **Næste måned:** B6 (konsolidér 2 verdensklasse-spor → 1)
6. **Resten:** Defer eller drop per mine anti-forslag (C1-C10)

---

## Appendix A: 24 foreslåede issues i kort form

**B-forslag (routing og workflow):**
1. B1: `[docs] AI_CHANNEL_ROUTING.md — eksplicit kanal-task-matrix`
2. B2: `[docs] DISPATCH_PLAYBOOK.md — safe/forbidden tasks før dispatch-adoption`
3. B3: `[docs+test] COWORK_PLAYBOOK.md — 3 testede use cases for Cycling Zone`
4. B4: `[docs] NOW.md "next-action" felt for cross-device handoff`
5. B5: `[docs] NOW.md "working agent + channel" felt for multi-AI claim`
6. B6: `[meta] Konsolidér Step 2-7 plan + Epic #323 til ét roadmap`
7. B7: `[docs] Prompt-bibliotek docs/prompts/ — 3 startemplates`
8. B8: `[docs] Mobil→Claude-Code task-templating`
9. B9: `[automation] Månedlig verdensklasse-audit-skill`
10. B10: `[security] OneDrive secret-folder decommission acceleration`
11. B11: `[automation] Discord-til-issue bot polish`
12. B12: `[docs] AI Council meta-doc — Manus/Codex/Claude roles`

**G-forslag (GitHub setup):**
1. G1: Aktivér #87 Projects v2 board (already open, gør den)
2. G2: Aktivér #88 branch protection (already open, gør den)
3. G3: `[github] Issue-templates i .github/ISSUE_TEMPLATE/`
4. G4: `[github] PR-template med Brugerverifikation-sektion`
5. G5: `[github] CODEOWNERS med AI-rolle file-patterns`
6. G6: `[github] Milestones for Epic #323 faser`
7. G7: `[github] Saved searches dokumenteret`
8. G8: Already tracked via #530 — workflow template
9. G9: `[github] Quality Inbox → label tilbage til kilde-issue`
10. G10: `[github] GitHub Discussions for AI-til-AI feedback`
11. G11: `[github] Repo description + topics opdateret`
12. G12: `[github] README med "How AIs work here" sektion`

---

**Slut på analyse.**
**Tracking-issue:** #555
**Branch:** `claude/workflow-analyse-2026-05-22`
**Næste skridt:** Claude Code-session læser dette, klassificerer 24 forslag, og opretter godkendte som issues.
