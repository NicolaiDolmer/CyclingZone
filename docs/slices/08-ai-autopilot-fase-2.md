# Slice 08 — AI-Autopilot Fase 2

## Mål
Etablering af world-class AI-autopilot workflow (Fase 2 af skalerings-roadmap). Dette inkluderer automatiserede tests ved hvert push og integration af Manus som den centrale orkestrator for loop D (Auto-PR-review) og Loop F (Subagent-orkestrering).

## Runtime-evidens
- `.github/workflows/ci.yml`: Eksisterende CI-workflow kører tests på push/PR.
- `docs/GITHUB_WORKFLOW.md`: Beskriver visionen for agent-loopet.
- `docs/AI_LOOPS.md`: Definerer Loop D og F som fremtidige mål.

## Invariant der beskyttes
- Ingen kode merges til `main` uden at passere alle tests.
- AI-genereret kode skal gennemgå et automatiseret review-loop før merge.
- Projekt-invarianter (økonomi, squad limits, ownership) skal verificeres automatisk.

## Minimal change
1.  **Opdatér `ci.yml`**: Tilføj eksplicit Manus-trigger og optimér cache-håndtering.
2.  **Etabler Loop D**: Implementér en wrapper eller instruktion til Manus om at køre `/review` automatisk ved PR-oprettelse.
3.  **Dokumentation**: Opdatér `AGENTS.md` og `GUARDRAILS_CORE.md` til at reflektere den nye AI-orkestrerings-disciplin.

## Verification path
1.  Push en test-branch med en bevidst fejl → CI skal fejle.
2.  Opret en PR → Manus skal (via workflow) trigge review eller give feedback.
3.  Verificér at `auto-merge` label fungerer sammen med de nye checks.
