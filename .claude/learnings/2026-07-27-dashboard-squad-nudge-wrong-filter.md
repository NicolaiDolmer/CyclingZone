# Postmortem · 2026-07-27 · Dashboard viste "udtagelse mangler" på en fuld trup (#3042)

## Hvad skete der?
Discord-bug 25/7: cybersimon rapporterede at Dashboardet viste "truppen er ikke fuld" på et løb, men klikkede han ind på selve løbet, var truppen fuld (8/8).

## Root cause
`DashboardPage.jsx`'s `squadSelectionMissingRace`-effekt talte selv `race_entries` med
`.eq("is_auto_filled", false)` — "har manageren manuelt valgt mindst én rytter?".
Løbssiden (`RaceSelectionPanel` via `GET /api/races/:id/selection` →
`backend/lib/raceSelection.js#getSelectionContext`) definerer derimod "fuld trup" som
`selection.rider_ids.length >= size.max` — ALLE entries (manuelle OG auto-fyldte af
`raceEntryGenerator`'s top-fill). Når `raceEntryGenerator` havde fyldt HELE truppen
automatisk (0 manuelle picks, men size.max auto-fyldte), talte dashboardets forespørgsel
0 og udløste den falske nudge — selvom truppen reelt var komplet.

Verificeret mod prod (SELECT only, ghwvkxzhsbbltzfnuhhz): 21 aktive team/race-par havde
`manual_count=0, total_count=size_max` i øjeblikket (Vuelta Ibérica 10 hold på 8/8,
Danmark Rundt/Tour des Hauts Plateaux/Vuelta a los Picos flere hold på 6/6) — samme
mønster som cybersimons rapport, ikke et enkeltstående edge case.

Endnu et tilfælde af det gentagne repo-mønster: "match UI'ets filter for kapacitets-/
tælle-logik" (jf. `feedback_match_ui_filter_for_capacity_logic`) — to steder i koden
tæller den "samme" ting med forskellige filtre.

## Fix
`frontend/src/pages/DashboardPage.jsx` — effekten kalder nu `GET /api/races/:id/selection`
(samme endpoint `RaceSelectionPanel` bruger) i stedet for en rå supabase-count.
Ny ren helper `frontend/src/lib/raceSquadSelectionStatus.js#isSquadSelectionMissing()`
sammenligner `selection.rider_ids.length` mod `size.max` — ingen dubleret tælle-logik.
PR: fix/3042-dashboard-squad-not-full.

## Forhindret-fremover
Ny unit-test `raceSquadSelectionStatus.test.js` binder direkte til #3042-reproet
("kun auto-fyldte entries, 0 manuelle" → IKKE missing) + tre andre kontrakt-cases
(delvis manuel < target → missing, tom → missing, flag OFF → aldrig missing).
Dashboardet henter nu samme payload som løbssiden i stedet for at genopfinde tællingen,
så en fremtidig kontrakt-ændring i `getSelectionContext` (fx en ny size-regel) automatisk
forplanter sig til begge flader.

## Læring
Når to UI-flader viser "samme" tal (her: er truppen fuld?), skal den ene enten kalde
den anden fladees kilde direkte, eller (hvis det er for dyrt) replikere PRÆCIS samme
filter — aldrig en approksimation der lyder rigtig ("manuelt valgt" ≈ "fuld") men
faktisk måler noget andet. Foretræk det første når kaldet er billigt (én ekstra GET
for ét løb, ikke N).
