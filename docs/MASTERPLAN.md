# MASTERPLAN: prioriteret rækkefølge (SSOT)

> Ejer-afstemt 4/11 (12 spørgsmål i chatten, #7495). Struktur: Merge og til dørs, Brand, Loftet, Kø, Forretning. Intet udskydes uden ejer-aftale. Intention: GDD. Detaljer: SSOT og issues. Status pr. kernefunktion: [audit 4/11](https://claude.ai/artifact/4ho37bWUTLwNNuGNuyuXpc). Release-gate: #6553 ved S6-start.

**Reglen:** Færdig = bygget, merget, tændt, synligt, gammelt væk, Hjælp + patch note (8 Til dørs-krav). **Loftet afløser byggestoppet (ejer 4/11):** alt inden for de tre loft-områder plus brand og forkert info må bygges uden liste; alt andet kræver ejerens go. Højst 3 områder ad gangen. Nyt prøves bag slukket kontakt før tænding.

**Arbejdsdeling (ejer 4/11):** Claude (PC1) ejer motor, taktik, udvikling, merge-køen, flag og prod. Codex tager sidesporene, der ikke kolliderer: TS-kæden, ops-værktøj, test-infrastruktur, vækst/penge-analyser og SEO-indhold.

## 0. Merge og til dørs først (ejer 4/11, skarpt)

Klare PR'er merges samme dag, og hvert merget issue får Til dørs-bevis inden for 24 timer. Værktøj frem for disciplin:
- **Reviewer sætter markøren selv** (`wave.js`), **main-CI afbrydes ikke** af nye commits, **auto-tog** på PC1 hvert 20. min for PR'er under de stående regler med alarm i #ops, når en klar PR har ventet over 2 timer.
- **Codex-genreview kun ved ændringer i produktionskode**; tests, docs og typer efter et Codex-review kræver kun Claudes markør.
- **Til dørs-tavlen #7632** er ejerens levende overblik og vises ved hver sessionsstart; **auto-beviset #7585 PR 3-4**; dagligt tjek melder merget issue uden bevis efter 24 timer.
- **Billede-go løbende:** venter en PR på ejerens billede-go, sendes billede og spørgsmål med det samme.
- Gamle åbne PR'er gennemgås 4/11: merge, luk med begrundelse eller ejer + dato.

## Brand (løbende, uden for loftet)

- **Løbenes sandhed:** sandhedsvagten #7643 (merget 4/11, første prod-kørsel bekræftes); Giro-rettelserne #7635/#7636 (#7642), #7639 (#7647), #7640 (#7648 + tænd-ledning).
- **Dronningeetaper #7236:** genmåling af Hexagone 15/17 og "kør" før 8/11.
- **Kontrakter, transfer, sæsonskifte:** ungdom #6882, graduering/auktion #7323, værdier #5842.
- **Stabilitet:** aftenafregningen #6490, ranglisten #6765, Postgres-genstart #7223. **Sikkerhed:** #7029, #7034, CodeQL #386 (#7653).

## Loftet (ejer-rangeret 4/11)

1. **Motor og løbsfilm sande:** #6350 tidsstempling (design), selektion #7645 (A først), nedkørsler #7644 (#7651), bjergudbrud #6912 (#7650, flad måles bagefter), realisme-gaten #7588 PR 4-6, #7260-listen. Plan: [RACE_ENGINE_PLAN](RACE_ENGINE_PLAN.md).
2. **Taktik synlig og forståelig:** træthed pr. indstilling på taktiksiden #7638 og indsatskortet #5101 (mockup først), delt kaptajn #7003/#7239/#7326 (krav 8), #7266, spillerfejl #7624/#7557/#7625.
3. **Udvikling 2.0 #6110:** #5950 variant B (opgavetabellen gennemgås med ejeren; tempo = mellemlange stigninger), trin 2-6 "ét skønnet tal" (plan klar, afventer ejerens godkendelse og frist), #4850 krav 4/5 og #7627 (gevinst pr. aktivitet i rapporten), #7637 træthed for ca. 200 ryttere, Score B parkeret til grundtalentet er bygget.

## Kø (når et loft-område er færdigt)

1. **Dato-løfter #6947:** TTT #3463, U23 del 2 #4620, omdømme #4957/#5106, indstillinger #3984.
2. **Løbssider:** Planning Workbench #7535 (i bero), løbstyper U23/junior #7471, etapekort #6365.
3. **Akademi og ungdom:** påmindelse, junior-pyramiden.

## Forretning

**Mål 31/12:** 2.000 kr. MRR og 200 aktive/7d (målinger i [GROWTH_STACK](GROWTH_STACK.md)).
- **Vækst (ejer 4/11, A+C):** fastholdelse først, så nye managers forstår deres første løb (bygger på #5101 og sande løbsdata), parallelt med flere besøgende. Derefter Pro-værdien #2806.
- **Markedsføring 3 gange om ugen:** mandag tal og plan, onsdag ét fællesskabsopslag, fredag indhold/SEO (Codex). Claude leverer udkast og tal i en artifact; ejeren poster.
- **Forside #6665** gøres klar til merge 4/11 (rebase, CI, før/efter); merges på ejerens go.
- **Spillerkommunikation:** én samlet patch note og ét Discord-opslag (EN) pr. dag med spillervendte ændringer; udkast ca. kl. 17, ejeren godkender.
- Bogføring, moms EU-privat #4511, billing #4514/#4512/#6062, måling #5305, SEO #5249/#5250.
- **Catch-up #6950:** samtale med ejeren 5/11 eller 6/11 (frist 8/11).

## Faste rutiner

Rapport får issue og svarudkast; ejeren poster. Patch notes kun efter observeret aktivering. Roadmap spejler den godkendte plan. Hver tænding kræver patch note, EN/DA Hjælp ved mekanikændring og registry/status. NOW/merge-close-out ejes af PC1. Beslutningskort ét ad gangen, med visuelt bevis.

## Doktrin

Styrke straffes aldrig. Én rytter, ét løb pr. løbsdag. Simulér før ship. Et regressionsgulv er ikke et godkendt mål. Synlige ratings falder ikke uden ejerens vidende. Én motor; revisionsskift og flag er ejer-gated. Regler og konkrete spilgrænser står i områdets SSOT.
