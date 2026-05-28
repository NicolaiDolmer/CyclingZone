# AI Ops — Token budget & memory-tier-system

Disciplin der holder cold-start under kontrol over tid. Baselinet 2026-05-14 efter `scalable-wobbling-blossom` plan (Phase 1-5). P0-sporet for næste token-reduktion styres i [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605).

## Aktuel baseline og mål

Målt 2026-05-28 på NICOLAIPC via `scripts/check-agent-token-hygiene.ps1 -BaselineOut docs/metrics/token-baseline-ai-worldclass-v2-2026-05-28.json`.

| Niveau | Claude cold-start | Codex cold-start | Brug |
|---|---:|---:|---|
| Aktuel runtime-baseline | ~19,600 tok | ~24,300 tok | Sandhed for #605 før trim |
| Næste praktiske P0-target | <15,000 tok | <18,000 tok | Første realistiske reduktion uden at miste quality-canaries |
| Aspirational world-class target | <8,000 tok | <12,000 tok | Beholdes som nordstjerne, men ikke close-out-gate for #605 |

Aktuelle største drivers: harness/tool schemas ~14,800 tok, Codex-only `AGENTS.md` + cache bringer Codex context til ~7,800 tok, HOT memory ~1,800 tok, on-demand memory-dir ~69,000 tok (+41% vs baseline).

## Budget pr. fil-kategori

| Fil | Kategori | Tier | Mål | FAIL ved |
|---|---|---|---|---|
| `MEMORY.md` (HOT) | Auto-load | HOT | <40 linjer / ~1,200 tok | >50 linjer eller >1,500 tok |
| `MEMORY_REFERENCE.md` | On-demand | WARM | n/a | n/a |
| `memory/*.md` detail-filer | On-demand | COLD | n/a | n/a |
| `CLAUDE.md` | Auto-load | HOT | <50 linjer / ~700 tok | >70 linjer eller >1,000 tok |
| `docs/NOW.md` | Eksplicit start-read | HOT | <30 linjer / ~700 tok | >40 linjer eller >1,000 tok |
| `.codex.local/SESSION_CONTEXT.md` | Optional auto-load cache (hook) | HOT | <30 linjer / ~500 tok | hook-bounds checked; missing is OK; no unique handoff |
| `docs/GUARDRAILS_CORE.md` | Conditional auto-load | HOT-conditional | <70 linjer / ~1,200 tok | >100 linjer |

**Cold-start total mål:** Brug tabellen ovenfor. Det gamle <8,000 tok mål er nu aspirational, fordi runtime-målingen viser at harness alene ligger på ~14,800 tok.

## Tier-system

```
HOT  →  Auto-loader på HVER session. Budget knapt. Lokale HOT-caches må kun indeholde regenererbar GitHub/OneDrive-context.
        Lokation: MEMORY.md, CLAUDE.md, NOW.md, SESSION_CONTEXT.md, GUARDRAILS_CORE.md (conditional)

WARM →  On-demand. Læses når HOT ikke er nok.
        Lokation: MEMORY_REFERENCE.md, META_DOCS_INDEX.md, alle docs/*.md

COLD →  Detail-filer. Læses kun ved specifik trigger.
        Lokation: memory/*.md detail-filer, docs/archive/*.md
```

## Promotion-regler (memory)

Nye memories går default i **WARM** (`MEMORY_REFERENCE.md`).

Promotion HOT (`MEMORY.md`) kræver ÉT af følgende:
1. Brugeren siger eksplicit "husk det som top-prioritet"
2. Reglen har bidt 2+ gange — sporet via `docs/AI_OPS_QUALITY_CANARIES.md` regression-log
3. Reglen gælder >50% af sessioner og er essentiel for korrekt opførsel

Demotion HOT → WARM (gør reverse):
- Hvis regel ikke er trigget i 60 dage
- Hvis det relaterede feature/issue er DONE og ikke længere afspejler nuværende state
- Hvis det er redundant med en anden HOT-rule

## Audit-cadence

**Månedlig** (1. mandag): kør `anthropic-skills:consolidate-memory` for at få kandidater. Bruger reviewer 5-10 min.

**Pre-commit**: `scripts/check-agent-token-hygiene.ps1` FAIL'er hvis HOT-budget overskrides. Integreret i `scripts/check-now-md.sh` Stop-hook.

**Per-session**: Stop-hook tjekker NOW.md line-count + warnings hvis HOT-files vokset siden sidste session.

## Hvad må IKKE auto-loades

- Liste over alle slice-briefs
- Liste over alle commits
- Liste over alle issues
- Fuld FEATURE_STATUS.md (er 371 linjer)
- Fuld ARCHITECTURE.md (423 linjer)
- Fuld GITHUB_WORKFLOW.md (264 linjer)
- Skill-descriptions for unused plugins (disable plugin'et hvis ubrugt)

## Kvalitets-canaries

Hvis du fjerner en regel fra HOT-tier, tilføj canary i `docs/AI_OPS_QUALITY_CANARIES.md` så regression fanges hurtigt. 10 canaries er defineret pr. 2026-05-14.

## Reference

- Plan: `C:\Users\emmas\.claude\plans\scalable-wobbling-blossom.md`
- Baseline JSON: `.codex.local/token-baseline-before.json`
- P0 baseline JSON: `docs/metrics/token-baseline-ai-worldclass-v2-2026-05-28.json`
- Master issue: [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605)
- Disable playbook: `docs/AI_OPS_DISABLE_PLAYBOOK.md`
- Quality canaries: `docs/AI_OPS_QUALITY_CANARIES.md`
- Memory tier-system: `~/.claude/projects/C--dev-CyclingZone/memory/README.md`
