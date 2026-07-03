# Live-kørsel mod bevægeligt system fangede false-positive som unit-tests + point-in-time-SQL missede

**Dato:** 2026-07-03
**Kontekst:** Byggede stall-watchdog (#2077) — cron der alarmerer når løb/finalisering/præmier/standings sidder fast UDEN exception.

## Hvad skete der

Watchdog-checket (b) var oprindeligt designet som per-etape: "en forfalden etape (`scheduled_at` > 2t siden) uden `race_results` → alarm" (kun løb med startfelt). Jeg validerede logikken to gange mod ægte prod via `execute_sql` — begge gange **tom** (baseline ren). Unit-tests (21 stk.) grønne. Alt så rigtigt ud.

Så kørte jeg **selve JS-koden** (`fetchWatchdogState`) mod prod via `infisical run` (read-only probe). Den fandt **18 findings** — løb 2-103t forfaldne med startfelt og ingen resultater. Et minut senere returnerede den samme SQL igen **tom**: scheduleren havde kørt løbene i mellemtiden.

## Rodårsag

Checket forvekslede **normal kø-latency med en stall**. Empirisk (prod post-chronrebuild): scheduleren arbejder sig gennem en kø og enkelt-etaper sidder rutinemæssigt mange timer "due" før de køres (throughput 20-33/62 pr. dag, ikke cap-ramt). En per-etape-tærskel på 2t ville derfor fyre konstant på helt sund drift.

Hverken unit-tests (statiske mock-rows) eller point-in-time-`execute_sql` (ét øjebliksbillede) kunne se dette — kun den **rigtige kode kørt gentagne gange mod det levende, bevægelige system** afslørede racet mellem "due" og "scheduler kører den".

## Fix

Redesignede (b) fra per-etape til et **globalt throughput-signal**: alarmér kun hvis forfalden kø (m. startfelt) eksisterer OG scheduleren ikke har importeret ét eneste resultat i > tærskel. Når resultater flyder (som normalt) → ingen alarm, uanset hvor bagud enkelt-etaper er. Fanger stadig P0-mønstret (30/6-2/7: motor "kørte" men producerede intet i 44t). Inherent robust mod backdatede schedule-rows.

## Lektie (generaliserbar)

- **Kør den ægte kode mod prod, ikke kun mocket + point-in-time-SQL.** For et system der MUTERER over tid (scheduler, kø, cron) beviser ét SQL-øjebliksbillede intet om race conditions. Kør koden gentagne gange og se om resultatet er stabilt. Forlænger [[feedback_test_real_endpoint_not_just_mocked]] + [[feedback_simulate_before_ship_balance]] til tidsafhængige systemer.
- **En "tavs-fejl-detektor" må kalibreres mod systemets NORMALE latency-fordeling**, ikke mod en idealiseret antagelse ("etaper kører inden for 2t"). Mål den ægte fordeling først.
- **Foretræk globale sundhedssignaler frem for per-entitet-tærskler** når per-entitet-latency er høj-varians. "Producerer motoren noget?" er robust; "er DENNE etape sen?" er støjende.
