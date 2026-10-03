# #6061 førstegangstilstand før løbsbelastning

Rodårsag: normaliseret løb gemmer en belastning uden at materialisere en manglende starttilstand. Den senere datoregistrerings historikværn afviser førstegangsinitialisering, og samme rytter ender i karantæne igen. En allerede frossen dato uden opening condition kræver eksplicit genopretning.

Forebyggelse: ved ny ejet rytter eller ejerskifte materialiserer en invoker-trigger den eksisterende førstegangsstandard i samme transaktion. Eksisterende condition/skade og tidligere aktivitet bevares. Installation er forward-only og efterregulerer ingen historiske data.

Bevis: tre nye SQL-regressioner observeret røde; 47 målrettede integrationstests grønne efter rettelsen. Migrationen applies to gange i PGlite, invoker/grants testes, og acquisition rollback ved inkonsistente flag testes.

Recovery: dedup pr. rytter/sæson/løbsdag, tidligere receipts udelukkes, ukendte historiske input holdes uafklarede. Read-only udtræk er privat i OneDrive-context/private-recovery/6061; ingen rå rytteroplysninger eller balance-tal publiceres. Prod-go er separat fra ejerens ja til at forberede genopretningen.
