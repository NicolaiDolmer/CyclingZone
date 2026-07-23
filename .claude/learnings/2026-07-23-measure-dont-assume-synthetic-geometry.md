# Mål, antag ikke — fem fejl i Sub-4 som tests og lint ikke kunne fange

**Dato:** 2026-07-23 · **Issue:** [#2448](https://github.com/NicolaiDolmer/CyclingZone/issues/2448) (Sub-4, etapeprofil-graf) · **PR:** [#2790](https://github.com/NicolaiDolmer/CyclingZone/pull/2790)

## Sammenfatning

Sub-4 tegner en syntetisk højdekurve fra `race_stage_profiles`. Enhedstests var grønne hele vejen, lint var grøn, og build var grøn — men fem reelle fejl overlevede alligevel til de blev fundet ved at **måle den faktiske output** frem for at ræsonnere om koden. Fire af dem ville have været synlige for spillerne.

## Fejlene, og hvad der fandt dem

| # | Fejl | Fundet af |
|---|---|---|
| 1 | Ruten faldt fra hver top helt til dalhøjde inden næste stigning — 915 hm på 6,6 km (14 % nedad) på en ægte S2-etape | Prototypen udskrev maks-højde og bølge-amplitude pr. fixture |
| 2 | Bølgeperioden var `2π·L`, ikke `L`. "4 km-bølgen" var 25 km lang, så bisektionen skruede amplituden op i ±800 m for at ramme `elevation_gain_m` — falske bjerge højere end etapens HC | Samme måling: amplituden var absurd, ikke koden mistænkelig |
| 3 | Sampling-rasteret ramte sjældent en knude, så HC-spidsen blev skåret 30 m af | En test der målte fod→top-højde mod `climbGainM()` fejlede med 30 m |
| 4 | i18n-nøglerne brugte `{{km}}`, men projektet kører `i18next-icu` (enkelt krølle). Readout'et rendrede råt `km {{km}}` | At klikke fladen igennem i browseren |
| 5 | På en summit-finish (`crest_km === distance_km`) blev stignings-labelen centreret på grafens højre kant og løb 40 px udenfor | `getBBox()` målt på hver `<text>` i den rendrede SVG |

Fejl 1-3 var alle i geometrien, og **invarianten var eksakt grøn hele tiden** (0,000 m afvigelse). En kurve kan ramme sin samlede-stigning-invariant perfekt og stadig se ud som noget der ikke findes i virkeligheden. Invarianten beviste at *summen* var rigtig, ikke at *formen* var det.

## Hvad der virkede

- **Prototype før spec.** Geometrien blev skrevet og kørt mod fem ægte S2-rækker (bjerg med dal-finish, summit-finish, brosten, klassiker, 6 km-prolog) FØR den kom i spec'en. Alle tre geometri-fejl blev fundet dér, ikke i review.
- **En kalibrerings-kanariefugl.** `waveAmplitude < 120 m` er ikke en korrekthedstest, men en test af at kurven ligner terræn. Fjernes nedkørsels-loftet eller forlænges bølgerne, fejler den. Den ville have fanget fejl 1 og 2.
- **Måling frem for øjemål i browseren.** `getBBox()` pr. tekst-node gav et tal (3 overflowende → 0 efter fix) i stedet for "ser fint ud".

## Hvad der skal gøres anderledes

1. **Ved syntetisk geometri: mål outputtets fysiske egenskaber, ikke kun dets invarianter.** Maks-højde, amplitude, hældninger. En invariant på summen siger intet om formen.
2. **Verificér i18n-syntaks mod en eksisterende nøgle i samme fil, ikke mod hukommelsen om biblioteket.** `grep` efter en nøgle med interpolation tog fem sekunder og ville have forhindret fejl 4.
3. **Klik fladen igennem, også når alle gates er grønne.** Tests og lint fangede nul af de to sidste fejl. Preview-seed skal derfor kunne bære hele fladen — det er et krav, ikke en bonus.
4. **Kant-tilfælde i visualiseringer er de vigtigste tilfælde.** Summit-finish er både den etapetype hvor labelen brød, og den type hvor stigningen ER dagens historie.

## Relateret

`.claude/learnings/` · [feedback_runtime_verify_first] · [feedback_show_visuals_proactively_during_work] · [feedback_owner_must_be_able_to_test_on_preview]
