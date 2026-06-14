# Multiagent-bølge: API stream-idle-timeout dræber agenter midt i flowet — master skal recovery'e

**Dato:** 2026-06-14
**Kontekst:** Selvstændig multiagent-dagbølge (5 parallelle worktree-agenter, ejer offline), #546-review-opfølgninger.

## Hvad skete

2 af 5 background-agenter (auth #1347/#1348/#1349 + economy #1350/#1351) returnerede med terminal API-fejl **efter** at have lavet alt kode-arbejdet, men **før** commit/push/PR:
- Agent B (economy): `API Error: Stream idle timeout - partial response received` efter 62 tool-kald / ~15 min.
- Agent A (auth): afkortet completion-summary (`"Waiting on core-smoke results"`) — døde mens den ventede på Playwright.

Begge efterlod fuldt færdigt, ucommittet arbejde i deres worktrees (verificeret via `git -C <wt> status`).

## Rod-årsag

Lange agent-turns (>~15 min, typisk når de venter på langsom Playwright) rammer en API stream-idle-timeout. Agent-processen dør uden at nå sine sidste commit/push/PR-trin. Completion-notifikationens summary er da afkortet eller en ren fejl — **"completed"-status ≠ arbejdet er pushed.** Dette er den konkrete dødsårsag bag pitfall #8 i `PARALLEL_WORKTREE_ORCHESTRATION.md`.

## Hvad virkede (recovery)

Per playbook-pitfall #8: master verificerede HVER agent med `git ls-remote origin <branch>` + `gh pr list --head <branch>`. For de 2 døde:
1. Inspicér worktree: `git -C <wt> status --short` viste alle ændringer ucommittet.
2. Review diffen (kvalitetskontrol — agent-output blindt-committes ikke).
3. Kør verify selv i worktreet: `node --test` + `npm run lint` + `npm run build` (master runtime-verify).
4. Færdiggør: `git add <specifikke filer>` → `commit -F` → `rebase origin/main` → `push` → `gh pr create` med Brugerverifikation-sektion (skrevet af master).

Resultat: alle 5 PRs merged, ingen tabt arbejde.

## Take-aways for fremtidige bølger

1. **Stol ALDRIG på completion-status alene** — verificér push+PR for hver agent. Gælder selv "completed".
2. **Den langsomme Playwright core-smoke er en timeout-magnet.** Overvej at instruere agenter til at køre core-smoke som det SIDSTE trin efter commit+push (så et timeout-død ikke koster commit'en), eller lade master køre den tunge UI-verify centralt.
3. **Recovery er billig** når worktrees er isolerede — arbejdet ligger der, master skal bare verificere + afslutte git-kæden.

Se også: [[PARALLEL_WORKTREE_ORCHESTRATION.md]] pitfall #8, HOT-memory `feedback_runtime_verify_first`.
