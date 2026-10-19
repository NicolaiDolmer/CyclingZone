# #6857: fixture-kontrakten skal opdateres i sin writer

Codex-review paa PR #6907 fandt, at de tre nye race identity-felter var tilfoejet i fixturen, men ikke i dumperens SELECT og mapping. En refresh ville fjerne felterne, og check ville afvise et ellers matchende katalog.

Rettet begge steder i dumpRacePoolFixture.mjs. Funktionen kan testes offline med injiceret klient, filsti og dato; CLI beholder credential-kravet og exit-koderne. Regressionstesten projicerer kun SELECT-kolonner, koerer rigtig filserialisering og check, bevarer baade null og JSON-vaerdier og afviser manglende identitetsfelter uden at skrive.

Laering: ved fixture-kontraktudvidelser skal producentens laesning, mapping og round-trip-test foelge med. Ingen spilleradfaerd er aendret; patch notes er derfor undtaget.
