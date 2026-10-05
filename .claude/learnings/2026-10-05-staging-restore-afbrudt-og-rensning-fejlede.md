# 5/10-2026: Afbrudt staging-restore blev meldt "gjort", og rensningen fejlede, da skemaet kom tilbage

## Hvad skete
1. `refresh-staging.ps1 -Full` blev afbrudt 5/10 (tidsgrænse). Status blev alligevel ført videre som "kopi og rens er gjort (1.889.644 resultater)". Fingeraftrykket viste senere: 0 indeks, 0 policies, 0 triggere, 199 af 696 constraints, og 17 tabeller uden data (alfabetisk fra `training_day_runs`).
2. Årsagen til afbrydelsen var `training_day_runs`: 32.627 rækker, 712 MB. `pg_stat_user_tables` sagde 8 rækker (forældet statistik), så tabellen lignede en bagatel.
3. Under reparationen stoppede jeg to gange en indlæsning, der "hang" på `COPY training_day_runs` med ventetilstand ClientRead. Den hang ikke; den var langsom, fordi 712 MB blev sendt op over en hjemmeforbindelse. Tabellens størrelse på staging voksede hele tiden.
4. `anonymize-staging.sql` satte `discord_dm_prefs` og `email_prefs` til null. Begge er NOT NULL. Så længe staging manglede constraints, virkede scriptet. Da skemaet var genskabt og `users` indlæst igen, fejlede rensningen, og 300 brugere stod med rigtige e-mails og Discord-id'er på staging, indtil scriptet var rettet (`1e447bc5e`).
5. En baggrundskommando med tidsgrænse blev dræbt midt i indlæsningen, så dens `finally` (rensningen) aldrig kørte.

## Hvorfor
- "Gjort" blev afgjort på et rækketal i én tabel, ikke på fingeraftrykket.
- Rensescriptet var kun prøvet mod et skema uden constraints.
- En `finally` beskytter ikke mod, at processen bliver dræbt udefra.

## Regler fremover
- En staging-kopi er først "gjort", når fingeraftrykket matcher prod OG rensningens egen kontrol (`ikke-anonyme = 0`) er kørt EFTER den sidste indlæsning. Begge tal skrives i statusmeldingen.
- Indlæs aldrig `users` (eller andet persondata) i et trin, der kan blive afbrudt, før rensningen. Rens i samme transaktion, eller kør rensningen som sit eget, korte trin umiddelbart efter og verificér tallet.
- Før du stopper en "hængende" COPY: mål om tabellen vokser (`pg_total_relation_size`) og hvor stor den er i prod (`pg_total_relation_size`, ikke `n_live_tup`).
- Rensescripter bruger `default` for kolonner, ikke `null`.

Refs #5904 #6170
