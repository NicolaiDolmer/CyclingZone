# AI Ops — Disable-playbook (Phase 2+3)

Baseret på faktisk brug i 66 sessioner (data: `.codex.local/token-baseline-before.json` + transcript-grep).

**Estimeret samlet besparelse: ~4,500-5,500 tokens pr. session** ud over Phase 1's ~3,150.

---

## Desktop-kanal drift — mekanisme og fix (#1286, fundet 11/6)

**Problem:** Plugins installeret via Claude Code Desktop-kanalen har separat plugin-state der ignorerer `enabledPlugins`-nøgler i `~/.claude/settings.json` (user-level). Disablede plugins kan drifte tilbage og æde cold-start-tokens uden at det er synligt i settings-filen.

### Kanal-hierarki (hvem vinder)

| Kanal | Fil | Kan overrides? | Anbefalet til disables? |
|---|---|---|---|
| Desktop-app plugin-state | intern i Desktop-binæren | Vinder over user-level | Nej — drifter ved app-opdatering |
| **Project-level settings** | `.claude/settings.json` (dette repo) | **Nej — repo-committed** | ✅ **Ja — brug denne** |
| User-level settings | `~/.claude/settings.json` (OneDrive-synced) | Omgås af Desktop-kanal | Supplement, ikke garanti |

**Konklusion: Alle `@claude-plugins-official`-disables skal stå i project-level `.claude/settings.json`.** User-level er backup, ikke primary. Desktop-kanal kan ikke override project-level settings.

### Korrekt disable-procedure

