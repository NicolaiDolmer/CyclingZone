# Plan: Samlet prioritering af alle åbne GitHub-issues

## Kontekst

CyclingZone står 4 dage før **30-dages Monetization Validation Sprint** (2026-05-18 → 2026-06-17). Brugerens langsigtede mål er fuldtid på CyclingZone (~14k DKK/md gross som første milestone). Repoet har **150 åbne issues** uden samlet prioriteret view — kun sprint-validation-bucket (#359-#367) er i fokus i SPRINT_DASHBOARD, og AI/Ops token-reduktion kører parallelt som "aktiv slice" per NOW.md.

Brugeren beder om en kategoriseret prioritering på 3 akser (værdi/tid/blocker) der gør det muligt at:
1. Vide hvad der skal gøres uge 21-24 (sprint) vs. juni-juli (post-sprint) vs. senere
2. Identificere top-10 highest-leverage issues for fuldtidsmålet
3. Foreslå luk-kandidater (separat liste, bruger har veto)
4. Flagge konflikter med aktivt sprint

## Issue-landskab (verificeret 2026-05-14)

| Bucket | Count | Note |
|---:|---:|---|
| Total åbne | **150** | |
| `claude:todo` | 141 | Workflow-state, ikke prioritet |
| `priority:high` | 26 | Førsteklasses prioriteringskandidater |
| `priority:med` | 75 | Default — kræver per-issue læsning |
| `priority:low` | 49 | Default-bucket for "senere" + luk-kandidater |
| `sprint-validation` | 9 | Sprint-låst — uge 21-23 |
| `epic:quality-hardening` | 15 | Infrastruktur-spor, halv-aktivt |
| `epic:ai-workflow` | 11 | Overlap med aktiv slice (AI/Ops token-reduktion) |
| `epic:economy-overhaul` | 5 | Slice 07 komplet — er disse efterveer? |
| `needs-ai-triage` | 9 | Ikke-kategoriseret — kategorisér selv |
| `claude:done` | 9 | Færdig-flag — luk-kandidater (bruger lukker selv) |
| `needs-decision` | 8 | Bruger-blokerede beslutninger |
| `needs-user-action` | 10 | Bruger-blokerede aktioner |

## Prioriteringsramme (3 akser)

### 1. Værdi-akse (ordnet — hvad driver fuldtidsmålet?)

| Tier | Værdi-kategori | Hvorfor |
|---:|---|---|
| **V1** | Sprint-validation direkte | Vinder eller taber 30-dages sprint = vinder eller taber Go-beslutning |
| **V2** | Retention-bygning (beta-spillere) | Hele revenue-modellen antager 40%+ weekly returning. Retention >> monetization-features. |
| **V3** | Mobile/UX i live beta | Discord-launch = mobile traffic. Broken mobile = bounced new sign-ups. |
| **V4** | Brand-load (UCI/IP-migration) | Blokerer commercial launch (day 30 Go). Skal være færdig før Stripe åbner. |
| **V5** | Monetization-infrastruktur (Stripe/ApS/MoR) | Først relevant POST day-30 Go-beslutning. Premature work hvis No-Go. |
| **V6** | Infrastruktur/scaling (Redis, restore-drill, secret mgmt) | Forsikring — bygger ikke MAU. Kør parallelt når der er tid. |
| **V7** | Tech-debt der aktivt bider | Bremser dev velocity. Kun hvis det blokerer V1-V4. |
| **V8** | Nice-to-have features | Overvej-luk hvis ikke retention-eller-monetization-relevant. |

### 2. Tids-akse (eksplicitte buckets der mapper til sprint)

- **T-1 (søn 17/5):** Pre-launch sanity (kun #367 mobile-verify lige nu)
- **Uge 21 (18-24/5) — sprint w1:** Foundation (Discord, baseline-metrics, top-spillere)
- **Uge 22 (25-31/5) — sprint w2:** Survey live + pricing
- **Uge 23 (1-7/6) — sprint w3:** Waitlist live + advokat-konsultation
- **Uge 24 (8-17/6) — sprint w4:** Day-30 decision
- **Juni-juli (post-sprint, betinget Go):** Stripe/ApS/MoR-implementation
- **Q3 (jul-sep):** Post-launch retention-features + scaling
- **Senere / overvej-luk:** Ikke kritisk for fuldtidsmål — kandidater til "won't fix"

### 3. Blocker-akse

- 🟥 **BLOKERER sprint** (kan ikke leveres uden = sprint-validation eller direkte input)
- 🟧 **BLOKERER commercial launch** (UCI/IP, ApS, GDPR, MoR)
- 🟨 **BLOKERER retention** (bug der frustrerer beta-spillere = D7-retention-killer)
- ⬜ **Ikke-blokerende**

## Eksekvering — sådan henter og kategoriserer jeg de 150 issues

### Token-budget-strategi (~30-40K tok total)

**Phase A — Inventory (~2K tok):**
```
gh issue list --state open --limit 300 \
  --json number,title,labels,assignees,createdAt,updatedAt
```
Returnerer ~150 rækker uden body — let scan for pre-bucketing.

**Phase B — Parallel body-læsning via 3 Explore-agenter (~30K tok):**

Jeg spawner **3 Explore-agenter i én besked** (parallel kørsel), hver med et eksplicit issue-nummer-batch:

1. **Agent 1 — Sprint + High-priority:** Læser de 9 `sprint-validation` + 26 `priority:high` issues (≈35 issues). Output: per-issue 2-3 linjer med (a) hvad det er, (b) værdi-tier V1-V8, (c) blocker-status, (d) anbefalet tidsbucket.
2. **Agent 2 — Epics + needs-decision + needs-user-action + needs-ai-triage:** Læser ~37 issues fra disse buckets. Output: samme format + flag for "stadig relevant?" og "venter på hvad?"
3. **Agent 3 — Resten (priority:med + priority:low minus dem allerede dækket + claude:done):** Læser ~78 issues. Output: samme format + luk-kandidat-flag (T/F) med begrundelse.

Hver agent får eksplicit bruger-kontekst: fuldtidsmål, sprint-status, retention>monetization-princip, UCI/IP-deadline.

**Phase C — Min syntese (~5-10K tok):**
Jeg samler de 3 agent-outputs til én master-tabel, applikerer 3-akse-rammen, producerer output.

### Token-budget-balance

| Komponent | Estimat |
|---|---:|
| gh inventory | ~2K |
| 3 parallelle Explore-agenter (output sammenfattet) | ~25K |
| Min syntese + plan-tabel | ~10K |
| **Total brugt** | **~37K** |

Inden for budget. Hvis enkelte issues kræver dybere læsning (referencerede PRs, commits), kører jeg targeted Read i Phase C.

## Output-format (forslag — bruger må vetoe)

**Anbefaling: ny fil `docs/BACKLOG_PRIORITIZED.md`** (ikke append til SPRINT_DASHBOARD). Begrundelse:
- SPRINT_DASHBOARD er sprint-fokuseret (tasks, metrics, decision-log) — at proppe en 150-issue-prioritering ind ville ødelægge dens "single-page status"-natur
- BACKLOG_PRIORITIZED kan opdateres uafhængigt (fx ugentligt) uden at røre sprint-dashboardet
- SPRINT_DASHBOARD får én linje øverst: `> Prioriteret backlog: [BACKLOG_PRIORITIZED.md](BACKLOG_PRIORITIZED.md) (opdateret YYYY-MM-DD)`

**Struktur i `BACKLOG_PRIORITIZED.md`:**

```
1. Top 10 highest-leverage (1-2 linjer pr. issue, link, hvorfor for fuldtids-målet)
2. Tidsplan-tabel:
   - T-1 / Uge 21 / Uge 22 / Uge 23 / Uge 24 / Juni-juli / Q3 / Senere
   - Pr. række: #N · titel · værdi-tier · blocker · 1-linje begrundelse
3. Konflikter med aktivt sprint
   - Hvilke ikke-sprint-issues bør pauses?
   - Hvilke AI/Ops-issues krydser sprint-fokus?
4. Luk-kandidater (separat — bruger har veto)
   - Pr. issue: link · sidst opdateret · 1-linje argument for luk
5. Antagelser jeg traf (så bruger kan korrigere)
6. Action-items efter prioritering (fx: assign labels, opdater milestones)
```

## Antagelser jeg har truffet (bruger kan korrigere)

1. **AI/Ops token-reduktion (aktiv slice) skal IKKE crowde sprintet** — så `epic:ai-workflow`-issues prioriteres lavere end V1-V4 medmindre de blokerer en sprint-task.
2. **`claude:done`-issues lukkes IKKE automatisk** — bruger lukker selv per memory-rule. Jeg flagger dem som luk-kandidater.
3. **`epic:economy-overhaul`-issues (5 stk) er efterveer fra slice 07 (komplet 2026-05-09)** — sandsynligt luk-kandidater medmindre body afslører genåbnet scope.
4. **Post-sprint-bucket (juni-juli) er BETINGET af day-30 Go-beslutning** — jeg medtager Stripe/ApS/MoR-issues her, men markerer dem `🔒 betinget Go`.
5. **Q3-bucket (jul-sep) er bredere "post-launch retention"** — jeg placerer features der primært bygger MAU/retention efter launch.
6. **UCI/IP-migration (team/rider rename + race-licens) er BLOKER for commercial launch** — alt der knyttes til kommercielle løbsnavne/team-trademarks får 🟧.

## Spørgsmål jeg vil stille via AskUserQuestion EFTER eksekvering, hvis usikre

Jeg vil stille spørgsmål når jeg har konkrete tvivlssager — fx:
- Hvis et issue ser ud til at være forældet men har høj-priority-label
- Hvis to issues har overlappende scope og bør konsolideres
- Hvis et stort epic-issue (>500 ord body) kræver split for at være eksekverbart
- Hvis et `needs-decision` issue har været åbent >30 dage uden ny aktivitet

## Out-of-scope for denne session (kan spawn-tasks hvis opdaget)

- Re-labeling alle 141 `claude:todo`-issues (separate session)
- Lukke `claude:done`-issues (bruger gør selv)
- Opdatere milestones på alle 150 issues (efter prioriterings-beslutning)
- Fix af konkrete bugs jeg ser i issue-bodies (skal logges som follow-ups)

Hvis jeg under læsningen opdager en kritisk regression eller security-issue der ikke er flagget, bruger jeg `mcp__ccd_session__spawn_task` til at logge det uden at blande det ind i denne session.

## Kritiske filer / referencer

- **Læst i denne session:** `docs/BUSINESS_STRATEGY.md`, `docs/SPRINT_DASHBOARD.md`, `docs/NOW.md`, top 150 linjer af `docs/FEATURE_STATUS.md` (resten on-demand)
- **LAUNCH_ROADMAP.md eksisterer ikke** — SPRINT_DASHBOARD + BUSINESS_STRATEGY dækker rollen
- **Output-fil (ny):** `docs/BACKLOG_PRIORITIZED.md`
- **Potentielt opdateres:** `docs/SPRINT_DASHBOARD.md` (én pointer-linje øverst) — KUN hvis bruger godkender

## Verifikation efter levering

1. Top 10 højest-leverage er begrundet i fuldtidsmålet (ikke i tech-debt eller refactor-ønsker)
2. Alle 150 issues er kategoriseret i præcis én tidsbucket (ingen "ukendt"-rest)
3. Luk-kandidater er separate og kommenteret — ingen issue lukkes uden bruger-veto
4. Sprint-validation-bucket #359-#367 er ALLE i uge 21-23 (ikke spredt)
5. AI/Ops token-reduktion-issues (epic:ai-workflow) er ikke prioriteret over sprint
6. Antagelses-sektion er fyldig nok til at bruger kan korrigere uden at læse hele master-tabel

## Næste skridt efter plan-godkendelse

1. **Phase A** — `gh issue list` med fuld inventory (1 kald, ~2K tok)
2. **Phase B** — 3 parallelle Explore-agenter (én besked, 3 tool-calls)
3. **Phase C** — Min syntese → skriv `BACKLOG_PRIORITIZED.md`
4. **Phase D** — Append pointer-linje til `SPRINT_DASHBOARD.md` (1 linje)
5. **Phase E** — Vis top 10 + luk-kandidat-liste i chat så bruger kan vetoe før noget commits
6. **Phase F** — Hvis bruger ønsker commit: commit + push (per `auto-push efter commit`-rule)
