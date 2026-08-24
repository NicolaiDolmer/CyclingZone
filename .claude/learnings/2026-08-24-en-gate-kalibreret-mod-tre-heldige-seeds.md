# En gate kalibreret mod tre heldige seeds måler held, ikke regressioner

**Dato:** 2026-08-24 · **Issue:** [#4180](https://github.com/NicolaiDolmer/CyclingZone/issues/4180) · **Udløst af:** [#4178](https://github.com/NicolaiDolmer/CyclingZone/issues/4178)/[#4179](https://github.com/NicolaiDolmer/CyclingZone/issues/4179)

## Hvad skete der

`npm run race:gate` kørte tre hardcodede seeds (2026, 7, 42) og krævede at hver
seed bestod alle bånd. Målt på 400 tilfældige seeds fejlede den på **168 af dem
(42 %) med uændret kode på main**. De tre CI-seeds var tilfældigvis blandt de
heldige. Gaten kunne dermed hverken frikende eller dømme en ændring — den var
rød lige så tit på grund af trækket som på grund af koden.

Det blev først synligt da #4179 udvidede navnelisterne og gaten faldt. Ingen
kunne afgøre om forringelsen var reel.

## Rodårsagen

To fejl, samme klasse:

1. **Båndene var fittet mod for lille en stikprøve.** `itt`-målet (≥60 %) blev
   sat da tre seeds målte 66/65/62. Den faktiske fordeling er middel 65,5 med
   spredning 11,6 procentpoint — målet lå på den **30. percentil**. Et bånd der
   ligger 0,5 spredning under middelværdien er et møntkast, ikke en gate.
2. **Variansen blev antaget at være støj, ikke indhold.** 83-93 % af variansen
   på hvert bånd er **populations-bunden**: hvert seed bygger sit eget felt på
   800 ryttere, og felterne er reelt forskellige. Målt ved at firedoble antallet
   af løb pr. seed — spredningen på `itt` gik 10,18 → 10,28 pp, altså intet.
   Flere løb koster 4× CPU og fjerner ingenting; kun flere seeds gør.

## Samme sygdom fandtes tre steder til

Da instrumentet virkede, dukkede den op igen med det samme:

- **`fictionalLaunchPopulation.test.js`: `max base_value ≤ 40M`.** Brydes på
  44 % af seeds med koden på main (op til 61,1M). Bestod kun fordi testen kører
  ét låst seed. Målte i øvrigt værdimodellen, ikke generatoren: værdikurven er
  så stejl i toppen at ét overall-point flytter den dyreste rytter 32,1M → 52,9M.
- **`longDayEnduranceLift` (rute-bånd).** Båndet er `>3pp`; den målte middelværdi
  er 3,01. Ren 50/50 — og derfor fejler `race:gate:routes` på 24 af 50 seeds.
- **Balance-baselinen.** 98 rækker var allerede drevet på main, ubemærket, fordi
  `balance:check` aldrig blev koblet på CI.

## Reglen der kom ud af det

**Et bånd skal placeres ud fra en målt fordeling, ikke ud fra de første tal man
så.** Konkret, før et bånd committes:

1. Mål metrikken over ≥50 seeds — ikke 3.
2. Skriv middelværdi og spredning ind ved båndet. Ligger båndet under ~2
   standardafvigelser fra middelværdien, er det et møntkast.
3. Afgør om variansen er **indholds-bunden** (populationen skifter → flere seeds
   + aggregat-dom) eller **motor-bunden** (sampling → flere løb pr. seed). Det
   afgøres empirisk, ikke ved fornemmelse: skalér den ene akse og se om
   spredningen følger med.
4. Dømmer et bånd på ét låst seed, tester det ikke det du tror — det tester
   dét seed.

**Og: skil de RNG-strømme der ikke hører sammen.** Navnene trak fra generatorens
hovedstrøm, så en ren navne-tilføjelse ændrede hver eneste rytters stats.
Understrøm pr. domæne (som `secondaryRng`, #3634) gør vedligehold gratis og
holder enhver balance-diff til én variabel.

## Forward-guards der kom med

- `evaluateSeedAggregateGate` i `lib/raceDryRunOracles.js` — dommen er nu en ren,
  unit-testet funktion i stedet for logik begravet i et script.
- `scripts/raceSeedVariance.js` — harnesset der målte det hele, så næste
  rekalibrering sker på tal.
- Test i `fictionalRiderGenerator.test.js` der udvider alle navne-clusters og
  kræver at ikke én rytters stats flytter sig. Verificeret rød på den gamle
  adfærd (211 af 400 ryttere flyttede sig).
- `race:gate` siger nu eksplicit fra ved færre end 10 seeds: "dette er IKKE en
  godkendelse" — i stedet for at rapportere grønt på et 3-seed-snit.
