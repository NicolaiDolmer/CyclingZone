# migrations-manual/ — manuelle migrations-PLANER (auto-applies ALDRIG)

Kontrakt for denne mappe (oprettet 2026-06-10, #669):

- **Filer her køres ALDRIG automatisk.** CI/merge-pipelinen rører dem ikke.
  Modsætningen er `database/*.sql`, som auto-applies mod prod ved merge —
  migrationer der kræver ejer-go, generator-output eller manuel sekvensering
  hører til HER, aldrig i `database/`.
- Hver fil er en **PLAN**: nummererede trin, verifikations-queries med
  forventede resultater, og en komplet ROLLBACK-sektion.
- Kørsel sker manuelt (psql/Supabase SQL editor) af ejeren eller en agent med
  eksplicit ejer-go — trin for trin, med verifikation mellem trinnene.
- Når en plan er udført og verificeret, opdateres status-headeren i filen
  (PLAN → APPLIED \<dato\> + link til issue-kommentar med verifikations-output).
