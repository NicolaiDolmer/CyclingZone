# En drop/recreate af en constraint mistede DEFERRABLE — og genåbnede et lukket dødvande

**Dato:** 24/8-2026 (fundet af den daglige Sentry/Railway-triage kl. ~09:30)
**Issues:** #4163 (denne), #4155 (reparationen der forårsagede det), #3934 (fixet der blev revertet), #3420
**Sentry:** CYCLINGZONE-32 + CYCLINGZONE-2D (begge `regressed`), CYCLINGZONE-4P

## Hvad skete der

`#3934` (18/8) løste et deterministisk dødvande i entry-generator-sweepen: en rytter-swap
mellem to overlappende løb er to separate (løb,hold)-enheder, og med insert-før-delete pr.
enhed er rytteren transient dobbeltbooket → `23P01`. Fixet var at gøre
`no_rider_double_booking` **DEFERRABLE INITIALLY IMMEDIATE** og lade en batch-RPC køre
`set constraints ... deferred` for hele holdets diff i én transaktion.

`#4155`-reparationen (nat til 24/8) skulle skrive en ny `game_day`-akse. Den droppede
constrainten før skrivningen — helt korrekt — og genskabte den til sidst:

```sql
alter table public.race_entries
  add constraint no_rider_double_booking
  exclude using gist (rider_id with =, binding_span with &&)
  where (binding_span is not null);
```

`deferrable initially immediate` manglede. Constrainten var tilbage, men et andet objekt
end det #3934 havde bygget. Fra første tick derefter fejlede RPC'ens `set constraints` med
`42809 constraint "no_rider_double_booking" is not deferrable`, hvert hold faldt tilbage i
per-enheds-vejen, og 18/8-dødvandet var tilbage: 56 fejlende enheder 05:51, 140 kl. 06:51 —
dagen før S3's første løbsdag.

## Hvorfor blev det ikke fanget

1. **Post-verify tjekkede eksistens, ikke form.** `#4155`'s `verify 4` var
   `select conname from pg_constraint where conname = 'no_rider_double_booking'` —
   forventet 1 række. Den så præcis dét den spurgte om, og intet af det der var gået tabt.
2. **Fejlbeskeden pegede på den modsatte diagnose.** 42809-teksten indeholder
   constraint-navnet, så `isRiderDayInvariantViolation` (navne-fallback) sagde "ægte
   dobbeltbooking". Loggen skreg om 140 dobbeltbookinger på et tidspunkt hvor der var nul.
3. **Fallbacken var tavs.** Batch-RPC-afvisningen var kun en `console.warn` pr. hold; det
   systemiske svigt lignede 140 uafhængige enheds-fejl.

## Regler herfra

- **Genskaber du en constraint, genskab dens FULDE definition.** Tag `pg_get_constraintdef()`
  FØR droppet og sammenlign efter — ikke `conname`.
- **Post-verify skal asserte formen, ikke eksistensen.** For denne constraint: `condeferrable = true`.
  Migrationen i #4163 gør det inde i transaktionen, så en halv gen-etablering ruller tilbage.
- **En fejlbesked der indeholder et constraint-navn er ikke bevis for en constraint-krænkelse.**
  Tjek SQLSTATE først: `42809` (ikke deferrable) og `23P01` (exclusion violation) er modsatte
  diagnoser med næsten samme tekst. `isConstraintNotDeferrable` tjekkes nu FØR
  `isRiderDayInvariantViolation`, og en test låser rækkefølgen.
- **Systemiske svigt skal navngives før deres symptomer.** Sweepen returnerer nu
  `constraint_not_deferrable` og lægger diagnosen først i `errors`.

## Bredere: hører hjemme i #4159's transition-gate

#4159 bygger allerede en blokerende gate ved sæsonskifte (`game_day`-mismatch = 0,
`binding_span`-overlaps = 0). Tilføj `no_rider_double_booking.condeferrable = true` som
tredje tælling — dette er anden gang på seks dage at DB-skema-drift i netop denne constraint
har slået race-motorens selvhelbredelse ud.