1. Tilføj plugin til `enabledPlugins`-map i `.claude/settings.json` (dette repo) med `false`
2. Commit + push (disablet er nu gældende for alle PCs der kloner repo'et)
3. Verificér ved næste session-start: plugin-skills må IKKE optræde i session-start system-reminder
4. Opdatér `drift_check.last_verified` i `docs/metrics/harness-snapshot-<PC>.json`

### Aktuelle projekt-level disables (`.claude/settings.json`)

| Plugin | Status | Årsag |
|---|---|---|
| `product-management@claude-plugins-official` | ❌ disabled | Aldrig brugt, ~500 tok overhead |
| `marketing@claude-plugins-official` | ❌ disabled | Aldrig brugt |
| `design@claude-plugins-official` | ❌ disabled | Aldrig brugt |
| `productivity@claude-plugins-official` | ❌ disabled | Aldrig brugt |
| `code-modernization@claude-plugins-official` | ❌ disabled (#382, løftet til project-level #1286) | 7 skills aldrig brugt |
| `vercel@claude-plugins-official` | ❌ disabled (#741, løftet til project-level #1286) | Next.js-skills unødvendige i Vite+React-stack |

### Drift-check

Kør ved session-start eller efter Desktop-app-opdatering:
```
# Verificér at ingen disabled plugins er synlige i skills-listen:
# 1. Start ny Claude Code session i CyclingZone
# 2. I session-start system-reminder — check at INGEN af disse prefix er til stede:
#    code-modernization:*, vercel:*, product-management:*, marketing:*, design:*, productivity:*
# 3. Opdatér drift_check.last_verified i docs/metrics/harness-snapshot-<PC>.json
```

Hvis et disabled plugin dukker op:
1. Verificér at det stadig er `false` i `.claude/settings.json`
2. Hvis ja → Desktop-kanal-drift bekræftet → disable igen via `/plugin` UI i Claude Code Desktop
3. Rapportér til #605-epic-tråden

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

### Skills aldrig invokeret — kandidater til disable

| Plugin / skill-gruppe | Skills | Disable-mekanisme | Status |
|---|---|---|---|
| `code-modernization:*` | 7 (modernize-assess/brief/extract-rules/harden/map/reimagine/transform) | `~/.claude/settings.json enabledPlugins` → `false` | ✅ Disabled 2026-05-15 (#382, -490 tok) |
| `anthropic-skills:pdf/docx/pptx/xlsx` | 4 (file format converters) | ❌ **Built-in i Claude Code-binæren** — ingen native disable. Per-session `/skills menu` disable er midlertidig. | Permanent ~280 tok overhead (research-bekræftet #382) |
| `product-management:*`, `marketing:*`, `design:*`, `productivity:*`, `data:*` | ~36 skills | N/A — disse plugins er ikke enabled på denne PC | Allerede inaktive |

**Realistisk Phase 3-besparelse: ~490 tok** (kun `code-modernization`). Den oprindelige 3,300-tok-projektion antog at alle ovenstående plugins var enabled — verificeret 2026-05-15 at de fleste aldrig var installeret.

### Sådan disabler du

Rediger `~/.claude/settings.json` `enabledPlugins`-map (cross-PC sync via OneDrive-hardlink siden #382):
```json
"enabledPlugins": {
    "frontend-design@claude-plugins-official": true,
    "claude-code-setup@claude-plugins-official": true,
    "code-modernization@claude-plugins-official": false
}
```

Alternativt: `/plugin` slash-command åbner plugin-management UI'en (kun synlige plugins fra lokal marketplace — built-in skills som `anthropic-skills:*` vises ikke her).

**Cross-PC:** Efter edit, kør `pwsh -File scripts/link-onedrive-context.ps1` på anden PC for at synce hardlinket. Plugin-state synces automatisk fremover.

**Behold disse plugins / skills (aktiv brug):**
- ✅ `claude-code-setup:*` — `/loop`, `/schedule`, `/init`, `update-config`, `keybindings-help`, `simplify`, `fewer-permission-prompts`, `claude-api`
- ✅ `frontend-design` — distinctive UI-komponenter (1 skill)
- ✅ `anthropic-skills:skill-creator`, `consolidate-memory`, `setup-cowork` (built-in, brugt aktivt)
- ❌ `code-modernization:*` — disabled 2026-05-15 (#382)

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

## DolmerPC-specifikke cuts (2026-05-29, #605)

Baseret på `docs/metrics/harness-snapshot-DOLMERPC.json` (17,093 tok, ~2,311 tungere end NicolaiPC).
Reelle målinger — ikke estimater. Estimat-forbeholdet i DOLMERPC-kommentaren fra 2026-05-28 er ophævet.

| # | Handling | Besparelse | Sikkerhed | Mekanisme |
|---|---|---:|---|---|
| 1 | Disable vercel-plugin | ~1,100 tok | 🟢 Safe — Next.js-skills bruges ikke i Vite+React-repo | `/plugin` → disable `vercel@claude-plugins-official` |
| 2 | Disconnect GitHub MCP | ~645 tok | 🟢 Safe — `gh` CLI dækker workflow; NicolaiPC kører allerede uden | claude.ai/settings/connectors |
| 3 | Disconnect Sentry MCP | ~375 tok | 🟡 Medium — kun hvis ingen MCP-baseret Sentry-triage; UCI-monitor alerting påvirkes ikke | claude.ai/settings/connectors |
| 4 | Disconnect Google Calendar + Drive | ~240 tok | 🟡 Medium — lav brug, men bevidst beholdt på NicolaiPC | claude.ai/settings/connectors |

**Behold uanset:** Claude_in_Chrome (22 tools) — UI-verifikation. Claude_Preview (13) — `/preview`.

**Forventet effekt:**
- #1+#2 (🟢 safe): 17,093 → ~15,350 tok (~parity med NicolaiPC)
- #1–#4: → ~14,700 tok (under NicolaiPC, under P0-target)

**Verificér efter cuts:** Start ny session og kør:
```
pwsh -File scripts/check-agent-token-hygiene.ps1 -BaselineOut docs/metrics/harness-snapshot-DOLMERPC.json
```
Sammenlign `total_harness_tokens` med 17,093.

---

## Hvis noget mangler efter cuts

Tegn at en disable var for aggressiv:
- AI siger "jeg har ikke værktøjet til X" på en hyppig opgave → re-enable den connector
- AI husker ikke en regel der pleje at virke → promotér tilbage til `MEMORY.md` HOT-tier
- En slash-command-cluster du brugte regelmæssigt er væk → re-enable plugin

Reversibilitet: alle disables tager <1 minut at re-enable. Vær aggressiv først, juster bagefter.
