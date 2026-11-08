# #7730: filmen påstod indhentning, ingen jagede

Filmens årsagstekst så kun, at afstanden faldt, og skrev "jagten kom for sent", også når motoren havde afgjort, at ingen ville jage. Afstanden kan falde af andre grunde.

**Rettelse:** motorens dom (`breakaway_chase_short` med `nobody_wanted` eller `no_chasers`) går foran det, afstanden ser ud til at sige.

**Forebyggelse:** test i `narrativeCauses6469.test.ts`. Fortæl årsager fra motorens begivenheder, aldrig ud fra et tal, der kun ligner.
