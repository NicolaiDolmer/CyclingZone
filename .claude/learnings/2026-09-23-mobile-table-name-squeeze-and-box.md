# Postmortem · 2026-09-23 · Mobil-tabeller: navn klemt til 0px + lodret boks (#5471, #4982)

## Hvad skete der?
Paa mobil-ranglisten (390px) fik hold med Founder-maerke en raekke paa 435-515px uden laesbart navn; hold uden maerke fik 23-50px til navnet og braekkede midt i ord. Samtidig laa alle DataTable-tabeller i en lodret boks (`max-h: 100dvh - 240px`), som i landscape (844 x 390) kun havde plads til ca. to raekker.

## Root cause
1. D-047-navnecellen er EEN flex-linje uden wrap, og #5410 (19/9) gav alle boern `min-w-0`. StandingsPage satte rang, prik, navn og op til fire `shrink-0`-badges som soeskende i en celle paa ca. 90px, saa navnet var det eneste der kunne krympe - til 0px - og `break-words` braekkede det tegn for tegn.
2. `SCROLLER`/`MOBILE_SCROLLER` (#4747) havde `max-h` uden nedre graense for viewport-hoejden, og `WRAP` var `overflow-hidden` (en scroll-container), saa en sticky overskrift kun kunne haenge fast i en boks.

## Fix
- `dataTableStyles.js`: `WRAP` og `MOBILE_SCROLLER` bruger `overflow: clip` (ikke scroll-containere), ingen lodret boks paa mobil; desktop-boksen kun ved >=641px bred OG >=600px hoej.
- `StandingsPage.jsx`: cellen er EEN wrap-enhed (rang + prik + navn samlet, badges paa naeste linje), online-prikken i rang-knappens hjoerne paa mobil, korte mobil-headere (`mobileHeader`).
- `DataTable.jsx`: `mobileHeader`-kolonne-prop; "Fuld tabel" uden boks.
- Specs: `standings-mobile-founder-mark.spec.ts`, `table-page-scroll-mobile.spec.ts` (390 + 844x390).

## Forhindret-fremover
Begge specs maaler adfaerd i browseren (navnebredde, ord braekket midt over via `Range.getClientRects`, ingen forfader med intern lodret scroll, sticky overskrift mod skaermens top). Reglen "navn + badges = een wrap-enhed" staar i DataTable-kommentaren og PAGE_TEMPLATES T2.

## Læring
En generisk `flex-wrap` paa hele navnecellens linje blev proevet og maalt: den efterlod et ledende ikon (troejeprikken) alene paa foerste linje paa andre sider (kitchen-sink-snapshottet). Wrap-enheden skal ligge dér hvor siden kender navnets graenser. Og mock-data skal vaere realistisk bred (7-cifrede praemier), ellers maaler en layout-spec heldet.
