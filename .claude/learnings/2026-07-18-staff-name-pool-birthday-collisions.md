# Staff-navnepulje: birthday-paradox-kollisioner ved liga-skala (#2643 → PR #2658)

## Symptom
Spiller-rapport (Discord): "samme person er ansat hos to hold". Prod: 60 aktive
`team_staff`-rows, kun 28 distinkte navne — 78% af rows delte navn med et andet hold.

## Rod-årsag
`STAFF_NAME_POOL` havde 40 navne; hvert hold trækker uafhængigt (deterministisk
pr. (teamId, season, role)) fra samme pulje. 40 hold × 5 roller mod 40 navne →
birthday-paradox gør cross-team-sammenfald næsten sikre. Ikke en bug i trækket —
en dimensioneringsfejl i indholdet.

## Fix
Content-only: pulje 40→150 håndkuraterede fiktive navne (oprindelige 40 uændret
først — DB-rows og seed-kontrakt urørt). Sim ved prod-skala: 75%→35% kolliderende
rows (nær teoretisk gulv for uniformt træk). Regressionstest låser pulje ≥120 +
kollisionsrate <50% i deterministisk prod-skala-scenarie.

## Læring
1. **Dimensionér content-puljer mod population, ikke mod æstetik.** En pulje der
   trækkes uafhængigt pr. entitet skal være ~2,5-3× forventede samtidige træk for
   at holde sammenfald på undtagelses-niveau; ved træk ≥ puljestørrelse er
   kollisioner matematisk uundgåelige uanset kuratering.
2. **Forward-guard som statistisk test:** deterministiske seeds gør en
   kollisionsrate-assertion stabil — den bider hvis puljen trimmes eller trækket
   skævvrides, uden flakiness.
3. Pulje-ændringer reshuffler deterministiske kandidat-træk → forvent re-seed af
   test-fixtures der forudsætter et bestemt draw (her scoutingFacilityIntegration).
