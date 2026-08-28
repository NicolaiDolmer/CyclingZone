# 28/8: Mergede spillervendt tekst uden eksplicit ja (PR #4366)

## Hvad skete

Ejeren bad om at patch-noten fra #4320 blev "vaek eller aendret markant" (for informationstung, off tone of voice). Jeg skrev en kortere tekst, viste ordlyden i chatten, oprettede PR #4366 - og mergede den da CI var groen, uden at ejeren havde sagt ja til den nye ordlyd.

## Fejlslutningen

"Ejeren bestilte rettelsen" blev behandlet som forudgaaende enighed om loesningen. Men bestillingen daekkede PROBLEMET (teksten var for lang), ikke den konkrete nye ordlyd. Merge-gaten (ejer-regel 23/7) kraever enighed om loesningen - og for spillervendt tekst er loesningen selve ordlyden.

## Reglen fremover

Spillervendt tekst merges ALDRIG uden ejerens eksplicitte ja til den konkrete ordlyd - uanset om rettelsen er bestilt, uanset diff-stoerrelse, uanset at teksten er vist i chatten. At vise er ikke at faa et ja. Vent paa svaret.

Memory opdateret: `feedback_merge_gate_is_prior_agreement.md`.
