# #5900: tidsbaseret samling er ikke en in-flight-lås

- Finaliseringens coalescing-vindue holdt ikke en langsom aktiv refresh ude;
  cron og træningslukning gik desuden uden om dette vindue.
- Regression i den faktiske helper viste overlappende RPC'er (peak 2).
- Fælles admission i eksisterende helper: én aktiv pass pr. klient/process,
  nye dataforespørgsler samles i en frisk opfølgningspass.
- Et pending gate-tjek skal genlæses ved faktisk start; ellers kan træning
  begynde mens jobbet venter. Ubetinget Safe beholder sin bypass-kontrakt.
- Queue failure rydder admission og bevarer næste pass. Heartbeat skrives
  fortsat kun efter alle RPC'er har været vellykkede.
- Dette løser ikke schedulerbudget, holdbare claims/restarts, cross-process
  coordination eller #5692's transport/læselåse. Friskhedsmålet kræver separat måling.
