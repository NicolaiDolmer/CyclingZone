# Akademi derive-hale: kode-fix ≠ data-fix for eksisterende rækker

**Dato:** 2026-06-19 · **Issue:** #1478 (+ #1308) · **Trigger:** jeppek Discord-feedback (akademiryttere "fortsat" ikke trænbare + uden ryttertype, dagen efter natbølge-fixet)

## Hvad skete
PR #1493 lukkede 4 akademi-bugs ved at rette generation/intake-koden (academyGenerator sætter nu height/weight; academyIntake kører derive-kæden). Issue blev lukket som `claude:done`. Men de akademiryttere der allerede var signet 18/6 — **før** fixet — beholdt den brudte tilstand: NULL height/weight, ingen `rider_derived_abilities`, ingen ryttertype, ingen base_value. Træning-engine springer ryttere uden afledte evner over → "kan ikke trænes". 11 af 20 akademiryttere ramt i prod.

## Rod-årsager / lektioner
1. **En kode-fix til generation/intake retter ikke rækker der allerede er oprettet.** "Issue = done" (koden) ≠ "live-state = fikset" (dataen). Klassisk label≠live-state. PR-beskrivelsen sagde det selv ("kræver engangs-backfill hvis go-live uden relaunch") — men det blev ikke kørt, og issue blev lukket. **Verificér altid mod prod-data, ikke kun mod merged kode.**
2. **Backfill skal sætte height/weight FØR derive.** `seedPhysiologyFromLegacy` defaulter NULL h/w til 180cm/70kg (physiologySeeding.js linje 46-47) → ens kroppe → udifferentierede watt/abilities. Det var præcis det academyGenerator's h/w-spredning undgik for nye ryttere. Backfillen gen-brugte samme gaussian-fordeling (deterministisk seed pr. rytter-id).
3. **Supabase `.select()` capper ved 1000 rækker (PostgREST default).** Et globalt `rider_derived_abilities`-select til at bygge et "har-allerede-derived"-sæt var stille trunkeret → 3 ryttere falsk-flagget som targets. Fanget via count-mismatch mod SQL-JOIN-sandheden (11 vs 14). **Scope membership-queries med `.in(ids)` eller brug `fetchAllRows`-paginering — stol aldrig på et utrunkeret bulk-select.**

## Fix
`backend/scripts/dev/backfillAcademyDeriveTail.js` (commit `ba6e5aa9`): h/w-spredning + `deriveForRiderIds` for de 11 fiktive akademiryttere. Prod-verificeret: 20/20 derive+type+base_value, 0 mangler h/w. Rørte ikke de 6 ægte PCM-akademiryttere (real-world-navne = åben ejer-beslutning).

## Forward-guard
Når en generation/intake-bug fixes: tjek om eksisterende rækker også skal backfilles, og kør/verificér det i SAMME slice — luk ikke issue på kode-merge alene.
