# Me-toningen erstattede cellernes baggrund i stedet for at ligge oven paa

Dato: 2026-08-31 (Europe/Copenhagen)
Issue: #2795 · PR: #4420 · Fundet af: adversarisk review

## Hvad skete der

PR #4420 flyttede "det her er dit hold"-markeringen fra `<tr>` til cellerne,
fordi en `box-shadow` paa en `<tr>` ikke males paalideligt i en
`border-collapse`-tabel. Diagnosen var rigtig, og markeringen blev synlig.

Men fladetoningen blev lagt som

    tr.cz-me > td { background-color: rgb(var(--me-ring) / 0.05) }

og det gav tre tavse regressioner, alle KUN paa brugerens egen raekke:

1. DataTables sticky navnekolonne er bevidst opak (`bg-cz-card`,
   `dataTableStyles.js:75`) fordi de numeriske kolonner scroller ind UNDER den.
   Den blev 95 % gennemsigtig, saa tallene kunne ses gennem holdnavnet.
2. Zone-tinten paa /standings (`bg-cz-success-bg` / `bg-cz-danger-bg`) blev
   erstattet, saa egen raekke var den ENESTE farveloese i sin op-/nedrykningszone.
3. `<Card>`'s `bg-cz-card` paa Global Rank-baandet forsvandt paa samme maade.

Dertil en fjerde af en anden slags: paa saeson-afslutningen mistede
divisionslederen der er dig selv sin dig-markering HELT.

## Rod-aarsag

To forskellige kaskade-fejl, som er nemme at forveksle:

**a) Specificitet mod Tailwind-utilities.** Cellernes egen baggrund kommer fra
utility-klasser med specificitet (0,1,0). `tr.cz-me > td` har (0,1,2) og staar
desuden efter `@tailwind utilities`. Reglen vandt paa begge taellinger og
ERSTATTEDE baggrunden i stedet for at laegge sig oven paa den. En 5 %-alfa-farve
"oven paa" noget er kun en illusion: `background-color` har ét lag.

**b) box-shadow kaskaderer ikke sammen.** `tr.cz-me-bar > td:first-child` og
`tr.cz-zone-up > td:first-child` har SAMME specificitet, saa den sidste i filen
vandt HELT - ikke "begge skygger". Lederen af en division er altid ogsaa i
op-rykningszonen, og kombinations-reglen matchede kun `.cz-me`, ikke
`.cz-me-bar`. Netop den kombination der altid forekommer, var den eneste
udaekkede.

## Fix

Toningen er nu en **inset box-shadow** i stedet for en `background-color`. En
inset skygge males OVER baggrunden og lader den staa, saa sticky-celle,
zone-tint, hover og leder-guld alle overlever. Det loeser ogsaa hover-fundet:
`group-hover:bg-cz-subtle` (0,3,0) slog toningen ud i netop den sticky celle.

Markerings-lagene ligger i CSS-variabler paa `<tr>` (`--cz-mark-tint`,
`--cz-mark-me`, `--cz-mark-zone`), og ét sted skriver `box-shadow` med alle tre
lag. Saa kan "dig" og en zone staa paa samme raekke uden at den ene erstatter
den anden. Zonen males foerst i listen, saa den ses oven paa dig-striben.

## Laering

- **En custom-klasse der saetter `background-color` paa et element der ogsaa
  baerer Tailwind-bg-utilities, er naesten altid forkert.** Den erstatter, den
  toner ikke. Vil du tone: inset `box-shadow`, `background-image`-gradient eller
  `color-mix` - noget der har sit eget lag.
- **`box-shadow` er ikke additiv paa tvaers af regler.** To markeringer der kan
  optraede paa samme element skal komponeres ét sted, fx via variabler.
- **Den kombination der ALTID forekommer, er den man glemmer at teste.**
  Lederen er altid i op-rykningszonen; alligevel var det den eneste udaekkede
  gren. Spoerg: hvilke af mine tilstande er korrelerede?
- **En guard der kun maaler det man lige har rettet, er halv.** Den gamle spec
  maalte `box-shadow` og var groen mens tre baggrunde var oedelagt. Maal ogsaa
  det du kunne komme til at OEDELAEGGE, ikke kun det du tilfoejer.
- **En assertion i en `if` der aldrig er sand, er ingen assertion.** Testen hed
  "uden at spise leder-guldet" og verificerede intet om leder-guldet, fordi
  `leaderIsMine` aldrig var sand med standard-mocken. Samme klasse som
  `2026-08-28-groent-flueben-der-intet-verificerede.md`. Har en test en gren der
  afhaenger af fixture-data, saa byg en fixture hvor grenen ER sand.

## Forward-guard

- `frontend/src/meMarkerCss.test.js` laaser mekanikken: ingen `background-color`
  i markerings-blokken, begge me-varianter i kombinations-reglen, og
  lag-raekkefoelgen i `box-shadow`. Mutations-testet: fjernes `.cz-me-bar` fra
  kombinations-reglen fejler 1 test; laegges toningen tilbage som
  `background-color` fejler 6.
- `frontend/tests/e2e/me-marker-cells.spec.js` maaler nu ogsaa
  `backgroundColor`: at den sticky celle er helt opak (alpha 1), og at egen
  raekke i en zone har samme celle-baggrund som naboen i samme zone. Ny mock
  hvor TEST_TEAM baade er leder OG i op-rykningszonen, saa leder-assertionen er
  ubetinget. Mutations-testet: laegges toningen tilbage som `background-color`
  fejler alle 3 tests paa alpha 0.05 mod forventet 1.
