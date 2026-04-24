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
