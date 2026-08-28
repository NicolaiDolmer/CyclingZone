# En godkendt mockup genåbnede en låst beslutning, og ingen så det før refutationen

**Dato:** 2026-08-28
**Kontekst:** Sæsonmatrixen (#1146, PR #4323). Ejer-godkendt visuelt design 27/8, bygget samme aften.

## Hvad der skete

Mit design-mockup til ejerens akse-beslutning viste fire linse-chips over gitteret,
heriblandt "Route match". Ejeren godkendte mockuppen ("Matrix-designet er godkendt, byg
det"), og builderen byggede alle fire linser.

Men Z1-spec'en fra 25/8 (`docs/superpowers/specs/2026-08-25-planning-center-z1-saesonmatrix-design.md`
§5) havde en EKSPLICIT ejer-beslutning om det modsatte: "Rute-match | nej | Kun ved
celle-åbning". Mockuppen prætenderede ikke at ændre den beslutning; den var bare tegnet
uden at holde linse-listen op mod spec'en. Godkendelsen af helheden blev dermed en
stiltiende tilbagerulning af en enkeltbeslutning, som hverken ejeren eller jeg opdagede.

Design-tro-refutationslinsen fangede det, fordi den læste spec'en på main frem for
builderens opsummering. Ejeren blev spurgt eksplicit og valgte at beholde linsen; spec'en
er opdateret med 27/8-beslutningen og begrundelsen (demand-vektor-forbeholdet fra 25/8
gjaldt ikke længere, fordi det nye season-read-endpoint bærer vektorerne).

## Lektionen

**En mockup-godkendelse godkender helheden, ikke hver enkelt delbeslutning.** Ejeren
kigger på formen; han krydstjekker ikke fire chips mod en fem dage gammel spec-tabel.
Ansvaret for at flage "denne detalje MODSIGER en låst beslutning" ligger hos den der
tegner mockuppen, FØR godkendelsen. Det er samme fejlklasse som 12/8 (låst beslutning
genåbnet som nyt A/B-valg), bare med et visuelt mellemled der gjorde den sværere at se.

## Hvad vi gør anderledes

1. **Før et mockup forelægges:** diff dets beslutningsbærende elementer (linser, aksevalg,
   knapper, vokabular) mod områdets spec/SSOT, og markér eksplicit i forelæggelsen hvis
   noget afviger fra en tidligere beslutning. Afvigelsen skal være et spørgsmål, ikke en
   passager.
2. **Refutations-linsen "ruller det her en ejer-beslutning tilbage?" virker** og skal
   læse spec'erne selv, ikke builderens opsummering. Den fangede både denne og
   #4306-spejlingen (withdrawal-gaten der skulle med ind i bulk-stien ved merge-konflikt).
3. Når ejeren derefter bekræfter afvigelsen, opdateres spec'en i SAMME ombæring, så SSOT
   aldrig står og modsiger koden (gjort her: §5-tabellen bærer nu 27/8-revisionen).

## Refs

#1146 · PR #4323 · `docs/superpowers/specs/2026-08-25-planning-center-z1-saesonmatrix-design.md` §5
