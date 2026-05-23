# Milestones setup — Epic #323 faser + Verdensklasse-plan

**Dato:** 2026-05-23
**Issue:** [#567](https://github.com/NicolaiDolmer/CyclingZone/issues/567) — "[github] Milestones for Epic #323 faser (G6)"
**Forslag-ID:** G6 (fra `docs/archive/2026-05-22-workflow-analyse.md` sektion 7)

## Hvorfor

Bruger har hidtil organiseret Epic #323 + Verdensklasse-plan via `epic:*`-labels. `gh api repos/NicolaiDolmer/CyclingZone/milestones` returnerede `[]` før denne ændring. Milestones giver visuel progress-bar pr. fase + nemmere overblik over hvilke issues der hører til hvilken fase.

## 6 milestones oprettet

Live på <https://github.com/NicolaiDolmer/CyclingZone/milestones>.

| # | Titel | Tilknyttede issues | open / closed |
|---|---|---|---|
| 1 | `Epic #323 — Fase 0: Gør gates reelle` | #324 | 1 / 0 |
| 2 | `Epic #323 — Fase 1: Supabase audits + docs sync` | #325, #326 | 0 / 2 |
| 3 | `Epic #323 — Fase 2: Secret mgmt + rate limit + Playwright` | #327, #328, #329, #339 | 1 / 3 |
| 4 | `Epic #323 — Fase 3: Realtime + cache + loadtest` | #330, #331, #333, #334 | 3 / 1 |
| 5 | `Epic #323 — Fase 4: Fuldtidsdrift playbook` | #332 | 1 / 0 |
| 6 | `Verdensklasse-plan Step 2-7` | #385, #386, #388, #455 | 4 / 0 |

**Total:** 16 issues tilknyttet, 0 fejlede attachments.

## Verifikation

```bash
gh api repos/NicolaiDolmer/CyclingZone/milestones \
  --jq '.[] | {number, title, open_issues, closed_issues}'
```

Returnerer alle 6 milestones med korrekte open/closed-tællere.

## Bevidst fravalgt

- **Due-dates** — ikke i acceptance criteria, og brugeren kan tilføje via UI bagefter når faser har konkrete deadlines.
- **Lukkede issues** (#325, #326, #328, #329, #334, #339) er tilknyttet som historik per scope — viser sig som "closed" i milestone-tælleren.

## Audit-trail for ændringen

- Branch: `chore/567-milestones`
- Worktree: `C:\dev\CyclingZone-worktrees\chore-567-milestones\`
- Orkestreret af master-session 2026-05-23 (3 parallelle worktree-sessioner: #547 + #524 + #567)
- GitHub-side-arbejdet (milestones + attachments) udført af subagent; audit-doc + commit + PR udført af master-session pga. sandbox-restriktion i subagent.
