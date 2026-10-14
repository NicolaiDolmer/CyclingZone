# Sæsonskifte S3 → S4 (27/9) - læring

## Hvad gik galt / var nær ved
1. **Kalender (#5830):** solveren tog første lovlige pakning; D2 fik 0 endagsløb i anden halvdel (12/7/1/1). Rettet med R16 (hul-loft) + R17 (uge-min/maks), og monument-/GT-regler skal altid gå forud i stigen (første forsøg fik 3 monumenter ind i Giroen).
2. **`mergeD4IntoD3S4.js` uden `--season`** valgte højeste sæsonnummer (S4, fordi kalenderen var skrevet) → alle hold 0 point. Kør altid med `--season=<afsluttet sæson>`.
3. **Frosne hold** springes over af parkering og sammenlægning → blokerede pensioneringen af D4 F. Tjek frosne hold i pensionerede puljer FØR 12a+.
4. **Readiness-gaten** var rød på transfervindue-felter som kun den afskaffede deadline-cyklus sætter (samme som S1/S2). Normalisér vinduet (inkl. `squad_enforcement_started_at`, constraint) i stedet for at bruge force til alt.
5. **Browser-ruden svarer "Annuller" på `confirm()`** → Claude kan ikke trykke admin-knapperne. Ejeren skal klikke, eller der skal et admin-script med samme vagter.
6. **Parkerede hold beholder `teams.division`** → stillingssiden talte dem med (D1 27). Visninger skal gruppere på pulje, ikke `division` (PR #5837).
7. **`league-size-invariant`-auditten** kendte ikke ungdomsgrupperne (FK `u23_/junior_league_division_id`) → falsk rødt på alle PR'er (PR #5838).
8. **Tørkørsler under en kørende pensionering** talte AI-hold der var ved at blive nedlagt. Kør tørkørsler EFTER forrige skridt er færdigt.

## Hvad virkede
- Backup-tabeller før 12a, dry-run → ejer-go pr. trin, SQL-kontrol efter hvert trin.
- Timelig entry-generator udtager KUN AI-hold; managers udtager selv (nød-udtagelse efter aftalt regel).
