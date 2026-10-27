# 2026-10-27: liga-audit skjult i skipped check-suite (#7312)

Merge-køen for #7309 stoppede med rød/mangler trods grønne required checks og review-gate. `gh pr checks` og GraphQL statusCheckRollup udelod liga-auditen, mens REST viste success på den aktuelle HEAD. Auditen var tilknyttet en skipped Actions-suite. Genkørsel af både review-gate og audit ændrede ikke rollup-aflæsningen.

Rettelse: læs liga-checket fra pagineret REST check-runs på PR'ens HEAD. Kræv præcis ét check, korrekt SHA, navn, external_id og github-actions samt completed/success. Ukendt eller ugyldigt resultat stopper stadig køen. Review-gate og øvrige checks bruger deres eksisterende kontrol, og HEAD genkontrolleres før merge.

Bevis: ny regression først rød (manglende REST-funktion), derefter 13 grønne klassifikationsscenarier og real Get-PrPlanEntry-test uden liga-check i rollup. Køens regressioner: 65/65. Ingen spillerændring; patch note er derfor undtaget. Ingen produktionsdata ændret.
CodeRabbit-review på f4dbcb0cd fandt et yderligere læserace før auditten: required checks kunne gælde et tidligere HEAD. Ny regression blev set rød og derefter grøn; start-HEAD skal nu også være gyldigt og matche metadata-HEAD.
Ejer godkendte derefter en lukket CodeRabbit-erstatning for kun #7313/#7311 (27/10), med HEAD-bundet ejerbeslutning og udløb ved deadline. Standardgaten er uændret. Negative tests dækker forkert repo/PR/SHA, udløb, manglende ejer/Codex, ukendt eller skippet CodeRabbit-resultat og åbne tråde; kø-integration beviser, at required CI fortsat blokerer.
