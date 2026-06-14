# Verificér et issues rod-årsags-hypotese mod selve gaten — før du implementerer dets foreskrevne fix

**Dato:** 2026-06-14 · **Issue:** #1267 (board-mål-kalibrering) · **Refs:** #1187-B, #1102

## Hvad skete

#1267 hævdede at 50% konsekvens-rate var drevet af to fejlkalibrerede mål
(`min_riders` umulig mod reelle trupper + `sponsor_growth` uflytbar i sæsonen) og
foreskrev: re-kalibrér de to → kør harnesset → ≤10% PASS.

Jeg implementerede præcis det. Begge problemer var ægte (alle 49 min_riders-mål var
bogstaveligt umulige). Men målt mod gaten flyttede fixet raten **50,0% → 45,5%** —
næsten ingenting.

## Den ægte rod-årsag

En per-kategori-nedbrydning viste: results-kategorien vejer 50% og bliver præcis **0
når et hold vinder 0 etaper**. Et hold med perfekte identitets-/økonomimål bliver
alligevel hard-hit ved 0 sejre. Og ~halvdelen af alle hold vinder 0 etaper pr. sæson
(winner-take-all + stejl talent-pyramide). min_riders/sponsor_growth var *medvirkende*,
ikke driveren.

Verificeret mod den ægte race-motor (ikke kun harnesset): 23-68% nul-sejrs-hold på
tværs af hold-dannelse + seeds → sejrs-knapheden er fundamental, ikke et harness-artefakt.

## Lektien

Et issue beskriver ofte en *hypotese* om rod-årsagen, ikke en verificeret kendsgerning —
især når det er skrevet før data fandtes. Den foreskrevne fix kan være korrekt-men-
utilstrækkelig.

**Mål fixets effekt mod selve accept-gaten FØR du stoler på issuets framing.** Her: kør
gaten (harnesset) efter hver kalibrerings-ændring, ikke kun til sidst. Da det første,
oplagte fix ikke flyttede gaten, var det signalet til at instrumentere en per-komponent-
nedbrydning og finde den ægte driver — i stedet for at blive ved med at pille ved de to
mål issuet pegede på (loop-guard).

Forlænger [[feedback_simulate_before_ship_balance]] (gaten var allerede et harness —
brug det som måle-loop, ikke kun som sluttest) og [[feedback_runtime_verify_first]]
(verificér før claim — også et issues egen årsags-påstand).

## Bonus: skel motor- vs. indholds-bundet gap

Da gaten ikke kunne nås med kalibrering, var næste skridt at verificere om problemet var
et harness-artefakt (billigst hvis det opløste sig) før jeg rørte ejer-låst mekanik.
Svaret (nej, det er ægte) sparede en unødig mekanik-ændring og afgrænsede beslutningen
korrekt til ejeren.
