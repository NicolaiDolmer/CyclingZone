# Kalender-SSOT'en var forældet på seks tal, og vagten der skulle fange det gik grøn

**Dato:** 30-31/8 2026 · **Issue:** [#4176](https://github.com/NicolaiDolmer/CyclingZone/issues/4176) · **Type:** dokumentations-drift + vagt-svigt

## Hvad der skete

`docs/CALENDAR_RULES.md` blev skrevet 24/8 som SSOT for alle kalender-regler. Seks dage senere var **seks af dens tal forkerte**, målt mod koden og mod prod:

1. Kvote-rækken i §1 sagde 135/108/81/54. Det tal svarer til 27 løbsdatoer. Sæsonen har haft 31 siden 25/8, så det rigtige er 155/124/93/62. Samtidig står `TIER_GAME_DAY_QUOTA` i koden på 140/112/84/56 (28 dage). **Tre kilder, tre tal, ingen der vidste af hinanden.**
2. §5's terræn-familie-tabel sagde `rolling` → flat_sprint og `classic` → hilly. Koden siger `rolling` → egen familie (siden 24/8) og `classic` → ingen familie.
3. §3 og §4 regnede GT-slæk på 21 etaper. Sæsonens tre GT'er har 18, 17 og 17. Slækket er 4 pladser, ikke 1.
4. §6 sagde "sæsonen grøn på alle seks akser, men 11 brud". Målt live: 7 brud, og sæsonen selv brudt på flad.

Samtidig kørte `calendar-invariant-audit.yml` grønt 30/8 **uden at have målt noget**: `verify-invariants.js` døde på en statement timeout i et andet domæne, `|| true` lod bash gå videre med en tom `invariants.json`, parser-blokken kastede `SyntaxError` — men blokken ender på `| tee`, og under `bash -e` er det tee's exit-kode der tæller. Job: success.

## Rod-årsag

**To forskellige, med samme form.**

Dokumentet: et SSOT-dokument har ingen mekanisme der binder det til koden. Da `TIER_DENSITY × REAL_DAYS` skiftede fra 27 til 31 dage, og da `rolling` fik sin egen familie, flyttede koden sig og dokumentet blev stående. Ingen test, ingen lint, intet review-krav koblede de to. Fejlen var ikke at nogen skrev forkert — det var at ingenting fangede at koden flyttede sig bagefter.

Vagten: samme form på procesniveau. `|| true` og `| tee` er begge skrevet for at gøre et step robust. Tilsammen gør de det **umuligt for steppet at fejle**, også når det ikke har målt noget. Manglende evidens så ud som grønt.

## Fix

Integreret alle målte korrektioner i `docs/CALENDAR_RULES.md` (én kilde, ikke to), med den forkerte værdi bevaret ved siden af den rigtige og en forklaring på hvorfor den var forkert. Tilføjet §11 "IKKE FASTLAGT" med otte spørgsmål der kræver ejer-beslutning, og §12 med de forward-guards der mangler. Vagt-fixet ligger i [#4465](https://github.com/NicolaiDolmer/CyclingZone/issues/4465), ikke her.

## Lærdom

**Et SSOT-dokument uden en test der binder det til koden, er en snapshot med en udløbsdato ingen kender.** Den vigtigste guard i §12 er derfor ikke en kalender-invariant, men en doc-test: hver konstant nævnt i dokumentet skal findes med den værdi i den fil tabellen peger på.

**Skriv den forkerte værdi ned sammen med den rigtige.** Fjerner man bare det gamle tal, læser næste agent det nye skråt og bruger sin egen hukommelse. Står der "dette stod på 21, virkeligheden er 17-18, og her er hvorfor forskellen betyder noget", stopper gentagelsen.

**`|| true` og `| tee` i samme step er en vagt der ikke kan fejle.** Enhver blok der læser et resultat, skal vælte hvis resultatet mangler. Manglende evidens er ikke grønt. Det er tredje gang på tre måneder, jf. `2026-08-09-invariant-vagt-taerskel-uden-tilstandstjek.md` og `2026-08-23-invariant-vagt-alarmerede-paa-egen-finaliseringshale.md`.
