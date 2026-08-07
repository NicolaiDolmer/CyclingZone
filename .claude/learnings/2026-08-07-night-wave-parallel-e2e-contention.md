# 2026-08-07 — Natbølge-orkestrering: parallelle e2e-suiter + passiv venten kostede 2+ timer

## Symptom
Aftenbølge med 15 opgaver: første 2/3 leverede i højt tempo, sidste 1/3 gik nærmest i stå. 4 agenter "kørte" i 2+ timer uden commits; ejeren opdagede stilstanden før orkestratoren (2 gange).

## Rodårsager (orkestrator-fejl, ikke agent-fejl)
1. **NIGHT_WAVE_RUNBOOK.md blev ikke læst før launch.** Den foreskriver stall-watchdog, chunking, keep-awake og recovery-protokol — alt det der manglede.
2. **Op til 5 fulde Playwright-suiter parallelt på én maskine.** Målt effekt: suite-tid 15-25 min solo → 1,5-2+ timer under kontention, plus flake-storme (op til 31 falske fejl pr. kørsel) der udløste isolerede genkørsler. Seriel kørsel efter omlægning: 9,6 min, 0 fejl.
3. **Kendt baggrunds-vente-fælde ikke forebygget.** Memory siger at baggrunds-vent er upålidelig på denne PC, men de første agent-prompts manglede "vent aldrig, poll logfiler direkte". 3+ agenter endte i passiv venten på notifikationer der aldrig kom.
4. **Ingen aktiv overvågning.** Orkestratoren ventede selv passivt på task-notifikationer i stedet for ground-truth-tjek (filaktivitet + prosesliste) hvert ~10. minut.

## Hvad virkede (behold)
- Ét issue = én agent = ét worktree = én PR; merge-i-rækkefølge for samme-fil-PR'er (dashboard-kæden).
- TaskStop + recovery i SAMME worktree (runbook-protokollen): alle 4 strandede spor reddet uden tab af arbejde (én lå i git-stash).
- Done-flip PR-for-PR umiddelbart efter merge.

## Forward-guard
- FØR enhver bølge: læs NIGHT_WAVE_RUNBOOK.md (står allerede i CLAUDE.md — regel eksisterede, blev sprunget over).
- Agent-prompt-skabelon SKAL indeholde: "kør alt forgrundet, vent aldrig på baggrunds-notifikationer, poll logfiler direkte" + "re-kør fejlede specs isoleret ved bred kontention".
- Maks ÉN fuld e2e-suite ad gangen pr. maskine: implementering må gerne være parallel, verifikation er seriel (test-slot ejes af ét spor ad gangen).
- Orkestrator-loop: ground-truth-tjek (worktree-filaktivitet + node-processer) hvert ~10. min; 2 tjek uden fremdrift = TaskStop + recovery.
