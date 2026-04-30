# MEMORY — Kontekst til AI-assistenter

Git-tracked, synces via GitHub på tværs af PC'er. Opdateres løbende.
Codex-sessioner læser herfra; Claude-sessioner har supplerende auto-memory i `~/.claude/`.

---

## Feedback — arbejdsstil

### Push følger commit automatisk
Push efter commit uden at spørge. Commit → push er én operation.

**Why:** Bruger spurgte "hvorfor spørger du om dette?" ved bekræftelsesspørgsmål om push.

**How to apply:** Commit → push til remote med det samme. Ingen bekræftelsesspørgsmål.

---

## Projekt-kontekst

### Økonomi-principper (gældende fra v1.46)
- `DEFAULT_BETA_BALANCE = 800.000 CZ$` (kode: `backend/lib/betaResetService.js`)
- Sponsor-indkomst: **240.000 CZ$/sæson** per team (med board-modifier)
- Rytterværdi = `uci_points × 4000` (generated column i DB)
- Økonomi-target: **stram men fair** — aktive kompetente managers kan overleve uden automatisk gældsspiral
- Større tuning: vent på prize-money baseline (sæson-realistiske CZ$-præmier)

### Launch-kontekst (2026-04-30)
- **17 aktive managers** i nuværende beta
- **Open beta target: ~1 uge** — data resettes inden launch
- Launch = offentlig open beta; spillet fortsætter direkte derfra til produktion
- Pre-launch must-haves: profile-fix (S2), prize-money (S3-S5), onboarding (S6)

### Token-disciplin (gælder alle sessioner)
- `docs/NOW.md`: **maks 30 linjer** — kun aktiv slice, næste handlinger, blockers, invarianter
- `docs/PRODUCT_BACKLOG.md`: kun fremadskuende — ingen done-historik
- Færdige detaljer → `docs/FEATURE_STATUS.md` + `docs/archive/`
- Læs kun ekstra docs-filer når den konkrete opgave kræver det
- `docs/MEMORY.md`: læs kun ved ny session eller eksplicit behov
