# 2026-11-10: Tænd-kort sagde "live for alle", aftalen var beta (#2176)

**Hvad skete:** Ejeren havde aftalt "tændt i beta" for Træn nu OG auto-accept. Tænd-kortet og Discord-udkastet for auto-accept sagde "on for alle", og patch note 7.427 havde `rollout: live`. Ejeren fangede det før tænding; intet nåede prod.

**Rodårsag:** Tænd-kortet blev bygget ud fra kontaktens tekniske værdi ("on") i stedet for ejerens aftalte trin. Ingen tjekkede, om kontakten overhovedet kendte "beta": `isAutoAcceptEnabled` kalder `evaluateFlagStage(value)` uden `isBetaTester`, så "beta" = slukket for alle.

**Samme dag, samme klasse:** patch note 7.426 (Træn nu, beta) blev synlig ved merge, før kontakten blev tændt; registry-flip til `state: beta` gjorde `tone-em-dash` rødt på main, fordi beta kræver ejer-godkendt roadmap-tekst.

**Forebyggelse:**
1. Tænd-kortet citerer ejerens aftalte trin (beta/on) ordret fra issuet, og jeg grepper kontaktens læser for `isBetaTester`, før "beta" loves.
2. Patch note-PR'er for en slukket funktion merges i samme omgang som tændingen (ikke før).
3. `state: beta` i FEATURE_REGISTRY kræver `roadmap_en/da` godkendt af ejeren; kør `node scripts/feature-registry-roadmap-check.mjs` før push.
