# Claude-handoff: vækst og permanent spillerfastholdelse

- Dato/slice: 4. november 2026, #7495. Kun analyse/design; ingen build-, merge-, prod- eller kommunikationsgodkendelse.
- Ejerens seneste valg: saml forslagene til fælles vurdering med Claude; derefter afstemte wireframes, spillerfeedback og først så beslutning om byg.
- Læs først [vækstspec](spec-growth-2026-11-04.md) og [overlap-audit](audit-growth-retention-overlap-2026-11-04.md).
- Fast retning: permanent værdi for alle managers. Onboarding lærer den samme funktion; en særskilt engangsoplevelse er fravalgt.
- Åbne alternativer: A holdets løb i Finale; B plan og dokumenteret forløb i holdvisningen. Begge konceptbilleder er i spec'en. Ingen af dem er valgt.
- Eksisterende ejere: #7266 produktbehov; #6350/#7643 korrekthed; #6570/#6469 leverede byggesten; #1140 indgang; #1369 måling; #3513 dashboardkontrakt.
- Datagrænse: kun eget holds historiske etapeplaner og faktisk loggede hændelser; plan er ikke udførelsesbevis, og udfald er ikke automatisk årsag.
- Privat: `balance-internals/growth/analyse-2026-11-04.md`, `owner-decisions-2026-11-04.md`, `evidence-2026-11-04/` og `claude-brief-2026-11-04.md` via OneDrive. Tal/priser/balance må ikke kopieres til GitHub.
- Måling: nye og etablerede spillere adskilles; rolling return er ikke exact-day retention. Snapshot-resultater udelukker ikke ventetidsproblemer. Pro-adgang er ikke MRR.
- Spillerfeedback: ejeren viser de afstemte wireframes; endelig spillertekst og praktisk testforløb afklares med Claude. Intet sendes af Codex.
- Åbent: eksperiment 2/3, konkrete succesgrænser, Pro-valg og oprindelig del B. Intet nyt mekanikforslag er stiltiende godkendt.
- Leverance: branch `codex/7495-growth-design-20261104`; draft-PR, SHA og observeret verifikation registreres på #7495. PC1 ejer videre prioritering, NOW, MASTERPLAN og merge.
- Trin 0: [sikringsrapport](https://github.com/NicolaiDolmer/CyclingZone/issues/7495#issuecomment-6629053724). Git-WIP er delt; lokale originaler er bevaret, mens OneDrive-uploadens sidste kvittering afventes.