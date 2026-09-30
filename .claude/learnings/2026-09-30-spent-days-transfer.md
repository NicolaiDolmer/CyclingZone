# Brugte løbsdage frigivet ved holdskifte

Refs #5860. SSOT: CALENDAR_RULES §8, RACE_ENGINE_RULES, TRAINING_RULES og TRANSFER_MARKET_RULES §10.

Completed frigav de mutable bindingsrækker. En udskudt handel og ny udtagelse kunne derfor genbruge samme løbsdag. Den nye belastningsledger afviste korrekt konflikten, men hele etapens finalisering blev blokeret.

Varige deltagelsesclaims er uafhængige af hold og snapshot-sletning. Kontrollen skal ske før officielle resultater, ikke kun under senere enrichment. Bootstrap skal inkludere resultater uden snapshots og låse evidens-tabeller mod samtidige skrivninger. Historiske overlaps retries skal være testet separat fra nye starter. Udtagelse og runtime-autofyld skal dele kontrollen; en sidste databaseafvisning alene giver stadig dårlige startfelter.

Ejerens valg 30/9 bevarer eksisterende resultater. Afgrænset genopretning sammenkæder ekstra belastningsbevis med det oprindelige bidrag, uden dobbelte tilstands-/udviklingsticks. Testet i PGlite og gennem binding/afvikling. PR #5983 merget efter ejer-go; alle GitHub-checks grønne, Vercel READY og migrationerne gennemført. Genopretning og uændret resultatfingeraftryk verificeret; privat bevis i OneDrive-context. Lokale browser-timeouts blev dokumenteret separat fra den grønne CI.
