# 2026-10-09: merge-kø-STOP læst som "færdig" → #6393 merget på rød main

**Hvad skete:** En baggrunds-ventesløjfe ventede på at den forrige merge-kø var færdig med `grep -qE "Hele merge-koeen|STOP"` og startede derefter næste kø. Køen efter #6053 sluttede med `STOP: main-CI er ROED`, men sløjfen tolkede STOP som "færdig" og merger #6393 oven på rød main. Ingen spillerskade (#6393 var kun et ops-script), men rød-main-reglen blev brudt.

**Rod:** Rød main skyldtes en `repeating-linear-gradient` i `SeasonMatrix.jsx` (#6390). Anti-slop-guarden er ikke et påkrævet PR-check, så PR'en var grøn, og fejlen dukkede først op på main.

**Regel fremover:**
1. En kæde efter en merge-kø fortsætter KUN ved `[OK] Hele merge-koeen`. STOP = afbryd kæden og rapportér.
2. Kør `node scripts/check-anti-slop.mjs` lokalt før push på UI-PRer (preflight dækker det ikke i dag).
