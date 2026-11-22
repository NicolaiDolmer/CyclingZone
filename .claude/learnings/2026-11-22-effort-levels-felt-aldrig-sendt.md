# 2026-11-22 · effortLevels blev aldrig sendt fra /api/training/me (#8541)

**Symptom:** `training_effort_levels` var on i prod, men profilens Træning-fane viste stadig "VO2max · Normal". I dag R5 brugte den gamle vælger-gren (ingen risikolinje, ingen niveau-skrivning).

**Rodårsag:** frontenden (useTraining.js, #8530/#8555) læste `data.effortLevels === true`, men intet backend-PR tilføjede feltet til GET /api/training/me. Preview-mocken satte feltet selv (`effortPickerPreviewSeed.ts`), så alle billeder før merge så rigtige ud.

**Hvorfor det slap igennem:** klienten og mocken blev bygget mod en API-kontrakt, der kun stod i en kommentar ("Samme felt som API'et skal sende"). Ingen test bandt klientens felt til routens svar, og prod-verifikationen kom først efter merge.

**Forebyggelse:** kontrakttesten `backend/lib/apiTrainingMeEffortLevels.routes.test.js` binder routens felt og klientens læsning sammen. Regel: når en preview-mock sætter et svarfelt, som klienten gater på, skal samme PR (eller en merget PR) sende feltet fra routen, med en kontrakttest. Prod-verifikation af et flag-gated felt = se feltet i det rigtige svar, ikke kun i preview.
