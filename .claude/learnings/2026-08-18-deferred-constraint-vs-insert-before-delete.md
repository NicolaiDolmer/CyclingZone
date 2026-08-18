# En immediate exclusion-constraint gør multi-statement-swaps til dødvande

**Dato:** 2026-08-18 · **Refs:** #3934, #3420, #3906 · **Sentry:** CYCLINGZONE-32/-2D

## Hvad skete

#3420-constrainten (`no_rider_double_booking`, EXCLUDE USING gist) gik live i prod
kl. 07:56. Fra kl. ~12 fejlede entry-sweepen ~350-440 (løb,hold)-enheder pr. tick,
deterministisk og uden selvheling. 19 menneskehold stod til løbsstart kl. 15 med
4-5/6 ryttere.

## Rodårsag

To designbeslutninger, hver korrekt i isolation, i konflikt:

1. Sweepen skriver via PostgREST — hver upsert/delete er sin EGEN transaktion.
   "Aldrig-tommere"-garantien blev derfor sikret med insert-FØR-delete pr. enhed.
2. Constrainten checker IMMEDIATE pr. statement.

En rytter-flytning mellem to overlappende løb er to enheder: insert i det nye løb
ses af constrainten FØR delete i det gamle → transient "dobbeltbooking" → 23P01.
Migrationen gav kun `replace_race_selection`-RPC'en en 23P01-håndtering; sweepens
writer (og raceRunner/regenerate) blev ikke gennemgået for multi-statement-
overgange der passerer et ulovligt mellemled.

**Trigger for eksplosionen:** 12 løb blev færdige kl. 12-14 → ~1.700 rytter-dage
frigivet i sweepens model → global re-optimering ville swappe bredt.

**Sekundært hul:** intet frigav `binding_span` ved løbs-completion (triggerne sad
på race_entries/race_stage_schedule/race_withdrawals — completion ændrer
races.status). 1.703 rækker holdt stale spans; datarepareret manuelt samme dag.

## Fix (#3934)

- Constraint → `DEFERRABLE INITIALLY IMMEDIATE` (uændret adfærd for alle
  single-statement-skrivere).
- Ny RPC `apply_race_entry_unit_batch`: hele holdets batch i ÉN transaktion med
  `SET CONSTRAINTS ... DEFERRED`; atomicitet overtager aldrig-tommere-garantien;
  `SET CONSTRAINTS ... IMMEDIATE` til sidst så 23P01 fanges og oversættes til
  navngiven fejl. JS falder tilbage til per-enheds-vejen hvis batchen afvises.
- Trigger på `races.status` resynkroniserer binding_span (completed → NULL).

## Læring

1. **Når du tilføjer en constraint til en tabel med flere writers: gennemgå HVER
   writers overgangs-sekvens, ikke kun dens slut-tilstand.** En diff-writer der er
   korrekt i slut-tilstand kan passere et ulovligt mellemled på vejen — og hvis
   skrivningerne er multi-statement (PostgREST!), ér mellemleddet en committet
   tilstand set fra constrainten.
2. **EXCLUDE/UNIQUE + lovlige swaps = DEFERRABLE + én transaktion.** Det er
   standardmønsteret; retry-lag oven på immediate checks er lappeløsninger.
3. **Denormaliserede kolonner (binding_span) skal have en trigger for HVER
   upstream-tilstandsændring der påvirker beregningen** — races.status manglede,
   fordi backfillen "løste" completed-cases statisk og skyggede for den dynamiske
   klasse (løb BLIVER færdige løbende).
4. Dagens fejlrate-mønster (3-7 → 440 på ét tick) var nøglen til rodårsagen: led
   efter hvad der ÆNDREDE SIG i verden (12 løbs-completions), ikke kun i koden.
