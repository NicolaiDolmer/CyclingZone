# Postmortem · 2026-09-28 · Vision-slot-accept kolliderede med milepælen den erstattede (#5840)

## Hvad skete der?
Efter sæsonskiftet S3→S4 (27/9) fejlede `POST /api/board/meeting/sign` med 500, når manageren accepterede det nye visionsmål (Sentry CYCLINGZONE-6C, 10 events, 3 brugere pr. 28/9 kl. 10). Mandatet kunne kun underskrives ved at afslå visionsmålet.

## Root cause
`buildVisionSlotProposal` genererede erstatningen deterministisk: samme plantype, `generateBoardGoals(...)[0]` og slottets mål-sæson, når den stadig lå i fremtiden. Tidlig opfyldelse er tilsigtet (BOARD_RULES §0.1/A7), så den fremtidige mål-sæson er normalen. Resultatet blev præcis samme `milestone_key` som slot-rækken selv, og insert ramte `uq_board_vision_milestones_team_key (team_id, milestone_key)`. Test-mocken havde hverken unik-indekset eller et `from().insert` for tabellen, så accept-stien var aldrig testet.

## Fix
`backend/lib/boardMandateMeeting.js`:
- Forslaget kender nu alle holdets milepæle (pagineret). Det vælger først et mål, holdet ikke allerede har; ellers bruger det næste ubrugte nøgle-indeks. GET og sign bruger samme input.
- Efter CodeRabbit-review lukkes slottet betinget (`slot_open` true→false), FØR erstatningen indsættes. Kun det kald, der vinder claimet, skriver. Et samtidigt sign eller en 23505 giver 409 uden sideeffekter, og en insert-fejl genåbner slottet.
- Ingen migration. De rapporterede prod-fejl kastede ved insert, før slot-lukning og mandat-opdatering, så de efterlod intet og kan prøves igen. Den gamle rækkefølge (insert → luk slot) kunne i teorien efterlade en erstatning ved et åbent slot, hvis selve lukningen fejlede. Det er ikke set i Sentry, og den nye rækkefølge udelukker det.

## Forhindret-fremover
`boardMandateMeeting.test.js`-mocken spejler nu unik-indekset (samme disciplin som NOT NULL-spejlet fra #5359). Der er regressionstests for manager-accept, auto-accept, genforsøg efter fejl og kapløb.

## Læring
En deterministisk nøgle, der bygges ud fra genererede data, skal tjekkes mod den tabel, den skrives til. Et test-mock uden prod-constraints tester kun den glade sti.
