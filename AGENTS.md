# AGENTS.md

## Hard rule
- Brug kun dette repo: `C:\Users\ndmh3\OneDrive\Skrivebord\cycling-manager`
- Aldrig andre lokale kopier, sync-kopier eller zip-udpakninger
- Forkert mappe → stop og bed om realignment før du læser, ændrer eller kører noget

## Start
0. Kør `git rev-parse --show-toplevel` — bekræft repo-root
0b. Læs `.codex.local/SESSION_CONTEXT.md` hvis den findes
    - `.codex.local/supabase-readonly.env` kan bruges til read-only live-inspektion
    - Ekko aldrig credentials i chatten eller i committede filer
1. Læs `docs/GUARDRAILS.md`
2. Læs `docs/NOW.md`

## Reference ved behov
- `docs/ARCHITECTURE.md`
- `docs/DOMAIN_REFERENCE.md`
- `docs/FEATURE_STATUS.md`
- `docs/CONVENTIONS.md`
- `docs/TEST_SCENARIOS.md`
- `docs/DEPLOYMENT.md`

## Codex-specifikt
- `.codex.local/` indhold bruges men committes aldrig
