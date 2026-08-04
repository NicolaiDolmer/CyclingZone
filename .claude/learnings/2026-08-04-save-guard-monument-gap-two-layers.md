# En "hurtig pre-flight + hård RPC-garanti"-parring skal mirrores i BEGGE lag, ikke kun ét

**Dato:** 2026-08-04 · **Issue:** #3114 (rest efter #3206) · **PR:** fix/3114-save-guard-d1

## Hvad skete

#3206 (3/8) lukkede monument-binding-hullet i sweep'en (raceEntryGenerator): Monuments
får game_day i 100000-båndet (en bevidst lane-packer-markør, ikke datakorruption) og
ville derfor ALDRIG overlappe et normalt løb i det rå game_day-rum. Sweep'en afleder nu
korrekt et pulje-lokalt vindue. Men issuet noterede selv den udestående rest: save-guarden
(loadTeamBindingContext, brugt af PUT /races/:id/selection) havde IKKE pulje-kontekst og
beholdt samme hul for MANUELLE udtagelser. D1 (hvor alle 5 nuværende Monuments bor,
verificeret mod prod) er i dag AI-only, så hullet var latent — men bliver aktivt så snart
mennesker kan tage manuelle valg i D1 (D1-oprykning efter 23/8).

## Rodårsag

`raceBindingWindow` nøgler på game_day for at binde ryttere til "én dag = ét løb". Det
er korrekt for NORMALE løb, men Monuments' game_day er en sentinel (>=100000, "uden for
dags-gitteret"), ikke en ægte in-game-dag — så den naive tolkning giver et vindue der
per konstruktion aldrig overlapper noget (100000+ vs 0..~90). Fixet kræver at kende
løbets PULJE (league_division_id) for at slå op hvilke normale løb der deler dets
danske kalenderdag — data loadTeamBindingContext hverken havde eller behøvede før.

## Læringer

1. **Et system med to lag ("hurtig pre-flight" + "hård garanti under lås") skal have
   SAMME nøgle-rum-logik i begge — en fix i det ene lag uden det andet lader kommentaren
   der hævder de er spejlede ("Nøgle-rum spejler backend/lib/raceBinding.raceBindingWindow")
   blive stille forkert.** Her: SQL-guarden i `replace_race_selection`
   (database/2026-07-10-replace-race-selection-binding-guard.sql) har STADIG samme
   monument-hul for den snævre samtidigheds-case (to næsten-simultane manuelle gem).
   Ikke lukket i denne PR — for høj blast radius (funktionen kører for ALT hvert gem,
   ikke kun monument-cases) til at ændre uden mulighed for at eksekvere/teste imod en
   rigtig DB i en uovervåget session. En verificeret afledningsquery (testet read-only
   mod prod, matcher JS-testfixturerne præcist) er dokumenteret i PR-beskrivelsen som
   grundlag for en opfølgende, MENNESKE-reviewet migration.
2. **En "genbrug samme mønster som X" (her: sweep'ens cetSpanByPool) skal implementeres
   ON-DEMAND når kaldestedet er pr.-request (loadTeamBindingContext), ikke som en
   ubetinget fuld-sæson-load.** Kun når DETTE løb eller et af holdets ANDRE committede
   løb rent faktisk er i monument-båndet (5 løb/sæson) bygges pulje-indekset — ellers
   uændret performance-profil for de ~99% af gem der aldrig rammer denne gren.
3. **Read-only SELECT mod prod er et gyldigt (og undervurderet) verifikationsværktøj når
   DDL/DML er forbudt.** Kunne ikke eksekvere PL/pgSQL-funktionen, men KUNNE køre selve
   afledningslogikken som en almindelig SELECT mod ægte data og få tallene til at matche
   de eksisterende unit-test-fixtures (game_day 3-4 for 2026-07-29) — nok evidens til at
   dokumentere en konkret, klar-til-review opfølgning i stedet for et vagt "burde nok
   ses på".

## Forward-guards

- 4 nye unit-tests i raceBinding.test.js: begge retninger (dette løb er monument / et
  andet af holdets løb er monument) + null-fallback (ingen puljeløb deler datoen,
  konservativ som deriveMonumentBindingWindow selv) + loadPoolLocalCetSpans isoleret.
- Modulkommentaren i raceBinding.js opdateret til at pege eksplicit på SQL-reststanden
  i stedet for at lade den fremstå lukket.
