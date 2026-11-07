# 2026-11-07: falsk entitlement-alarm ved opsagt abonnement (#7833)

- Aarsag: betalingsvagten behandlede alle adgangsgivende statusser ens ved manglende periodeslut, mens entitlement.js afviser cancelled uden dato.
- Rettelse: spring kun cancelled uden periodeslut over. Active/past_due og varsler for kendte eller ugyldige datoer bevares.
- Bevis: syntetiske regressioner fejlede foer rettelsen for null, undefined og tom streng. Berorte tests koeres efter rettelsen med fast now.
- Laering: en vagt skal foelge adgangskontraktens undtagelser uden at fjerne signalet for manglende cachedata paa loebende abonnementer.
- Ingen prod-data, prod-skrivning, spillertekst, flag eller migration.
