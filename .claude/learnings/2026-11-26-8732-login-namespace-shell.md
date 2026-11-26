# #8732 · Hold spilmenuen fri af oversættelsesindlæsningen

Den beskyttede rute ventede på både dashboard- og træningsoversættelser, før den monterede Layout og dets Outlet. En forsinkelse kunne derfor blokere menupunkter og ruter, der bruger andre namespaces, herunder den direkte rytterprofil i 429-backoff-prøven.

Behold de to namespaces uden for loginpakken. Gate kun træningssiden,
træningsfanen i rytterprofilen og det relevante kort på etapesiden. Regressionstesten
holder dansk indlæsning åben, simulerer en fejl i den engelske fallback og
navigerer via den synlige menu til truppen.

Linux WebKit viste, at dashboardets route-gate satte oversættelser, sidechunk
og data i rækkefølge. Start chunken på dashboard-ruten parallelt med appskallen,
og lad dashboardet starte data og sit eksisterende mountbudget, mens
oversættelserne hentes. Kun dashboardets indhold viser loader.

Den oprindelige 2,5-sekundersprøve var også ustabil på PR'ens base. Tættere
målepunkter inden for samme grænse passerede ti gange på dashboardrettelsen.
Den særskilte regressionstest holder oversættelserne tilbage og kræver,
at dashboardets dataforespørgsel starter, før de frigives.
