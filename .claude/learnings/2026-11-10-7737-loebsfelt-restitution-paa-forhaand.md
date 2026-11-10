# Træn nu gav løbsfeltets restitution på forhånd (10/11)

**Fejl:** ved et Træn nu-tryk før dagens løb blev det åbne løbsfelt regnet som "løb med
belastning 0" i den foreløbige opgørelse, så rytteren fik feltets restitution, før løbet var
kørt (morgen 50 → 40 ved hård træning, 15 ved hvile; uden tryk 50). Fundet af en uafhængig
Fable-dommer, ikke af de 400+ eksisterende tests eller tre reviews.

**Rodårsag:** opgørelsen kender kun "race" eller træning pr. felt; der var ingen tilstand for
"løb, endnu ikke kørt". Testene sammenlignede rekonstruktion med den samme forkerte opgørelse.

**Rettelse (#7970):** `pendingRaceSlots` i `settleDateFatigueV2`; et åbent løbsfelt springes
over (ingen belastning, ingen restitution). Ejerens regel 10/11 på #7737.

**Forebyggelse:** spillervendte tal testes mod en uafhængig referenceregel (ejerens ord), ikke
kun mod samme funktion; brug en dommer med kun reglerne som input før tænding af motorændringer.
