# Undersøgelse #8725: TASTE v2-udkast og modsigelser

> Undersøgelsesspor (kind: investigate, #5220), forberedelse til ejerens UI/UX-blok 26/11 kl. 10-11. Refs #8725, #8737.
> Intet er rettet: `docs/design/TASTE.md` og `docs/design/PAGE_TEMPLATES.md` er urørte. Alt står her.
> De låste regler genåbnes ikke: én gold primary pr. view, hairlines, 5 px radius, tabeltal, stroke-ikoner.

## Metode

- Læst i fuld længde: `docs/design/TASTE.md` (359 linjer), `docs/design/PAGE_TEMPLATES.md` (126 linjer), issue #8725 og #8737 med kommentarer.
- Kode målt med grep i `frontend/src` (sider og komponenter, testfiler udeladt): `index.css` (tokens og `@theme`), `components/ui/*` (DataTable, TableTitleBar, MobileTableChips, FilterBar, HeroStats, Tabs, Segmented, ProgressMeter, Modal, EmptyState, Skeleton, RiderHoverCard, chip-/badge-stilarter), `components/rider/RiderNameCell.jsx`, `components/training/mobile/TrainingMobileRiderCard.tsx`, `lib/theme.jsx`, `scripts/lint-ui-slop.mjs`, `scripts/check-anti-slop.mjs`.
- Tællingerne er grep-forekomster på main pr. 26/11 (`232fc45a0`), ikke en visuel dom. De viser omfanget, ikke at hvert træf er en fejl.
- Ikke gjort: ingen kørsel af appen, ingen skærmbilleder, ingen axe. checklist.design-skillen (opgave 1, 3 og 4 i #8725) er ikke installeret eller læst; den er et separat skridt (se fix-planen).

## Dom i én linje

Bekræftet. Der er 22 konkrete modsigelser: 12 mellem TASTE og PAGE_TEMPLATES (eller inde i TASTE selv), 6 mellem dokumenterne og koden og 4 mellem dokumenterne og ejerbeslutningerne 25/11 (#8737). Den største: ejeren forbød 25/11 små versal-labels med spærring. PAGE_TEMPLATES kræver dem stadig seks steder, og koden har 734 `uppercase`-forekomster i 238 filer.

---

## Del 1. Modsigelser

Sorteret efter hvor meget spilleren ser dem. "Ejer-spørgsmål" betyder, at den kræver ejerens valg (ét ad gangen). "Doc-rettelse" betyder, at ejeren allerede har besluttet, og at kun teksten halter efter.

### A. Kræver ejerens valg

**M1 · Små labels i versaler** (ejer-spørgsmål, størst)
- **TASTE §3, sidste række (ejer 25/11):** "Små labels i VERSALER med spærring" er forbudt. Sentence case overalt, ændres område for område med før/efter-billeder.
- **TASTE selv modsiger:** §5a: "labels 10 px uppercase `--text-3`". P10: chip-række i "`text-2xs` uppercase".
- **PAGE_TEMPLATES kræver versaler seks steder:** kortets meta-label ("uppercase meta label … tracking .08em"), T1-rækkernes meta-linje, T2-tabeloverskrifter ("`text-2xs` uppercase, tracking .06em"), den sticky navnecelles underlinje, zone-pillen og HeroStats-labelen ("uppercase tracking .1em"). Desuden mikroskalaens egen definition: "`text-2xs` = 11px, any uppercase meta line".
- **Koden:** 734 forekomster af `uppercase` i 238 filer. I kittet sidder de i `DataTable`, `HeroStats` (`tracking-widest`), `Section`, `CollapsibleSection`, `Divider`, `chipStyles`, `badgeStyles`, `fieldStyles`, `tableStyles` og `RiderHoverCard`.
- **Anbefaling:** 25/11 er den nyeste ejerbeslutning, så den vinder. PAGE_TEMPLATES skrives om til sentence case, og ændringen laves i kittet (6-8 stilfiler), ikke side for side. Den rulles ud bag beta-flag efter #8737's regel om gradvis udrulning, med billeder af tabel, kort og profil før/efter. Spørgsmål til ejeren: **gælder forbuddet også tabeloverskrifter?** De er den største flade, og FM bruger versaler netop dér. Min anbefaling er ja, men vis det først på rytterdatabasen og stillingen.

**M2 · Stat-rækken under heroen**
- **TASTE §3 (ejer 25/11):** forbudt: "en række store nøgletal lige under en hero ('stat strip')". Rytterprofilens stat-række vises før/efter, næste gang profilen ændres.
- **TASTE P3:** rytterprofilens hero "med … stat-række med hairline over" kaldes "Rigtigt i dag. Referencen for alle T3-sider".
- **PAGE_TEMPLATES T3:** "Stat row: use the `HeroStats` primitive" er påbudt anatomi. 20 px/650-tal, og "Fewer stats is never the fix".
- **Koden:** `components/ui/HeroStats.jsx` bruges på T3-siderne.
- **Anbefaling:** skeln mellem to ting. *Identitetsdata* i heroen (rating, alder, værdi og kontrakt, højst 4 og i tekststørrelse) er tilladt. *Pynte-nøgletal* (store tal uden sammenhæng og KPI-fliser) er forbudt. Ejeren vælger på rytterprofilen ud fra to billeder: A er nuværende HeroStats, B er tallene som én meta-linje under navnet. Indtil da står HeroStats.

**M3 · Chip-række eller kolonne-knap på mobil**
- **TASTE P21 (ejer 19/11, #8280):** ingen chip-række og ingen pille-radius. Kolonne-knappen i tabellens titellinje bytter kolonner. Spørgsmål 23: "uden chip-række".
- **TASTE P10, spørgsmål 15 og §6 fork 6:** kræver stadig "chip-rækken og 'Fuld tabel'". P10 har en note om, at chip-rækken er afløst 19/11 af P21, men den beskriver den i næste sætning i fuld længde.
- **PAGE_TEMPLATES D-047:** hele chip-opskriften står som gældende. Det samme gælder P16-gulvets liste ("column chips") og Rytterdatabasen ("Løn vælges via kolonnechip").
- **Koden:** `TableTitleBar` bruges på 3 flader (`RidersPage`, `RiderRankingsPage`, `AcademyLedgerTab`). Alle andre `DataTable`-kald falder tilbage til `MobileTableChips`.
- **Anbefaling:** P21 vinder, fordi den er nyest og allerede bygget. Spørgsmål 15 skrives om til "kolonne-knappen". PAGE_TEMPLATES beskriver chip-rækken som "udgående, flyttes til titellinjen". Ejer-spørgsmål: **skal resten af tabellerne flyttes til titellinjen i én samlet PR eller side for side?** Jeg anbefaler kit-niveau: `DataTable` får titellinjen som standard, når der er mere end 3 kolonner.

**M4 · FilterBar over tabellen eller kontroller inde i rammen**
- **TASTE P1 (fork 1, 2/9):** "filterbar på én linje (søg + 3 selects + 'Flere filtre' lukket)".
- **PAGE_TEMPLATES T2:** `FilterBar` over tabellen, og på mobil "collapses to search + two half-width selects".
- **TASTE P21 (19/11):** "ingen kasse-selects eller forklaringsbokse over tabellen". Alt, der kun styrer én tabel, står i én titellinje inde i rammen.
- **Koden:** `FilterBar` bruges i 7 filer, og titellinjen i 3.
- **Anbefaling:** P21 overtager formen fra fork 1 og beholder målet (8-10 rækker over folden). `FilterBar` står kun tilbage til filtre, der styrer hele siden og ikke én tabel. Ejeren bekræfter med ét ja, fordi fork 1 står som "genåbn ikke" i §6.

**M5 · Hvor guld må stå** (de låste regler røres ikke, kun listen over steder)
- **TASTE P3 (fork 3):** guld står "præcis fire steder": primær knap, leder-markør, guld-tekst (quiet action og aktiv fane) og 2 px keyline på T3. "aldrig guld-tint på egen række".
- **PAGE_TEMPLATES tilføjer tre steder:** "Meters/progress fills may use accent", Segmented med aktiv "gold text on a 10% gold face" og faner med "gold 2px underline" på alle faner, ikke kun T3.
- **TASTE P7 og P12:** talentmærker og mestertrøjer er navngivne undtagelser.
- **Koden:** fanens understregning er `border-cz-accent` som standard. Guld-tekst på aktiv fane er opt-in (`accent`). `bg-cz-accent/N`-tints har 210 forekomster i 90 filer.
- **Anbefaling:** TASTE v2 får én udtømmende liste over de syv steder i koden i dag plus de navngivne undtagelser. Alt uden for listen er et fund. Ejer-spørgsmål: **tæller fane-understregning og målerfyld med i rationeringen?** Jeg anbefaler ja, som de er. De 210 tints gennemgås derefter mod listen i en egen audit, og Segmented's 10 %-flade er det eneste tilladte tint.

**M6 · Hvad navnecellen indeholder**
- **TASTE P12 (7/11):** "nation · hover-ikon · navn · mærker · status · evt. ryttertype".
- **TASTE P21 (17/11):** "navnecellen viser kun navnet … typen står i sin egen kolonne".
- **PAGE_TEMPLATES:** den sticky første kolonne har "name + jersey/classification dot + uppercase subline". D-047: "nation, age still fold into the name cell's subline".
- **Koden:** `RiderNameCell.jsx` viser "Rytternavn uden flag (nation har nu sin egen kolonne)". `RiderTypeBadge` bruges i 25 filer.
- **Anbefaling:** én regel, der matcher koden og 17/11: navn + mærker (talent og trøje) + status-mærker. Nation, type og alder står i egne kolonner. Ejer-spørgsmål: **må mobil folde nation og alder ind som underlinje?** D-047 siger ja, og P21 siger kun navn. Jeg anbefaler ja på mobil, fordi pladsen er tre kolonner, og nej på desktop.

**M7 · Pille-radius**
- **PAGE_TEMPLATES D-047:** "999px pill, the one place pill radius is allowed". Hard don'ts: "pills use `rounded-cz-pill`", altså generelt.
- **TASTE §3:** "ÉN radius (5 px) + pill". **P21:** "ingen pille-radius".
- **Koden:** `chipStyles` (den generelle `Chip`) bruger `rounded-cz-pill`. `badgeStyles` bruger 5 px. `StatusBadge`'s prik er `rounded-full`. Der er 300 forekomster af `rounded-cz-pill` eller `rounded-full`.
- **Anbefaling:** 5 px på flader er låst og røres ikke. Pille-radius får en lukket liste: prikker, avatarer, tælle-piller og `Chip`. Badges forbliver 5 px. Det er et teknisk valg, men ejeren bør se det, fordi P21 sagde "ingen pille-radius".

**M8 · Display-skriften og skriftnavne**
- **TASTE P4:** Bebas kun på det ene store ord i T3-heroen. Resten er "Inter Tight og DM Sans".
- **PAGE_TEMPLATES T3:** context-strip i "display font uppercase, 14px" og initialer i Bebas. Det modsiger P4.
- **#8737 punkt 7/19:** display-skriften bliver. Brødtekst og tal skiftes til en variabel skrift med tabeltal (#8698). **TASTE §3:** "Heroens skrift afgøres på billederne i #8698".
- **Koden:** `font-display` bruges i 42 filer (landing og supporter er tilladt), heraf 4 steder i `text-xs`/`text-sm`/`text-base`.
- **Anbefaling:** TASTE v2 navngiver roller (display, tekst, data), ikke skrifter. Skriftnavnene bor i tokens. Context-strip flyttes til tekst-skriften. Ejer-spørgsmål kun via #8698 (de 3 par).

**M9 · Bevægelse: tider og teknik**
- **TASTE P14:** "kort fade (ca. 150 ms)" og samtidig "alle overgange tager 140-240 ms med ease-out". Aldrig `transition: all`.
- **#8737 punkt 8:** "150-250 ms, View Transitions".
- **Koden:** `duration-150` 56 gange, `duration-200` 7 gange og `duration-500` 3 gange (uden for begge intervaller). `transition-all` står 114 gange i 44 filer, og P14 forbyder det. `animate-pulse` står på frist-tekst 3 steder (auktioner, dashboard og rytterstatistik).
- **Anbefaling:** tre tids-tokens (150/200/250 ms, ease-out) ifølge #8737. `transition-all` og `duration-500` kommer på anti-slop-ratchetten. Den pulserende frist erstattes af statisk fare-farve og ikon, så status har ét sprog (P8). Ejer-spørgsmål kun om pulsen.

**M10 · Målebredder**
- TASTE spørgsmål 2 og P1 måler på 1280×900, og spørgsmål 15 på 375 px. Spørgsmål 16a og P21 bruger 1440 og 390×844. Fold-disciplinen i PAGE_TEMPLATES bruger 1000 px højde og 1280×900. #8737 design-CI bruger top-10 sider på "mobil + desktop".
- **Anbefaling:** ét sæt overalt: 390×844 og 1440×900. Det er det, ejeren bad om 25/11, og det, design-CI skal tage billeder i. Ejeren bekræfter med ét ja.

### B. Doc-rettelser (ejeren har besluttet, teksten halter)

**M11 · Træningskortets placering på mobil.** PAGE_TEMPLATES siger "fulde kort ÉN gang **under tabellen**". TASTE P10 siger, at ejeren 21/9 valgte "lige under sin egen række, placeringen under hele tabellen er trukket tilbage". Koden (`TrainingMobileRiderCard.tsx`) følger TASTE. Ret PAGE_TEMPLATES.

**M12 · `overflow-x`.** TASTE P10 siger `overflow-x: hidden`, og PAGE_TEMPLATES siger `overflow-x: clip`. Koden bruger `clip`, og det er nødvendigt for den sticky overskrift mod skærmens top. Ret TASTE, eller fjern det tekniske fra TASTE helt.

**M13 · Guld-tekstens farve.** PAGE_TEMPLATES siger "always `--accent-t` (#a07800)". `index.css` har haft `#866400` siden 19/11 (#8433, AA). Dokumenterne skal kun nævne token-navnet, aldrig hex.

**M14 · Hover-kortets bredde.** P18 siger "384 px". §5a siger "P18's 'ca. 360 px' er den samme regel i runde tal". P18 siger ikke længere 360. Koden bruger `w-[24rem]` = 384. Slet bisætningen.

**M15 · Tælling og nummerering.** §1 hedder "ti principper", men der er 21. Scoren i §4 siger "tjeklisten nu har 22 spørgsmål", men listen har 26 punkter (1-23 + 7a, 16a og 16b, i rækkefølgen …15, 16a, 16b, 16, 18…). §6 fork 8 siger "17 spørgsmål". §5 siger, at briefs citerer "P1-P11". Renummerér i v2.

**M16 · Ét sted for hver ting.** TASTE siger, at PAGE_TEMPLATES "siger HVAD", og TASTE "HVORFOR". Alligevel står D-047-opskriften og træningsundtagelsen i fuld længde i begge, på hvert sit sprog og med små forskelle (M3, M11 og M12 er netop opstået sådan). #8737 punkt 1 siger: tokens, så katalog, så TASTE som principper og tjekliste. Opskrifter flyttes til PAGE_TEMPLATES (senere Storybook). Beslutningslogs flyttes til en log-fil, der arkiveres og ikke slettes (rule 38).

### C. Dokumenterne mod ejerbeslutningerne 25/11 (#8737)

**M17 · Overlay-teknik.** TASTE P18: "bygges med browserens popover og ankerpositionering". #8737 punkt 17: egne komponenter på Radix-fundament (dialog, menu, tooltip, dropdown). Koden bruger hverken popover-API eller Radix, men `Portal` + `getBoundingClientRect` (`RiderHoverCard.tsx`). **Anbefaling:** TASTE v2 beskriver adfærd (Esc, fokus-fælde, fokus tilbage, ark på mobil) og overlader teknikken til kataloget.

**M18 · Lyst og mørkt tema.** #8737 punkt 6: begge temaer følger telefonen, spilleren kan vælge, og forbedringen sker på de samme tokens (retning B er anbefalet). TASTE har kun spørgsmål 16 med en henvisning til "GUIDELINES §2". PAGE_TEMPLATES nævner kun "always-navy sidebar". Koden (`lib/theme.jsx`) følger allerede `prefers-color-scheme` + `data-theme`. **Anbefaling:** et nyt princip i v2 (se P12 nedenfor).

**M19 · Tilgængelighed.** TASTE spørgsmål 16b kræver AA-kontrast (4,5:1 og 3:1). #8737 punkt 18 siger WCAG 2.2 AA som krav plus farveblind-tilstand (#7988, lovet). P5 siger om evne-farverne: "indtil vi har en bedre løsning for farveblinde". **Anbefaling:** et nyt princip om WCAG 2.2 AA som gulv. Det omfatter fokus, trykflade, ikke-tekst-kontrast 3:1 og farveblind-tilstand som token-sæt.

**M20 · Beslutningsform.** TASTE P17 kræver billeder med ægte data. #8737 punkt 4 siger "levende wireframe først", og ejeren godkender én side ad gangen. TASTE nævner ikke wireframe-først. **Anbefaling:** P17 udvides (v2 P14).

### D. Koden bryder en regel, der ikke er omstridt (til orientering, ikke modsigelser)

**M21 · Trykflader.** P16 og PAGE_TEMPLATES siger 44 × 44 på grov pointer. §5a siger "luk-knap 36 px" i bundarket og menurækker "min. 36 px". `Modal.jsx`'s luk-knap er `h-8 w-8` (32 px). Om gulvet på 44 px løfter den på touch, er ikke verificeret i browseren her. **Anbefaling:** §5a's 36 px rettes til "synlig 36, trykflade 44", og luk-knappen måles på 390 px.

**M22 · Ikonstørrelser og spinnere.** P7 siger "ét stroke-ikonsæt (16/20/24 px)". P6 siger 22-26 px til tomme tilstande, og PAGE_TEMPLATES siger 13 px chevron og 26 px tom tilstand. Koden har mest 14 (207), 13 (132), 12 (124), 16 (97), 26 (96), 11 (58) og 10 (49). Desuden bruges `Spinner` i 6 filer uden for `PageLoader` og KitchenSink (`BoardPage`, fire racehub-komponenter og `SeasonFinanceReportPanel`), og §3 forbyder det. **Anbefaling:** ikon-tokens følger skrifttrinnene (12/14/16/20/26), og spinnerne kommer på ratchetten.

---

## Del 2. Udkast: TASTE v2 (principper + tjekliste)

Struktur efter #8737 punkt 1: **tokens** (værdier) → **katalog** (PAGE_TEMPLATES nu, Storybook når #8737 trin 2 er bygget) → **TASTE** (hvorfor og hvor godt, ja/nej). TASTE v2 indeholder ingen pixelværdier, hex-koder, klassenavne eller skriftnavne. Den peger på tokens og katalogets historier. Beslutningsloggen (§6 i dag) flyttes til `docs/design/TASTE_DECISIONS.md` og arkiveres, intet slettes. Udkastet er skrevet til ejerens blok. Ordlyden i de omstridte punkter afhænger af svarene på M1-M10.

### Låst (genåbnes ikke)

1. Én gold primary pr. view.
2. Hairlines, ingen skygger (overlays undtaget).
3. 5 px radius på alle flader.
4. Tabeltal på al numerik.
5. Stroke-ikoner. Aldrig emoji, unicode-pile eller tekst-glyffer.

### Én sætning

Cycling Zone skal se ud, som om det er lavet af folk, der elsker cykelsport og data, ikke af en skabelon. Ved konflikt mellem tæthed og ro vinder tætheden (Football Manager er ankeret). Roen kommer fra typografi, hairlines og rationeret guld.

### Principper

| # | Princip | Reglen | Kilde i v1 |
|---|---|---|---|
| P1 | **Data først** | Det, spilleren kom for at se, står over folden. Kontroller, der kun styrer én tabel, står i tabellens titellinje. Forklaringer står under eller bag. | P1, P21 |
| P2 | **Ægte cykeldata er billedet** | Profiler, tidsgab, trøjer og kurver er vores billedsprog. Mangler en flade liv, er svaret mere ægte data, aldrig pynt. Én ruteprofil-komponent i to størrelser. | P2, P19 |
| P3 | **Sandt eller tomt** | Hvert tal og hvert løfte er bakket af data, der findes nu. En tom flade er en handling med én knap, ikke en beskrivelse. | P6, P11 |
| P4 | **Redaktionel ro** | Hairlines, én radius og luft. Guld står kun på listen over guld-steder i tokens (M5), og alt andet er et fund. | P3 |
| P5 | **Typografiske roller** | Display står kun på det ene store ord pr. side. Tekst og data har hver deres rolle, og data har altid tabeltal. Sentence case overalt (M1). To mikrotrin, intet under det mindste. | P4, P5, §3 |
| P6 | **Ens ting står ens** | Samme slags tabel har samme kolonneorden, rækkehøjde og sortering overalt. Rytter- og holdnavne er altid links. Hver slags tal har én skrivemåde og én formatter. | P5, P12, P13 |
| P7 | **Ét sprog for status** | Fire prioritetssignaler (gold primary, status-mærke, tælle-pille og T3-keyline) og én opskrift for status-flader. Et nyt signal udvander de fire. | P8 |
| P8 | **Kort på fladen, manual i Hjælp** | Kun label, værdi, handling eller én linje kontekst. Fagord kan klikkes og forklares i én sætning, og der er højst ét Hjælp-link pr. sektion. | P9, P15 |
| P9 | **Ét spil på alle skærme** | Samme komponenter, tokens og regler på web, mobil og app. Mobil viser de samme tal i en anden geometri: navn + tre kolonner uden vandret scroll, og tidsakse-tabeller er undtaget. Trykflader er mindst 44 × 44. | P10, P16, P20 |
| P10 | **Bevægelse forklarer** | Kun når den viser, hvad der skete (et tal, der ændrer sig, en rytter, der rykker op). Tre tider fra tokens, ease-out, kun transform/opacity. Ved reduceret bevægelse animeres intet. | P14 |
| P11 | **Overlays opfører sig ens** | Svævende kort på computeren og ark nederst på telefonen. Esc lukker, fokus holdes inde og vender tilbage. Spillets fonte og mærker. Opskriften står i kataloget. | P18, §5a |
| P12 | **To temaer, ét system** (ny) | Lyst og mørkt på de samme tokens, efter telefonens valg eller spillerens. Hierarkiet er det samme i begge, og ingen flade forsvinder. | #8737 punkt 6 |
| P13 | **Tilgængelighed er gulvet** (ny) | WCAG 2.2 AA: tekstkontrast, ikke-tekst-kontrast, synligt fokus og trykflader. Farve bærer aldrig betydning alene, og farveblind-tilstand er et token-sæt. | Q16b, #8737 punkt 18, #7988 |
| P14 | **Vi beslutter på billeder** | Levende wireframe med ægte data først, før og efter side om side, og ejeren godkender én side ad gangen før byg. | P17, #8737 punkt 4 |

### Tjekliste v2 (ja/nej pr. side, 390×844 og 1440×900, lys og mørk)

`[CI]` = kan håndhæves af en vagt (anti-slop, axe eller billedsammenligning). `[øje]` = visuel dom. **Fed** = vejer dobbelt.

**Struktur**
1. `[øje]` Bruger siden én af T1/T2/T3 uden egne sidehoveder, bredder eller padding? (katalog)
2. **`[øje]` Står det primære indhold over folden på 1440×900, med højst ét kontrol-lag mellem faner og data?** (P1)
3. `[øje]` Overblik først og detaljer i faner, uden løsrevne knaprækker, bannere eller introtekst over indholdet? (P1, P8)

**Data**
4. `[øje]` Er der mindst ét ægte cykeldata-element som billede, hvor det giver mening, og intet dekorativt? (P2)
5. **`[øje]` Er alt indhold bakket af data, der findes nu, og er hver tom tilstand en handling med én knap?** (P3)
6. `[CI]` Er al numerik tabeltal, højrestillet i tabeller, med enhed og skrevet med den fælles formatter? (låst 4, P6)
7. `[CI]` Kan hver datatabel sorteres på alle kolonner, med navnet som link? (P6, `tableSortIntent.test.js`)

**Chrome**
8. **`[CI]` Er der præcis én gold primary, og står guld kun på guld-listens steder?** (låst 1, P4)
9. `[CI]` Nul skygger uden for overlays, nul gradienter og glow, kun 5 px radius på flader og pille kun på pille-listen? (låst 2-3, M7)
10. `[CI]` Kun stroke-ikoner i ikon-tokenens størrelser, ingen emoji, pile eller glyffer? (låst 5)
11. `[øje]` Har alle mærker samme anatomi, og bruges kun de fire prioritetssignaler? (P7)
12. `[øje]` Står display-skriften kun på sidens ene store ord? (P5)

**Copy**
13. `[CI]` Sentence case overalt, også i små labels (efter M1), ingen em-dash og ingen fyldord? (P5, TONE)
14. `[øje]` Er al tekst på fladen label, værdi, handling eller én linje kontekst, EN først? (P8)

**Mobil**
15. `[øje]` Viser 390 px navn + tre kolonner uden vandret scroll, med kolonne-knappen i titellinjen til resten (tidsakse-tabeller undtaget)? (P9)
16. `[CI]` Har hver trykflade mindst 44 × 44, og kan alt nås uden langt tryk? (P9, P13)
17. `[øje]` Ville siden kunne genkendes som Cycling Zone på den anden skærm? (P9)

**Tema, tilgængelighed, bevægelse**
18. `[CI]` Består siden axe (WCAG 2.2 AA) i lyst og mørkt uden nye fejl? (P12, P13)
19. `[øje]` Holder mørkt tema samme hierarki som lyst? (P12)
20. `[CI]` Bruger overgangene kun tids-tokens og ingen `transition-all`, og respekteres reduceret bevægelse? (P10)
21. `[øje]` Opfører overlays sig som opskriften (kort/ark, Esc, fokus)? (P11)

**Proces**
22. `[øje]` Ligger før/efter-billederne (390 og 1440, lys og mørk) på PR'en til ejerens godkendelse? (P14)

**Bonus, afgør verdensklasse**
23. `[øje]` Ville en Football Manager-spiller, der ser siden i 5 sekunder, tro, at den er lavet af nogen, der elsker cykelsport? Hvis nej: skriv hvad der mangler.

Score som i dag: andelen af "ja" blandt de relevante spørgsmål. Mindst 95 % er verdensklasse-kandidat, 80-94 % er på system og mangler smag, og under 80 % skal have en runde. 2, 5 og 8 vejer dobbelt (v1's 2, 7, 8 og 13, hvor 7 og 13 er slået sammen i 5). 11 af de 23 er `[CI]` og kan blive vagter i #8737 trin 3.

### Hvad flytter ud af TASTE

| Fra TASTE v1 | Til | Hvorfor |
|---|---|---|
| D-047-opskriften (P10) og træningsundtagelsen | PAGE_TEMPLATES T2, senere `DataTable`-historier i Storybook | Står i dag dobbelt og er gledet fra hinanden (M3, M11, M12) |
| §5a overlay-opskriften | Katalog (`RiderHoverCard`/`Menu`-historier) | Teknik, ikke smag (M17) |
| §6-tabellerne (2/9, 7/11, 12/11) | `docs/design/TASTE_DECISIONS.md` (arkiv, intet slettes) | Principperne citerer beslutningen. Loggen er kilden |
| Skærmbillede-eksemplerne (`wave6-elevation/…`, juli) | Bilag i v2 med dato, fornyes af design-CI | De viser sider, der siden er ændret |
| Pixel-, hex-, klasse- og skriftnavne | tokens (`index.css` nu, `tokens.json` efter #8737 trin 1) | Én kilde |

---

## Fix-plan

**Trin 1 · Ejerens blok (26/11 kl. 10-11), ingen kode.** Claude stiller M1-M10 som ét spørgsmål ad gangen med billeder og én anbefaling, i rækkefølgen M1, M2, M3+M4, M5, M6, M7, M10, M9, M8. M8 afgøres via #8698's tre skriftpar. Svarene noteres på #8725.

**Trin 2 · Doc-PR (docs-only, lav risiko).** Filer: `docs/design/TASTE.md` (v2 efter del 2 med ejerens svar), `docs/design/PAGE_TEMPLATES.md` (M3, M4, M6, M7, M11, M13, sentence case efter M1, overlay-opskriften fra §5a), ny `docs/design/TASTE_DECISIONS.md` (§6 flyttes ordret). Doc-rettelserne M11-M16 tages med uden ejer-spørgsmål. Ingen spillertekst, så den kan merges med grøn CI + review (stående merge-regel). Kun ejeren må ændre TASTE (P17), så v2-teksten vises ejeren før merge.

**Trin 3 · Vagter (sammen med #8737 trin 1 og 3).** `scripts/check-anti-slop.mjs` får ratchet-regler for `transition-all`, `duration-500`, `Spinner` uden for `PageLoader`, `rounded-cz-pill` uden for pille-listen, ikonstørrelser uden for tokens og, efter M1, `uppercase` på tekst under 12 px. Baselinen fryser dagens tal, så kun bedre slipper igennem (skralde-reglen fra #8737 punkt 3).

**Trin 4 · Kit-ændringer, hver sin PR med før/efter-billeder og beta-udrulning (#8737-kommentaren 26/11, regel 2).**
- (a) sentence case i `dataTableStyles`, `tableStyles`, `HeroStats`, `Section`, `chipStyles`, `badgeStyles`, `fieldStyles`.
- (b) `DataTable`: titellinjen som standard og `MobileTableChips` udfases, efter M3-svaret.
- (c) den pulserende frist erstattes på 3 sider.
- (d) luk-knappen i `Modal` måles og løftes til en trykflade på 44 px.

Risiko: (a) og (b) er synlige på næsten alle sider. Derfor beta først, Sentry og PostHog i 1-3 dage og derefter alle på ejerens ja. Billedsammenligningen fra #8737 trin 3 fanger utilsigtede ændringer.

**Trin 5 · Resten af #8725 (egen lane).** Læs checklist.design-skillens indhold, installér den med låst version, kortlæg dens punkter mod TASTE v2-tjeklisten ovenfor (tjekliste-punkt, vores regel, konflikt, forslag) og kør de første audits. Den mapping er ikke lavet her.

---

bekraeftet + fix-plan
