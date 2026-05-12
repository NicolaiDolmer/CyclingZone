# 2026-05-12 — Claude Action max-turns cap på stor audit-refactor

## Bug

Issue [#260](https://github.com/NicolaiDolmer/CyclingZone/issues/260) ("Holdnavn altid clickable → leder til holdsiden") triggede et Claude Action-run med 12 sub-tasks i ét checklist. Run [25699672154](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/25699672154) ramte `--max-turns 50` cap midt i eksekveringen — ingen kode committet, ingen PR oprettet.

## Root cause

`--max-turns 50` var fastsat i `claude.yml`. En "audit alle steder X vises"-issue med 12 adresseringspunkter kræver typisk:
- ~5 turns: exploration (find alle filer)
- ~3 turns per fil: read + edit + verify = ~36 turns for 8 sider
- ~5 turns: close-out filer (NOW.md, PatchNotes, commit, push, PR)

Total: ~46-50 turns selv ved efficient execution — ingen buffer for fejl, re-reads eller uventede fund.

## Fix

1. `--max-turns` bumped **50 → 120** i `.github/workflows/claude.yml` (kræver workflow-rettighed, separat action).
2. **Scope-split strategy**: Issue delt i to:
   - [#315](https://github.com/NicolaiDolmer/CyclingZone/issues/315) — Scaffolding (TeamNameLink-komponent + backend team_id) — ét run, ~20 turns
   - [#316](https://github.com/NicolaiDolmer/CyclingZone/issues/316) — Rollout til 8 sider — ét run, ~60 turns (nu realistisk med 120 cap)
3. **SCOPE-GUARD-instruktion** tilføjet til claude.yml prompt: audits med >5 adresseringspunkter skal blockeres up-front med en "split til sub-issues"-comment i stedet for at brænde et helt run.

## Læring

**1. Audit-issues er turny.** "Find alle steder X" = ubestemt explorations-overhead + 1 edit-cyklus per fund. Tommelfingerregel: >5 edit-targets = split til to runs.

**2. Checklist-størrelse != turn-budget.** 12 checkboxes i et issue er ikke 12 turns — det er 12×3-5 turns. Validér mod turn-budget inden du starter edit-fasen; stop og split hvis budgettet ikke holder.

**3. Max-turns er stille single-point-of-failure** (gentager læring fra 2026-05-07-automation-workflow-hardening.md). Ingen partial commit, ingen PR, kun en fejl-comment. Konsekvens: 0 deliverables fra et 50-turns-run.

**4. Scope-guard er billigere end et mislykket run.** Et "dette er for stort, splitter" svar tidligt i et run koster ~5 turns. Et fuldt-run-cap koster 50 turns + brugerens follow-up + nyt run. Guard up-front.
