# Session-prompt: præmiefordelingen pr. division ([#3719](https://github.com/NicolaiDolmer/CyclingZone/issues/3719))

**Status ved parkering:** fordelingen er BESLUTTET, én A/B står tilbage. Ejeren parkerede den 14/8 til en egen session. **Læs [#3719-tråden](https://github.com/NicolaiDolmer/CyclingZone/issues/3719) først** — hele analysen med tal ligger der, dette er kun indgangen.

## Beslutningen der allerede er truffet

Ejer 14/8, ordret: *"D1 skal have flest, D2 halvdelen, D3 en tredjedel, D4 en tiendedel"*

Præmiepulje-indeks med D1 som anker: **D1 100 · D2 50 · D3 33 · D4 10.**

Målt mod sæson 3's genererede kalender (point pr. pulje à 24 hold, model valideret 98-100 % mod faktiske resultater i sæson 2):

| Division | Mål | S3 faktisk | Afstand |
|---|---|---|---|
| 1 | 188.247 (anker) | 188.247 | anker |
| 2 | 94.124 | 98.026 | +4 %, reelt på mål |
| 3 | 62.122 | 52.452 | mangler +18 % |
| 4 | 18.825 | 14.535 | mangler +30 % |

## Den ene beslutning der mangler

Målet kan **ikke** nås med de nuværende knapper uden at bryde en tidligere ejer-beslutning.

Game-day-kvoten er ejer-låst (`TIER_GAME_DAY_QUOTA` 140/112/84/56) og klasse-whitelisten er låst af prestige-kaskaden ([#2276](https://github.com/NicolaiDolmer/CyclingZone/issues/2276)): D3 må kun køre ProSeries og Class1, D4 kun Class1 og Class2. Inden for de rammer er endagsløbs-andelen praktisk talt eneste håndtag, fordi et endagsløb er 1,68× så point-tæt pr. løbsdag som et etapeløb i samme klasse.

For at nå 33 i D3 skal 46 af 82 løbsdage være endagsløb, hvilket i ANTAL løb er ~0,85. `TIER_ONE_DAY_SHARE_TARGET[3]` står på **0,58**, sat 7/8 fordi ejeren kaldte 0,76 *"for mange endagsløb i 3. division"* ([#3327](https://github.com/NicolaiDolmer/CyclingZone/issues/3327)). Målet kræver altså en højere andel end den der allerede blev afvist. Samme billede i D4 (27 % → 59 % af løbsdagene).

**A) Præmie-multiplikator pr. division.** Præmiepengene får deres egen skrue uafhængigt af UCI-pointene: D2 ×0,96 · D3 ×1,19 · D4 ×1,30. Point forbliver rå og virkelighedstro (samme princip som [#3718](https://github.com/NicolaiDolmer/CyclingZone/issues/3718)). Rammer målet eksakt, rører ikke kalenderen, ingen regenerering. Koster: præmie og point er ikke længere samme tal, så hjælpesider, /rules og "forventet pulje" skal sige hvilken sats der gælder.

**B) Åbn klasse-whitelisten.** Giv D3 adgang til OtherWorldTourC (1.607 point pr. endagsløbs-dag mod ProSeries' 924). Rammer målet uden at røre endagsløbs-andelen. Koster: prestige-kaskaden brydes, D3 kører samme løbsklasse som D2, og forskellen mellem divisionerne bliver mindre synlig. Kræver regenerering af D3's og D4's kalendere.

👍 **Anbefaling: A.** Den holder både variationen fra #3327 og prestige-kaskaden fra #2276 i live, og den kræver ingen kalender-regenerering.

## Hvad sessionen skal levere

1. Ejer-svar på A/B. **Stil det som ét spørgsmål**, ikke som et dossier.
2. Implementér det valgte, plus den gate #3719 beder om: et præmiepulje-mål pr. tier som data, og en verifikation i `tierCalendarMaterializer.js` der fejler højlydt hvis en genereret pulje afviger over tolerancen. Samme håndhævelses-mønster som `TIER_ONE_DAY_SHARE_MIN`.
3. Dry-run-rapporten skal vise præmiepuljen pr. tier, så tallet ses FØR en kalender materialiseres.
4. Player-facing copy hvis A vælges: satsen skal fremgå, ellers lyver "forventet pulje" igen.

## Bindinger

- **A og [#3720](https://github.com/NicolaiDolmer/CyclingZone/issues/3720) er samme skrue set fra to sider.** Vælges A, skal upkeep-kurven kalibreres mod de multiplicerede præmietal, ikke de rå. Tag dem i den rækkefølge.
- **Timing:** ændres sæson 3's puljer efter 24/8 rammer det en sæson der allerede kører. Enten før cutover, eller bevidst fra sæson 4. Ejer-valg.
- **Rør ikke `PRIZE_PER_POINT` som global skrue** uden at genlæse [#1816](https://github.com/NicolaiDolmer/CyclingZone/issues/1816): den blev sat til 75 for at gøre præmie til et supplement på 30-40 % af sponsor. Målt er den 98 % i D1, 67 % i D2, 40 % i D3, 14 % i D4. Kun D3 rammer intentionen, og det hører i #3720's A/B.

## Kilder

Alle tal er målt read-only mod prod 14/8. Fuld udledning, SQL-grundlag og de øvrige fund (koncentration pr. pulje, D1's 14,1 M der bliver menneske-tilgængelig ved cutover) står i [#3719](https://github.com/NicolaiDolmer/CyclingZone/issues/3719) og [#3720](https://github.com/NicolaiDolmer/CyclingZone/issues/3720).
