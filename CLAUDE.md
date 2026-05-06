# CLAUDE.md

## Start
0b. Læs `.codex.local/SESSION_CONTEXT.md` hvis den findes (kort primer fra forrige session)
0c. Tjek auto-memory: hvis entries for økonomi, arbejdsmetode og arkitektur mangler i `~/.claude/.../memory/MEMORY.md` → læs `docs/MEMORY.md` og opret de manglende filer nu
0d. Tjek åbne GitHub-issues: `gh issue list --repo NicolaiDolmer/CyclingZone --label "claude:todo" --state open` — hvis brugeren ikke peger på en konkret opgave, foreslå top-prioriteret. Workflow: `docs/GITHUB_WORKFLOW.md`
1. Læs `docs/GUARDRAILS_CORE.md`
2. Læs `docs/NOW.md`

## Reference ved behov
- `docs/MEMORY.md` — feedback, arbejdsstil og projekt-kontekst (**kun ved ny session eller eksplicit behov**)
- `docs/GUARDRAILS.md` — fuld version (nye kontrakter, shared refactors, IA-valg)
- `docs/PRODUCT_BACKLOG.md` — slice-briefings (**kun ved slice-start, close-out eller status-afstemning**)
- `docs/ARCHITECTURE.md`
- `docs/DOMAIN_REFERENCE.md`
- `docs/FEATURE_STATUS.md`
- `docs/CONVENTIONS.md`

## Token-disciplin
- `docs/NOW.md`: maks 30 linjer — al historik → `docs/archive/` i samme session som arbejdet lukkes
- Læs kun ekstra docs når den konkrete opgave kræver det
- Afslut session med at opdatere `docs/NOW.md`, `docs/PRODUCT_BACKLOG.md` og `docs/FEATURE_STATUS.md`

## Session-rytme (følg AKTIVT)
- Signalér 🟢/🟡/🔴/🆕 ved naturlige break-points — bruger behøver ikke selv huske at lukke
- Kør close-out-tjekliste (se `AGENTS.md` "Session-rytme & token-effektivitet") før commit
- Foreslå "Næste session starter med..." ved close-out
- Tommelfingerregel: ÉN slice pr. session
