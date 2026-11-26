# #8215 · Lås på ranglistens sorteringsindeks

Den lokale replay og preflight bestod, mens GitHubs migration-idempotency-job afviste det almindelige indeksbyg på en eksisterende tabel. Guardens deltest indgik ikke i den første lokale kørsel.

Byg indekset med `CONCURRENTLY` som top-level statement med begrænset låseventetid. Ved genforsøg fjernes kun et ugyldigt indeks. Funktionen og dens grants bliver i samme transaktion. Den målrettede replay behandler top-level statements som `psql -f` og prøver en afbrudt bygning, et genforsøg og en almindelig genkørsel.
