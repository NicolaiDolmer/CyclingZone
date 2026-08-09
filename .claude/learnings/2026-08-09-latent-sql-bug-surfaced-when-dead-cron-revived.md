# Latent SQL-bug lå i dvale indtil en død cron blev genoplivet

**Dato:** 2026-08-09 · **Sentry:** CYCLINGZONE-4D · **Fix:** #3572

## Symptom

`Cron error (mid-season review): column season_standings.prize_money does not exist` —
10 events på ~2,5 time, hver 30. minut (cron-intervallet), fra release `509a9139`.
0 brugere ramt (cronen sender bannere, den betjener ikke et request).

## Rod-årsag

`boardMidSeason.js` selectede `prize_money` fra `season_standings`. Den kolonne har
**aldrig** eksisteret i tabellen (præmiepenge ligger på `race_results`). Selecten stod
der fra filens første commit (`90458dcf`, S-02g) og blev videreført uændret i #2596.

Fejlen var usynlig i 3 måneder fordi cronen aldrig nåede så langt: `#3502` viste at
mid-season-review-gaten krævede `board_negotiation_state === 'complete'`, en værdi
ingen kodesti nogensinde satte. Cronen returnerede altså altid tidligt, før queryen.

PR #3527 (7/8) fjernede den gate. Første gang koden reelt kørte, ramte den den latente
SQL-fejl. **Fixet af én bug afslørede en anden, der havde ligget bag den hele tiden.**

## Hvorfor testene ikke fangede det

`createFakeSupabase` er projektion-aware, men ikke skema-aware: den returnerer bare
`undefined` for en kolonne der ikke findes i fixture-rækken. Værre endnu spejlede
test-fixturerne selv fejlen (`prize_money: 50000` i `season_standings`-rækkerne), så
mock og kode var enige om en virkelighed der ikke fandtes i prod.

## Fix + forward-guard

- Kolonnen fjernet fra selecten (feltet blev aldrig læst nedstrøms — verificeret med grep).
- `makeFakeSupabase` i `boardMidSeason.test.js` validerer nu `season_standings`-selects
  mod det faktiske prod-skema (`information_schema.columns`, snapshot 9/8) og fejler med
  en klar besked ved ukendt kolonne. Negativ-testet: gammel select → 8 røde tests.
- `prize_money` fjernet fra fixturerne i begge board-testfiler.
- Den rettede query kørt mod ægte prod-DB via `execute_sql` (ikke kun mocket).

## Læring

1. **En død kodesti skjuler alt bag sig.** Når en gate åbnes, så genlæs koden bagved
   som om den var ny — den er aldrig blevet eksekveret, og "den har været der længe"
   er intet bevis for at den virker.
2. **Mocks der spejler koden i stedet for skemaet, bekræfter fejlen.** Fixture-data er
   en påstand om prod. En select-guard mod det faktiske skema er billigere end en
   PostgREST-fejl i produktion.
3. Cluster: [[feedback_test_real_endpoint_not_just_mocked]] — mocket test beviser
   rendering, ikke backend-kontrakten.
