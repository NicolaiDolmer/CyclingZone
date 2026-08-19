# Schema-default læst som måling: race_days_total = 60

**Dato:** 2026-08-19 · **Kontekst:** løn-design-sessionen; 17/8-lønkalibreringen (A på PR #3393)

## Hvad skete

17/8-kalibreringen læste `seasons.race_days_total = 60` på den kommende S3-række og byggede hele indtægtsfremskrivningen på "S3 har 60 løbsdage mod S2's 28" (2,1x skalering, ~159M, "blød landing på 25 %"). Feltet var `DEFAULT 60` fra schema.sql: ingen kode materialiserede det ved sæson-oprettelse, og S1/S2's 28 var sat ad anden vej. Sæson 0 stod også med 60. **Ejeren fangede fejlen** ("det lyder ikke korrekt") under design-sessionen; den ægte S3-kalender i `races` viste 28 game days, ~1:1 med S2.

Afledt bug fanget FØR den fyrede: `wageDeductionSweep` dividerer dagslønnen med samme felt, så dagsløns-flippet 23/8 ville have opkrævet ca. halv løn over sæsonen.

## Rod-årsag

Et DB-felt med en schema-default er ikke en måling. `upcoming`-rækker bærer defaults indtil noget materialiserer dem, og intet i kæden skelnede "sat" fra "default".

## Fix

- `tierCalendarMaterializer` (PR #3393) skriver nu `race_days_total` fra kalenderens distinkte `game_day_start` når kalenderen skrives; post-verify-trin lagt i cutover-drejebogen.
- A genfremskrevet på korrekt præmis mod den ægte kalender og bekræftet af ejeren.

## Læring (forward-guard)

1. **Verificér aggregat-felter mod deres kilde** før de bærer en kalibrering: `race_days_total` skal krydstjekkes mod `count(distinct game_day_start)` i `races`, ikke læses råt. Gælder alle materialiserede/cachede felter på `upcoming`-rækker.
2. Sammenlign med søster-rækker: at sæson 0 og 3 delte værdien 60 mens 1 og 2 havde 28 var signalet om en default, ikke en måling.
3. Ejerens "det lyder ikke korrekt" er en måle-trigger: svar med en frisk kilde-query, ikke med at gentage det tidligere tal.
