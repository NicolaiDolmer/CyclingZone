# #8732 · Hold spilmenuen fri af oversættelsesindlæsningen

Den beskyttede rute ventede på både dashboard- og træningsoversættelser, før den monterede Layout og dets Outlet. En forsinkelse kunne derfor blokere menupunkter og ruter, der bruger andre namespaces, herunder den direkte rytterprofil i 429-backoff-prøven.

Behold de to namespaces uden for loginpakken. Brug den eksisterende i18n-gate på dashboardet, træningssiden, træningsfanen i rytterprofilen og det relevante kort på etapesiden. Regressionstesten holder dansk indlæsning åben, simulerer en fejl i den engelske fallback og navigerer via den synlige menu til truppen.
