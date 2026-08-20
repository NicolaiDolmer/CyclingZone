# Postmortem · 2026-08-20 · Falsk "mangler udtagelse"-notifikation på fuld trup (#4038)

## Hvad skete der?
Discord-spiller-rapport 20/8: "I have chosen who will ride the races but still
get notifications that say I haven't." Notifikationen "Squad selection needed"
blev sendt selvom holdets trup var fuld.

## Root cause
`backend/lib/selectionWarningSweep.js` definerede "mangler udtagelse" som
"ingen MANUEL entry" (`is_auto_filled=false` findes ikke for hold+løb) — IKKE
"trup under target-størrelse". Det matchede ikke løbssidens/Dashboardets
kanoniske kontrakt (`getSelectionContext`/`isSquadSelectionMissing`:
`entries.length >= size.max`, ALLE entries uanset auto/manuel).

Prod-verifikation (SELECT only, ghwvkxzhsbbltzfnuhhz): 26 `selection_warning`-
notifikationer sendt 20/8 for Tour des Fjords (ProSeries, mål 6/6) — næsten alle
med `total_entries=6, manual_entries=0`: FULDT auto-udfyldte trupper (af den
hver-time-kørende `raceEntryGeneratorSweep.js`) fik alligevel "mangler
udtagelse"-beskeden.

Dette er PRÆCIS samme fejl-klasse som #3042 (Dashboard-nudgen, postmortem
`.claude/learnings/2026-07-27-dashboard-squad-nudge-wrong-filter.md`) — bare i
et andet kode-spor (notifikations-sweepet i stedet for Dashboard-effekten).
#3042-fixet rettede kun dashboardets forespørgsel; notifikations-sweepet blev
aldrig opdateret til samme kontrakt, selvom det var en BEVIDST designbeslutning
(filhoved-kommentar 4/8): "kun-auto-udfyldt tæller stadig som mangler" — en
antagelse der ikke holdt, fordi beskeden selv tilbyder "let the assistant
auto-select for you", og assistenten/den auto-genererende sweep allerede HAR
gjort det for de fleste rammer hold.

## Fix
`teamsMissingSelection()` sammenligner nu `entryCountByTeam` (alle entries,
manuelle+auto) mod `selectionSizeForRace(race).max` — samme tælle-kontrakt som
`raceSelection.js#getSelectionContext`. `defaultFetchManualEntryTeamIdsByRace`
erstattet af `defaultFetchEntryCountsByRace` (tæller ALLE entries, ikke kun
`is_auto_filled=false`). `race_class` tilføjet til race-selecten så
`selectionSizeForRace` kan slå target-størrelsen op.
PR: fix/4038-falsk-udtagelses-notifikation.

## Forhindret-fremover
Ny regressionstest ("#4038 — fuldt AUTO-udfyldt trup (target nået) er IKKE
'mangler'") binder direkte til prod-repro'et. Fire tests dækker kontrakten:
delvist udfyldt → mangler, tomt → mangler, fuldt (manuelt ELLER auto) → IKKE
mangler, afmeldt → aldrig mangler.

## Læring
Samme mønster som #3042: når FLERE kodesteder skal svare "er trup X fuld?",
skal de dele ÉN kilde/kontrakt — ikke hver sin tilnærmelse. En "empirisk
begrundet" designbeslutning (kommentaren fra 4/8) kan stadig være forkert hvis
den ikke tjekkes mod den kontrakt resten af systemet allerede har (her:
`isSquadSelectionMissing`/`getSelectionContext` fandtes allerede, men blev
ikke genbrugt). Søg efter eksisterende "er X komplet?"-logik FØR man opfinder
en ny — jf. `feedback_read_existing_plans_before_building` i global memory.
