# #5967: En grøn browsertest overskrev et committet bevis

- CI-run 36680133171: desktop-shardens 262 browsertests bestod, men clean-tree-gaten fejlede, fordi #3517-testen ændrede `frontend/pr-screens/3517/after/mobile.png`.
- Rodårsag: testen brugte en direkte `pr-screens`-sti uden repoets eksisterende `evidenceShotPath`-kontrakt.
- Rettelse: begge screenshots går gennem `evidenceShotPath`. Standardkørsler skriver under `frontend/test-results/evidence`; den eksisterende eksplicitte `CZ_WRITE_COMMITTED_SHOTS=1`-vej til manuelle beviser bevares.
- Assertions, viewports og clean-tree-gaten er uændrede. Det committede screenshot opdateres ikke som løsning.
- Læring: Beståede assertions er ikke hele testens kontrakt. Kontroller også filsystemets sideeffekter, og brug den fælles artefakt-helper.
