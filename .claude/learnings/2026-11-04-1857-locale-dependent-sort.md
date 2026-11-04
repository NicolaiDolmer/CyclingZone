# 2026-11-04: Motor-output afhang af maskinens sprog (#1857)

**Symptom:** `replayStage1857.mjs` gav `bit_identical: false` for alle gemte prod-etaper, når det kørte på PC1, selv i præcis etapens `engine_build`. Replayet var deterministisk med sig selv.

**Rodårsag:** v4-motoren (og v3, broen) sorterede rytter- og gruppe-id'er med `a.localeCompare(b)` uden sprog. Sorteringen følger så processens standardsprog: Railway (Linux) er en-US, PC1 (Windows) er da-DK, hvor "aa" læses som "å" og sorteres sidst. UUID'er med "aa" byttede plads med naboen i `passages.perRider`, `loads` og `passage_totals`. Værdierne var ens; kun rækkefølgen, og dermed hashen, afveg.

**Hvorfor det tog tid:** mistanken gik først på manglende input i snapshottet, libm/Math-forskelle og forkert `engine_build`-stempling. Udelukkelsen kom fra at tvinge kun `localeCompare` til en-US med en preload: så matchede alle seks etaper.

**Rettelse:** `compareIds` med fast "en-US" i alle 123 kald (#7609), en determinismetest der kører samme input under da-DK og en-US mod en frossen hash fra merge-base, og vagten `scripts/check-locale-compare.mjs` (CI + preflight).

**Lær:** al sortering i deterministisk kode skal have eksplicit sprog eller ren kodeenheds-sammenligning. "Det virker i prod" beviser ikke determinisme; kør replay på en maskine med et andet sprog.
