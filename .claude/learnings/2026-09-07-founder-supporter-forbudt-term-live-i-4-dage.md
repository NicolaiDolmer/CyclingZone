# 2026-09-07: "Founder supporter" stod live i 4 dage, selvom TONE_OF_VOICE forbyder det

**Issue:** #5007 (Founder-mærke manglede på managerprofilen). PR #5010. Aftenbølge 7/9.

## Hvad skete

#4649 (3/9) byggede `FounderMark.jsx` med i18n-teksten "Founder supporter" (EN) / "Founder-supporter" (DA) og satte den på forum, stilling og holdside. `docs/TONE_OF_VOICE.md` linje 123, 144 og 269 forbyder præcis det sammensatte navn ("brug Founder eller Supporter alene"). Ingen fangede det: ikke workeren, ikke CodeRabbit, ikke preflight, ikke ejer-review af #4649. 7/9 genbrugte #5007-workeren komponenten på managerprofilen, orkestratoren byggede merge-kortet på workerens rapport og sendte billeder uden selv at læse dem, og ejeren opdagede ordet med det samme.

Samme aften: #5023 (Discord-navn) kom med dansk hjælpetekst uden æøå ("Vises paa din offentlige profil, saa andre..."). Også en TONE_OF_VOICE-regel uden vagt.

## Rod-årsag

Tekstreglerne findes kun som prosa. Der er lint for i18n-nøgler, arrow-glyfer og anti-slop-klasser, men ingen for forbudte termer eller ae/oe/aa i `da/*.json`. En regel uden vagt holder præcis så længe som den næste worker husker at læse den.

## Forward-guard

- Orkestrator-regel (gælder fra 7/9, i scratchpad-tjeklisten og i næste worker-skabelon): merge-kort bygges på `gh pr diff` og på billeder orkestratoren selv har åbnet, aldrig på workerens rapport. Bidt 3. gang (2x 3/9 + 7/9).
- Foreslået vagt (ikke bygget, ejer sagde "intet nyt i aften"): `scripts/lint-locale-tone.mjs` i preflight + CI, der fejler på (a) forbudte termer fra en liste i TONE_OF_VOICE ("Founder Supporter", "free forever", "freemium", "Founder-supporter"), (b) `\b(aa|ae|oe)\b`-mønstre i danske ord i `frontend/public/locales/da/*.json` og (c) "vi"/"vores" i systemtekster hvor jeg-stemmen gælder. Kandidat til issue ved næste ops-slot.
- Backwards-check 7/9: grep `founder.supporter` i frontend/src + locales; kun `pro.json` var player-facing; route `/founder-supporter`, `FounderSupporterPage.jsx` og tabellen `founder_supporter_waitlist` er identifikatorer og blev ladt i fred.

Refs #5007 #4649 #5010 #5012 #5023
