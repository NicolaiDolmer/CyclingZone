# #7023: historikgrundlag for analyseværkstedet

Read-only undersøgelse 21/10/2026, Supabase-projekt Cycling Zone. Kodegrundlag `54b9a8bfb` på `origin/main`. Dette er dataegnethed, ikke en ny balancekalibrering eller byggegokendelse. Privat måleoversigt ligger i OneDrive-handoff; ingen spillerværdier, kontoid'er eller balancetal publiceres her.

## Hvad blev positivt observeret?

Supabase `execute_sql` blev brugt til læsende SELECTs omkring 17:10-17:16 UTC. Sæson 4 var aktiv. For ejerens aktuelle hold blev målt: antal ryttere/trup, tilstedeværelse af aktuelle evner, antal startpunkter og anden sæsonhistorik, historikkildernes datospænd, numerisk nøgle-dækning og fravær/tilstedeværelse af negative nettoændringer. Ingen INSERT/UPDATE/DDL.

- Alle ejerens nuværende seniorryttere har et dokumenteret overgangs-startpunkt for den aktive sæson og aktuelle evner.
- En del nyere evner mangler i startpunkterne, selv om de findes i de aktuelle evner. Komplet rytterrække betyder derfor ikke komplet evnedækning.
- Ungdomstrupperne har væsentligt mindre startdækning. Nogle har senere gevinsthistorik; nogle har ingen sæsonhistorik. Første gevinst er efter ændringen og må ikke udgives for sæsonstart.
- Kalenderhistorik og løbsdags-historik findes begge for aktiv sæson. Den ekstra kilde `race_development` findes i løbsdags-tabellen.
- Overgangs-startpunkter for sæson 4 ligger dagen før sæsonens registrerede startdato. Et rent datofilter fra startdatoen ville kassere gyldige baselines.
- Nul-deltaer er mulige og meningsfulde. Manglende startværdi skal fortsat være null/ukendt.

Konklusion: **grundlaget kan bære et nyttigt ejerforsøg nu**, men ikke løftet om fuld sæsonsum for alle nuværende ryttere og alle evner. Afklar mærkning/komplethed før build. Der er ikke identificeret et behov for en ny historiktabel for v1; komplet historik for alle ville være et separat registreringsprojekt.

## Kodeevidens

| Kilde | Konsekvens for planen |
|---|---|
| `backend/lib/dailyTrainingEngine.js:1205` og `:1468` | Snapshots ved faktiske gevinster, efter abilities-writes, best effort; ignoreDuplicates giver ikke komplet før/efter hver tick. |
| `backend/lib/riderProgressionEngine.js:431` | Overgangssnapshot skrives efter udviklings-RPC med det nye sæsonnummer. |
| `backend/lib/riderDevelopmentReceipt.js:14` | Flet begge historikkilder og vælg kilde/sæson/løbsdag deterministisk. Dato-dedupe og limit er uegnet som eneste baseline-læser. |
| `backend/lib/proRiderHistory.js:42` og `:83` | Deterministisk sortering og live-punkt eksisterer, men reduceren er til sæsonslut, ikke sæsonstart. |
| `frontend/src/lib/developmentReport.js:108` | Eksisterende helper summerer kun positive observerede ændringer og springer manglende felter over. Må ikke genbruges som fuld netto-sum. |
| `frontend/src/components/TeamDevelopmentTab.jsx:33` | Holdets eksisterende udviklingsfane viser prognose/loft; den er relateret, men opfylder ikke matrixanalysen. |
| `backend/lib/ownerGate.js:19`, `backend/routes/api.js:1025` | Ejer-only er allerede en fail-closed allowlist oven på admin/auth. |
| `frontend/src/components/ui/DataTable.jsx:78` | Kanonisk renderer har sortering, tæthed og D-047; TanStack kan adapteres lokalt. |
| `frontend/package.json` | React/Vite/TypeScript og Recharts findes; TanStack Table er ikke installeret. |

Linjenumre er for det undersøgte SHA og skal genkontrolleres efter rebase. Kildetekst og faktisk SQL-observation har forrang over ældre noter.

## Genmåling uden rå spillerværdier

Brug `database/schema-snapshot.json` før nye SQL-kolonnenavne. Læs aktiv sæson fra `seasons.status = 'active'`, ikke fra dagsdato. Find ejerens hold via eksisterende autoriseret identitet; offentliggør ikke user/team-id.

1. Gruppér nuværende egne ikke-pensionerede ryttere på `riders.squad`.
2. Match `rider_derived_abilities` på rider_id for current coverage.
3. Match `rider_derived_ability_history` på rider_id, aktivt season_number og source `season_transition` for dokumenteret start.
4. Tæl numeriske JSON-felter i baselines; manglende nøgler tælles ikke som nul.
5. Tæl historik i begge kilder, afgrænset til aktuelle rider-ids og sæson; print kun dækning/datospænd, ikke evneværdier.
6. Ved implementering: gør målingen med teamafgrænsede, paginerede batchlæsninger. Afprøv EXPLAIN/latens på lokal PG17-fixture, ikke produktions-loadtest.

## Sikkerhed og verifikationsgrænser

Supabase Security Advisors blev læst. Der var INFO om RLS uden policies samt tre WARN om authenticated SECURITY DEFINER-funktioner; ingen advisors blev ændret. De er uden for denne featureundersøgelse; efterprøv eksisterende sikkerhedsissue #7018 før særskilt triage. Advisors alene er ikke adgangsbevis.

Ejer-allowlistens kode er verificeret; den faktiske runtimekonfiguration af OWNER_USER_IDS blev ikke læst eller ændret. API-adgang skal afprøves ved implementering med en rigtig ejer-session og en admin-ikke-ejer-fixture.

Ingen prototype er kørt mod rigtige spillerdata. Ingen nye SQL-skemaer, mutationer, flagflips eller deployment. Byggeplanens PG17-/browser-/API-tests er planlagte, ikke beståede tests.
