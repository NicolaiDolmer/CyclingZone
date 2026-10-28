# #7153: frivillig udtrækning og ny udtagelse

Udtrækning frigav bindingsdagene, men bevarede race_entries. Managerens gem afviste udtrækningen, mens separat genindmelding genbandt gamle entries og kunne kollidere med andre løb.

Rettelse: særskilt manager-RPC. Slet gamle entries før udtrækningen slettes, indsæt derefter de nye. Bevar transaktion, holdlås, override-log og dobbeltbookingsconstraint. Kontrollér kun nye picks, afvis også auto-udtagne konflikter uden flytning. Automatik og did_not_start har ingen ny genindmeldingsvej.

Baseline reproduceret i lokal PG17: gammel bulk-gem beholdt udtrækningen (1 i stedet for 0). Ny RPC: tretten scenarier grønne, inkl. rollback og låst start, migration indlæst to gange. Harnessen skal indlæse den faktiske withdrawal-trigger og binding_span-funktion; de ældre bulk-fixtures havde kun entry-triggeren. Windows psql læser SQL via UTF-8 stdin.

NOW, patch notes og registry er undtaget efter ejerens direkte mandat. Claude ejer review/merge og post-migration-verifikation. Ejeren alene tænder løbene. Ingen data-reparation eller ændring af backup_7153_*.

Review fandt at Train now fejlagtigt så historiske entries som aktive; manager-genindmelding validerer nu mod tom aktiv udtagelse. Auto-frigivelsers kildeløb får samme startguard og ordnede række-låse som målløbet. Travle hold-/race-låse afvises straks, så en ventende transaktion ikke skriver med en gammel request-tid. Begge låse er målt i native PG17.

Verifikation på Windows: standardens backendrunner ramte ENAMETOOLONG ved 1.088 filer. Samme filer kørte i batches; en gammel source-kontrakt blev tilpasset og Node IPC-deserialisering i raceRunnerIncidents blev genkørt med test-isolation=none, begge 6/6. Frontend har 5.007 grønne unit-tests. CI bruger også tsconfig.checkjs.json: et valgfrit null-argument krævede eksplicit JSDoc-arraytype, uden ændring af baseline. Browserpreview kræver client + SSR + prerender (app.html), ellers er /login korrekt 404 i den statiske server.
