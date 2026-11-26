# MASTERPLAN: intern sandhed (SSOT)

> **Tre lag (ejer 23/11, #8584):** MASTERPLAN = intern sandhed · roadmappet i spillet = spillerrettet (Planlagt = ja + issue + dato; idéer til afstemning) · [NOW.md](NOW.md) = dagen. #8600-artifacten = visuel MASTERPLAN; #8584 = beslutningsdagbog; tavlen #7911; ledger #7495. Historik står i git-loggen, ikke her.
> **Hvert punkt:** issue · ejer (ejer/Claude/Codex) · dato · status. Rækkefølgen er ejer-godkendt (4/11, 8/11, 19/11, 23/11); flyt kun op/ned med ejerens ja.
> **Fjern-reglen (ejer 16/11 + 19/11, #8230):** et punkt må kun fjernes, hvis det samtidig står på roadmappet med horisont, i docs/I_GANG.md eller er lukket med bevis. Plan-hul-tjek hver mandag: `scripts/plan-gap-audit.mjs`.

**Status-ord:** idé · design · byg · PR · klar (venter merge) · merget · live · slukket · venter ejer · overskredet.

## Rammer (ejer 4/11 + 8/11, roller 23/11)

- **Mål:** bæredygtig forretning: stabil database, lavere udgifter, mere indtjening, flere og mere loyale brugere (mål 31/12 i [GROWTH_STACK](GROWTH_STACK.md)). **Til dørs først:** det halvbyggede går før nyt. **Fejl** (live og forkert) rettes uden go; alt nyt kræver ejerens go.
- **Udgivelse januar 2027** når: ingen alvorlige fejl (ejer vurderer), et sæsonskifte uden nedbrud, Pro 2.0 live; dato meldes da.
- **Færdig** = bygget, merget, tændt, synligt, gammelt væk, Hjælp + patch note (8 Til dørs-krav). Byggestoppet er slukket (ejer 25/11, #8729): ingen godkendelsesliste; ejeren beslutter retning og nye spor. Nyt prøves bag slukket kontakt før tænding.
- **Merge og tænding:** én session ad gangen; klare PR'er merges samme dag, Til dørs-bevis inden 24 t. Tænding = bevis i prod + patch note + Hjælp + roadmap + issue lukket; tænde-blok kl. 07. **Dommer (ejer 10/11):** før tænd-kort for motor, træning og penge dømmer en uafhængig Fable-dommer.
- **Roller:** Claude (PC1) merger og koordinerer, 1-3 laner · Codex (Dolmer PC) bygger, maks 3 samtidig, højst 2 der bygger · ejeren beslutter, tester, tænder og betaler.
- **Doktrin:** spilleren ser det, spillet regner på. Styrke straffes aldrig. Én rytter, ét løb pr. løbsdag. Simulér før ship. Gulv ≠ godkendt mål. Synlige ratings falder ikke uden ejeren. Én motor; revision/flag er ejer-gated.
- **Rutiner:** rapport → issue + svarudkast; ejeren poster. Hver tænding: patch note, EN/DA Hjælp ved mekanik, registry/status. Nyt i kernefunktioner → mail til tidligere spillere (kun samtykke).

## Denne uge: uge 48 (23.-29/11)

**Faste datoer**
- **man 23/11 · træning live (ejer):** programfælden #8608 · live (#8622) · saldoen #8357 · live (#8466) · ugeblokke #8549 · PR #8601 Fable godkendt m. bemærkninger, ejer "merge" bag slukket kontakt; før tænding: fund A (pas to gange) + regel B (lås i skadesfelt flyttes til første raske felt) · Claude · rotation #8548 · PR #8624 + #8625 stables på #8601 · Claude (Codex nede) · `training_week_priority` · ejer tænder.
- **Træning først (ejer 23/11):** I dag, Rapport, Program og Udvikling færdige før nyt; siderne må kun blive samme eller bedre (paritet #8631). Én linje pr. rytter, egne kolonner, **ingen forkortelser** #7947 · Claude-spor. Ingen skjult holdplan (fast træning pr. rytter, overgang = dagens træning) #8026 · design + Fable før byg. **Med #7947 (start 25/11, Codex):** #8688 #8684 #8607 #8685 #8686 (egen fane) #8690 · #8689 (kun forventet hårdhed, billede først). #8687 nu · Codex.
- **tir 24/11:** S6-kalender #5841 · Claude.
- **tor 26/11** · ejer + Claude: kontraktloft #7138 først · prøveskifte #7325 · mail 1 #8619 · AI-hold #8614 · **træning live** (W1, rotation, #8549, #8678; #7947) · motor #8189 #4596 #7645 · #8081 · patch notes-siden #8449 (Codex). Ejer 25/11: byggestop slukket (#8729), design-løft #8737.
- **før 28/11 · skiftets rester** · Claude/Codex · byg + prøvekørsel: **automatisk oprykning i stedet for Graduation Day #7323** (junior→U23 ved 19, U23→senior ved 23; fuld trup = ryk op alligevel, ingen nye køb over loftet; salg fortsætter; ejer 24/11) · **lofter 30/30/30, maks 60 #8034** · **bestyrelsen efter pause #8100** (ejer 24/11) · skader nulstilles #5865 · aldring #8522 (tændt) · aftenafregningen #6490 + deploy-vindue #8422 · ungdom #6882 (tre trupper, intet akademi) · trupstørrelser #7490 · seniortrup-optag #8605 (med #8668) · kontraktloft #7138/#8691: Codex undersøger, ejer torsdag.
- **Efter skiftet, ejerens rækkefølge 24/11** (afslut startet → designet → nyt): 1 rotation #7456 (beta 24/11) · 2 solgte ryttere #7455 · 3 taktik på telefon #8386 · 4 bjergudbrud #6912 · 5 træthed og tidsgrænse #7715 · 6 aftenkørsel #6490 · 7 stabilitet #6917 · 8 Android #6584 · 9 kort pr. rytter #5101 · 10 selektion #7645 · 11 #7866 · 12 #8458 · 13 #8419 · 14 #8024 · 15 #8440 · 16 #8592 · 17 #8545 · 18 #7986. Brænder i dag: prognosefald #8604 + gammel score/løbsudvikling #8476 (Claude 24/11).
- #6528 før 28/11 · moms #4511 fre 27/11.
- **lør 28/11 · S6 starter** · Claude · bevis på skiftedagen.
- **søn 29/11 · mail 2** "S6 er i gang" #8619 · ejer godkender tekst + modtagerantal · kræver aktiv S6 og synlig kalender.

**1. Til dørs og åbne PR'er** (Claude merger på ordret "merge")
- **Prioriteringssession 23/11** (#8584 runde 1+3): denne uge #8024, #8100 (før 26/11), motorpakke #7645 + #7644 + #7715, #7137 rangliste, #7866 + #8458, #8419, akademi A (#8060, ejer tænder), #8034 (prøv til S6-start), #7455 + #7986, #6490, #6584, #8073 sidegennemgang (+ #8585, #8324), lofter + hybrid kortlægges · Claude/Codex. Nej/fjernet: #8576 karrierefase, startliste-rutematch (ratings bliver), Udviklingsscore B + catch-up (#8359).
- Prod-bevis + rapport A's ejer-tjek tages af Claude/Codex (ejer 25/11); ejeren ser kun afvigelser: #8611 #7962 #7861 #7859 #7862 #8400 #7627 #8608 #8546.
- Discord-kanalen mod issues + spørgeliste · uge 48.

**2. Roadmap og planer** ("ellers skubbes alt")
- Roadmap-model, 15 kategorier, faste tidspunkter #8616 · Codex G → ejer kategori for kategori · PR, 38 ejer-spørgsmål. Fire nye spillerønsker som Idé i G's SQL; bygges ikke denne uge.
- MASTERPLAN i 3 lag #7631 · Claude · PR, ejer læser før merge. #8600 punkt 15-65 sorteres · ejer + Claude · uge 48.
- Plan-sync og til dørs-værktøjer (Codex K): artifact fra MASTERPLAN #7631 · roadmap-vagt #7630 · rest af #6205 · til dørs-tavlen #7632 · delingstjek #7629 · #8001 · #7440 · Codex · kø.
- Roadmappet 19/11: 24 idéer til afstemning + 3 lovede; flyt kun efter ja pr. punkt · indgår i G. Ugeplan D · Codex · kø (sidst).
- Roadmap-invitation: patch note + Discord "Stem på det næste" + link i mail 29/11 + dashboard-kort med 3 idéer + #6958 · Codex · efter G.

**3. Marketing, fastholdelse, nye spillere** ("uden spillere er der intet spil")
- Tracking før annonce (ejer 23/11): #8621 + #8629 live, #8623 ejer "merge" · penge pr. kampagne (Pro-køb med kampagne, udgiftstabel, PostHog "Kampagner") · Codex N3.
- Annonce Facebook DK 500 kr. · ejer starter efter egen testtilmelding · **stop-grænse 50 kr. pr. ny aktiv spiller** (dag 3; over = pause + ejer). Mails 26/11 + 29/11 løftes til best practice #8396 · Claude-spor.
- Gratis kanaler + Google-sider #5249 · Codex · byg 25/11.
- Første oplevelse + alle mails (Codex I): forside, oprettelse, mails, første session · Codex · kø (rapport). Første dage #8084 · forsiden #8431 · login #8428 · små tekster #8430 · byg.
- Comeback uden bestyrelsesdom #8100 · merget (#8675), prod-bevis #7829.
- Mailrytme (ejer 23/11): nyhedsmail hver 2. uge + ved store nyheder; maks 3/md pr. person; samtykke, afmelding med ét klik, måling.

**4. Kernefunktioner til dørs** (ejer 23/11, ordret; loftet rangeret 4/11; **Forstå løbet #7716 før #6110**)
- **Motor og løbsfilm:** motor-dom #6649, #6940, #6299, #7290 · Claude (Fable) · tor 26/11 (favoritmåling Codex 25/11). Selektion #7645 (A først) · ejer vælger mulighed 1/2. Nedkørsler #7644 · bjergudbrud #6912 · #7899 · #7902 · tidsgrænse ved træthed #7715 · slukket · tor 26/11. Tidsstempling #6350 · design. Realisme-gaten #7588 PR 4-6 · næste motorsession (ejer 23/11). Årsag til alt: #7714, #7725-#7730, #7754. Samleliste #7260; plan: [RACE_ENGINE_PLAN](RACE_ENGINE_PLAN.md).
- **Løbsside v6:** live 21/11 · prod-bevis + luk · #8343, #8355, #8287.
- **Taktik:** ændringerne gennemgås med ejeren. Træthed pr. indstilling #7638 · indsatskortet #5101 (mockup først) · delt kaptajn #7326 · #7266 · #7557 · trøjejagt #7855 (prod-bevis) · holdplaner #8013.
- **Udvikling 2.0 #6110 og træning:** XP live; søndagsjob #7685 · XP fra P 1-99 #8545 (ejer 23/11: torsdag 26/11) · træthed nu #7801/#7982 (prod-bevis; #7536 forklaret) · træningssiden #7947 (skitse #8248) · Træn nu-øjeblikket #8363 · #3924 · bagefter #2798 og #3564; #3813 og #5238 med · Claude/Codex.
- **Akademi** aldersgruppe #6944 · **planlægning** #8419, #8420, #8306 · **patch notes-siden** #8449 · Codex · byg. Spillernes rettelser og ønsker tages stilling til.
- **Codex-kø fra 19/11 (#8374):** #8425 · #8428-#8430 · #6850 · #7233 · dashboard #8448 → #8019 → #8447 · UX #8434-#8442 · farveblind #7988 (lovet) · dashboard C #8300 når #8448 har en uges data · Codex · kø efter G-P.

**5. Drift**
- Supabase målt read-only (Codex L) → første besparelser · ejer ser live før sletning, intet uden arkiv. Plan v3 #7659: #7663 · ranglisten #7664 → #8003 · Codex · 25/11.
- Sentry-rodårsager (Codex M): små PR'er; motor/træning = Fable · uge 48. Flag-løkke #8660 · Codex.
- Udgiftsliste med pris/brug/nedgrader/sluk · Claude · uge 48; ejeren opsiger selv.
- Bestyrelsen tændes ved rigtige skyggetal + ejer-go.

## Næste uge: uge 49 (30/11-6/12)

- Annoncens første måling: tilmelding, første løb, 7-dages retention · Claude · efter launch.
- "Hvor hørte du om os?" #3796 · Codex · efter første kampagne · venter ejer.
- Autopris-incitament #8474 · første dage #8084 · farvepakke #8325 + #8326 + #8364 + #7988 · lofter besluttes · assistent-design #8394 (byg dec.) · trækbar roadmap-tavle (admin, efter #8616) · Claude/Codex.
- E-mail, winback, notifikationer, PWA, SEO #8396 · Claude · plan først.
- Nyt byg efter til dørs: top 3 fra roadmap-afstemningen tages med i ugeplanen · ejer.
- #5918 · #1283.
- Fejlrettelse: sortér rytterlisten efter spejdet potentiale #7924 · "Stræk" bliver "Sværere" #5850 (ejer 23/11 aften).
- **man 30/11 ejer:** fair-play #3153 #3818 #4497 #7927 · #3092 #720 #691 #1450.
- Uge 49: #8696 (+#5327) #5385 #6889 #7041 #2236 #8698.
- Roadmap Uge 49 (ejer 24/11): udvikling af det, rytteren gjorde i løbet #5950 · mellemtider i referatet #8343 · første dage #8084 · tog-vagt #8665 (Codex).

## S6 (starter 28/11)

- Pro 2.0 #8085 (tre pakker med billeder, pris uændret, aldrig styrke) + betaling #4514 · billing #4512, #6062 · moms #4511 · udgivelseskrav.
- Profiltop #8281 · kolonner #8595 · indbakke #8280/#2223/#7467 · badges i én komponent #8587 · angreb #7884, #6912, #8061 · akademi #6944/#8036 (ejer 23/11).
- TTT #3463 · motor.
- U23 #4620 og junior #4621: senest i S6, inden S7 · løbstyper #7471.
- Holddynamik #1177 · onboarding #1140 · hjælp i kontekst #961 · evner forklaret #1833 · velkommen tilbage #8282 · etapeløbsguide #7708.
- Taktik: hvis-så-ordrer #5574 · opgaveskift på stigning #7417 (med #7884) · enkeltstart-positionering #7565 · løbsfilm: angreb live #8045 (med #7861) · ungdom i bestyrelseslokalet #7096 (ejer 23/11 aften).
- Fornyelser og udløbne kort (design 9/11) · deling efter sæsonstart · inviter en ven efter Pro 2.0.

## Senere

- **Starten af 2027:** omdømme #4957/#5106. **Q1 2027:** #934, #5113, #5063.
- **S6+:** #6191, #5625, #1154, #5180.
- Indstillinger #3984 (dato-løfte #6947) · ny dato venter ejer.
- Fire nye spillerønsker (#8584 23/11): idé på roadmappet; byg efter til dørs.

## Parkeret

- Sikkerhed #7029 + #7034: ét vindue med ejeren; #7029 "ikke nu" (ejer 8/11).
- Idéer (ejer 10/11): #4630, #5621, #935, #1147.
- Interne værktøjer: afklares. Slid-varsel #8531: afvist 21/11. Meta Pixel/Conversions API: vent i første test (UTM først).
