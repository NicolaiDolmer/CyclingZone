# Mål på den håndhævelse der gælder EFTER din egen migration — også i dine hjælpescripts

**Dato:** 2026-08-24 · **Issues:** #4173 #4161 #4163 · **Session:** master-session (kalender/binding-kæden)

## Hvad skete

Akse-reparationens hjælpescript (`repairGameDayAxis4161.mjs`) var skrevet FØR #4173-migrationen
og bar to skjulte koblinger til den gamle verden:

1. **Konflikt-tælleren målte spænd** (`binding_span`-overlap) — korrekt dengang DB'en håndhævede
   spænd, men efter #4173 håndhæver DB'en dag-MÆNGDER. Dry-run-tallene ville have været målt på
   en regel der ikke længere findes (overvurderet risiko → falsk STOP, eller i den omvendte
   fejlklasse: grønt dry-run mod forkert regel, jf. gårsdagens fejl på række 10 af 943).
2. **SQL-skabelonen udskød den GAMLE constraint ved navn** (`set constraints no_rider_double_booking
   deferred`) — den droppes af migrationen, så DO-blokken ville være fejlet med undefined_object
   (42704) i prod, natten før sæsonstart.

Begge blev fanget fordi app-lags-arbejdet tvang en gennemlæsning af scriptet FØR kørsel.

## Læring

- **Et hjælpescript er en del af migrationens blast-radius.** Grep efter constraint-/tabelnavne i
  `backend/scripts/` når en migration flytter en invariant — ikke kun i app-laget.
- **Dry-run-målinger skal navngive hvilken håndhævelse de spejler.** Scriptet siger nu eksplicit
  "DB-semantik efter #4173" i sit output, så en fremtidig læser kan se om målingen matcher verdenen.
- **#4163-vagten (`lint-constraint-form.mjs`) fik et flytte-mønster** (`supersededBy`): drop uden
  retur er kun lovligt når samme fil etablerer den registrerede afløser, og afløseren form-tjekkes
  selv (DEFERRABLE). Uden det havde vagten blokeret enhver invariant-flytning — eller værre,
  var blevet slået fra.
- **Kør den store skrivning som ÉT statement.** Række-for-række via PostgREST kan ikke udskyde
  constraints (hver række = egen transaktion) — det var gårsdagens rod-årsag. DO-blok + deferred
  constraint + psql via `SUPABASE_DB_URL` er den sikre sti.
- Bonus-genbid under verifikation: en ad-hoc SQL uden sæson-filter målte S2-data (#3070-fælden).
  `game_day` er sæson-relativ — ALTID `season_id`-filter.
