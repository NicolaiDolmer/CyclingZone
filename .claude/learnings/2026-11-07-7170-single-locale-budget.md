# 2026-11-07: bundle-gaten summerede alternative sprog (#7170)

- Aarsag: kun beta-chunks var undtaget. Naar et sprog gik live, steg den samlede sum selv om spilleren kun vaelger eet ekstra sprog.
- Rettelse: faelles JS inkl. statisk engelsk fallback + stoerste valgfrie sprogbundle, uanset beta-status. Ingen runtime-loading aendret.
- Baseline: lokalt klientbuild paa ead4c6e5f maalte 1671,3 KB med gammel model og 1388,0 KB med ny. Budget 1600 -> 1330, 5% margin bevaret; loft 1396,5 KB bevarer ca. samme hovedrum.
- Regression: ekstra mindre sprog og stoerre nyt sprog fejlede foer rettelsen; faelles vaekst skal stadig fejle. Alle fixtures er syntetiske.
- Laering: maal delte fallback-dependencies separat fra gensidigt alternative chunks. En sum over alle ruter er et regressionsmaal, ikke den enkelte spillers download.
- Ingen prod-data, prod-kald, spillertekst, flag eller migration.
