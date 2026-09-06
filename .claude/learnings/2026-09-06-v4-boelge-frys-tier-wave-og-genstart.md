# 6/9: v4-bølgen. Tre frosne workers, en genstart der kostede 5 timer, og TIER WAVE

## Hvad skete
- Natsession 5-6/9 (audit → 7 designbeslutninger → byggekø). Computeren blev genstartet ~12:35; alle kørende workers og workflowet døde. Fire laner havde INTET pushet efter 2-4 timers arbejde (holdspil, M9, M11, M12) → ~5 timers arbejde tabt. Fire andre laner havde pushet og overlevede som PR'er (#4891-#4894).
- Tre agenter frøs uden fejl (tre-krav-lanen i nat, M12 to gange i dag). Den ene af M12-frysene var en fejlklassifikation: agenten arbejdede i en undermappe (`worktrees/m12lane/...`), mit tjek kiggede i en antaget sti.
- En 90-minutters lane brugte 50-60 % af tiden på verifikation der blev gentaget i CI (fuld backend-suite, harness på både main og branch, alle 3 e2e-projekter for én i18n-nøgle). 5-6 workers på én PC gjorde hver kørsel 2-3× langsommere; mit eget måle-script nåede ikke igennem på 2 min.

## Rod-årsager
1. Ingen push-kadence i praksis: briefen sagde "push hvert 15. min", men ingen livstegn-krav ved start og ingen måling fra orkestratoren.
2. Frys-detektion baseret på notifikationer (kommer aldrig ved frys) og på antagede mappestier.
3. Verifikations-tier for enkelt-sessioner (TIER FULL) anvendt på bølge-workers, hvor CI allerede er fuld gate.

## Ændret (ejer-godkendt 6/9)
- **TIER WAVE** i `docs/AI_OPS_REFERENCE.md` + `NIGHT_WAVE_RUNBOOK.md` §Agent-regler: målrettede tests + tsc + preflight lokalt, CI er fuld gate, harness-baseline én gang pr. main (`backend/scripts/out/baseline/`), maks 3 byg-workers pr. PC, fuld e2e lokalt kun ved markup/snapshots.
- **Livstegn:** push inden 10 min (tom commit ok), derefter hvert 15. min. Orkestratoren måler hvert 15. min på BRANCH (`git worktree list` + `origin/<branch>`), aldrig på en antaget sti. Tavs >45 min = stop + recovery-worker i samme worktree med målt WIP (commits ahead, dirty filer, sidste fil), reset aldrig.
- Recovery virkede: løbsside-lanen (7 commits + stort ukommitteret træ) blev overtaget uden tab.

## Hvad der ikke må gentages
- At merge fem PR'er i kæde uden at genkøre tests på det samlede resultat: gik godt (371/371 lokalt bagefter), men "Deploy verify" blev rød i de sekunder hvor fem Railway-deploys afløste hinanden. Merge én ad gangen med mindst et par minutters mellemrum, eller vent på deploy før næste.
- At antage at en agent er frossen ud fra én signalkilde.

Refs: #3855, #4632, #2944, #2582, docs/superpowers/specs/2026-09-06-race-engine-v4-flip-and-tactics-design.md
