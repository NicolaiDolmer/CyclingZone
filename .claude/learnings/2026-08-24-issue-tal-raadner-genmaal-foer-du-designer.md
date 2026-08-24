# Et issues egne tal rådner. Genmål før du designer på dem.

**Dato:** 24/8 2026 · **Issues:** #4190, #4174, #4192 · **Session:** kalender + træning

## Hvad der skete

Tre issues blev skrevet 24/8 med målte tal i. Samme aften, før nogen arbejdede på dem, landede
to ændringer der flyttede grundlaget: bindingen gik fra interval til dag-mængde (#4173), og
akse-reparationen genoprettede overlap-cap'en (#4161). Da jeg genmålte:

| Issue | Issuets tal | Genmålt |
|---|---|---|
| #4174 rytterkrav | 29 / 24 / 24 / 18 · 21 % kan stille fuldt | 22 / 21 / 12 / 12 · 78 % af de aktive |
| #4190 huller | "generatoren spreder etaperne" | generatoren har 0 huller i D2/D3/D4; afledningen laver 167 |
| #4192 hvile-fælden | 1.520 ryttere på 103 hold | 404 på 69 hold i sæson 3 |

Alle tre ville have ført til det forkerte arbejde. #4174 ville have givet mindre startfelter for
at løse et problem der var halveret. #4190 ville have fået en regel bygget ind i en generator der
allerede opfyldte den. #4192's tal var målt uden season-filter.

## Rod-årsagen

Tre forskellige mekanismer, samme klasse:

1. **Tallet blev målt før et fix landede.** Et issue er et øjebliksbillede, ikke en tilstand.
2. **Diagnosen pegede på det forkerte lag.** #4190 navngav faktisk `deriveGameDayAxis` i sin
   årsags-sektion, men konkluderede alligevel "hører i generatoren". Ingen havde kørt generatoren.
3. **Målingen manglede et filter.** `game_day` er sæson-relativ, og `training_plans` har rækker
   fra alle sæsoner. Et tal uden `season_id` er et forkert tal.

## Reglen

**Genmål ethvert tal du designer på, med det filter der gør det sandt, og mål det lag du vil
ændre.** Ikke laget ved siden af. For #4190 tog det ét read-only script mod pakkerens eget output
at vende diagnosen: `buildTierMaterializationPlan` er ren, så generatoren kan måles uden at røre
noget som helst.

Det koster typisk 10-20 minutter. Det sparede her tre stykker forkert arbejde, hvoraf det ene
(mindre startfelter i D3/D4) ville have ramt spillerne.

## Bi-fund samme session

Jeg daterede en patch note og et dokument **25/8** fordi session-prompt-filen hed
`2026-08-25-...`. `TZ=Europe/Copenhagen date` sagde 24/8. CI's `check-patch-notes-version.js`
fangede det: *"A note's date is when it shipped... Measure the date (`date`), do not infer it
from a document or a filename."* Gaten havde allerede skrevet læringen ned. Jeg læste den ikke
før den fejlede.

Samme klasse som ovenfor: et tal (her en dato) læst fra en kilde ved siden af i stedet for målt.
