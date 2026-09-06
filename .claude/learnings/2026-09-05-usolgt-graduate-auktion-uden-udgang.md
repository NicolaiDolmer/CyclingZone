# Postmortem · 2026-09-05 · Usolgt graduate-auktion havde ingen udgang (#4495)

## Hvad skete der?
Akademiryttere der blev sat til salg ved graduering, men som ingen bød på, blev fanget i akademiet for altid: `is_academy=true` hos sælgeren, uden for trup-cappen, uden nogen sti videre. Målt 31/8: 8 ryttere på 22-23 år på 6 hold (5/9: 6 ryttere på 4 hold). Det var også rod-årsagen bag #4484, hvor graduerings-sweepet fejlede 23 gange på én nat, fordi de fastlåste ryttere blev fundet som graduates igen næste sæson og fik en ekstra grad-række.

## Root cause
`createGraduateAuction()` i `backend/lib/academyGraduation.js` lader bevidst rytteren stå `is_academy=true` mens auktionen kører, og docblokken lovede ordret at finalization satte `is_academy=false` "ved salg / free agent ved ingen bud". Kun den første halvdel fandtes: `auctionFinalization.js` satte `graduatePatch` UDELUKKENDE på vinder-stien (`if (effectiveBidderId)`). Uden bud faldt koden ned i no-bid-grenen, lukkede auktionen som `completed` og rørte aldrig rytteren. Grad-rækken var imens stemplet `sold` allerede da auktionen blev OPRETTET, så tilstanden var uigenkaldelig.

## Fix
- `academyGraduation.releaseUnsoldGraduate()` (ny): den dokumenterede udgang, fri agent, conditional update (`id` + `team_id` + `is_academy=true`) så den er idempotent.
- `auctionFinalization.js`: no-bid-grenen kalder udgangen efter `closeAuction`; den garanterede bank-handel flipper nu også `is_academy` (samme latente klasse).
- `backend/lib/stuckAcademyGraduates.js` (ny): ét delt prædikat.
- `ownershipInvariantWatch` invariant G + `backend/scripts/repairStuckAcademyGraduates.js`.
- `docs/YOUTH_RULES.md` §2.2/§4/§7. PR #4789.

## Forhindret-fremover
- Daglig read-only invariant-vagt (G) med 48t grace, så et legitimt override-vindue ikke giver falske positiver.
- 18 nye tests, heraf en eksplicit forward-guard: en usolgt SENIOR-auktion må ALDRIG røre rytteren (uden `is_academy`-gaten ville fixet fyre sælgerens rytter ved enhver usolgt auktion).
- Reparations-scriptet deler prædikat med vagten, så dry-run og apply ikke kan divergere.

## Læring
**En docstring der beskriver to udfald, hvor koden kun implementerer det ene, er en tikkende bombe.** Kommentaren så ud som dokumentation af eksisterende adfærd, men var i virkeligheden et design-løfte ingen havde indfriet, og den maskerede hullet i to måneder. Når en tilstand er en bevidst MELLEMTILSTAND (her: rytteren står uden for cappen mens auktionen kører), skal ALLE udgange fra den tilstand kunne peges på i koden, ikke kun den glade sti. Grep efter hver terminal-status (`completed`, `cancelled`, no-bid) og spørg: hvem rydder op i mellemtilstanden HER? Beslægtet: [feedback_docstring_is_a_claim_not_a_spec].
