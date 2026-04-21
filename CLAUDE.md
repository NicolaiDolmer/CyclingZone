# CLAUDE.md — Entry for Claude Code

## Start
1. Læs `docs/RUNTIME_GUARDRAILS.md`
2. Læs `docs/AI_EXECUTION_STANDARD.md`
3. Læs `docs/NOW.md`

## Brug som reference ved behov
- `docs/ARCHITECTURE.md`
- `docs/DOMAIN_REFERENCE.md`
- `docs/FEATURE_STATUS.md`
- `docs/CONVENTIONS.md`

## Regler
- Runtime > docs
- Følg `docs/RUNTIME_GUARDRAILS.md` for guardrails, invariants og stop conditions
- Følg `docs/AI_EXECUTION_STANDARD.md` for task format og execution discipline
- Verificér frontend -> API -> engine -> DB før fix eller implementering
- Stop ved drift og skift til `investigation`

## Ved afslutning
- Opdater relevante current docs
- Opdater `frontend/src/pages/PatchNotesPage.jsx` ved enhver brugerrettet feature eller mærkbar adfærdsændring
- Opdater `frontend/src/pages/HelpPage.jsx` hvis ændringen påvirker regler, flow, FAQ, onboarding eller admin-brug
- Kør `npm run sync-docs`
