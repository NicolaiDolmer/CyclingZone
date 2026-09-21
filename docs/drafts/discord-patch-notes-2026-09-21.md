# Discord #patch-notes: udsnit v7.290 (21/9)

> Udkast til copy-paste. Ejeren poster selv (`docs/PATCH_NOTES_RULES.md` §3: titel + "What changed" ordret fra `frontend/src/data/patchNotes.js`, ingen nye påstande). Kun EN, ejeren poster aldrig dansk i Discord. Genereret direkte fra datafilen, så teksten er ordret. Refs #5443 #5416 #5452 #4851 #5449.

---

v7.290 (21 Sep)

**Rider values**
- 396 riders were stuck at the wrong value. Since August, some riders were valued as the rider type they had before the type update, so their value only moved when one specific ability improved. On Sunday I corrected the type for the 396 riders on manager teams whose value goes up from the fix. Nobody went down. The rest of the value model follows in a later update, and I will tell you before it happens.

**Rankings**
- A rare error on the rankings pages. If you opened a rankings page in the few seconds where the tables behind it were being refreshed, you could get an error instead of the list. The game now quietly tries once more, so you get the rankings.

**Training**
- Training score in the beta group: a proper graph, and now on your phone. For the beta group, the small graph next to the training score was drawn as a black blob instead of a thin line. That is fixed. The score is also on the new phone training page now, in the squad table and on the rider card, and the Score column has a small info icon that takes you to the explanation in Help.

Full detail as always at cyclingzone.org/patch-notes.
