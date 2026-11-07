# MASTERPLAN: prioriteret rækkefølge (SSOT)

> Ejer-afstemt 4/11, opdateret 7/11 (#7495, roadmap #7892). Intet udskydes uden ejer-aftale. Intention: GDD. Status: [audit 4/11](https://claude.ai/artifact/4ho37bWUTLwNNuGNuyuXpc). Release-gate: #6553 ved S6-start.

**Reglen:** Færdig = bygget, merget, tændt, synligt, gammelt væk, Hjælp + patch note (8 Til dørs-krav). **Loftet afløser byggestoppet (ejer 4/11):** alt inden for de tre loft-områder plus brand og forkert info må bygges uden liste; alt andet kræver ejerens go. Højst 3 områder ad gangen. Nyt prøves bag slukket kontakt før tænding.

**Arbejdsdeling (ejer 6/11 aften):** fra 7/11 ejer Claude Code på Dolmer PC motor, taktik, udvikling, løbssiden, spillerkommunikation, merge, flag og prod. Ingen aktiv Codex-session. Kun én session merger og tænder ad gangen.

## Tidsplan (ejer 4/11 aften)


Fuld liste med datoer: #7632. "Done" først ved alle 8 krav; fredagskort til ejeren.

- **Status 7/11:** tændt #7733, #7726. #7638 + #7754 indgår i løbsside-redesignet #7778. Bølge PC1: #7801, #7715 (tænd-kort), #2009 hover + højreklik #7858 (live 7/11), #7644 + #6912 (måling), #7645 (design), #6181 PR 1-2, trøjejagt #7855, træningsrapport #7745/#7746. Secrets + sikkerhed senest 9/11.
- **Næste uge (9-15/11):** #7778 v3 (dele #7859-#7868) → plan, sandhedsvagt (8/11), auto-accept #2176, XP #6110, dagsform #7725, fri rolle #7856, trøjejagt #7855, Discord-afstemning #7869, feedback + fair-play #5431 (9/11), forside #6665, graduering #7323, aftentræning #6490, scouting ved salg #7455 (før sæsonskifte), rangliste #6765 (14/11).
- **Ca. 15-18/11:** catch-up #6950 besluttes (frist 8/11 udgået); spørg igen om "nye managers forstår første løb" (parkeret).
- **Før S6-kalenderen:** løbstyper U23/junior #7471. **Før S6-start:** U23 del 2 #4620, Planning Workbench #7535.
- **S6 (dec):** Pro-værdien + betaling #2806/#4514. **Starten af 2027:** TTT #3463, omdømme #4957/#5106, træningsværksted #4630, ønskelister #5621, følg/inviter #935, markedsrygter #1147.
- **S6 eller senere:** junior-pyramiden #4621, akademiryttere #6191, scouts #5625, personlighed #1154, milepæle #5180. **Laves ikke:** #3147, #2840, #6194, #7747, #6126.
- **Roadmap efter spillernes karakterer (ejer 7/11 nat):** op: træthedsprognose #7892 (næste uge), kaptajner #1177 (efter loftet), evnernes kilde #3813 + formtræning #5238 (med Udvikling 2.0). [Beslutninger](investigations/2026-11-07-roadmap-omprioritering-forslag.md).

## 0. Merge og til dørs først (ejer 4/11, skarpt)

Klare PR'er merges samme dag, og hvert merget issue får Til dørs-bevis inden for 24 timer. Værktøj frem for disciplin:
- **Reviewer sætter markøren selv**, **main-CI afbrydes ikke**, **auto-tog** hvert 20. min med alarm i #ops. Codex-genreview kun ved produktionskode. Billede-go sendes med det samme.
- **Til dørs-tavlen #7632** er ejerens overblik; **auto-beviset #7585 PR 3-4** melder merget issue uden bevis efter 24 timer.

## Brand (løbende, uden for loftet)

- **Løbenes sandhed:** sandhedsvagten #7643; Giro-rettelserne #7635/#7636, #7639, #7640.
- **Dronningeetaper #7236:** tændt 4/11 (ejer "kør"); genmål Hexagone 15/17 ca. 7-8/11 med fuldere startliste.
- **Kontrakter, transfer, sæsonskifte (prøves før S6):** ungdom #6882, graduering/auktion #7323, aftenafregningen #6490, trupstørrelser #7490.
- **Supabase uden fejl #7659:** retning A (mål, ret det tunge, alarmer): #7662/#7663/#7664, ranglisten #6765 senest 14/11. **Sikkerhed (ét vindue med ejeren):** #7029 + #7034.

## Loftet (ejer-rangeret 4/11)

**Ejer 5/11: Forstå løbet #7716 går først, foran #6110.** Alt har en ægte årsag og kan forklares (#7714, #7715, #7725-#7730, #7754). **Træn nu (#7737) og pop-up (#3924) lander samlet med Udvikling 2.0 (ejer 5/11)**; design med spillerne, intet byggegodkendt.

1. **Motor og løbsfilm sande:** #6350 tidsstempling (design), selektion #7645 (A først), nedkørsler #7644 (#7651), bjergudbrud #6912 (#7650, flad måles bagefter), realisme-gaten #7588 PR 4-6, #7260-listen. Plan: [RACE_ENGINE_PLAN](RACE_ENGINE_PLAN.md).
2. **Taktik synlig og forståelig:** træthed pr. indstilling på taktiksiden #7638 og indsatskortet #5101 (mockup først), delt kaptajn #7003/#7239/#7326 (krav 8), #7266, spillerfejl #7624/#7557/#7625.
3. **Udvikling 2.0 #6110 (XP-model, ejer 6/11):** fælles prisliste, FAST potentiale giver XP, intet hårdt loft, mest fokus og lidt i resten, ét tal XP (i dag og 30 dage), Træn nu tæller straks og giver målt bonus (#7801). Bagefter går potentialet ud af prisen og træningshastigheden ind (#2798), og potentialet omregnes til 1-99 (#3564). Løser #7757; rapportens løbsgevinst #7627, evnernes kilde #3813 og formtræning #5238 med. Bagefter: trøjemål #5573.

## Kø (når et loft-område er færdigt)

0. **Mestertrøjer og talentmærker #7824 (ejer 6/11, kun design, intet byg uden go):** trøjer efter Forstå løbet og løbsside A, talentmærker efter XP og spillernes afstemning.
1. **Dato-løfter #6947:** TTT #3463, U23 del 2 #4620, omdømme #4957/#5106, indstillinger #3984.
2. **Løbssider:** Planning Workbench #7535 (i bero), løbstyper U23/junior #7471, etapekort #6365.
3. **Kaptajner på vejen og mentorer #1177** (spillernes karakter, ejer 7/11).
4. **Akademi og ungdom:** påmindelse (junior-pyramiden S6 eller senere).

## Forretning

**Mål 31/12:** 2.000 kr. MRR og 200 aktive/7d (målinger i [GROWTH_STACK](GROWTH_STACK.md)).
- **Vækst (ejer 4/11, A+C):** fastholdelse først, så nye managers forstår deres første løb (bygger på #5101 og sande løbsdata), parallelt med flere besøgende. Derefter Pro-værdien #2806.
- **Markedsføring 3 gange om ugen:** mandag tal og plan, onsdag fællesskabsopslag, fredag indhold/SEO (Codex).
- **Spillerkommunikation:** én patch note og ét Discord-opslag (EN) pr. dag; udkast ca. kl. 17.
- Bogføring, moms EU-privat #4511, billing #4514/#4512/#6062, måling #5305, SEO #5249/#5250.
- **Vækstpakken PR #7652:** retning afstemmes med ejeren, så wireframes før byg. Catch-up #6950 besluttes ca. 15-18/11.
- **Del B, varig motivation (#7661):** find et dokumenteret spillerbehov med ejeren; intet build-go. Grundlag: OneDrive `balance-internals/growth/del-b-2026-11-04/`.

## Faste rutiner

Rapport får issue og svarudkast; ejeren poster. Patch notes efter observeret aktivering. Hver tænding kræver patch note, EN/DA Hjælp ved mekanikændring og registry/status. NOW/merge-close-out ejes af Dolmer PC.

## Doktrin

Spilleren ser det, spillet regner på (dagsform bliver). Styrke straffes aldrig. Én rytter, ét løb pr. løbsdag. Simulér før ship. Et regressionsgulv er ikke et godkendt mål. Synlige ratings falder ikke uden ejerens vidende. Én motor; revisionsskift og flag er ejer-gated.
