# Kæde-rækkefølge er en invariant, og generatorers referenceår skal følge sæsonen

**Dato:** 2026-08-28 · **Issues:** #4307, #4311, #4355 · **PR:** #4354

## Hvad skete der

To selvforskyldte fund i sæsonstart-sessionen:

1. **Kæden #4311 → #4307 blev kørt baglæns.** MASTERPLAN havde rækkefølgen ejer-godkendt netop fordi #4311 (fyld-klemmen dækker ikke afledte evner) skulle lukkes FØR trup-opfyldningen (#4307) skabte nye ryttere gennem hullet. Sessionen prioriterede den mest presserende gameplay-effekt (tynde trupper før kl. 11) og sprang derved over det led der beskyttede den. Resultat: 411 ryttere med taktik op til ~58 og 205 med potentiale over ejerens 2,5-loft — som derefter skulle repareres i prod (ekstra PR, ekstra prod-mutation, ekstra ejer-GO).

2. **Opfyldnings-scriptet genererede mod launch-årets referenceår.** `ageForSeason` = launch-år + (sæson-1) - fødselsår, så en genereret "39-årig" var 41 i sæson 3-termer — over karriere-NPV'ens hårde 40-års-grænse → `base_value` null → `deriveForRiderIds` kastede midt i live-kørslen.

## Læringer

- **En ejer-godkendt kæde-rækkefølge er en invariant, ikke et forslag.** Står der "A → B", så tjek FØR B køres at A er landet — også når B haster. Hastværk var hele grunden til at rækkefølgen fandtes.
- **Enhver rytter-generator skal tage sæsonens referenceår, ikke launch-årets.** `seasonReferenceYear(activeSeason)` er sandheden; `LAUNCH_POPULATION.referenceYear` er kun korrekt i sæson 1. Samme klasse som `.claude/learnings/2026-08-24-afledning-arver-ikke-generatorens-regler.md`: nedstrøms-formler (her alders-forankringen) arver ikke generatorens antagelser.
- **Positivt mønster der reddede kørslen:** opfyldningen var additiv med idempotens båret af selve `<12`-tjekket, ikke kun af markøren — derfor kunne den afbrudte kørsel genoptages sikkert efter fixet.

## Forward-guard

- `fillTailAbilityGate.test.js` (PR #4354) fejler hvis nogen skabelses-vej producerer fyld-ryttere over loftet — målt på afledningen.
- #4355 dækker det historiske juni-kuld med samme læk.
- SSOT for rytter-skabelses-bånd pr. vej udestår (ejer-ønske 27/8, jf. #4266-sporet) — indtil det findes, er svaret på "hvilke bånd gælder for denne generator?" kun i generatorens egen kode.
