# Løbsfilmen viste et gammelt hul ved målet (#7900, PR #7910)

**Symptom:** feltet stod lige med vinderne i filmens målbillede, mens resultatlisten sagde fx +0:16. Sandhedsvagten R5 meldte det; 11 af 81 etaper på 48 timer.

**Rodårsag:** motoren melder kun `gap_update` ved målet for nogle af grupperne. Filmen bar derfor det seneste hul videre for resten, selv om `finish_time` i resultatet var rigtig. Vagten havde ret, filmen tog fejl.

**Rettelse:** målbilledet bygges af resultatets huller (`settleFinishOnResults` i `backend/lib/raceStory.js`), og filmen skifter først på målstregen, så grupperne før stregen er motorens. Motoren er ikke ændret.

**Forebyggelse:** R5 og filmen bygger nu ens, og reglen står i race-story-kontrakten. Bivirkning, der skal huskes: R5 kan ikke længere se, om motorens egne målhuller afviger fra resultatet.

**Læring om proces:** en rettelse på "sidste billede" kræver måling på alle billeder før stregen. Første version mistede grupper i 60 filmbilleder på 12 etaper; det fandt kun Codex' review og en 82-etapers måling, ikke testene. Mål hele filmen mod main, før et målbillede ændres.
