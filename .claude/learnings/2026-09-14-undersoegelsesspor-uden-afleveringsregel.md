# Postmortem · 2026-09-14 · Undersoegelsesspor uden afleveringsregel (#5098 / PR #5206)

## Hvad skete der?
Dagboelgen 14/9 (wf_d3c0d357) satte #5098 ("holdudtagelse nulstilles ved etapeskift", ubekraeftet) paa en Opus-lane med briefen "verificér foerst, ret rodaarsagen hvis aegte". Lanen bekraeftede fejlen efter 30 min og havde fixet efter 50 min, men koerte derefter fire runder CodeRabbit CLI og rettede hvert fund (tre aegte race-conditions i samme kode). Sporet ramte det haarde loft paa 180 min uden at have sat PR'en klar, og ejeren spurgte to gange hvorfor der ikke var et klart svar efter 3 timer.

## Root cause
Briefen havde ingen afleveringsregel for undersoegelsesspor: intet "PR klar efter 60 min, resten som opfoelger", og ingen graense paa antal CodeRabbit-runder. Orkestratoren skrev selv den regel til ejeren kl. 10:07, men greb ikke ind i det koerende spor. Samtidig laa fire tunge Opus-spor forrest i koen, saa de seks smaa spor ventede 1,5 time paa en lane.

## Fix
Orkestratoren overtog PR #5206 kl. 11:20: markerede den klar, satte en read-only reviewer paa (GODKENDT), tog selv skaermbilleder af "ugemt"-linjen via Playwright mod branchens dev-server (uden VITE_PREVIEW_MOCK, ellers vinder preview-mocken over Playwright-routes) og gav go-kortet. Selve fixet var korrekt hele vejen.

## Forhindret-fremover
Issue oprettet 14/9 til wave.js-briefen: (1) undersoegelsesspor faar 60 min-vindue med tvungen aflevering "bekraeftet + fix-plan" eller "afvist + bevis-test"; (2) maks een CodeRabbit-runde pr. spor, resten som fund i PR-body; (3) koen blandes: eet lille spor pr. lane foerst; (4) livstegn-krav ved 15 min uden commit (#5176-lanen laa 40 min uden commit). Se issuet i NOW.md.

## Laering
Et spor der "finder mere" er ikke det samme som et spor der leverer. Afleveringsreglen skal staa i briefen, ikke i orkestratorens hoved, og orkestratoren skal stoppe et spor der har leveret sit svar, i stedet for at vente paa loftet. Ejeren maaler paa tid-til-klart-svar, ikke paa antal fund.
