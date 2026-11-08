# Databasen hang i 15 minutter under Hexagones start (8/11, #7659)

**Symptom:** kl. 15.11-15.26 gav alle kald til Supabase 522/524 og forbindelses-timeout. Projektet stod som ACTIVE_HEALTHY, og forsiden svarede. Genstart løste det.

**Rodårsag (sikker på loftet, sandsynlig på mekanikken):** Medium-instans med 4 GB. Memory commitment ligger på 3,7-3,9 GB i baseline, og et slot med mange løbsafslutninger lægger 1,2-1,5 GB oveni. 8/11 ramte loftet på 5,33 GB og blev der. Tidligere dage toppede lige under. Vægten følger afslutninger, ikke etaper: hver senior-afslutning kører en global bestyrelsespas, ca. 2.200 edge-kald.

**Det var ikke:** trafikken, matview-overlap, disk-IO, dagens kontakter eller #7910.

**Forebyggelse:** alarm på commitment; mandat-synk som én RPC og færre gentagne læsninger; pause efter afslutninger bag kontakt; Large som forsikring gennem Hexagone. Plan med tal på #7659.

**Læring:** `ACTIVE_HEALTHY` og en sund forside siger intet om, hvorvidt databasen tager nye forbindelser. Vi havde ingen alarm på commitment, og kurven skulle hentes i hånden fra dashboardet. Mål RAM-kurven pr. slot, før en kapacitetsbeslutning tages, og tag kald pr. afslutning med i enhver ny efterbehandling. Antag ikke, at "pr. etape" er enheden: mål på en afslutningsfri og en afslutningstung time.
