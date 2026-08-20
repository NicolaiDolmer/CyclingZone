# Patch note-numre skal tildeles i MERGE-orden, og laveste nummer skal merges foerst

**Dato:** 2026-08-20 (aften-sessionen, merge-toget)

## Hvad skete der

Fem PR'er i aftenens merge-tog fik forhaandstildelt patch note-numre efter
PLANLAGT raekkefoelge: trin 7=7.153, #4013=7.154, #4012=7.155, #2748=7.156.
Saa blev PR #4019 (spejder-mekanik) faerdig foerst og fik 7.157 - og blev
merget FOERST, fordi den var klar og havde ejer-go.

`check-patch-notes-version.js` kraever at en PRs top-version er STOERRE end
mains top. Da main-toppen blev 7.157, fejlede alle fire ventende PR'er med
lavere numre. Alle fire skulle omnummereres (7.158-7.161) og have main merget
ind igen - fire ekstra konfliktloesninger og CI-runder.

## Rod-aarsag

Nummer-tildeling og merge-orden blev behandlet som to uafhaengige beslutninger.
Det er de ikke: vagtens invariant goer nummerraekkefoelgen = merge-raekkefoelgen.

## Regel fremover

1. Ved et merge-tog: tildel IKKE numre paa forhaand til PR'er med usikker
   raekkefoelge. Tildel nummeret ved MERGE-tidspunktet (main-top + 1).
2. Tildeles numre alligevel paa forhaand (fx fordi flere sessioner bygger
   parallelt), er de en BINDENDE merge-orden: laveste nummer merges foerst,
   og en PR der bliver klar "for tidligt" maa vente eller alle bag den
   omnummereres.
3. Konfliktmoensteret ved omnummerering er mekanisk (entry oeverst over mains
   nye top, python-splejsning af konflikt-hunks) men koster en CI-runde pr. PR.

Relateret: serielle patchNotes-konflikter i selve toget er UUNDGAAELIGE (hver
merge flytter main-toppen som naeste PR har baseret sin resolution paa) -
planlaeg 2-3 min konfliktloesning pr. vogn ind i togets tidsplan.
