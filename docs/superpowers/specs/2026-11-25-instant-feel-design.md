# Øjeblikkelig respons i Cycling Zone

25. november 2026 · Design til ejerens beslutning · Refs #8584, #6494, #8682

Mål: Spillerens handling skal kvitteres synligt med det samme, og spillet skal vise det autoritative udfald, når det er kendt. Ved afbrudt forbindelse skal et ukendt udfald kunne afklares uden dobbelt afsendelse. Eksisterende API og Postgres afgør bud, låse, udtagelse og træningsafregning.

## Baseline

[Analytics Stack](../../ANALYTICS_STACK.md) beskriver felt- og labdækningen. #8682 sampler LCP, INP og CLS hos identificerede spillere med aktivt analysesamtykke. Rapportér p75 og antal efter metrik, enhed, build og normaliseret rute. Hold dokument og SPA adskilt, og brug sidste prøve pr. metrik-id. INP måler interaktionens næste paint. Afventning af serverens udfald måles særskilt. PR'ens syntetiske transporttest viste, at eventet kan nå frem. Det oprindelige feltvindue var utilstrækkeligt. En ny read-only optælling 25/11 observerede leverede events på dashboard, auktioner, planlægning og træning. Første dags stikprøver giver et foreløbigt signal om større LCP-ventetid ved navigation til planlægning end auktioner. Feltprøverne er endnu korte, med begrænset dækning pr. rute og enhed. De private tal og stikprøvestørrelser hører til ejerens målegrundlag.

Historisk labreference fra #8022 (12/11, lokal Chrome, mobilprofil, tre Lighthouse-kørsler pr. rute) viste LCP-median ca. 16,75 s på dashboard og 14,60 s på transfermarked. De separate browserinteraktionskørsler gav LCP på ca. 1,03 og 0,67 s på samme to ruter. Kørselstyperne er forskellige. De store forskelle viser, hvorfor throttling, cache og browserprofil skal fastholdes inden for en sammenligning. Denne reference dækker navigation/visning og siger ikke, hvor længe en handling ventede på et svar. Genmål på samme build før et pilotforsøg.

| Forløb | Hvad vi skal isolere | Målinger |
| --- | --- | --- |
| Auktion → afgiv bud | Første synlige feedback, atomisk serverafgørelse, konkurrentbud og genhentning af visningen | Klik → pending, svar, endeligt korrekt vist bud. Reproducer overbud og afvist bud med fixtures. |
| Udtagelse → gem | Lokal kladde, svar, tabt kvittering og lås ved løbsstart | Klik → pending, svar, genlæsning og endeligt korrekt gemt udtagelse. Reproducer ændring i to faner og tabt svar. |
| Træning → gem program / Træn nu | Programændring og serverens afregning er to forskellige forløb | Mål accept og korrekt efterfølgende visning hver for sig. Reproducer delvis fejl med kontrol af kanonisk rapport. |
| Dashboard → auktioner / planlægning / træning | Kold rutebundle, varm cache, datakald og første brugbare indhold | Klik → ruteskal og klik → brugbart indhold. Gem netværksrækkefølgen og mål kold og varm hver for sig. |

Der foreligger ingen sammenlignelige klik-til-udfald-målinger for de tre mutationer i denne reference. Brug Chromium med syntetiske konti mod lokal eller staging, med samme build, netværksprofil, fixtures og profil ved før/efter. Kør både normal drift og kontrolleret forsinkelse, serverafvisning, tabt svar og ny forbindelse. Gem timings, antal, fejlfrekvens og råspor privat. Brug definitionerne i [Transfer Market Rules](../../TRANSFER_MARKET_RULES.md), [Planning Center Rules](../../PLANNING_CENTER_RULES.md) og [Training Rules](../../TRAINING_RULES.md) som facit.

## Tre veje

| Vej | Fordel | Omkostning, risiko og drift |
| --- | --- | --- |
| **A · Eksisterende datalag (#6494)** | TanStack Query kan opdatere egen visning straks og genbruge eksisterende cache, typede hooks og API. Ruteskal og forudindlæsning kan behandles separat. | Lille første slice. Netværksfejl, samtidige mutationer og versionsskift kan give forkert rollback. Brug en afgrænset pending-tilstand, serverens kanoniske svar, invalidering og genlæsning ved ukendt udfald. Ingen nye tjenester. |
| **B · Udvalgt Supabase Realtime** | Giver anden fane eller en anden spiller hurtigere signal om ændring. Auktioner og bud bruger allerede Postgres Changes med debounced genhentning. Mål først event → callback → refetch → korrekt paint dér. Et nyt forsøg giver kun mening på en konkret manglende kanal, fx gemt træningsprogram i en anden fane. | Private kanaler og adgang pr. hold, debouncing og refetch ved reconnect. Mål beskedforbrug, samtidige kanaler, fan-out og event → korrekt visning i eksisterende ramme. For bred Postgres Changes kræver autorisationsarbejde pr. abonnent. Kanalfejl skal falde tilbage til eksisterende genhentning. |
| **C · ElectricSQL + TanStack DB** | Kan levere lokale reaktive samlinger og delt frisk tilstand på tværs af skærme. | Kræver egne read shapes, eksplicit serverautorisation, replikeringskapacitet, styr på WAL/slot-lag, backfill, local-cache-rydning ved kontoskift, konflikthåndtering og fejlberedskab. Behold autoritative API-skrivninger og test afstemning med replikeret tilstand. Eksperimentér kun lokalt, hvis det eksisterende driftsbudget ikke kan bære det. |

[Plan for #6494](../plans/2026-11-12-6494-dashboard-market-query.md) · [Supabase Realtime og Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) · [TanStack DB](https://tanstack.com/db/latest/docs/overview) · [Electric Shapes](https://electric-sql.com/docs/guides/shapes)

## Anbefaling til ejerens beslutning

Start med A som afgrænset pilot på **gem træningsprogram** under #6494. Vis lokal ændring som afventende, behold eksisterende servervalidering og brug serverens svar til at afslutte tilstanden. Træningsafregning og bud må aldrig fremstå gennemført før serverens bekræftelse. Vælg B for et konkret problem med synk mellem faner eller spillere, hvis A efterlader dokumenteret forsinkelse. Genbesøg C, hvis flere ruter kræver fælles lokal tilstand, og de mindre løsninger har et målt hul.

Før et eventuelt build-go skal Claude forelægge ejeren pilotflade, pending-visning og målsætning. Testplanen bør dække normal handling, reel afvisning, tabt svar, reload, kontoskift og samtidighed. Sammenlign den samme labserie og feltvinduer med passende dækning. Piloten skal kunne slås tilbage til eksisterende flow. Alle tre veje forudsætter nul nye betalte tjenester.
