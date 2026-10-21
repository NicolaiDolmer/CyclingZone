# #6827/#6839: held-status på den normaliserede sti

Årsag: tests dækkede den gamle INSERT-reservation, mens Train now kræver datoflaget ON og springer INSERT over. Både registrering og atomic commit tager en ventende hold-lås. Promise.race i klienten afsluttede kun ventetiden, ikke fetch-kaldet.

Rettelse: additive manager-RPC'er tager try-lock og delegerer i samme transaktion; sweepens funktioner ændres ikke. Motoren mapper held til den eksisterende fejltype. Første registrering i Train now mapper også held. Statusfetch får AbortSignal, timeout/stop/unmount afbryder, og polling-guard frigives først når det faktiske kald er afsluttet.

Bevis: lokal PG17 reproducerede ventende registrering før rettelsen; efter rettelsen held uden writes, normal commit, idempotent sweep, uændrede sweep-funktionsdefinitioner og nægtet adgang for offentlige roller. Rigtig router + motor testes med datoflag ON (409 ved registrering/commit, 200 uden hold). Hook-runtime testes med kontrollerede timere.

Læring: følg feature-flagget og alle tidligere låsende RPC'er; en regex-test af Promise.race beviser hverken cancellation eller serialisering.

Review fandt backend-før-migration-vinduet: nye wrapper-RPC-navne mangler indtil auto-migrate. Kun PGRST202 der navngiver den kaldte wrapper falder tilbage til den oprindelige ventende RPC; andre fejl og held genkøres aldrig. Den faktiske router+motor dækker også dette vindue.
