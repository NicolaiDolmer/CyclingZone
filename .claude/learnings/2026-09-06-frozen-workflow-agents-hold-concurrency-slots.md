# 2026-09-06: Frosne workflow-agenter holder deres samtidigheds-plads; per-spor-timeout frigiver ikke lanen

## Hvad skete

Natbølge 5-6/9 (26 spor, lane-pool over Workflow-tool, 6+3 laner). Seks agenter frøs i løbet af natten (01:07, 01:08, 01:12, 01:45, 01:50, 04:07), alle midt i et almindeligt Bash-kald: `git push`, `sed -n`, `node --test`, `gh pr checks | grep`, `cat NOW.md` og et `sleep 5; cat` mod en dev-server-log. Transcript-mtime stod stille, worktree'et var uændret, og kaldet fik aldrig et tool_result. De samme kommandomønstre (`cd X && ...`, `W="..."; ...`) lykkedes 98 af 99 gange hos andre agenter, så det var ikke et mønster, men sporadiske harness-frysninger (ca. 6 af 30 agenter).

Per-spor-timeouten (`Promise.race`) fyrede som designet og lod lanen gå videre i køen. Men den nye `agent()` startede ikke: den frosne agent holdt stadig sin plads i workflowets samtidigheds-loft (min(16, CPU-2) = 6), så det nye kald stod i kø bag den. Bølge A kørte reelt på 2 laner fra 01:12 til 03:50 uden at det kunne ses i /workflows.

## Hvorfor det ikke blev fanget

- Runbookens stall-watch måler transcript-mtime og worktree-fremdrift, ikke om workflowets loft er optaget af døde pladser.
- `started`/`result`-tallene i journalen så rigtige ud: nye spor startede, bare langsommere.
- Hard rule 21 (per-agent-timeout) blev læst som "lanen er fri igen". Den beskytter kun barrieren.

## Hvad der virkede

- Hvert spor pushede tidligt og oprettede sin egen PR, så fire af de seks frosne spor havde arbejdet liggende (pushet commit, eller dirty filer i worktree'et). Recovery-workers i SAMME worktree (bølge C, D, F) færdiggjorde dem uden tab.
- At stoppe hele workflow A og relancere de resterende spor som en ny bølge (E) på 6 rene laner gav fuld kapacitet igen på fem minutter og kostede kun to agenters kontekst.
- Enkelt-agenter kan ikke stoppes (`TaskStop` kender hverken agentId eller label), så "stop workflowet, relancér resten" er den eneste kirurgi der findes.

## Regel fremover (natbølge-runbook)

1. **Stall = tab af lane, ikke bare tab af spor.** Ved bekræftet frys (transcript-mtime > 25 min uden fremdrift i worktree'et): stop workflowet og relancér de ustartede spor + recovery af de frosne i samme worktrees. Vent ikke på timeouten.
2. **Recovery-brief skal indeholde WIP-status målt i worktree'et** (commits ahead, pushed?, dirty filer) og "reset aldrig".
3. **Monitor-scriptet skal tælle frosne agenter mod loftet** og advare når `frosne >= laner/3`.
4. Kommandodisciplin i briefs (én linje, absolutte stier, ingen `sleep`) reducerer ikke frys-raten målbart, men gør recovery lettere at læse. Behold den.

Refs #605, docs/NIGHT_WAVE_RUNBOOK.md §Anti-hang.
