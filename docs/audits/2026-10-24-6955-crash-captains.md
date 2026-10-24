# #6955 Rammer styrt kaptajner uforholdsmaessigt?

Dato 24/10/2026. Read-only maaling i prod (S4), ingen motor-konstanter. Raa tal i OneDrive balance-internals/6955/.

## Metode
Stage-starter = distinkte (race, etape, rytter) i `race_results` (result_type = 'stage'). Rolle fra `race_stage_roles`, ellers `race_entries.race_role`. Styrt = `race_incidents.kind = 'crash'`.

## Resultat (styrt pr. etapestart; praecise rater kun i OneDrive)
- Kaptajn, sprintkaptajn og hjaelper ligger i samme niveau; hunter lidt lavere, fri rolle klart lavest.
- Kaptajner (inkl. sprint) samlet ligger en anelse UNDER resten af feltet.
- Pr. etapetype er kaptajner og ovrige naesten ens (flad, bjerg, kuperet); enkeltstart har naesten ingen styrt.
- Kaptajner ligger ikke over hjaelpere, hverken samlet eller pr. etapetype. Kun cobbles viser et lille tal-grundlag (12 styrt).

## Konklusion
Ingen overrepraesentation. Kode giver heller ikke rolle indflydelse paa risikoen. Ingen aendring anbefales.
Begraensning: evne-opdeling (nedkoersel/flad) blev ikke brugt, profiltype er stratificeringen.
