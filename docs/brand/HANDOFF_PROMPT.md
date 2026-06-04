# Brand Identity — Handoff Prompt (PC-to-PC)

> **How to use:** Paste the content of the block below verbatim as your FIRST message in a new Claude Code or Codex session on the new PC. Don't edit it. Don't summarize it. The AI must read every line.

---

## Pre-flight on the OLD PC (do this before switching)

```bash
git status
git add docs/brand/ docs/TONE_OF_VOICE.md
git commit -m "wip(brand): handoff state — Phase 1 locked, P2 light-canvas pending"
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
6. `docs/brand/logo-explorations.html` — åbn i preview, det er den aktive arbejdsfil. Preview er wired i `.claude/launch.json` som `brand` (port 4173): start via `mcp__Claude_Preview__preview_start name=brand` og naviger til `/logo-explorations.html`.

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

1. **Decisions Sprint** — ✅ **LOCKED 2026-05-20** (wordmark Bebas Neue + twin lines, F1a stacked, F1b CZ Inter Tight Black, dark canvas #0e0f15). Farve-palet: dark P1 locked, **light canvas P2 = aktiv pending beslutning**.
2. **Asset Production** — 🟡 startet 2026-06-04: outlinede SVG-masters i `frontend/public/brand/` + favicon swappet (PR #1026). Mangler: PNG/ICO-raster, OG-image-refresh, Discord/social. Se `ASSETS.md`.
3. **Design System Extension** — typography scale, color tokens, spacing, component patterns (gates på P2/P3 farve-lock)
4. **UI Integration** — anvend brand i eksisterende UI, light + dark mode parity. **Bemærk: nav-IA + whitespace-overvejelser ligger i `docs/brand/UI_NAV_IA.md`.**
5. **Documentation** — brand guidelines mini-doc, future decision framework

## Self-correcting hints

- Kan du ikke finde en fil? Tjek `docs/brand/` først, så `docs/`
- I tvivl? Læs `PROJECT_PLAN.md` igen
- Vil du stille et abstrakt spørgsmål? STOP. Render visuelle muligheder først.
- Memory ligger i `~/.claude/projects/C--dev-CyclingZone/memory/MEMORY.md` (auto-loaded) — har mine præferencer
- Hvis noget i DECISIONS_LOG ikke giver mening: spørg mig, men antag at det er korrekt indtil jeg siger andet

## Hvad du skal gøre LIGE NU

State (per 2026-06-04): Phase 1 LOCKED. Asset-masters shippet i `frontend/public/brand/` + favicon swappet (PR #1026 — tjek om merged: `gh pr view 1026`). Font-outlining-teknikken er dokumenteret i `docs/brand/ASSETS.md` (fonttools + google/fonts OFL) — genbrug den, opfind ikke ny. **Aktiv beslutning: P2 light-mode canvas** (4 koncept-kandidater i logo-explorations.html: A newsprint #f5edcf, B velodrome #f0e6cf, C race-bib #faf8ee, D cobblestone #e8e7e3).

1. Bekræft at du har læst PROJECT_PLAN, DECISIONS_LOG, ASSETS.md, BRAND_BRIEF og åbnet logo-explorations.html i preview.
2. **Primær opgave:** Render P2-kandidaterne for mig (preview-screenshot), giv din ærlige anbefaling, og bed mig vælge A/B/C/D. Når jeg har valgt → log i DECISIONS_LOG.md MED DET SAMME → fortsæt til P3 (accent-gul-refinement). Én beslutning ad gangen.
3. **Alternativ (hvis jeg hellere vil have autonomt arbejde):** refresh `frontend/public/og-cycling-zone.svg` — den bruger i dag `<text font-family="DM Sans">` + en gammel "C"-mark, som social-scrapers renderer i fallback-font. Erstat med den outlinede wordmark + F1a-mark fra `frontend/public/brand/`, BEHOLD copy ordret, verificér i preview uden font-fald.

Pre-flight før commit (CLAUDE.md): frontend `node --test` + `npm run build` grønne; PatchNotes ved brugerrettet ændring; PR med Brugerverifikation-sektion; Refs #481. Rører du visuelle snapshots: kør alle 3 playwright core-smoke-projekter.

(Valgfrit først, 10 sek: bekræft Clarity er live nu — "hent sessions sidste 7 dage fra Clarity". Virker det, er #864 unblocked. Fejler det med "An error occurred", rapportér og fortsæt med brand — Clarity fejlsøges separat.)

Genstart ikke. Bed ikke om tilladelse til at fortsætte. Resume bare. Verdens-klasse standard fra første tur.
```

---

## After pasting — what should happen

The new AI should:
1. Read all the files listed
2. Confirm it understands the current state (Phase 1 locked; P2 light-mode canvas is the active A/B/C/D decision)
3. Either render the P2 candidates and ask you to choose, OR proceed with the OG-image alternative / your next instruction

If the AI tries to restart or asks abstract questions: copy this rule back at it — *"Stop. Read DECISIONS_LOG.md and resume. No restarts."*

## GitHub master issue (created)

**Master tracking issue:** [#481 — Brand identity overhaul](https://github.com/NicolaiDolmer/CyclingZone/issues/481)

Reference in all brand-related commits via `Refs #481` per project convention. Sub-issues per phase can be created as needed and linked to #481.

Check status anytime: `gh issue view 481`

## What lives where (continuity reference)

| Location | What | Sync mechanism |
|---|---|---|
| `docs/brand/*.md` | Plan, decisions, brief, moodboard, handoff | Git push/pull |
| `docs/brand/logo-explorations.html` | Active visual state | Git push/pull |
| `~/.claude/projects/.../memory/` | AI memory (preferences, history) | OneDrive-context sync |
| `~/OneDrive/CyclingZone-context/secrets/` | API keys etc. | OneDrive sync |
| GitHub issue (if created) | Phase progress, sub-tasks | GitHub (cross-PC by default) |
