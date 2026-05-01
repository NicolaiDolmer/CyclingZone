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
- Rytterværdi = `uci_points × 4000` (generated column `price` i DB)
- `market_value = GREATEST(5, uci_points) × 4000 + prize_earnings_bonus` (generated)
- `salary` er IKKE generated — skal altid opdateres manuelt: `salary = uci_points × 400`
- Økonomi-target: **stram men fair** — aktive kompetente managers kan overleve uden automatisk gældsspiral

### Rytter-import og UCI-data
- **Autoritativ kilde:** Google Sheet `1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic` (3000 ryttere, opdateres af GitHub Actions)
- Lokal kopi: `scripts/uci_top1000.csv` — overskriv ved re-import med ny CSV fra Sheet
- Import-script: `scripts/import_riders.py` — bruger 5-lags navnematch + PCM_UCI_OVERRIDE
- Se `docs/CONVENTIONS.md` → "Import af ryttere" for komplet algoritme og invarianter
- **Fejlmønster der kendes:** PCM sammensatte efternavne, UCI mellemnavne, polske ł/Ø-tegn, alternativ translitteration (Tesfazion/Tesfatsion) — alle håndteres nu i scriptet

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
