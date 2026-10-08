# #6095 · Taktik-gem overskrev alle etaper (2026-10-04)

## Hvad skete
Giro della Penisola 2/10: spilleren gemte etape 1-17 én ad gangen kl. 05:59-06:07. Kl. 15:19 skrev ét "Gem etape 2" alle 17 etapers intentioner om. Etape 1 (planlagt 11:00, kørt 19:05) blev også skrevet om, selvom UI'et viste den låst.

## Rod-årsag
- `PUT /stage-roles` var REPLACE for alle redigerbare etaper (`stage_number > stages_completed`). En kladde fra en anden fane/enhed overskrev alt.
- Serveren beskyttede kun kørte etaper, ikke etaper hvis start var passeret, mens ordre-API'et allerede havde `isStageLocked` på `scheduled_at`.
- Issuets hypotese (hydrering af kun den åbne etape) var forkert: `buildDraftMatrix` hydrerer alle etaper. Uden historik kan den præcise kladde ikke bevises.

## Rettelse (#6141)
`stageRolesWriteScope.ts`: klienten sender `stages` (ændrede etaper) + `base_versions`; serveren erstatter kun dem, afviser startede etaper og giver 409 ved samtidig ændring. Hele kladden sendes stadig, så ny frontend mod gammel backend i deploy-vinduet opfører sig som før.

## Læring
1. **REPLACE-endpoints skal være scope'et til det klienten faktisk ændrede.** En klient-kladde er altid potentielt forældet (flere faner, mobil + pc).
2. **Lås-regler skal håndhæves i ALLE skrive-API'er for samme flade.** Ordrer og intentioner havde forskellige lås.
3. **Deploy-vinduet er en del af kontrakten:** vælg en payload, hvor ny klient mod gammel server ikke er værre end i dag.
4. Verificér en issue-hypotese i koden, før du bygger på den.
