# To grønne PR'er gav rød main på ui-lint (17/11)

**Hvad:** #8310 (T03) indførte en lint-regel mod `rounded-sm`. #8273 (v6 Startliste) var grøn mod en ældre main og brugte `rounded-sm` to steder. Begge blev merget kort efter hinanden. Main blev rød på `static-guards` (lint-ui-slop), og pre-commit stoppede alle frontend-commits, indtil #8329 rettede det.

**Rodårsag:** en PR, der skærper en regel, og en PR, der bryder den nye regel, testes hver for sig mod main, men aldrig sammen. Branch protection er ikke strict (ejervalg 4/8), så en grøn PR kan være bagud for en regel.

**Forebyggelse:** GitHubs merge-kø, der tester PR'er sammen før main (CI-plan trin 5, #8331, weekenden 21-22/11). Indtil da gælder det, at en PR, der indfører en ny lint- eller guard-regel, skal efterfølges af et kørsels-tjek af de åbne PR'er med de filer, som reglen rammer (`node scripts/lint-ui-slop.mjs` på hver åben branch) før næste merge.
