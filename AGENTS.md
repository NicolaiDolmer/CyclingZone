# AGENTS.md

## Hard rule
- Brug kun den aktuelle bekræftede repo-root fra `git rev-parse --show-toplevel`
- Aldrig andre lokale kopier, sync-kopier eller zip-udpakninger
- Hvis repo-root ikke matcher den workspace-mappe brugeren aktuelt har angivet → stop og bed om realignment før du læser, ændrer eller kører noget

## Start
0. Kør `git rev-parse --show-toplevel` — bekræft repo-root
0b. Læs `.codex.local/SESSION_CONTEXT.md` hvis den findes
    - `.codex.local/supabase-readonly.env` kan bruges til read-only live-inspektion
    - Ekko aldrig credentials i chatten eller i committede filer
1. Læs `docs/GUARDRAILS_CORE.md`
2. Læs `docs/NOW.md`

## Token-effektiv kontekst
- Læs kun dokumenter ud over startlisten, når opgaven konkret kræver dem.
- Læs `docs/GUARDRAILS.md` ved: nye datakontrakter, IA/naming-valg, shared runtime-refactors eller features med flere plausible produktmodeller.
- Læs `docs/PRODUCT_BACKLOG.md` og `docs/FEATURE_STATUS.md` ved slice-start, status-afstemning og close-out — ikke som standard ved hver lille bugfix.
- Ved Supabase/live-inspektion: start med målrettede `npm run db:ai:*` kommandoer frem for brede dumps.

## Reference ved behov
- `docs/ARCHITECTURE.md`
- `docs/DOMAIN_REFERENCE.md`
- `docs/FEATURE_STATUS.md`
- `docs/CONVENTIONS.md`
- `docs/TEST_SCENARIOS.md`
- `docs/DEPLOYMENT.md`

## Codex-specifikt
- `.codex.local/` indhold bruges men committes aldrig
- Ved alle brugerrettede feature-, fix- eller runtime-ændringer skal patch notes opdateres på hjemmesiden i `frontend/src/pages/PatchNotesPage.jsx`
- Opret ikke separate docs-only patch notes; hjemmesidens Patch Notes er den brugerrettede sandhed
- Efter hver afsluttet feature/fix skal `docs/NOW.md`, `docs/PRODUCT_BACKLOG.md` og `docs/FEATURE_STATUS.md` afstemmes mod runtime, så næste session ikke starter en allerede lukket opgave igen
