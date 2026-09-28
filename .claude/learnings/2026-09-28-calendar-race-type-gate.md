# R16/R17 blev målt, men stoppede ikke næste kalender-apply

S4's kalender blev skrevet 27/9 med nye søgeregler for fordelingen af endagsløb og etapeløb. Ved efterfølgende kodeaudit viste en regressionstest, at `calendarScorecardReport.js` godt kunne rapportere et langt hul eller en skæv uge, mens `scorecardGateGroups(...).applyBlocking` stadig var tom. Generatorens fallback kan vælge en pakning uden R16/R17; uden apply-gaten kunne en fremtidig kalender blive skrevet med en synlig afvigelse.

Rettelsen fører begge typer fund til apply-gaten og tæller dem i placeringsdiagnostikken. Den historiske S3-fixture pakkes eksplicit uden de nye regler, så dens gyldne snapshot forbliver uændret. Nye kalendere bruger reglerne som default. Testen blev først kørt rød med to ublokerede fund, derefter grøn. Den fulde lokale test fangede retroaktiv S3-drift, som blev rettet før PR.

Læring: en rød scorecard-linje er ikke en gate, før dens fund er koblet til den kode der afviser `--apply`. Test både diagnosen, den faktiske apply-kategori og den historiske fixtur ved nye kalenderregler.

Refs #5830 #5506.
