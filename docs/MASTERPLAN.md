# MASTERPLAN: prioriteret rækkefølge (SSOT)

> Ejer-afstemt 4/11, opdateret 5/11 (#7495). Intet udskydes uden ejer-aftale. Intention: GDD. Status: [audit 4/11](https://claude.ai/artifact/4ho37bWUTLwNNuGNuyuXpc). Release-gate: #6553 ved S6-start.

**Reglen:** Færdig = bygget, merget, tændt, synligt, gammelt væk, Hjælp + patch note (8 Til dørs-krav). **Loftet afløser byggestoppet (ejer 4/11):** alt inden for de tre loft-områder plus brand og forkert info må bygges uden liste; alt andet kræver ejerens go. Højst 3 områder ad gangen. Nyt prøves bag slukket kontakt før tænding.

**Arbejdsdeling:** Claude (PC1) ejer motor, taktik, udvikling, merge-køen, flag og prod. Codex: TS-kæden, ops-værktøj, test, vækst/penge-analyser og SEO.

## Tidsplan (ejer 4/11 aften, 20 planlagte + 22 påbegyndte punkter gennemgået enkeltvist)


Fuld liste med datoer: #7632. "Done" først ved alle 8 krav; fredagskort til ejeren. Åbne denne uge: markedsføring + 10x-plan; træning #7637/#7559/#7558/#7584; #7260; motor-kontakterne #6912/#7644/#7635/#7640 i ét "kør"; motor-pakkens krav 8; #6984; rutematch + assistent; secrets #7029. Næste uge: moms #4511, #7565, #7581, dashboard #7626, sortering #7537. Resten af S5: indstillinger #3984.

- **Denne uge (senest 8/11):** træthed pr. indstilling #7638 (ejer vælger A/B); feltet #7712; #7705, #7693, #7733, #7734; delt kaptajn krav 8 + #7326; forside #6665; Supabase #7659 (ranglisten senest 14/11).
- **Næste uge (9-15/11), roadmap-rækkefølgen:** Hvorfor? #7717, selektion #7645, assistent #6207, udbrud #6912, graduering #7323, salg #6181, aftentræning #6490, enkeltstart #7565, rapport #7627, løbsudvikling #5950, sortering #7537, Udvikling 2.0 #6110; indsatskortet #5101; etapekortet #6365 besluttes.
- **Ca. 15-18/11:** catch-up #6950 besluttes (frist 8/11 udgået); spørg igen om "nye managers forstår første løb" (parkeret).
- **Før S6-kalenderen:** løbstyper U23/junior #7471. **Før S6-start:** U23 del 2 #4620, junior-pyramiden #4621, Planning Workbench #7535.
- **S6 (dec):** Pro-værdien + betaling #2806/#4514. **Starten af 2027:** TTT #3463, omdømme #4957/#5106.

## 0. Merge og til dørs først (ejer 4/11, skarpt)

Klare PR'er merges samme dag, og hvert merget issue får Til dørs-bevis inden for 24 timer. Værktøj frem for disciplin:
- **Reviewer sætter markøren selv**, **main-CI afbrydes ikke**, **auto-tog** hvert 20. min med alarm i #ops. Codex-genreview kun ved produktionskode. Billede-go sendes med det samme.
- **Til dørs-tavlen #7632** er ejerens overblik; **auto-beviset #7585 PR 3-4** melder merget issue uden bevis efter 24 timer.

## Brand (løbende, uden for loftet)

- **Løbenes sandhed:** sandhedsvagten #7643; Giro-rettelserne #7635/#7636, #7639, #7640. "Lad andre jage" #7557 tændt 5/11 (patch note + tjek efter første etape).
- **Dronningeetaper #7236:** tændt 4/11 (ejer "kør"); genmål Hexagone 15/17 ca. 7-8/11 med fuldere startliste.
- **Kontrakter, transfer, sæsonskifte (prøves før S6):** ungdom #6882, graduering/auktion #7323, aftenafregningen #6490, trupstørrelser #7490.
- **Supabase uden fejl #7659:** retning A (mål, ret det tunge, alarmer): #7662/#7663/#7664, ranglisten #6765 senest 14/11. **Sikkerhed (ét vindue med ejeren):** #7029 + #7034.

## Loftet (ejer-rangeret 4/11)

**Ejer 5/11: Forstå løbet #7716 går først, foran #6110.** Alt har en ægte årsag og kan forklares (#7714, #7715, #7725-#7730, #7754). **Træning som dagens oplevelse:** Træn nu med det samme (#7737) og pop-up (#3924) designes med spillerne; intet byggegodkendt.

1. **Motor og løbsfilm sande:** #6350 tidsstempling (design), selektion #7645 (A først), nedkørsler #7644 (#7651), bjergudbrud #6912 (#7650, flad måles bagefter), realisme-gaten #7588 PR 4-6, #7260-listen. Plan: [RACE_ENGINE_PLAN](RACE_ENGINE_PLAN.md).
2. **Taktik synlig og forståelig:** træthed pr. indstilling på taktiksiden #7638 og indsatskortet #5101 (mockup først), delt kaptajn #7003/#7239/#7326 (krav 8), #7266, spillerfejl #7624/#7557/#7625.
3. **Udvikling 2.0 #6110:** næsten nul fremgang på en hel dag #7757 skal løses her; #5950 variant B (opgavetabellen gennemgås med ejeren; tempo = mellemlange stigninger), trin 2-6 "ét skønnet tal" (plan klar, afventer ejerens godkendelse og frist), #4850 krav 4/5 og #7627 (gevinst pr. aktivitet i rapporten), #7637 træthed for ca. 200 ryttere, Score B parkeret til grundtalentet er bygget.

## Kø (når et loft-område er færdigt)

1. **Dato-løfter #6947:** TTT #3463, U23 del 2 #4620, omdømme #4957/#5106, indstillinger #3984.
2. **Løbssider:** Planning Workbench #7535 (i bero), løbstyper U23/junior #7471, etapekort #6365.
3. **Akademi og ungdom:** påmindelse, junior-pyramiden.

## Forretning

**Mål 31/12:** 2.000 kr. MRR og 200 aktive/7d (målinger i [GROWTH_STACK](GROWTH_STACK.md)).
- **Vækst (ejer 4/11, A+C):** fastholdelse først, så nye managers forstår deres første løb (bygger på #5101 og sande løbsdata), parallelt med flere besøgende. Derefter Pro-værdien #2806.
- **Markedsføring 3 gange om ugen:** mandag tal og plan, onsdag fællesskabsopslag, fredag indhold/SEO (Codex).
- **Spillerkommunikation:** én patch note og ét Discord-opslag (EN) pr. dag; udkast ca. kl. 17.
- Bogføring, moms EU-privat #4511, billing #4514/#4512/#6062, måling #5305, SEO #5249/#5250.
- **Vækstpakken PR #7652:** retning afstemmes med ejeren, så wireframes før byg. Catch-up #6950 besluttes ca. 15-18/11.
- **Del B, varig motivation (#7661):** find et dokumenteret spillerbehov med ejeren; intet build-go. Grundlag: OneDrive `balance-internals/growth/del-b-2026-11-04/`.

## Faste rutiner

Rapport får issue og svarudkast; ejeren poster. Patch notes kun efter observeret aktivering. Roadmap spejler den godkendte plan. Hver tænding kræver patch note, EN/DA Hjælp ved mekanikændring og registry/status. NOW/merge-close-out ejes af PC1.

## Doktrin

Styrke straffes aldrig. Én rytter, ét løb pr. løbsdag. Simulér før ship. Et regressionsgulv er ikke et godkendt mål. Synlige ratings falder ikke uden ejerens vidende. Én motor; revisionsskift og flag er ejer-gated.
