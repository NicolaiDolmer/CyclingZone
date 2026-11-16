# Skitse #7535: "Planning · Today's tactics" vist som færdig i spillet

Ejer 16/11 på #7535: vis HVOR wireframets "Planning · Today's tactics" (v6b-1280-today) skal ligge i spillet, som om den er færdig, før der besluttes. Ingen produktkode, merges ikke.

Åbnes med `npm run dev` i `frontend/` på
`/src/preview/sketches/i-dag-taktik/index.html?open=r1&orders=all&theme=dark`.
`open=r1` åbner rytter 1's kort på telefon, `orders=all` vælger "All orders", `theme=dark` mørkt tema.
Til PR-billederne: `?mark=1&cap=1&shot=1440|390` (røde rammer + nummer, sætning brændt ind øverst) og `?cap=1&shot=flow` (pile for vejen ind).

Billeder: `pr-screens/7535-i-dag/`.

## Forslaget (placering A)

'Today' er en visning på planlægningssiden ved siden af Week board, Race list og Month calendar (samme kontakt-knapper som `/planning/workbench`). Dagens løb står på én liste; det valgte løb viser det fælles taktikpanel fra PR #8289 under listen.

## Filer

| Fil | Indhold |
|---|---|
| `AppShell.tsx` | Spillets app-skal efter `components/Layout.jsx`: sidebjælke, mobil-topbar, side-padding, hurtig-navigation. Samme klasser og tokens; Wordmark og ikoner er appens egne. |
| `TodayHost.tsx` | Planlægningens sidehoved (appens `PageHeader` + kontakt-knapper), dagens løb (tabel på computer, én række pr. løb på telefon), løbslinjen og panelet. |
| `Marks.tsx` | Kun til billederne: sætning brændt ind øverst, røde rammer med nummer, pile. |
| `Panel.tsx`, `Profile.tsx`, `model.ts`, `taktik.css` | Kopi fra PR #8289. Ændret: indsatsen på én linje Easy, Normal, Hard (ejer 16/11) og `saveInHeader`, så guldknappen kan stå i sidehovedet. |
| `data.ts` | Wireframets ruter og etapetider; rytternavnene er opdigtede. |

## Hvad der ikke er med

- Kun engelsk. Dansk kommer via i18n i produktkoden.
- Ingen backend: gem, åbn og kontakterne er kun klik.
- Påmindelsen "Squad missing" fra den rigtige side er udeladt for at holde fokus på placeringen.
- Saldo, antal online, løb, hold og ryttere er opdigtede.
