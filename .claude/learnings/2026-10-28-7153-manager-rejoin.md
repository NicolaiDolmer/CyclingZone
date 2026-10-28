# #7153: frivillig udtrækning og ny udtagelse

Udtrækning frigav bindingsdagene, men bevarede race_entries. Managerens gem afviste udtrækningen, mens separat genindmelding genbandt gamle entries og kunne kollidere med andre løb.

Rettelse: særskilt manager-RPC. Slet gamle entries før udtrækningen slettes, indsæt derefter de nye. Bevar transaktion, holdlås, override-log og dobbeltbookingsconstraint. Kontrollér kun nye picks, afvis også auto-udtagne konflikter uden flytning. Automatik og did_not_start har ingen ny genindmeldingsvej.

Baseline reproduceret i lokal PG17: gammel bulk-gem beholdt udtrækningen (1 i stedet for 0). Ny RPC: syv scenarier grønne, inkl. rollback og låst start, migration indlæst to gange. Harnessen skal indlæse den faktiske withdrawal-trigger og binding_span-funktion; de ældre bulk-fixtures havde kun entry-triggeren. Windows psql læser SQL via UTF-8 stdin.

NOW, patch notes og registry er undtaget efter ejerens direkte mandat. Claude ejer review/merge og post-migration-verifikation. Ejeren alene tænder løbene. Ingen data-reparation eller ændring af backup_7153_*.
