# Mock-rute brød generatorens regler i et ejer-billede (27/11)

**Hvad skete:** Billedet af planlægningssidens stigningsdetaljer (#8826/#8857) viste Tour de Preview etape 1 som flad massespurt med en kat. 4-stigning 18 km før mål. Ejeren: "Hvorfor er der en forkert rute med? Det må altså ikke ske mere".

**Rodårsag:** preview-mockens etaper (`frontend/src/preview/seedData.js`, `SEED_STAGE_PROFILES`) er håndskrevne og blev aldrig holdt op mod generatorens regler. Prod er ren: 0 af 381 flade S5-etaper og 0 af 95 flade S6-etaper (dry-run) har en stigning inden for de sidste 20 km.

**Rettelse:** stigningen flyttet til km 128.

**Forebyggelse:** `frontend/src/preview/seedRouteRealism.test.ts` holder alle mock-etaper på reglerne (flad: ingen kat. 1/2/HC og ingen stigning i de sidste 20 km; spurtafslutning: intet topmål; top aldrig efter mål). Udvid testen, når en ny regel kommer i generatoren. Før et ejer-billede: tjek at mock-indholdet er realistisk, ikke kun at UI'et virker.
