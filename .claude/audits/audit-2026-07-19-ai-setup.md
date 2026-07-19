# AI-opsætnings-audit — 2026-07-19

Fuld audit af Claude Code-harness, plugins, MCP-servere, skills, hooks, memory og docs-context. Kørt på DOLMERPC-kanalen (Cowork/desktop). Issues oprettet samme dag; prioriteres af ejer 19/7.

## TL;DR

Fundamentet er stærkt (hooks, memory-tiers, token-gates, worktree-flow). Men der er markant **harness-drift siden sidste måling 29/5**: Vercel-pluginet er sneget tilbage under nyt ID (`vercel-plugin@vercel`), 4-5 plugins er dødvægt/dubletter, deferred tool-listen er vokset fra 149 til ~450+ tools. Estimeret **4-7k tokens spildt pr. session-start**. Dertil: NOW.md 2x over token-budget (2.405 tok mod ~1.200) trods OK line-count, MEMORY.md 2 tokens fra fail-gaten (3.198/3.200), memory-dir +173% siden baseline, 7 af 14 scheduled tasks udløbne.

## 1. Slå fra (dødvægt + dubletter)

| # | Hvad | Hvorfor | Gevinst/session |
|---|------|---------|-----------------|
| 1 | `vercel-plugin@vercel` (user-settings `true`) | #741 disable'de `vercel@claude-plugins-official` 29/5, men marketplace-varianten kom ind i stedet. Injicerer knowledge-update-blok + CLI-nag hver session, ~50 Next.js-skills (stack er React+Vite/Express), 3 agents, dublet af Vercel MCP-connector. Drift-vagt overvåger kun det gamle ID → fangede det ikke. | ~3-4k tok |
| 2 | `resend@claude-plugins-official` | ~90 tools + 6 skills; ingen Resend-integration i koden (grep-verificeret; mails via Supabase Auth). | ~1,6k tok |
| 3 | `supabase@claude-plugins-official` | Fuld dublet af Supabase-connectoren (claude.ai); permissions-allowlist peger på connector-ID'er. Skills findes som repo-skills i `.claude/skills/supabase*`. | ~800 tok |
| 4 | `playwright@claude-plugins-official` | ~26 tools der dublerer Browser-panen; tests kører via CLI. | ~400 tok |
| 5 | `discord@claude-plugins-official` | `.mcp.json` kører allerede `mcp-discord` (leverer discord_send m.fl.). Plugin-skills er til Claude-i-Discord-kanal-setup. | ~300 tok |
| 6 | Cowork-connectors i dev-sessioner: Ahrefs (~150 tools), Clarity, Calendar, Drive | Hører til marketing-sessioner. Kan KUN toggles i Cowork/claude.ai connector-UI (ejer-klik). | ~3k tok |
| 7 | ~25 uautentificerede plugin-MCP'er (bigquery, datadog, hubspot, klaviyo, notion, linear, figma, …) | Loader i denne kanal trods repo-disable; kan aldrig bruges (auth mangler). Samme løsning som 6. | ~1k tok |

**Behold** (evidens for brug): GitHub MCP (92 kald/4 uger) + gh CLI, Sentry MCP (53 kald), Vercel-connector, Railway, superpowers, coderabbit, code-review, feature-dev, frontend-design, skill-creator, claude-code-setup, github-housekeeping (egen skill).

## 2. Slet / ryd op

- 7 udløbne scheduled tasks: remind-1903-2080-11jul, v3-launch-verify-13-7, followup-loen-oprydning-2026-06-28, relaunch-rehearsal-1191-reminder, remind-review-fictional-names-pr1262, ga4-deploy-efter-vercel-kvote, dagboelge-3-ejer-paamindelse. Behold: daily-sentry-railway-triage, weekly-fairplay-scan, weekly-sentry-clarity-triage, pool-purity-verifierne, cz-pro-go-live, now-md-railway-cleanup.
- Memory-dir +173% (48k → 133,8k tok, 241 filer). Månedlig consolidate-memory (1. mandag) ikke kørt — overmoden.
- MEMORY.md 3.198 tok / 48 linjer — 2 tok fra fail (>3.200), præcis på line-target. Demotér 2-3 entries til WARM.
- Stale referencer: `docs/AI_OPS_TOKEN_BUDGET.md` linje 99 peger på `C:\Users\emmas\...` (anden PC/bruger). Harness-snapshots fra 29/5, noterer selv behov for re-måling.
- `~/.claude/settings.json.bak-20260528` kan slettes.

## 3. Docs/context-forbedringer

- **NOW.md: 26 linjer men 2.405 tok** (budget ~1.200). Line-gate består, token-gate WARN'er kun → linjerne er blevet ekstremt lange. Trim afsluttede blokke til én linje; gør token-WARN til FAIL i `check-agent-token-hygiene.ps1`.
- **CLAUDE.md: 1.805 tok** mod mål ~700-1.000 (WARN). Flyt tunge dele til AGENTS.md/AI_OPS_REFERENCE.md (on-demand).
- **Drift-vagt:** `harness-snapshot-*.json` → `drift_check.should_be_absent` skal matche på prefix (fx `vercel-plugin@*`), ikke eksakt ID. Tilføj staleness-WARN i hygiejne-scriptet når snapshot >30 dage.

## 4. Nye skills (adresserer regler der allerede har bidt)

1. **/close-out** — kodificér 6-trins close-out (done-flip, NOW-trim m. token-count, patch-notes/help-tjek, hygiejne-script, Working-agent-nulstilling). Størst ROI; done-flip bidt 21/6, NOW-budget driver nu.
2. **/patch-notes** — udkast til PatchNotesPage.jsx + help.json (EN/DA, copy-regler indbygget) fra dagens merged PR'er.
3. **/balance-sim** — wrapper simulér-før-ship-harnesset (ejer-accepteret 7/6); relevant til #2650 + #2645B.
4. **/night-wave** — NIGHT_WAVE_RUNBOOK.md som skill med preflight-GO/NO-GO som hårde gates.

Hook-tilføjelse: **PostToolUse på Edit/Write af `frontend/**` → eslint på ændret fil** (forebygger #2044-klassen; verify-local kører ikke eslint).

## 5. Presse Fable til det yderste

- **Workflow-orkestrering (ultracode)** til natbølger/audits: find → adversarial-verify → syntese med deterministisk kontrolflow. Eksplicit opt-in pr. opgave; dyrt — til de store bølger.
- **Judge-panels** til balance-design (#2645B): 3 uafhængige forslag scoret af parallelle dommere før syntese.
- **Effort-routing på subagenter:** model-routing findes (sonnet-workers); reasoning-effort-routing er næste håndtag (lav til mekanik, høj til verify/judge).
- **/code-review ultra** på store PR'er — supplement til CodeRabbit, ejer-triggered.
- **/loop med selvpacing** til verify-sweeps i stedet for engangs-reminders (undgår stale-task-bunken).

## Anbefalet rækkefølge

1. Disable-bølge (pkt. 1.1-1.5) — settings-edits, ~6-7k tok/session.
2. Cowork-connector-toggles (1.6-1.7) — ejer-klik.
3. Oprydning (pkt. 2) + NOW/CLAUDE-trim (pkt. 3).
4. Drift-vagt-hærdning + snapshot-re-måling.
5. /close-out først af de nye skills; resten efter behov.
