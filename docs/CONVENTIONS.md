# CONVENTIONS — Cycling Zone

## Sprog

- Dansk i UI, dokumentation og anden brugerrettet tekst
- Engelske variabelnavne, funktionsnavne, kolonnenavne og enums i kode
- Hold labels korte, konkrete og konsekvente på dansk

## Naming

- Database-navne bruger snake_case
- JavaScript-navne bruger camelCase
- React-komponenter bruger PascalCase
- Route-navne skal afspejle domænet, ikke intern implementation

## UI og labels

- Vis valuta som `CZ$`
- Brug konsekvente domæneord: rytter, hold, transfer, lån, auktion, bestyrelse
- Bland ikke dansk og engelsk i samme UI-flow

## Kodeformat

- Hold docs kompakte og referencevenlige
- Foretræk små, domæneafgrænsede ændringer frem for brede refactors
- Arbejd i små slices med ét primært runtime-mål pr. session
- Brug målrettede tests først; kør bredere test/build når ændringen rører shared runtime, routing eller brugerflows
- Afslut større opgaver med root cause, invariant, filer ændret, tests kørt og næste anbefalede slice

## Kontekst- og tokenhygiejne

- `docs/NOW.md` må kun indeholde aktiv slice, næste slice, blockers og aktuelle release-noter; flyt detaljer til backloggen
- `docs/PRODUCT_BACKLOG.md` er kanonisk sted for nye ideer, bugs og planlagte forbedringer
- Undgå at gentage roadmap i chatten; referér til slice-navn og runtime-path
- Nye sessioner bør starte med prompten i `docs/PROMPT_LIBRARY.md#effektiv-session`
- Læs ekstra reference-docs efter behov, ikke som standard, medmindre guardrails kræver det
- Gruppér relaterede ændringer efter domæne: transfer/window_pending, auctions, beta-reset, UI/mobil, økonomi eller integrationer

## UI — lyst tema (gældende palette)

Sidebar er mørk navy (`#1a1f38`). Alt andet — sider, kort, formularer — bruger lyst tema:

| Formål | Klasse |
|---|---|
| Kortbaggrund | `bg-white` |
| Sideflade (indlejret) | `bg-slate-50` |
| Kortborder | `border-slate-200` |
| Primær tekst | `text-slate-900` |
| Sekundær tekst | `text-slate-500` |
| Dæmpet tekst / labels | `text-slate-400` |
| Accent tekst (guld på lys) | `text-amber-700` |
| Accent baggrund | `bg-amber-50` / `bg-amber-100` |
| Rækkedeler i tabeller | `border-slate-100` / `divide-slate-100` |
| Hover-baggrund | `hover:bg-slate-100` |
| Input-baggrund | `bg-slate-100` |
| Grøn / rød / orange / blå på lys | `/700`-varianter (`text-green-700` osv.) |
| Status-baggrunde | `bg-green-50`, `bg-red-50`, `bg-orange-50` |
| Guld-knapper (primær handling) | `bg-[#e8c547] text-[#0a0a0f]` — stays |
| CSS-variabel tokens (fremtid) | `bg-cz-body`, `bg-cz-card`, `text-cz-1` osv. — se `index.css` og `tailwind.config.js` |

## UI-refaktoring

- Ved bulk farve-erstatning på tværs af mange filer: grep alle unikke mønstre FØR replacement-scriptet skrives
  ```bash
  grep -hro "text-white/[0-9]*\|bg-white/[0-9]*\|border-white/[0-9]*\|divide-white/[0-9]*" frontend/src/pages/ | sort -u
  ```
- `LoginPage` og `ResetPasswordPage` renderer udenfor `Layout` og sætter `min-h-screen bg-[…]` direkte — de ignorerer body-CSS. Søg efter `min-h-screen bg-` ved tema-skift og fix separat med CSS-variable-klassen (`bg-cz-body`).

## Produktindhold

