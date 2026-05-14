# AI Ops — Disable-playbook (Phase 2+3)

Baseret på faktisk brug i 66 sessioner (data: `.codex.local/token-baseline-before.json` + transcript-grep).

**Estimeret samlet besparelse: ~4,500-5,500 tokens pr. session** ud over Phase 1's ~3,150.

---

## Phase 2 — Disable ubrugte MCP-connectors

**Handling:** Åbn https://claude.ai/settings/connectors (eller Connectors-menu i Claude Code) og **disconnect** disse:

| Connector | Faktiske kald (66 sess.) | Begrundelse |
|---|---|---|
| **Microsoft Clarity** | 0 | Aldrig brugt |
| **Google Drive** | 0 | Aldrig brugt (kontraintuitivt — re-enable hvis du finder use case) |
| **Gmail** | 0 | Aldrig brugt |
| **Google Calendar** | 0 | Aldrig brugt |
| **Control Chrome** (separat fra Claude_in_Chrome) | 1 | Redundant — du har Claude_in_Chrome (114 kald) |
| **mcp-registry** | 0 | Discovery-værktøj, sjælden brug |
| **computer-use** | 0 | Aldrig brugt |

**Behold:**
- ✅ GitHub (26 kald + heavy `gh CLI` fallback)
- ✅ Supabase (131 kald — core)
- ✅ Vercel (9 kald — deployment-verify)
- ✅ Claude in Chrome (114 kald — UI verifikation)
- ✅ Claude Preview (34 kald)
- ✅ Discord (37 kald — bridge)
- ✅ ccd_directory, ccd_session_mgmt, scheduled-tasks (billige + nyttige even hvis ubrugte)

**Estimeret besparelse: ~2,000-2,500 tok** (35+ tool-skemaer fjernet fra deferred-list).

---

## Phase 3 — Disable ubrugte plugins/skills

Skills auto-listes ved session-start (~2,000 tok). Mange er aldrig invokeret.

### Skills FAKTISK brugt (last 66 sessions, via slash-commands)
- `/loop` (66), `/preview` (43), `/dependency-review` (26), `/claude-review` (20)
- `/season-end-preview` (16), `/agent-loop` (14), `/review` (12), `/prize-payout-preview` (12), `/auto-merge-loop` (12)
- `/schedule` (4), `/pre-merge-review` (4)
- Marginale: `/spec` (3), `/season-preview` (2), `/init` (2), `/analyze` (2)

### Skills aldrig invokeret (kandidater til disable)
Alle skills fra disse plugin-namespaces:
- `product-management:*` (9 skills) — brainstorm, competitive-brief, product-brainstorming, metrics-review, sprint-planning, write-spec, stakeholder-update, roadmap-update, synthesize-research
- `marketing:*` (8 skills) — campaign-plan, seo-audit, email-sequence, performance-report, brand-review, competitive-brief, content-creation, draft-content
- `design:*` (7 skills) — accessibility-review, design-critique, design-system, research-synthesis, user-research, ux-copy, design-handoff
- `productivity:*` (4 skills) — update, task-management, start, memory-management
- `code-modernization:*` (7 skills) — modernize-assess/brief/extract-rules/harden/map/reimagine/transform
- `anthropic-skills:pdf/docx/pptx/xlsx` (4 skills) — file format converters, aldrig brugt på CyclingZone
- `data:*` minus analyze/write-query (8 skills) — create-viz, data-context-extractor, data-visualization, explore-data, build-dashboard, statistical-analysis, validate-data, sql-queries (eventuelt behold)

**Total: ~47 skills × ~70 tok = ~3,300 tok besparelse hvis alle disables.**

### Sådan disabler du

I Claude Code, kør:
```
/plugin
```
Det åbner plugin-management. Disable plugins du ikke vil have.

Alternativt — rediger `C:\Users\emmas\.claude\settings.json` `enabledPlugins`-map. I dag har du kun:
```json
"enabledPlugins": {
    "claude-code-setup@claude-plugins-official": true,
    "code-modernization@claude-plugins-official": true
}
```

Hvis skills kommer fra et auto-marketplace (sandsynligvis), tilføj `false` for ubrugte:
```json
"enabledPlugins": {
    "claude-code-setup@claude-plugins-official": true,
    "code-modernization@claude-plugins-official": false,
    "product-management@<marketplace>": false,
    "marketing@<marketplace>": false,
    "design@<marketplace>": false,
    "productivity@<marketplace>": false,
    "anthropic-skills@<marketplace>": true
}
```

**Behold disse plugins / skills (aktiv brug):**
- ✅ `engineering:*` — `/review`, `/dependency-review`, `/claude-review`, `/agent-loop`, `/auto-merge-loop` aktivt brugt
- ✅ `claude-code-setup:*` — `/loop`, `/schedule`, `/init`, `update-config`, `keybindings-help`, `simplify`, `fewer-permission-prompts`, `claude-api`
- ✅ `anthropic-skills:skill-creator`, `consolidate-memory`, `setup-cowork` (brugt aktivt)
- ⚠️ `code-modernization:*` — overvej disable (greenfield projekt, 0 brug)

---

## Verifikation efter disables

1. Start ny Claude Code-session i CyclingZone
2. Kør: `pwsh -File scripts/check-agent-token-hygiene.ps1 -BaselineOut .codex.local/token-baseline-after.json`
3. Sammenlign `cold_start_total_est`:
   - Før: 12,775 tok
   - Forventet efter Phase 1+2+3: **~7,000-8,000 tok**

4. Kør quality-canary-tjekliste i `docs/AI_OPS_QUALITY_CANARIES.md` — alle 10 skal være 🟢
5. Lav én rigtig opgave (fx pick et issue, fix, commit, push) og noter hvis noget context manglede

---

## Hvis noget mangler efter cuts

Tegn at en disable var for aggressiv:
- AI siger "jeg har ikke værktøjet til X" på en hyppig opgave → re-enable den connector
- AI husker ikke en regel der pleje at virke → promotér tilbage til `MEMORY.md` HOT-tier
- En slash-command-cluster du brugte regelmæssigt er væk → re-enable plugin

Reversibilitet: alle disables tager <1 minut at re-enable. Vær aggressiv først, juster bagefter.
