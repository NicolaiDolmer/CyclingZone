# UI viste handlinger som backend afviser (akademi-ryttere)

**Dato:** 2026-06-29
**Issue/PR:** #2007 / PR #2019 (EPIC #2000 Slice 3)
**Type:** latent UI/backend-kontrakt-mismatch (fundet under feature-arbejde)

## Symptom
Rytter-profilen (`RiderStatsPage.jsx`) viste "Start auktion" + "Sæt til salg" for ALLE
egne ryttere (`isMyRider`), inkl. egne AKADEMI-ryttere. Backend afviser begge for
akademi-ryttere med `rider_is_academy` (auktion: `getAuctionStartIssue`; transferliste:
POST `/api/transfers`-guard). Resultat: knapper der altid fejler ved klik.

## Rod-årsag
Gating-prædikatet brugte `isMyRider` (ejer) uden at skelne senior vs. akademi.
`is_academy` blev end ikke hentet i ryttersidens `riders`-SELECT, så fladen *kunne*
ikke skelne. Akademi-ryttere har deres eget flow (promote/demote), men UI'et
afspejlede ikke den backend-grænse.

## Fix
- Tilføj `is_academy` til SELECT → afled `isMySeniorRider = isMyRider && !is_academy`.
- Gate auktion + transferliste til `isMySeniorRider`; vis kun promote for akademi-ryttere.

## Lære (forward-guard)
Når backend har en GUARD der afviser en handling for en delmængde, skal UI'et gate
på SAMME diskriminator — ellers viser man knapper der garanteret fejler. Hent det
felt diskriminatoren kræver (her `is_academy`) i selve fladens query. Samme mønster
som [[feedback_match_ui_filter_for_capacity_logic]]: UI-filter = backend-filter.
