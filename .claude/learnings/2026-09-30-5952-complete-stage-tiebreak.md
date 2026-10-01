# #5952: Det sidste led i et UCI-tiebreak må ikke falde tilbage på id

- Det oprindelige issue krævede placeringssum og derefter bedste enkeltplacering. Handoff/PR-resuméet fremhævede summen.
- Backendens stage-comparator manglede det andet led, mens frontend-fallbacken allerede havde det.
- En test med ens tid og ens placeringssum viste backendens forkerte id-rækkefølge; frontend gav den rigtige rækkefølge.
- Rettelse: bestPlace efter placeSum. Begge runner-stier og genberegningen bruger samme kerne; det gamle baseline-kald uden placeringsopslag bevarer sin gamle rangering.
- Verifikation: 60 målrettede tests og endelig verify-local/preflight bestod. SSOT, hjælp og patch note beskriver hele kæden.
- Læring: Læs kilde-issuets fulde krav før du vurderer et handoff som komplet. Test et fuldt tie ved hvert led, ikke kun det første nye led.
