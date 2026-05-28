# Verdensklasse-roadmap — konsolideret AI/Ops + skalerings-spor

> **Status:** v1 etableret 2026-05-22 per [#560](https://github.com/NicolaiDolmer/CyclingZone/issues/560).
> Konsoliderer to parallelle "verdensklasse"-spor til ét roadmap så koordinering bliver eksplicit.

## Hvorfor denne doc eksisterer

CyclingZone har drevet **to parallelle "verdensklasse"-spor** uden konsistent cross-referencing:

1. **Track A — Token-reduktion + cross-PC reproducibility** ("Step 1-7" / Phase 0-5)
   - Kilde-plan: [`docs/archive/plans/2026-05-14-ai-setup-world-class-plan.md`](archive/plans/2026-05-14-ai-setup-world-class-plan.md)
   - P0 2026-05-28: [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605) samler AI World-Class v2 + token-friendly agent setup. Aktuel måling: Claude ~19.6K tok, Codex ~24.3K tok, harness ~14.8K tok, memory-dir ~69K tok.
2. **Track B — [Epic #323](https://github.com/NicolaiDolmer/CyclingZone/issues/323) 4-fase skalerings-roadmap**
   - Mål: produktion klar til 5.000-10.000 brugere + fuldtidsdrift fra 2026-06-01

Workflow-analyse 2026-05-22 sektion 2 ([arkiv](archive/2026-05-22-workflow-analyse.md)) fandt: **"Det er det vigtigste enkelte fund."** Risiko ved 2 ukoordinerede spor = overlap missed, dependencies usynlige, prioritering inkonsistent.

Denne doc er **én tabel** der mapper begge spor + overlap-section + anbefalet eksekvering.

---

## Track A — Token-reduktion + cross-PC reproducibility

Step-numrene stammer fra `2026-05-15`-planlægning refereret i issue-bodies (#385, #386, #388). Step 5 og 6 er **aldrig nummereret som issues** — sandsynligvis foldet ind i sibling-issues eller dropped. Hvis du møder reference til "Step 5/6", behandl som ikke-eksisterende og spørg.

| Step | Issue | Titel | Status | Owner | Effort | Blocker |
|---|---|---|---|---|---|---|
| 1 | [#356](https://github.com/NicolaiDolmer/CyclingZone/issues/356) | AI Ops: Disable ubrugte plugins/skills | ✅ CLOSED | Claude | S | — |
| 2 | [#385](https://github.com/NicolaiDolmer/CyclingZone/issues/385) | Settings.json 3-lag split + path-audit forward-guard | ✅ CLOSED, `claude:done` | Claude | M (~1h) | — |
| 3 | [#385](https://github.com/NicolaiDolmer/CyclingZone/issues/385) | (samme issue som Step 2 — path-audit del) | ✅ CLOSED, `claude:done` | Claude | (M, inkl.) | — |
| 4 | [#386](https://github.com/NicolaiDolmer/CyclingZone/issues/386) | Bootstrap-script til ny PC | 🟡 OPEN, lav-prio | Claude | M (~2h + VM-test) | Afhænger af #385 |
| 5 | — | (ikke nummereret) | n/a | n/a | n/a | n/a |
| 6 | — | (ikke nummereret) | n/a | n/a | n/a | n/a |
| 7 | [#388](https://github.com/NicolaiDolmer/CyclingZone/issues/388) | Skill-portefølje per slice (dynamisk `enabled-skills.json`) | 🟡 OPEN, med-prio | Claude | L (~3h) | Afhænger af #356 ✅, #357 |

**Tilknyttede Track A-issues uden Step-nummer:**

| Issue | Titel | Status | Owner | Effort | Blocker |
|---|---|---|---|---|---|
| [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605) | P0 AI World-Class v2 — token-friendly agent setup | 🔴 P0 OPEN | Claude/Codex | M-L | Samler #357/#355/#388/#658 |
| [#383](https://github.com/NicolaiDolmer/CyclingZone/issues/383) | Cross-PC settings.json reconciliation + hook scripts commit (pc1) | ✅ CLOSED, `claude:done` | Claude | M (~2h) | — |
| [#455](https://github.com/NicolaiDolmer/CyclingZone/issues/455) | DX: live-verifikation af nye hooks på begge PCs (efter #453) | 🟡 OPEN, med-prio | Codex/Claude | S (~30min) | Kræver brugerens test på begge PCs |
| [#357](https://github.com/NicolaiDolmer/CyclingZone/issues/357) | Verificér Phase 1-3 cold-start <8K + canary-regression | 🟡 OPEN | Claude | S (~30min) | Phase 2+3 disables færdige |

**Track A — overordnet status:** P0 token-sporet er genåbnet via #605, fordi runtime-baseline 2026-05-28 stadig fejler cold-start: Claude ~19.6K, Codex ~24.3K, harness ~14.8K, memory-dir ~69K. Cross-PC settings #383/#385 er runtime-verificeret lukket; #386/#455 står tilbage.

---

## Track B — Epic [#323](https://github.com/NicolaiDolmer/CyclingZone/issues/323) skalerings-roadmap

| Fase | Issue | Titel | Status | Owner | Effort | Blocker |
|---|---|---|---|---|---|---|
| **0** | [#324](https://github.com/NicolaiDolmer/CyclingZone/issues/324) | Gør AI/release baseline reel og verificerbar | 🟡 OPEN, høj-prio | Codex | M | Lokale hooks aktivering + drift-monitor-fix |
| **1** | [#325](https://github.com/NicolaiDolmer/CyclingZone/issues/325) | Supabase audit helpers og runtime-drift til grønt | ✅ CLOSED | Claude | L | — |
| **1** | [#326](https://github.com/NicolaiDolmer/CyclingZone/issues/326) | Afstem AI/Ops roadmap med runtime-status | ✅ CLOSED | Codex | S | — |
| **2** | [#327](https://github.com/NicolaiDolmer/CyclingZone/issues/327) | Professionel secret management væk fra OneDrive-hardlinks | 🟡 OPEN, claude:done-flagged, høj-prio | Manus (ADR) → Claude/Codex (impl) | L | ADR-doc + #339 (Infisical setup) |
| **2** | [#328](https://github.com/NicolaiDolmer/CyclingZone/issues/328) | Rate limiting og abuse protection | ✅ CLOSED | Claude | L | — |
| **2** | [#329](https://github.com/NicolaiDolmer/CyclingZone/issues/329) | Playwright smoke-tests og light visual regression | ✅ CLOSED | Codex | M | — |
| **3** | [#330](https://github.com/NicolaiDolmer/CyclingZone/issues/330) | Cron ud af webserveren + job-locking multi-instance | 🟡 OPEN, høj-prio | Claude | L | Defer til >100 brugere (har 17, beta) |
| **3** | [#331](https://github.com/NicolaiDolmer/CyclingZone/issues/331) | Loadtest og DB performance baseline | 🟡 OPEN, med-prio | Codex (PR) + Claude (follow-ups) | M | Defer til pre-launch |
| **3** | [#333](https://github.com/NicolaiDolmer/CyclingZone/issues/333) | Supabase Realtime WebSockets som primær live-kanal | 🟡 OPEN, høj-prio | Claude (design) + Codex (frontend-switch) | L | needs-contract |
| **3** | [#334](https://github.com/NicolaiDolmer/CyclingZone/issues/334) | Redis/in-memory cache for hyppigt læste endpoints | ✅ CLOSED | Claude | M | — |
| **4** | [#332](https://github.com/NicolaiDolmer/CyclingZone/issues/332) | Fuldtidsdrift incident playbook + backups + cost model | 🟡 OPEN, med-prio | Manus | M | needs-decision |

**Track B — overordnet status:** Phase 1 ✅ komplet · Phase 2 nær-komplet (kun #327 secret-mgmt impl udestående) · Phase 0 åben · Phase 3 mixed (2 closed + 3 open) · Phase 4 åben.

---

## Overlap mellem Track A og Track B

Identificerede berørings-punkter hvor arbejde i ét spor blokerer eller accelererer det andet:

### 1. Lokale hooks-aktivering — Track A #383 ↔ Track B #324 (Phase 0)

**Overlap:** #324 (Phase 0) siger eksplicit: *"Aktivér lokale hooks på denne PC og dokumentér/verify cross-PC setup"*. Det er præcis hvad #383 + #455 leverer.

**Beslutning:** Behandl #383 + #455 som **Track A-implementation der lukker Track B's #324 hook-aktiverings-AC.** Når begge er færdige, kan #324 lukke sin del af AC.

### 2. Secret management — Track A cross-PC setup ↔ Track B Phase 2 (#327, #339)

**Overlap:** `docs/CROSS_PC_SETUP.md` (Track A-leverance) refererer Infisical som **fremtidig erstatning** af OneDrive-hardlinks. Track B's #327 ejer den faktiske migration. #339 (Infisical Phase 1) er forudsætning for at fjerne OneDrive-secret-folder.

**Beslutning:** **Track B ejer secret-mgmt-arbejdet.** Track A's cross-PC bootstrap (#386) skal vente med at fjerne OneDrive-secret-link indtil #327 + #339 er færdige. Tidsmæssigt: [#563](https://github.com/NicolaiDolmer/CyclingZone/issues/563) (B10 acceleration) er flaget som høj-prio før fuldtid 2026-06-01.

### 3. Skill/plugin management — Track A Step 1 (#356) ↔ Track A Step 7 (#388)

**Overlap:** Intern Track A-overlap. Step 1 (statisk disable) er foundation; Step 7 (dynamisk per-slice) er evolution. Begge bidrager til cold-start-mål.

**Beslutning:** Step 7 (#388) styres nu af #605. Dynamic skills skal kun bygges hvis P0-baselinen viser >500 tok realistisk gevinst efter lavere-risiko trims.

### 4. Cold-start verifikation — Track A #357/#605 ↔ alt andet

**Overlap:** #357 var Track A's leverance-bevis, men #605 er nu P0-masteren der både måler, prioriterer og lukker gap'et. Baseline 2026-05-28 viser at <8K ikke er et realistisk close-out-gate, fordi harness alene er ~14.8K.

**Beslutning:** **Kør #605 NU.** #357, #355, #388 og #658 er child/follow-up spor under #605 og skal ikke eksekveres uafhængigt.

---

## Anbefalet eksekvering (kombineret)

Prioriteret rækkefølge efter blocker-analyse + ROI:

### Fase P0 — AI World-Class v2 token-friendly setup (nu)

1. **[#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605)** — Mål baseline, trim HOT context, reducer user-controllable harness/load, etabler watchdog og kør quality-canaries.
2. **[#357](https://github.com/NicolaiDolmer/CyclingZone/issues/357)** / **[#355](https://github.com/NicolaiDolmer/CyclingZone/issues/355)** / **[#388](https://github.com/NicolaiDolmer/CyclingZone/issues/388)** / **[#658](https://github.com/NicolaiDolmer/CyclingZone/issues/658)** — behandles som child-spor under #605.

### Fase X1 — Cross-PC stabilitet (denne uge, blokerer det meste)

1. **[#383](https://github.com/NicolaiDolmer/CyclingZone/issues/383)** — Closed, afventer kun evt. bruger-verifikation
2. **[#385](https://github.com/NicolaiDolmer/CyclingZone/issues/385)** — Closed, afventer kun evt. bruger-verifikation
3. **[#455](https://github.com/NicolaiDolmer/CyclingZone/issues/455)** — Live-verifikation hooks begge PCs (~30 min, kræver brugerens test)
4. **[#386](https://github.com/NicolaiDolmer/CyclingZone/issues/386)** — Bootstrap-script ny PC (~2h + VM-test) — DEFER hvis ingen ny PC venter

Når disse er færdige, kan #324 (Track B Phase 0) sandsynligvis også lukkes (overlap-punkt 1).

### Fase X2 — Secret management decommission (før fuldtid 2026-06-01)

5. **[#339](https://github.com/NicolaiDolmer/CyclingZone/issues/339)** — Infisical Phase 1 (manuel ~30 min)
6. **[#327](https://github.com/NicolaiDolmer/CyclingZone/issues/327)** — Komplet secret-mgmt migration (efter ADR-doc, L)
7. **[#563](https://github.com/NicolaiDolmer/CyclingZone/issues/563)** — OneDrive secret-folder decommission (efter #327, M)

### Fase X3 — Bootstrap-script + nice-to-have (efter X1+X2)

8. **[#388](https://github.com/NicolaiDolmer/CyclingZone/issues/388)** — Skill-portefølje per slice (~3h) — kun hvis #605 viser ROI nok

### Fase X4 — Skalerings-spor (post-MVP-validation, primært Q3 2026)

10. **[#333](https://github.com/NicolaiDolmer/CyclingZone/issues/333)** — Supabase Realtime (høj-prio men har soak-tid)
11. **[#332](https://github.com/NicolaiDolmer/CyclingZone/issues/332)** — Fuldtidsdrift playbook (Manus-leverance før fuldtid)
12. **[#330](https://github.com/NicolaiDolmer/CyclingZone/issues/330)** — Cron multi-instance (DEFER til >100 brugere)
13. **[#331](https://github.com/NicolaiDolmer/CyclingZone/issues/331)** — Loadtest baseline (DEFER til pre-launch)

---

## Track-A Step 5/6 — uløst nummerering

Step 5 og 6 i Track A er aldrig opstået som GitHub-issues. Sandsynligvis:
- **Step 5** = potentielt **MCP-disable** (matcher Phase 2 i den arkiverede plan) — ikke længere relevant da MCP-styring sker via `/mcp` interaktivt
- **Step 6** = potentielt **Hooks/docs trim** (Phase 4) — er allerede landet via [#382](https://github.com/NicolaiDolmer/CyclingZone/issues/382) og CLAUDE.md slankning

Hvis du ser fremtidig reference til Step 5 eller 6: behandl som **historisk artefakt**, ikke missing-work. Ingen action.

---

## Vedligeholdelse

Denne doc opdateres når:
- En af de listede issues lukkes → flyt til ✅ + opdater Track-status-sum
- Ny issue oprettes der peger ind i en af de to tracks → tilføj som række
- Overlap-punkter ændrer ejer eller blocker → opdatér relevant overlap-section
- Et nyt Track (fx Track C) tilføjes — kun hvis det er reelt parallelt og ikke kan foldes ind i A eller B

**Kilde-sandhed:** GitHub issue-bodies + epic-comments. Denne doc er aggregat, ikke source of truth — verificér ved tvivl.

## Cross-references

- Workflow-analyse: [`docs/archive/2026-05-22-workflow-analyse.md`](archive/2026-05-22-workflow-analyse.md) sektion 2
- Track A kilde: [`docs/archive/plans/2026-05-14-ai-setup-world-class-plan.md`](archive/plans/2026-05-14-ai-setup-world-class-plan.md)
- Track B kilde: [Epic #323](https://github.com/NicolaiDolmer/CyclingZone/issues/323)
- Cross-PC praktisk runbook: [`docs/CROSS_PC_SETUP.md`](CROSS_PC_SETUP.md)
- Token budget regler: [`docs/AI_OPS_TOKEN_BUDGET.md`](AI_OPS_TOKEN_BUDGET.md)
- Tracker for denne consolidation: [#560](https://github.com/NicolaiDolmer/CyclingZone/issues/560)
