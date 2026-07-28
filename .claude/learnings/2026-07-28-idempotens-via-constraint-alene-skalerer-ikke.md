# Idempotens via DB-constraint alene skalerer ikke

**Dato:** 2026-07-28 · **Issue:** [#3123](https://github.com/NicolaiDolmer/CyclingZone/issues/3123) · **PR:** [#3125](https://github.com/NicolaiDolmer/CyclingZone/pull/3125)

## Symptom

~27.600 `duplicate key value violates unique constraint "uniq_finance_idempotency_key"` i Supabase' Postgres-log pr. døgn. Bursts på 96 fejl med 40 ms mellemrum, hvert 5. minut. Startede 27/7 17:26.

## Rod-årsag

`payRaceDaySponsorsToDate` genberegnede sponsor-krediteringer for **alle** completede løb i sæsonen ved hvert sweep-tick og lod `uniq_finance_idempotency_key` afvise de allerede-betalte. Adfærden var eksplicit dokumenteret som bevidst: *"gentagne sweep-ticks er harmløse"*.

Det er sandt for **datakorrektheden** — og falsk for **omkostningen**. Hver afvisning er et sekventielt round-trip (~40 ms) plus en ERROR-linje. Antallet skalerer lineært med completede løb.

## Hvorfor det ikke blev fanget

1. **Testen testede korrektheden, ikke omkostningen.** Den eksisterende idempotens-test (`skipped credit (23505) tæller ikke i credited`) asserterede eksplicit `rpcCalls.length === 2` — altså at begge forsøg *blev sendt*. Testen cementerede den dyre adfærd som forventet.
2. **Det ser gratis ud ved n=1.** Med 4 af sæsonens 455 løb kørt var sweep'en 4 sekunder. Problemet er først synligt når man ganger op: ved 455 løb ~10.900 forsøg → ~7,5 min pr. tick, på et 5-minutters-interval. Sweep'en ville overhale sig selv inden sæsonen var slut.
3. **Der fandtes allerede et korrekt mønster ved siden af.** Præmie-stien har en `prize_paid_at`-gate der filtrerer betalte løb fra *før* insert, og har derfor 0 kollisioner. Sponsor-stien blev bygget som "mirror" af præmie-stien, men arvede kun løkke-formen — ikke gaten.

## Fix

Pre-filter: hent sæsonens bogførte idempotency-nøgler i én pagineret SELECT, spring dem over. DB-constraintet bevares som backstop mod samtidige ticks.

## Læringer

**En unique-constraint er en korrekthedsgaranti, ikke en kontrolstruktur.** Når normalstien er "prøv og bliv afvist", betaler man et round-trip + en logline pr. afvisning. Det er fint som backstop mod races, forkert som primær idempotens-mekanisme i en løkke der vokser.

**Spørg "hvad koster det ved 100×?" når en sweep itererer over noget der akkumulerer.** Alt der er `for (alle rækker siden sæsonstart)` i et tilbagevendende job skal gates på "hvad er nyt", ikke på "hvad fejler".

**Logstøj i den størrelsesorden er et signal, ikke kosmetik.** 27.600 identiske fejl i døgnet var her ikke problemet — det var *måleren* der viste en sweep på vej mod interval-overløb. Værd at kigge på Supabase-loggen med jævne mellemrum, ikke kun når noget er gået i stykker.

**Når en test asserterer et antal kald, så tjek om den beskytter adfærden eller cementerer den.** `assert.equal(rpcCalls.length, 2)` beskyttede en spildt round-trip.

## Guard

Ny test asserterer `rpcCalls.length === 0` ved andet tick — den fejler hvis nogen genindfører prøv-og-fejl-stien. Plus en pagination-test: PostgREST afkorter tavst ved 1000 rækker, og en afkortet nøgle ville falde tilbage på præcis den 23505-sti fixet fjerner.

## Efterspil: fixet havde selv en fejl

CodeRabbit fandt at pre-filterets `.range()` manglede `.order()`. Offset-pagination over et uordnet resultatsæt er udefineret i Postgres — en nøgle kan hoppe mellem sider og blive sprunget over, hvorefter den falder tilbage på præcis den 23505-sti fixet skulle fjerne. Rettet i `f8b69eab` med `.order("idempotency_key")` (unik → totalordning).

**Læring om testen:** første version af pagineringstesten ville ikke have fanget det, fordi mocken returnerede deterministisk rækkefølge. En mock der er *pænere* end virkeligheden gør testen blind. Mocken returnerer nu bevidst **ustabil rækkefølge pr. kald** når `.order()` mangler, præcis som Postgres må — og guarden er verificeret ved at fjerne `.order()` og se testen fejle.

## Backwards-check

- **#3126** — samme paginerings-fejl i `api.js`' tre cap-sikre schedule-helpere. Konsekvens dér: ufuldstændigt binding-vindue → dobbeltbooking (#3113/#3120). Latent (761 rækker mod `PAGE = 1000`).
- **#3127** — de resterende 12 `allowDuplicate: true`-callsites gennemgås for om de er event-drevne (constraint som backstop = korrekt) eller sweep-agtige (kræver pre-filter).
