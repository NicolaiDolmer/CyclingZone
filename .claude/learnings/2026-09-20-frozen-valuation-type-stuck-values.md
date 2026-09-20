# Vaerdier stod stille: frossen vaerditype + vaerdi og rating paa forskellige evner (#5416, #5443)

**Symptom:** spillere meldte 6/9 og igen 19-20/9 at ryttere udvikler sig uden at vaerdien flytter sig. #4872 blev lukket 7/9 som "ingen kodefejl, 36 ryttere".

**Rod-aarsag (to lag):**
1. `riders.valuation_type` blev frosset 4/8 (#3345). 849 ryttere paa menneskehold stod som `tt`, den eneste vaerditype med EEN vaegtet evne. Traen alt andet, og vaerdien staar stille.
2. Rating-opskrifterne (`displayRecipes.js`) blev gjort brede 13/8. Vaerdiens vaegte (`valuationWeights.js`) fulgte aldrig med. Rating og vaerdi regner derfor paa forskellige evner.

**Hvorfor det ikke blev fanget:** #4872 maalte "reelt fastlaaste" med en snaever definition (36) i stedet for at taelle hvor mange der sad paa den smalle type (849). En frysning uden udloebsdato og uden vagt blev staaende i syv uger.

**Rettet 20/9:** 396 ryttere (dem der stiger og ikke overskyder den kommende model) fik rigtig type. Resten foelger med den nye formel (#5443).

**Forward-guard (udestaar, #5443):** test der fejler hvis vaerdi-vaegte og rating-opskrift ikke daekker de samme evner; scorecard-baand paa samlet vaerdi (#5445).

**Proces-laering:** laes `docs/ECONOMY_RULES.md` FOER der stilles ejer-spoergsmaal om vaerdier. Naar en spiller-klage lukkes som "model-resultat", skal omfanget taelles bredt, ikke kun de vaerste tilfaelde. Enhver frysning skal have en udloebsbetingelse og et issue der ejer den.
