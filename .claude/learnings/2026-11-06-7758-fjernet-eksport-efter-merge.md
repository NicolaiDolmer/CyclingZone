# #7758: PR gik i stykker, da #7712 fjernede en eksport

**Hvad skete:** #7712 fjernede `isPeloton` fra raceStoryModel.ts. #7758 importerede den stadig. Git viste ingen konflikt, så build fejlede først i CI.

**Rodårsag:** Pairwise merge-tjek finder kun tekstkonflikter, ikke fjernede eksporter.

**Forebyggelse:** Flet main ind og kør `tsc` på PR'er, der deler filer med den netop mergede PR, før køen tager dem.

## #7692: rytter ude af feltet hvilede

**Hvad skete:** Ryttere der faldt ud af et etapeløb uden incident stod som bundet og hvilede hver dag.

**Rodårsag:** Binding kom fra udtagelsen, ikke fra om rytteren faktisk var i feltet. Salg gjorde rytteren senior straks, midt i et U23-løb.

**Forebyggelse:** Hvile på grund af binding kræver bevis for, at rytteren stadig er i løbet (seneste `entrant_snapshot`).
