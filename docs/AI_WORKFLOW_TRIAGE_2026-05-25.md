# AI-workflow Triage 2026-05-25 — Routines + Memory Stores + Dreaming

> **Status:** Decision-doc fra parallel 4-Explore-subagent research-pass.
> **Trackere lukker:** [#622](https://github.com/NicolaiDolmer/CyclingZone/issues/622) + [#629](https://github.com/NicolaiDolmer/CyclingZone/issues/629) (efter user-approval af denne ADR).
> **Sub-issues triaget:** #623-#628 + #630-#633 (11 i alt).

## TL;DR

Efter parallel research-pass (4 subagents) konvergerer beslutningen: **byg ÉN routine (#627 Housekeeping Weekly) som proof-of-concept**, og **DEFER alle Memory Store/Dreaming-kandidater** indtil baseline-volumen retfærdiggør investering.

Routines er ikke uden ROI — men kun #627 leverer både (a) klart use-case Maya validerede live, (b) recommend-only blast-radius, og (c) genbrug af eksisterende `.claude/skills/github-housekeeping/` skill. Alt andet i porteføljen konkurrerer med deterministisk Action-baseret automation der vinder på cost/simplicitet.

Cloud Memory Stores + Dreaming venter på at have **3+ aktive routines** med overlappende context — under det giver eksisterende Anthropic prompt-cache (~90% hit) næsten samme værdi gratis.

## Decision-matrix

### Routines (tracker [#622](https://github.com/NicolaiDolmer/CyclingZone/issues/622))

| # | Kandidat | Decision | Hvorfor |
|---|---|---|---|
| [#623](https://github.com/NicolaiDolmer/CyclingZone/issues/623) | PatchNotes Guard | ✅ **IMPLEMENT (#2)** | Højeste bid-frekvens; LLM giver merværdi via suggested version-bump + tekstforslag. Build efter #627 har kørt 1-2 uger uden incidents (event-trigger ny kompleksitet). |
| [#624](https://github.com/NicolaiDolmer/CyclingZone/issues/624) | Post-deploy Verifier | ⏸️ **DEFER** | `deploy-verify.yml` (666 runs) + `scripts/verify-deploy.ps1` + `smoke-test-prod.mjs` dækker allerede. AI-værdi kun i Sentry-baseline-delta-reasoning — observér 2 uger med #621-baseline først. |
| [#625](https://github.com/NicolaiDolmer/CyclingZone/issues/625) | Sync-deps Drift | ❌ **DROP** | Eget issue-body indrømmer "stærk kandidat for drop". Deterministic GitHub Action med `npm run doctor` `install-parity`-row er billigere + simpler. Skriv lille Action i stedet. |
| [#626](https://github.com/NicolaiDolmer/CyclingZone/issues/626) | Sprint Dashboard Daily | ⏸️ **DEFER** | Validation Sprint slutter 2026-06-17 (~3 uger). ROI for lav når sprint er ved at lukke. Revurder ved næste sprint. |
| [#627](https://github.com/NicolaiDolmer/CyclingZone/issues/627) | Housekeeping Weekly | ✅ **IMPLEMENT (#1)** | Lavest blast-radius (recommend-only, ingen file-mutation), skill'en eksisterer, Maya valideret canonical use-case, adresserer "audit-close-aggressive"-bid fra 2026-05-23. Perfekt proof-of-concept. |
| [#628](https://github.com/NicolaiDolmer/CyclingZone/issues/628) | Token-budget Watchdog | ❌ **DROP** (redesign) | Routine kan ikke læse `~/.claude/projects/.../memory/MEMORY.md` (uden for repo). 1/3 af budgettet utilgængelig. Drop indtil et sync-pattern findes; alternativ: extend `scripts/audit-memory-dir.mjs` til at skrive snapshot til `docs/metrics/`. |

### Memory Stores + Dreaming (tracker [#629](https://github.com/NicolaiDolmer/CyclingZone/issues/629))

| # | Kandidat | Decision | Hvorfor |
|---|---|---|---|
| [#630](https://github.com/NicolaiDolmer/CyclingZone/issues/630) | Memory Store som context-backend for routines | ⏸️ **DEFER** (conditional) | 0 ROI uden ≥2 aktive routines. Anthropic standard prompt-cache giver ~90% hit gratis — Memory Store leverer marginal forbedring oven på det. Re-evaluér når #627 + #623 begge kører >5 runs/uge kombineret. |
| [#631](https://github.com/NicolaiDolmer/CyclingZone/issues/631) | Dreaming over routine-transcripts | ⏸️ **DEFER** | Kræver ≥3 aktive routines × ≥1 run/uge i 4 uger = ~12 transcripts før første Dream giver mening. `anthropic-skills:consolidate-memory` skill løser ~80% lokalt og gratis — benchmark mod den FØR vi accepterer CMA-cost. |
| [#632](https://github.com/NicolaiDolmer/CyclingZone/issues/632) | Discord-bridge state pilot | ⏸️ **DEFER** (betinget go) | Memory Store kræver routine-mount for at give value. Discord-bridge kører lokalt via mcp-discord — pilot uden CMA-routine er bare "fil-flyt", ikke validation. Re-aktivér når #622 leverer en Discord-relateret routine. |
| [#633](https://github.com/NicolaiDolmer/CyclingZone/issues/633) | Local↔Cloud sync investigation | ✅ **ADR LEVERET** (H4 anbefalet) | Per-domain split: `project_*` + `reference_*` → cloud-eligible · `feedback_*` → lokal-only. Reversibilitet HØJ. Implementation først efter #630 + #632 går aktiv. Se §H1-H4 nedenfor. |

## Konsoliderede findings

### Routines — top 3 cross-cutting risici (skal være på plads FØR første routine kører)

1. **Write-permissions verificeret** — per [feedback_remote_routines](memory pointer) (2026-05-03 "Dark mode S2"-incident: 31 filers arbejde tabt). GitHub MCP `permitted_tools` SKAL eksplicit inkludere `create_branch` + `create_or_update_file` + `create_pull_request` (eller minimum `issue.create` for #627). Tomt array = silent read-only.
2. **Observability i issue/PR-comment** — routine-runs er kun synlige på `claude.ai/code/routines/<id>`, ingen API til logs. Hver routine SKAL outputte "summary issue" eller PR-comment så fejl er recoverable fra GitHub-side.
3. **Loop-guard / idempotency** — særligt event-driven routines (#623) skal eksplicit deduplicere på PR-nummer for at undgå "routine åbner issue → ny PR → routine åbner nyt issue"-loop.

### Memory Store break-even-analyse

Token-økonomien er en wash mellem (status quo prompt-cache) og (Memory Store + 95% CMA-cache). **Kvalitativ break-even ved 3+ routines** med overlappende context:

| Lag | Cost-baseline | Med Memory Store |
|---|---|---|
| Bootstrap | $0 | ~$0.05 engangsoperation |
| Per routine-run input | ~3,500 tok → ~350 billable (90% cache) | ~8,700 tok → ~440 billable (95% cache) |
| Manual sync (CLAUDE.md edit → alle routines) | Manuel prompt-edit pr. routine | Automatic via init-script |

Under 3 routines: manuel paste billigere + enklere. Over 3: store wins på konsistens og update-propagation, ikke på token-cost.

### H1-H4 ADR for local↔cloud sync (#633)

Repo-state: **127 lokale memory-filer** (84 feedback + 23 project + 17 reference + 3 misc). Cross-PC sync via OneDrive directory-junction (stabil for `memory/`, fragil for andre links — SessionStart-hook auto-heals).

| Hypothesis | Pro | Con | Score |
|---|---|---|---|
| H1 Hold separate | Lavest cost; status quo virker | Permanent dobbelt-curation; drift; ingen agent-shared baseline | 4 |
| H2 Cloud-master + lokal-cache | Single source of truth; erstatter OneDrive-hack | Offline broken; CMA-lock-in; Dreaming kan overskrive tier-disciplin | 3 |
| H3 Lokal-master + cloud-snapshot | Lavest disruption | Stadig hardlink-hack; ingen cross-agent write-loop | 5 |
| **H4 Per-domain split** ✅ | Cleanest separation; udnytter eksisterende prefix-konvention; mindre Dreaming-cost; Codex/Manus shared baseline | Retagging-pas (~150 filer); 2-vejs bridge-kompleksitet | **7** |

**Anbefaling: H4** med pilot på 5-10 `reference_*`-filer FØRST. Implementation blokeret indtil #630 + #632 leverer cost-data fra praksis.

## Cross-cutting konflikt fundet (flag fra Agent B)

`docs/AI_CHANNEL_ROUTING.md` siger eksplicit "Aldrig brug Dispatch til high-blast-radius" — routine-housekeeping (#627) er præcis sådan en task. Mulig konflikt mellem routine-adoption og eksisterende routing-guidance. **Bør drøftes på [AI Council #564](https://github.com/NicolaiDolmer/CyclingZone/issues/564) før #622-vedtagelse.**

## Recommended next 3 actions

1. **Beslut #627 build NU** — kør write-permissions-test først (single read-only routine til at verificere GitHub MCP-connector permitted_tools setup), DEREFTER bygge Housekeeping Weekly. Effort: ~2 timer.
2. **Skriv `.github/workflows/sync-deps-drift.yml`** — ren GitHub Action der erstatter #625 routine-kandidat. Effort: ~30 min.
3. **AI Council #564 sync** — afklar konflikt med AI_CHANNEL_ROUTING.md før vi adopterer routines bredt.

## Out-of-scope-fund (fra subagents — opretter IKKE som issues, men værd at vide)

- `scripts/audit-memory-dir.mjs` kunne skrive token-budget-snapshot til `docs/metrics/` — det ville flytte #628 fra DROP til IMPLEMENT
- `drift-monitor.yml` mønster er moden — let at kopiere til "Loop B · Deps Drift" Action
- `claude-triage.yml` + `claude-review.yml` workflows findes allerede — tjek overlap FØR routine-adoption
- `anthropic-skills:consolidate-memory` skill leverer ~80% af Dreaming's value-prop lokalt + gratis
- AGENT_ARCHITECTURE.md auto-regen (`<!-- BEGIN/END FAILURE-MODES -->`) trigger memory-store re-upload pr. postmortem hvis i store — overvej trim til topology-only

## Cross-refs

- Trackere: [#622](https://github.com/NicolaiDolmer/CyclingZone/issues/622) (Routines) · [#629](https://github.com/NicolaiDolmer/CyclingZone/issues/629) (Memory Stores)
- Reference memories: `reference_claude_code_routines.md` · `reference_anthropic_memory_stores.md` · `reference_onedrive_context.md`
- Postmortem (write-permissions-gotcha): [feedback_remote_routines](pointer i WARM-tier)
- Eksisterende automation: `.github/workflows/{deploy-verify,drift-monitor,claude-triage,claude-review}.yml` · `scripts/{verify-deploy.ps1,check-agent-token-hygiene.ps1,audit-memory-dir.mjs}` · `.claude/skills/github-housekeeping/`
- Related: [AI_LOOPS.md](AI_LOOPS.md) (Loop F subagent-orkestrering pattern brugt til denne triage) · [AI_COUNCIL.md](AI_COUNCIL.md) ([#564](https://github.com/NicolaiDolmer/CyclingZone/issues/564))

---

_Genereret 2026-05-25 via parallel 4-Explore-subagent research-pass. Token-cost: ~262k på tværs af 4 agents + master synthesis. Wall-clock: ~13 min. Alternativ sekventiel: ~3-4 timer._
