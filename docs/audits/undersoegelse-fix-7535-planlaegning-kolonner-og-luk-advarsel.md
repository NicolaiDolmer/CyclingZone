# Undersøgelse: trup-tabellens kolonneoverskrifter og ryttertype (#7535, PR #8454)

Undersøgelsesspor (kind: investigate). Ingen kodeændring i denne branch ud over denne rapport.

## Spørgsmål

PR #8454 lader trup-tabellens kolonneoverskrifter (`frontend/src/components/planning/SquadTable.tsx`) bryde over to linjer. Ejeren så billederne natten til 20/11 og bad om at se muligheder først. Opgaven: 2-3 tydeligt forskellige muligheder, der løser (1) at de danske overskrifter er for brede og (2) at ryttertypen bliver afkortet.

## Metode

- Branchens kode (HEAD = PR #8454 + merge af main) blev eksporteret med `git archive` til en scratch-mappe uden for worktreet.
- I scratch-kopien fik `SquadTable.tsx` midlertidige varianter bag `?v=a|b|c` (aldrig committet).
- Build med preview-mocken (`VITE_PREVIEW_MOCK=1 vite build`, under verifikations-semaforen), serveret lokalt, fotograferet med Playwright på `/planning/workbench`, dansk, cookie-banner lukket, viewport-billeder 1440 og 390.
- For hver variant blev tabellens bredde og antal afkortede celler målt i browseren.

## Bekræftet problem (nuværende PR #8454, dansk, 1440)

- Tabellen står i kompakt tilstand (`data-compact="true"`): den har ikke plads i kortet med fuld pynt.
- 15 afkortede celler i den synlige tabel. Ryttertypen afkortes for de lange danske typenavne (fx "Brostens…", "Bakkeryt…", "Bjergrytt…"), og "I <løb>"-mærket i Status afkortes også.
- Overskrifterne står ujævnt: nogle på én linje, nogle på to (Rating, Træthed, Belastning, Rutematch), så hovedet får forskudte grundlinjer.
- Ingen vandret overløb på siden (dokumentet er ikke bredere end vinduet) ved 1440 og 390.

## Muligheder

| | Idé | Målt (DA, 1440) | Fordele | Ulemper |
|---|---|---|---|---|
| A | Korte overskrifter på én linje (fx "Træt.", "Belast.", "Match") med fuld tekst i tooltip; typen som `RiderTypeBadge` som i andre tabeller | Typen afkortes ikke længere; tabellen er stadig kompakt (Status-mærket afkortes fortsat) | Én linje, alle kolonner bliver, typen ser ud som på holdsiden | Forkortelser kræver tooltip og skal laves på alle 5 sprog; badget bruger accentfarve i en tæt tabel |
| B | Færre faste kolonner (Status, Træthed, Belastning skjult som standard) + kolonnevælger (stroke-ikon, "Kolonner 7/10") | Ikke kompakt, 0 afkortede celler | Luftigst, fulde ord, manageren vælger selv, fungerer på alle sprog uden nye forkortelser | Vigtig information (skade, træthed) er skjult som standard; kræver gemt valg pr. manager og nye tekster |
| C | Overskrifter på to linjer, men alle i samme faste højde og balanceret; typen i egen kolonne uden afkortning | Typen afkortes ikke; tabellen er stadig kompakt (Status-mærket afkortes fortsat) | Alle kolonner og fulde ord, mindst kodeændring | Højere tabelhoved, visuelt tæt på det ejeren afviste |

Billeder (lokalt, ikke i repoet): `C:/Dev/CyclingZone-worktrees/.wave-scratch/8454-muligheder/`
- `0-nu-da-1440.png`, `0-nu-da-390.png` (nuværende PR #8454, reference)
- `A-da-1440.png`, `A-da-390.png`
- `B-da-1440.png` (kolonnevælgeren vist åben), `B-da-390.png`
- `C-da-1440.png`, `C-da-390.png`

Mobil (390) ændrer sig kun lidt i alle tre: mobilen viser allerede kun de valgte tal-kolonner via chip-rækken. I A står typen som mærke under navnet; overskrifterne bliver korte.

## Anbefaling

**B**, med fallback **A**, hvis ejeren vil have alle kolonner synlige som standard.

Begrundelse: B er den eneste variant, hvor tabellen ikke falder i kompakt tilstand og intet afkortes ved 1440 på dansk; den løser problemet på alle sprog uden forkortelser og følger TASTE (fulde ord, hairlines, ét stroke-ikon, ingen ekstra guld). Den nye `TableTitleBar` (merget på main efter denne branch) er det naturlige sted for kolonnevælgeren, så den ikke opfindes på ny.

## Fix-plan (efter ejerens valg)

1. Merge `origin/main` ind, så `frontend/src/components/ui/TableTitleBar.tsx` er tilgængelig.
2. `SquadTable.tsx`: overskrifter `whitespace-nowrap` (fjern to-linjers-wrap fra #8454); type-cellen uden `truncate`/`max-w`.
3. B: kolonnesæt `{status, fatigue, load}` valgfrit via `TableTitleBar`; valget huskes pr. manager (samme mønster som mobilens `mobileColumns`-chip-række). A: korte etiketter som nye i18n-nøgler på alle 5 sprog + fuld tekst i `title`, og `RiderTypeBadge` i type-cellen.
4. Behold mobilens chip-række uændret.
5. Test: udvid `runde3.test.ts` med "ingen vandret overløb og ingen afkortet type ved 1440 på DA/EN/FR/ES/NL"; før/efter-billeder 1440 + 390 DA og EN.
6. Patch note (EN først, DA under) ved merge.

Risiko: lav. Rent præsentationslag bag den slukkede `planning_workbench`-kontakt; ingen data, motor eller økonomi. B kræver nye tekster ("Kolonner") og dermed ejer-godkendt copy.

## Dom

bekraeftet + fix-plan
