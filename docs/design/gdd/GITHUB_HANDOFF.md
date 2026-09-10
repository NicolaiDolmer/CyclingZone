# GDD · GitHub-opgavekort ved Claude-overdragelse

**10/9 2026.** Ejer bad om at registrere aftalte, endnu ikke byggede dele.
Dette er designopfølgning, ikke build-go eller ændring af MASTERPLAN.

## Eksisterende ejere som genbruges

| Issue | Sessionens bidrag | Dokument |
|---|---|---|
| [#1239](https://github.com/NicolaiDolmer/CyclingZone/issues/1239) | Fri klubidentitet, flere legitime succesveje, bestyrelse inden for retningen, fri omlægning | D-001–003/D-008–009; BOARD_RULES §0 |
| [#1148](https://github.com/NicolaiDolmer/CyclingZone/issues/1148) | Egen avl, udviklingsklubber, tre sæsoner, offentlig historie og personlig opfølgning | RIDER_LEGACY; D-010–017 |
| [#1177](https://github.com/NicolaiDolmer/CyclingZone/issues/1177) | Holdarbejde, kaptajnstøtte, personbåret samspil og positiv mental mentoring | D-021–028; RIDER_ATTRIBUTES_RESEARCH |
| [#1154](https://github.com/NicolaiDolmer/CyclingZone/issues/1154) | De øvrige evnekandidater: Ro under pres og Træningsdisciplin, med klart domæne | R-003; endnu åbent design |
| [#4850](https://github.com/NicolaiDolmer/CyclingZone/issues/4850) | Nyere GDD-retning for passende løbsudfordring/erfaringslæring som designinput til reworket | D-018–020; TRAINING_RACE_DEVELOPMENT_RESEARCH |

#1177 er allerede navngivet "Holddynamik-dybde: vejkaptajner + mentor + erfaring";
der oprettes derfor ikke separate dubletter om de samme temaer. #4850's
eksisterende tidsomlægning og ejerdeadline gøres ikke afhængig af alle nye
forslag uden særskilt planbeslutning. Ejerens prioriteringslabels bevares.

## Samlet GDD-opfølgning

**Oprettet: [#5087 — Samlet Game Design Document og fortsat designinterview](https://github.com/NicolaiDolmer/CyclingZone/issues/5087).**
Den samler dokumentleverancen og fortsættelsen efter Q-031; den erstatter ikke
de fem featureejere ovenfor. #1145 er det historiske, lukkede doktrinanker,
som leverede juni-doktrinen. Det er ikke genåbnet.

## Publicerede overdragelseskommentarer

| Sted | Direkte link |
|---|---|
| #1239: identitet og bestyrelse | [Aftaler fra 10/9](https://github.com/NicolaiDolmer/CyclingZone/issues/1239#issuecomment-5616574907) |
| #1148: egen avl og historik | [Koncept og valgte regler](https://github.com/NicolaiDolmer/CyclingZone/issues/1148#issuecomment-5616575843) |
| #1177: Holdarbejde, samspil og mentor | [D-021–028 og åbne detaljer](https://github.com/NicolaiDolmer/CyclingZone/issues/1177#issuecomment-5616576519) |
| #1154: øvrige evnekandidater | [Ro under pres og Træningsdisciplin](https://github.com/NicolaiDolmer/CyclingZone/issues/1154#issuecomment-5616577286) |
| #4850: træningsrework | [Designinput med bevaret scopegrænse](https://github.com/NicolaiDolmer/CyclingZone/issues/4850#issuecomment-5616578247) |
| #1145: historisk doktrinanker | [Pointer til ny GDD-leverance](https://github.com/NicolaiDolmer/CyclingZone/issues/1145#issuecomment-5616578553) |
| #3514: bestyrelsesrework | [Afstemt rework-overblik og afgrænsning](https://github.com/NicolaiDolmer/CyclingZone/issues/3514#issuecomment-5616578865) |

#1239/#1148/#1177/#1154 har fået additive `needs-design`/`needs-decision`-labels;
eksisterende prioritet er bevaret. #4850/#3514 er ikke generelt blokeret af
det nye designinput. Ingen eksisterende issue-body er overskrevet, ingen
feature er lukket, og der er ikke sendt en direkte agent-mention eller dispatch
til implementation. Status/labels og én ny overdragelseskommentar på hver af
de fem featureejere er genlæst og verificeret efter skrivningen.

## Dubletkontrol og scopevurdering

To søgeveje er brugt: `gh issue list --state all --search ...` og
`gh search issues --repo NicolaiDolmer/CyclingZone --match title,body ...`.
Relevante hits er læst med body/seneste kommentarer, og kendte ejere er læst direkte.

| Tema | Første/supplerende søgning | Resultat og disposition |
|---|---|---|
| Samlet GDD | "game design" / GDD; derefter "Game Design Document" / designinterview | Kendt #1145 læst; egen ny dokumentleverance, ingen præcis GDD-sag fundet i de afgrænsede søgninger |
| Identitet | DNA / klubidentitet | #1239 dækker præcist; genbrug. #2022 er onboardingkorrekthed, #3514 eksisterende Mandat-release |
| Egen avl | homegrown / "egen avl" | #1239/#932/#1308 læst; #1308 er leveret akademi-MVP. #1148 læst direkte og ejer vedvarende udviklingshistorier |
| Løbsudvikling | loebsudvikling / debut | Ingen præcise hits; #4850 er kendt reworkejer, #1136 parent; genbrug frem for parallelt rework |
| Holdarbejde | teamwork / samspil | #1177 læst som eksisterende holddynamikejer. #4914/#4599 er kalibrering/dagsform, ikke vores nye evnedefinition |
| Mentor | mentor / lederskab | #1177 dækker. #4264 er informationsmodel; en kort inspirationsomtale dér gør ikke scouting til mentorens ejer |
| Øvrige evner | "ro under pres" / traeningsdisciplin | Ingen præcise hits; #1154 læst som personligheds-/relationsparent, kandidater registreres dér |

De manglende søgehits er afgrænset evidens, ikke et bevis for fravær af alle
historiske formuleringer. Intet nyt issue er skabt som om et gammelt runtimeproblem
stadig findes alene ud fra en gammel issue-body. #1136's påstand om statiske
ryttere er eksempelvis historisk; nyere kode og SSOT beskriver udviklingen.
