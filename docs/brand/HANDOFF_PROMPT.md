# Brand Identity — Handoff Prompt (PC-to-PC)

> **How to use:** Paste the content of the block below verbatim as your FIRST message in a new Claude Code or Codex session on the new PC. Don't edit it. Don't summarize it. The AI must read every line.

---

## Pre-flight on the OLD PC (do this before switching)

```bash
git status
git add docs/brand/ docs/TONE_OF_VOICE.md
git commit -m "wip(brand): handoff state — Phase 1 D1 awaiting choice"
git push origin main
```

Verify OneDrive-context (`~/OneDrive/CyclingZone-context/`) has synced — memory + secrets follow you automatically per `reference_onedrive_context.md`.

## Pre-flight on the NEW PC (do this before pasting the prompt)

```bash
cd C:\dev\CyclingZone   # or wherever the repo lives on the new PC
git pull origin main
git status              # should be clean
```

If memory needs re-linking: `pwsh -File scripts/link-onedrive-context.ps1`

---

## The prompt — paste this verbatim

```markdown
Hej Claude (eller Codex). Jeg fortsætter et brand identity-projekt fra en anden PC. Læs grundigt før du svarer.

## Mission

Lave Cycling Zones komplette brand identity "once and for all" — logo, favicon, Discord-assets, social avatars, design manual, UI/UX-tokens. Skal matche tone-of-voice. Skal holde 5+ år. Tag højde for nuværende UI (light + dark mode) og fremtidig vækst.

## Læs disse filer i denne rækkefølge FØR du svarer

1. `docs/brand/PROJECT_PLAN.md` — overall plan, faser, status, værktøjer, arbejdsregler
2. `docs/brand/DECISIONS_LOG.md` — single source of truth for hvad der er besluttet
3. `docs/brand/BRAND_BRIEF.md` — DNA-fundamental (audience, personlighed, principper)
4. `docs/TONE_OF_VOICE.md` — voice guide (load-bearing — kan ikke brydes)
5. `docs/brand/MOODBOARD.md` — ~35 reference brands
6. `docs/brand/logo-explorations.html` — åbn i preview, det er den aktive arbejdsfil

## Arbejdspattern (HARDCODED — afvig ikke)

- **ÉN visuel beslutning ad gangen** i `logo-explorations.html`
- **Vis valgmuligheder VISUELT + stil spørgsmål SAMTIDIG** — aldrig abstrakte text-only-spørgsmål om visuelle ting
- Bruger peger A/B/C/D, du raffinerer inden for valget, gentag
- Opdater `DECISIONS_LOG.md` umiddelbart efter hvert konfirmeret valg
- Genåbn ALDRIG en beslutning der står i DECISIONS_LOG — medmindre brugeren eksplicit siger det
- Match `TONE_OF_VOICE.md` i hvert visuelt valg (premium uden flashy, founder-led, build-in-public)
- Whoop er taste anchor (bekræftet)
- Wordmark-first identitet (bekræftet)
- Skjult cykling-DNA (bekræftet)

## Værktøjer (brug proaktivt — jeg forventer du selv foreslår)

- **Claude Code (dig)**: orchestration, SVG-generation, file writing, planning, dokumentation
- **ChatGPT (GPT-5 + image gen)** eller **Midjourney v7**: image-generation når SVG ikke er nok (foreslå konkrete prompts)
- **GitHub via `gh` CLI**: progress-tracking (master issue + sub-issues per fase)
- **Skills tilgængelige**:
  - `design:design-system` — Fase 3 (design tokens, color, typography)
  - `design:design-handoff` — Fase 2 + 4 (dev specs)
  - `design:design-critique` — review af kandidater før Fase 2
  - `frontend-design:frontend-design` — Fase 4 (production UI integration)
  - `engineering:architecture` — ADRs for store beslutninger i Fase 5

## Faser (full map — se PROJECT_PLAN.md for detaljer)

1. **Decisions Sprint** — 5 visuelle beslutninger → lås logo-retning (IN PROGRESS)
2. **Asset Production** — final SVG, alle størrelser, favicon-set, Discord, social, OG-image
3. **Design System Extension** — typography scale, color tokens, spacing, component patterns
4. **UI Integration** — anvend brand i eksisterende UI, light + dark mode parity
5. **Documentation** — brand guidelines mini-doc, future decision framework

## Self-correcting hints

- Kan du ikke finde en fil? Tjek `docs/brand/` først, så `docs/`
- I tvivl? Læs `PROJECT_PLAN.md` igen
- Vil du stille et abstrakt spørgsmål? STOP. Render visuelle muligheder først.
- Memory ligger i `~/.claude/projects/C--dev-CyclingZone/memory/MEMORY.md` (auto-loaded) — har mine præferencer
- Hvis noget i DECISIONS_LOG ikke giver mening: spørg mig, men antag at det er korrekt indtil jeg siger andet

## Hvad du skal gøre LIGE NU

1. Bekræft at du har læst PROJECT_PLAN, DECISIONS_LOG, BRAND_BRIEF og åbnet logo-explorations.html i preview
2. Fortæl mig hvilken decision der er IN PROGRESS i DECISIONS_LOG.md
3. Vent på mit svar (A/B/C/D eller custom) ELLER på en ny instruktion

Genstart ikke. Bed ikke om tilladelse til at fortsætte. Resume bare. Verdens-klasse standard fra første tur.
```

---

## After pasting — what should happen

The new AI should:
1. Read all the files listed
2. Confirm it understands the current state (Decision 1 of 5 — Overall Personality, options A/B/C/D)
3. Either ask you to make the choice OR proceed with your next instruction

If the AI tries to restart or asks abstract questions: copy this rule back at it — *"Stop. Read DECISIONS_LOG.md and resume. No restarts."*

## Optional — create a GitHub master issue for tracking

If you want shared progress tracking across PCs (recommended), the AI can create a master issue:

```bash
gh issue create \
  --title "Brand identity overhaul — logo + design manual (once-and-for-all)" \
  --body-file docs/brand/PROJECT_PLAN.md \
  --label "claude:todo"
```

Then reference the issue number in commits via `Refs #N` per project convention.

## What lives where (continuity reference)

| Location | What | Sync mechanism |
|---|---|---|
| `docs/brand/*.md` | Plan, decisions, brief, moodboard, handoff | Git push/pull |
| `docs/brand/logo-explorations.html` | Active visual state | Git push/pull |
| `~/.claude/projects/.../memory/` | AI memory (preferences, history) | OneDrive-context sync |
| `~/OneDrive/CyclingZone-context/secrets/` | API keys etc. | OneDrive sync |
| GitHub issue (if created) | Phase progress, sub-tasks | GitHub (cross-PC by default) |
