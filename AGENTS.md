# AGENTS.md

## Hard rule
- Brug kun den aktuelle bekræftede repo-root fra `git rev-parse --show-toplevel`
- Aldrig andre lokale kopier, sync-kopier eller zip-udpakninger
- Hvis repo-root ikke matcher den workspace-mappe brugeren aktuelt har angivet → stop og bed om realignment

## Start
0. Kør `git rev-parse --show-toplevel` — bekræft repo-root
0b. Læs `.codex.local/SESSION_CONTEXT.md` hvis den findes (kort primer fra forrige session)
1. Læs `docs/GUARDRAILS_CORE.md`
2. Læs `docs/NOW.md`

## Token-effektiv kontekst
- `docs/MEMORY.md`: læs kun ved ny session eller eksplicit behov — ikke ved hver bugfix
- `docs/GUARDRAILS.md`: læs ved nye datakontrakter, IA/naming-valg, shared runtime-refactors
- `docs/PRODUCT_BACKLOG.md` og `docs/FEATURE_STATUS.md`: læs ved slice-start og close-out
- Supabase-inspektion: start med målrettede `npm run db:ai:*` frem for brede dumps

## Reference ved behov
- `docs/ARCHITECTURE.md`
- `docs/DOMAIN_REFERENCE.md`
- `docs/FEATURE_STATUS.md`
- `docs/CONVENTIONS.md`
- `docs/TEST_SCENARIOS.md`
- `docs/DEPLOYMENT.md`

## Codex-specifikt
- `.codex.local/` bruges lokalt men committes aldrig (gitignored)
- Opdatér `.codex.local/SESSION_CONTEXT.md` ved session-slut (se format herunder)
- Ved alle brugerrettede ændringer: opdatér `frontend/src/pages/PatchNotesPage.jsx`
- Efter afsluttet slice: afstém `docs/NOW.md`, `docs/PRODUCT_BACKLOG.md` og `docs/FEATURE_STATUS.md`

## SESSION_CONTEXT.md format
Fil: `.codex.local/SESSION_CONTEXT.md` — opdatér ved session-slut, maks 15 linjer.

```
# Session context — [dato]

Aktiv slice: [slice-navn]
Status: [in_progress | completed]

Seneste handlinger:
- [hvad der blev gjort]

Næste handlinger:
- [konkret næste skridt]

Kritiske facts:
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000
- [andet relevant for næste session]
```

## Cross-PC setup
Ved ny PC: kopier template til lokal Codex-mappe:
```bash
cp -r .codex.local.template/ .codex.local/
```
Tilpas `.codex.local/supabase-readonly.env` med lokale credentials.
