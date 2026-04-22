# AGENTS.md — Entry for AI Agents

## Start
0. Verificér at du står i en rigtig git-worktree:
   - kør `git rev-parse --show-toplevel`
   - bekræft at aktiv arbejdsmappe matcher repo-root eller bevidst valgt submappe i samme repo
   - hvis kommandoen fejler, eller mappen ikke er en repo, så stop og bed om korrekt sti før du fortsætter
0b. Læs lokal maskinkontekst hvis den findes:
   - læs `.codex.local/SESSION_CONTEXT.md`
   - hvis `.codex.local/supabase-readonly.env` findes, må den bruges til read-only live-inspektion
   - ekko aldrig credentials tilbage i chatten eller i committede filer
1. Læs `docs/RUNTIME_GUARDRAILS.md`
2. Læs `docs/AI_EXECUTION_STANDARD.md`
3. Læs `docs/NOW.md`

## Brug som reference ved behov
- `docs/ARCHITECTURE.md`
- `docs/DOMAIN_REFERENCE.md`
- `docs/FEATURE_STATUS.md`
- `docs/CONVENTIONS.md`
- `docs/TEST_SCENARIOS.md`
- `docs/DEPLOYMENT.md`

## Regler
- Runtime > docs
- Følg `docs/RUNTIME_GUARDRAILS.md` for guardrails, invariants og stop conditions
- Følg `docs/AI_EXECUTION_STANDARD.md` for task format og execution discipline
- Verificér frontend -> API -> engine -> DB før fix eller implementering
- Stop ved drift og skift til `investigation`
- Lokal maskinkontekst og lokale credentials i `.codex.local/` må gerne bruges, men må aldrig committes

## Ved afslutning
- Opdater relevante current docs
- Opdater `frontend/src/pages/PatchNotesPage.jsx` ved enhver brugerrettet feature eller mærkbar adfærdsændring
- Opdater `frontend/src/pages/HelpPage.jsx` hvis ændringen påvirker regler, flow, FAQ, onboarding eller admin-brug
- Kør `npm run sync-docs`