- `frontend/src/pages/PatchNotesPage.jsx` er den løbende changelog for brugerrettede releases og fixes
- `frontend/src/pages/HelpPage.jsx` er den løbende forklaring af regler, flows og FAQ
- Nye features og mærkbare adfærdsændringer skal reviewe begge sider før opgaven betragtes som færdig

## Import af ryttere (`scripts/import_riders.py`)

### Autoritativ datakilde — Google Sheet
UCI-ranglisten hentes fra Google Sheets (opdateres løbende af GitHub Actions scraper):
- **Sheet-URL:** `https://docs.google.com/spreadsheets/d/1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic`
- Indeholder **3000 ryttere** (ikke bare top-1000) — alle ryttere med UCI-points
- Kolonneformat: `Rank, Name, Team, Nationality, UCI Points, Updated`
- Lokal kopi: `scripts/uci_top1000.csv` — skal holdes opdateret ved re-import

**Opdatér lokal CSV** (ved re-import med ny data): Download fra Google Sheet via Google Drive MCP
(`download_file_content` med fileId `1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic`, exportMimeType `text/csv`)
og overskriv `scripts/uci_top1000.csv`.

### Navnematch — 5-lags fallback
PCM WORLD_DB og Google Sheet bruger forskellige navneformater.
`import_riders.py` prøver strategierne i rækkefølge:

1. **Eksakt match** (normaliseret)
2. **Omvendt token-rækkefølge** (fx "RASMUS PEDERSEN" ↔ "PEDERSEN RASMUS")
3. **Eksakt token-sæt** — samme ord, forskellig rækkefølge (fx "CORT NIELSEN MAGNUS" ↔ "CORT MAGNUS NIELSEN")
4. **PCM-tokens ⊆ UCI-tokens** — UCI har mellemnavn/ekstra token (fx "HONORE MIKKEL" ⊆ "HONORE MIKKEL FROLICH")
5. **UCI-tokens ⊆ PCM-tokens** — PCM har ekstra navnedel (fx "ALMEIDA JOAO" ⊆ "ALMEIDA JOAO LUIS")

### normalize_name — tegnhåndtering
Strippér accent-combining chars via NFKD + explicit erstatning af precomposed tegn:
- `ł / Ł → L` (polsk — Kwiatkowski, Aniołkowski, Bogusławski)
- `ø / Ø → O` (nordisk — Øxenberg)
- `æ / Æ → AE`
- `ß → SS` (tysk)
- `đ / Đ → D` (kroatisk)

### PCM_UCI_OVERRIDE (øverst i scriptet)
Eksplicit map `pcm_id → normaliseret UCI-navn` for tilfælde algoritmen ikke klarer:
```python
PCM_UCI_OVERRIDE = {
    9151: "BLACKMORE JOSEPH",      # PCM: "Joe";       UCI: "Joseph"
    9934: "KOERDT BJORN",          # PCM: "Bjoern";    UCI: "Bjorn"
    7372: "TESFATSION NATNAEL",    # PCM: "Tesfazion"; UCI: "Tesfatsion"
}
```
**Tilføj her** ved nye mismatch der ikke løses af de 5 strategier eller normalize_name.

### Hvornår opdateres DB-værdier?
`uci_points` gemmes i `riders`-tabellen. `price` og `market_value` er GENERATED columns
der genberegnes automatisk. Re-import med nyt UCI-CSV overskriver `uci_points` for alle
matchede ryttere — SQL-migrationer er midlertidige patches, erstattes ved re-import.

### ⚠️ Invariant — pris og løn opdateres ALTID sammen
`salary` er IKKE en generated column. Enhver ændring af `uci_points` SKAL efterfølges af:
```sql
SET salary = uci_points * 400
```
Formlen: `salary = price × SALARY_RATE = uci_points × 4000 × 0.10 = uci_points × 400`

Gælder ved: SQL-migrationer, import-script, admin-override, UCI-sync og enhver direkte DB-ændring.
`recalculateRiderSalaries.js` håndterer dette automatisk efter GitHub Actions UCI-sync.
