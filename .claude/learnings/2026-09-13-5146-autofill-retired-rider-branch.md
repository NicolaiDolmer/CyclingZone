# Postmortem · 2026-09-13 · Løbsstartens autofyld væltede for alle hold ved guardens rytter-gren (#5146)

## Hvad skete der?
DB-guarden `guard_draining_ai_obligation` (#4753) har to grene: "AI team is draining" og "AI rider is retired". PR #5137 (#4959) håndterede kun hold-grenen i løbsstartens autofyld (TOCTOU: drop de drænende rækker, skriv resten). Ramte en batch-insert rytter-grenen (en AI-rytter pensioneret mellem udvælgelse og insert), aborterede hele statementet, og autofyldet væltede for ALLE hold i løbet. Fundet ved read-only review af #5137; ikke observeret i prod.

## Root cause
Et TOCTOU-fix der kun dækkede den ene af to symmetriske guard-grene. `isDrainingAiObligation` matchede begge grene, så kaldestedet kunne ikke vide hvilken genlæsning (teams vs. riders) der var relevant.

## Fix (PR #5190)
- `isRetiredAiRiderRejection` i `backend/lib/raceBinding.js` matcher KUN rytter-grenens RAISE-tekst.
- `dropRetiredRiderRows` i `backend/lib/raceRunner.js` genlæser `riders.is_retired` for batchens rider_ids og dropper kun de ramte rækker; resten skrives én gang.
- Test låser matcheren mod guardens egen SQL (læser RAISE-teksterne fra migrationsfilen), plus TOCTOU-simulering: første insert afvist med rytter-teksten, anden insert uden rytteren lykkes, og et andet hold påvirkes ikke.

## Læring
Når en guard har flere grene, skal enhver "drop de ramte rækker og prøv igen"-håndtering dække alle grene, og testen skal læse grenene fra guardens kilde, så en ny gren i SQL'en fejler testen i stedet for at vælte løbsstarten.
