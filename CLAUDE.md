# CLAUDE.md — Regler for Claude Code

## Ved SESSION START
1. Læs docs/NOW.md for aktuel status
2. Brug docs/ARCHITECTURE.md som reference — spørg ikke om ting der står der
3. Brug docs/DOMAIN_REFERENCE.md for spilleregler og domæneviden

## Under arbejdet
- Dansk i UI og dokumentation, engelske variabelnavne i kode
- Opdatér docs/ løbende hvis du tilføjer endpoints, tabeller eller routes

## Ved SESSION AFSLUTNING — OBLIGATORISK
Kør altid følgende når arbejdet er færdigt:
1. Opdatér docs/NOW.md: flyt færdige opgaver, tilføj nye bugs
2. Opdatér docs/FEATURE_STATUS.md hvis features har skiftet status
3. Opdatér docs/ARCHITECTURE.md hvis der er nye endpoints/tabeller/routes
4. Commit docs/-ændringer: `git add docs/ && git commit -m "docs: sync after session"`

Disse trin er ikke valgfrie. De sikrer at næste session starter med korrekt kontekst.

## Docs-struktur
- docs/NOW.md — aktuel status (opdateres hver session)
- docs/FEATURE_STATUS.md — hvad er bygget og hvad mangler
- docs/ARCHITECTURE.md — teknisk reference
- docs/DOMAIN_REFERENCE.md — spilleregler
