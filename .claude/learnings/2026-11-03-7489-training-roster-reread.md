# 2026-11-03 #7489: falsk træningsalarm ved frigivelse under aftentræningen

**Symptom:** Sentry CYCLINGZONE-A6 og en `needs_reconciliation`-række, når en manager frigav ryttere minutter efter at aftentræningens sweep var startet.

**Rod-årsag:** træningskørslen læste datoens frosne trup én gang, før registreringen af datoen. En rytter frigivet efter dato-åbningen stod derfor som "usikker" og blev karantænesat med `unsafe_roster_or_missing_opening`, selvom aftenlukningen (#6504) allerede kendte forskellen på "forladt holdet" og "usikker".

**Rettelse (#7572, `7f5c828d`):** truppen læses igen lige før tjekket; `team_id == null` efter åbningen går via den eksisterende `depart_training_date_riders`. Ingen dæmpning af alarmen: reelt usikre ryttere og test/bank/frosne hold karantænesættes som før; mangler RPC'en, falder koden tilbage til karantæne.

**Lære:** når en tilstand læses før en lang operation (sweep over flere løbsdage), skal tjekket bruge en frisk læsning eller samme afgang/karantæne-semantik som de andre kaldesteder. Brief til lanen: "bekræft tidsrækkefølgen i koden først" gav den rigtige årsag.

**Proces:** wave-ejerskab frigives først ved næste intake-tjek; merge-køen springer en færdig PR over indtil da. `wave-policy.mjs intake --peek --finished <branch>` frigiver straks.
