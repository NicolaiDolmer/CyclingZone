# 2026-10-29: #6469 forklaringer manglede på etapeside v2

Problem: PR #7275 koblede den rene narrative afledning ind i den klassiske historie og film. Stage-fanen på etapeside v2 læste serverens story gennem curateMoments og fik derfor ingen forklaringer, selv med relevante gemte hændelser.

Årsag: visuelt bevis dækkede kun den klassiske læser. Et grønt modeltestspor og integration med main beviste ikke, at alle aktive forbrugere brugte ændringen.

Rettelse: v2 genbruger afledningen og eksisterende godkendte tekstnøgler. Forklaringer hæftes på et konkret valgt udfald uden at fortrænge andre øjeblikke. Det eksisterende eget-holdordreopslag deles med Your orders; ukendte svar giver ingen ordretilskrivning. Motor og gemte resultater ændres ikke.

Bevis: ny v2-modelregression observeret RED på manglende forklaringer og derefter GREEN. Browserregressioner dækker den faktiske Stage-fane, autoritativ ordre over stage-role-fallback, fejlet ordreopslag og mobil/desktop. Endelige målinger og SHA står på PR #7275.

Forebyggelse: følg alle aktive forbrugere fra feature-flag og route til renderer, og optag visuelt bevis på den flade spilleren faktisk får. Det tidligere ITT-P2 er særskilt i #7329 og erklæres ikke rettet for den klassiske læser.

Patch notes og spillertekst ejes af Claude; denne rettelse genbruger PR'ens eksisterende copy. Ingen feature-state eller flag ændres.
