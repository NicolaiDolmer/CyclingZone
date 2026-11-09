# Talentmærker var tomme hele dagen efter beta-tænding (9/11)

**Symptom:** `talent_marks_7879` blev sat til beta om formiddagen, men ingen beta-spillere så mærker. `rider_talent_marks` havde 0 rækker. Kortet til ejeren sagde "kører i beta".

**Rodårsag:** beregningen kører kun i natvinduet 03.00-03.45 (`isInTalentMarksWindow`), og kontakten blev tændt efter vinduet. En tom tabel blev ikke beregnet før næste nat.

**Rettet:** beregningen kørt én gang manuelt 9/11 kl. 17.13 (rækker læst tilbage).

**Forebyggelse:**
- En tom tabel skal beregnes ved næste tik, ikke først i næste natvindue (lille rettelse, #7879).
- Tænd-kort siger aldrig "kører i beta" uden at have læst, at der findes data, og at funktionen er set.
