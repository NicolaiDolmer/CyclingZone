# Rytterlistens minibjælke lignede en uønsket prik

**Dato:** 2026-06-09
**Symptom:** Rytterdatabasen viste en farvet prik umiddelbart før alle 14 stat-tal.

## Rod-årsag

`RidersPage.StatBar` rendere både en smal progress-bar og et farvet talbadge. Commit
`2d718373` gjorde progress-baren stat-farvet som del af den fælles gradient. I de
smalle stat-kolonner blev den korte `rounded-full`-bjælke visuelt aflæst som en prik.
Den samtidige ændring af `OnlineBadge` var ikke relateret; komponenterne deler hverken
markup eller selector.

## Fix

Den redundante progress-bar blev fjernet fra rytterdatabasen. Det farvede stat-tal og
den fælles `statStyle`-gradient blev bevaret.

## Hvorfor det ikke blev fanget før

Gradienttesten verificerede kun farveberegningen. Den låste ikke, hvor mange samtidige
farvemarkører en stat-celle måtte vise, og den visuelle smoke-test maskerede tekstnoder
uden en specifik kontrakt for StatBar-markuppen.

## Læring

Når en eksisterende kompakt visualisering får stærkere farve eller kontrast, skal den
vurderes som et nyt visuelt element. To markører for samme værdi kan blive til støj,
selv når hver markør isoleret set er korrekt.

Forward-guard: `RidersPage.statBar.test.js` kræver det farvede stat-tal og afviser den
procentuelle minibjælke.
