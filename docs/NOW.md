# NOW — Aktuel arbejdsstatus

## Aktiv styring
**Masterplan landed 2026-05-19:** `docs/MASTER_PLAN.md` er nu styringskontrakten for CyclingZone på tværs af Manus, Claude Code og Codex. Frem til validation sprint slutter 2026-06-17 har **Monetization Validation Sprint forrang** over brand-polish, bot-polish og post-Go betalingsimplementation. Brand Phase 1 er stadig låst, men Brand Phase 2 må ikke trumfe sprintens feedback-loop.

> **Næste session starter med:** Læs `AGENTS.md`, `docs/GUARDRAILS_CORE.md`, `docs/NOW.md` og `docs/MASTER_PLAN.md`. Kør derefter **Session A — status-synk ([#497](https://github.com/NicolaiDolmer/CyclingZone/issues/497))**: afstem `SPRINT_DASHBOARD.md` og åbne/lukkede GitHub-issues med faktisk state, så sprinten kan styres uden misforståelser.

## Senest leveret
- 2026-05-19: **Masterplan + AI-arbejdsmodel etableret.** Ny `docs/MASTER_PLAN.md` definerer single source of truth, prioriteringsregel frem til 2026-06-17, agentroller for Manus/Claude Code/Codex, aktuel master-rækkefølge og konkrete næste sessioner. PatchNotes ikke nødvendigt, da dette er intern plan/docs og ingen brugerrettet produktændring.
- 2026-05-20: **Brand Phase 1 LOCKED ([#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481)).** Final brand foundation: Bebas Neue wordmark, twin lines, dual-form favicon system og sibling-font system. Næste brandtrin er Phase 2 color palette, men kun når sprint-loopet ikke blokeres.
- 2026-05-18: **Discord soft launch de-facto live — [#423](https://github.com/NicolaiDolmer/CyclingZone/issues/423) closed.** Custom bot (#424-#427) udestår, men er ikke kritisk for community-drift.
- 2026-05-18: **Sprint Day 1 close-out.** `SPRINT_DASHBOARD.md` baseline-metrics udfyldt, top-15-spillerliste gemt privat, og `docs/TONE_OF_VOICE.md` etableret.
- 2026-05-18: **i18n Fase 3 epic [#412](https://github.com/NicolaiDolmer/CyclingZone/issues/412) funktionelt komplet.** Fase 3.5 epic [#483](https://github.com/NicolaiDolmer/CyclingZone/issues/483) er næste i18n-spor efter sprint-P0.

## Næste sessioner i rækkefølge
1. **Session A — Status-synk og plan-landing ([#497](https://github.com/NicolaiDolmer/CyclingZone/issues/497), Claude Code):** Synkronisér `SPRINT_DASHBOARD.md`, `NOW.md` og relevante issues med `MASTER_PLAN.md` og faktisk GitHub-state. Definition of done: stale status rettet eller kommenteret.
2. **Session B — Naming + fair freemium messaging (Manus):** Afgør tier-navne og skriv PatchNotes-, Discord-, survey- og landing-copy. Definition of done: #366 kan udføres uden ny afklaring.
3. **Session C — Discord validation loop (Manus + bruger):** Opret/brug `#fair-premium-feedback`, første poll, top-player DM-skabelon og interview-flow. Definition of done: første feedback-loop er live eller klar til paste.
4. **Session D — #366 PatchNotes implementation (Claude Code/Codex):** Implementér fair freemium PatchNotes-entry ud fra godkendt copy.
5. **Session E — #479 mobile performance triage (Codex/Claude Code):** Sikr at `/founder-supporter` ikke er mobil flaskehals før bred recruitment.
6. **Session F — Brand Phase 2 (Claude Code):** Kør kun color palette light/dark fra `docs/brand/HANDOFF_PROMPT.md`; genåbn ikke logo/typografi.
7. **Session G — i18n Fase 3.5 (Claude Code):** Status-afstem #412/#484, derefter high priority #485/#486 efter #482-pattern.

## Arbejdsregel
Hvis en agent foreslår arbejde uden for ovenstående rækkefølge, skal den først forklare hvilken P0/P1-sprintværdi eller blocker der retfærdiggør omprioriteringen. Ellers parkeres opgaven.
