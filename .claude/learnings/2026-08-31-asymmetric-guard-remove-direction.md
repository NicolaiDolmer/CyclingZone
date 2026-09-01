# 2026-08-31 — Asymmetrisk gem-vagt: fjernelses-retningen var et hul (#4534)

## Hvad skete

Sæsonmatrixen (PR #4323, live 31/8 ~21:00) blokerede tilføjelse til startede løb men
lod REN FJERNELSE gå igennem. ~1 time efter launch fjernede en tester sin kaptajn fra
en Giro med 10/18 kørte etaper — rytteren forsvandt fra feltet, kunne ikke gen-tilføjes
og blev straks ledig til andre løb.

## Rod-årsag

Ikke en bug i klassisk forstand — en BEVIDST undtagelse (#2637: "en skadet rytter skal
altid kunne fjernes, også midt i aktivt løb") der var designet til Race Hub's
enkelt-løbs-flow, men fulgte gratis med da `prepareSelectionChange` blev delt med
bulk-endpointet (#4316). Matrixen gjorde fjernelse til ét klik på en hel sæson — og
undtagelsen var aldrig tænkt som en spiller-vendt "udgå frivilligt"-mekanik.
Removal-only-tjekket sammenlignede desuden kun rytter-SÆT, ikke roller, så et
kaptajnsskifte kunne også omskrives i samme "rene fjernelse".

## Læringer

1. **En undtagelse i en delt validering skal genbesøges når en NY forbruger kobles på.**
   #4316-PR'ens "INGEN ny valideringssemantik: genbruger PRÆCIS samme regler" lød som
   sikkerhed, men genbrugte også undtagelsen i en kontekst (masse-redigering) den aldrig
   var designet til. Grep efter undtagelser/bypass-flag i delt kode når endpoint-flader
   udvides — ikke kun efter reglerne.
2. **"Delmængde af rytter-ids" er ikke "ren fjernelse".** Sæt-sammenligning uden
   rolle-sammenligning tillod rolle-omskrivning. SQL-guarden fik samme fund separat
   (FUND4, `<@` er inklusiv). Symmetri-tjek: enhver retnings-afhængig vagt skal testes i
   BEGGE retninger, i alle lag (app + SQL-backstop).
3. **Fingeraftryk for midt-i-løb-fjernelse:** race_results for kørte etaper uden
   tilsvarende race_entries-række (rider stadig eksisterende, hold ikke withdrawn).
   Genbrugelig detektions-query — kandidat til kalender-invariant-audittens sweep.

## Forward-guard

- Frys-reglen håndhæves nu ubetinget i alle tre lag; regressionstests i begge retninger
  (unit + pglite-integration mod den ægte migrationsfil).
- Bypass-plumbingen (`removalOnly`/`allowRemovalOnly`) er SLETTET, ikke deaktiveret —
  et forældet flag fra en gammel kalder kan ikke genåbne hullet (testdækket).

Refs #4534 #2637 #4316 #1146
