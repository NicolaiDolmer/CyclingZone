# Postmortem · 2026-10-30 · Transferliste efter akademi-frigivelse (#7284) + sæsonhul i transferhistorik (#7285)

## Hvad skete der?
#7284: 11 junior/U23-ryttere stod stadig på transferlisten efter at være fyret fra akademiet eller frigivet ved graduering. #7285: 244 handler fra 26-27/10 (efter S4's slutdag, før S5's start) blev vist under sæson 4.

## Root cause
#7284: `closeTransferListingsForRiders` blev kaldt i senior-fyring, kontraktudløb, pension og trupkontrol, men ikke i akademi-fyringen (`POST /riders/:id/academy-release`) og de to release-grene i `academyGraduation.js`. #7285: `buildSeasonResolver` (`teamTransferHistory.js`) faldt i hullet mellem to sæsoner tilbage på "senest startede sæson", altså den forrige.

## Fix
#7284: 419c172 (#7394): alle tre stier lukker listings best-effort (fejl til Sentry, bogføring springes aldrig over) + dry-run-reparationsscript `scripts/7284-withdraw-orphan-listings.mjs`. #7285: #7393: et event i hullet hører til den kommende sæson; reglen står i `docs/TRANSFER_MARKET_RULES.md`.

## Forhindret-fremover
Tests pr. release-sti (`academyGraduation.test.js`, `academyRelease7284.test.js`) og grænsedags-tests for resolveren (25/10, 26/10, 28/10).

## Læring
En "rytteren forlader holdet"-invariant skal gælde ALLE stier: når en ny sti tilføjes (akademi, graduering), så søg efter alle steder der rydder op efter et holdskifte (race_entries, listings) og kald dem alle. Sæsonhuller mellem `end_date` og næste `start_date` er reelle i prod og skal have en eksplicit regel.
