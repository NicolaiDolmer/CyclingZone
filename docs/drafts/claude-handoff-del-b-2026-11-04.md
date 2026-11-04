# PC1-handoff: brugbare leverancer fra DolmerPC, 4. november 2026

- **Start:** læs CLAUDE/AGENTS, aktuel NOW/MASTERPLAN og de aktuelle PR-HEADs. Ejeren videresender den private handoff; dette er ikke et nyt merge- eller build-go.
- **Teknisk leverance:** Codex klargjorde eksisterende PR'er, ikke nye features: main-integration/rebase, konflikter, genmålte baselines, målrettede tests, uafhængigt integrationsreview og push.
- **TS:** #7612 → #7619 blev forberedt i rækkefølge og markeret klar. Kontrollér nuværende tilstand; allerede merged arbejde springes over, og nyere PC1-commits må ikke overskrives af lokale DolmerPC-HEADs.
- **Ops:** #7524 er kun en review-/markøropgave. Derefter #7531, #7532, #7529, #7530, #7528 og #7571; den daterede status og testproveniens står på hver PR.
- **Gates:** Claude afstemmer aktuelle reviewmarkører/CI. #7530 og #7571 kræver ejerens særskilte go før merge. #7571s reelle command-only child-tool-prøve er stadig åben til første rigtige PC1-bølge.
- **Tests:** integrationsrunderne var målrettede. Historiske fulde suiter er ikke nye fulde grønne kørsler; Windows-fixtures erstatter ikke den reelle prøve eller manglende Linux-bevis.
- **Bevar fra #7661:** [kilde- og overlap-audit](audit-durable-motivation-2026-11-04.md), [officielle spilkilder](manager-game-sources-2026-11-04.md) og privat SELECT-grundlag med kildeforbehold.
- **Før ikke videre som hovedløsning:** navigationsmockuppen. Den endte som en lille genvej; eksisterende træningskort og næste-etape-taktikknap dækker allerede meget. [Spec'en](spec-durable-motivation-2026-11-04.md) bevares som undersøgelsesnoter, ikke produktkontrakt.
- **Ufærdig hovedopgave:** et stærkt forslag til varig motivation mangler stadig. Genbrug researchen, afgræns et dokumenteret spillerbehov med ejeren, og undgå at genopfinde eksisterende løsninger.
- **Afgrænsning:** #7652 holdes stabil. Claude beholder #5101/#7638/#5950/#6110 og korrekthedsarbejdet; #7535s bero og #6950s ejerbeslutning genåbnes ikke af denne handoff.
- **Privat:** målinger, SQL, eksempler og skitser er afleveret privat. Spillerdata, økonomi og balance må ikke kopieres til det offentlige repo; brug ejerens private handoff til placeringerne.
- **Mandat:** ingen produktbyg, merge til main, deploy, flagændringer, prod-skrivninger eller spillerudsendelser er udført af Codex. NOW/MASTERPLAN og afslutning efter eventuelle merges ejes af Claude.
