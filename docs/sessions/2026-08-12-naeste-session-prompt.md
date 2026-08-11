# Prompt til næste session (skrevet 11/8 aften)

> Kopiér alt under linjen ind som din næste session-prompt.

---

Læs `docs/NOW.md`. Den blev verificeret linje for linje 11/8 — hvert issue-nummer er tjekket mod GitHub, og tre forældede påstande blev rettet. Stol på den, men verificér stadig før du kalder noget løst.

Temaet er stadig **tillid**, og det er skærpet: spillerne har i flere dage ikke kunnet regne med spillet. Vi laver ingen quick fixes. Rod-årsag, permanent løsning, simulér-før-ship på alt balance-følsomt, og en guard der beviser at fejlen ikke kan komme igen. Hellere færre opgaver løst fremragende end mange løst halvt.

**Denne session skal eksekvere, ikke kun planlægge.** Mindst punkt 1 og 2 skal være merged og live, før vi taler om resten.

Stil spørgsmål hver gang du er i tvivl — **ét ad gangen, i klart sprog, med din anbefaling**. Ikke tekniske dossierer: jeg husker ikke et issue ud fra et tal, og jeg vil hellere designe med dig end få noget serveret. Det gælder også rækkefølgen nedenfor — udfordr den gerne.

## Læs først (ikke valgfrit)

`docs/superpowers/specs/2026-08-09-3564-progressionskaede-samlet-design.md` er SSOT for hele progressionskæden. §5 (måltal-skelettet), §11.5 (beslutning A-E) og §12 (sekvensen frem mod 23/8) er de dele der binder. Beslutning A, C, D og E er låst af mig — de skal ikke genåbnes, de skal implementeres. **Byg ikke noget i kæden uden at have læst §12's sekvenstabel.**

## Rækkefølgen

### 1. #3639 — 119 ryttere træner mod et loft de allerede har nået (EKSEKVÉR)

Er alle evner i et træningsfokus på loftet, giver træningen nul, og fladen siger intet. Tre spillere meldte symptomet 10/8 uden at kende mekanikken. `TRAINING_FOCUSES` i `backend/lib/training.js:52` mapper hvert fokus til flere evner — et fokus er først dødt når alle er på loft.

Ikke en balance-ændring: et signal + en vagt. Leverance: (a) hovedrum pr. evne i fokus, ikke kun tier-procenten fra #3234, (b) tydelig tilstand når fokus er dødt, (c) backwards-check af hvem der er ramt og hvor længe, (d) en metrik der tæller døde slots dagligt, så næste loft-ændring ikke gentager det i stilhed.

Dette er sessionens mest synlige spillerfix. Det skal ship'e først.

### 2. #3503 — potentiale-visningen er ulæselig, og jeg har målt hvorfor (DESIGN + EKSEKVÉR)

**Dette er "ryttertype-loftet" jeg efterspurgte.** Rod-årsagen er fundet og målt 11/8:

`riderProgression.js:382` sætter loftet til `Math.max(tapered, current)`. Overhaler en rytter sit potentiale-loft, følger loftet permanent med. Konsekvens i prod: **20,3 % af alle ryttere (1.773) er sluppet ud af deres potentiale**, hos voksne 32,3 %. Ungdomsstien klamper korrekt (1,3 %).

Derfor kan en 4-stjernet have toploft 99, mens alle 74 seks-stjernede ligger på præcis 88 (spec'ens designede anker). Stjernen er korrekt afledt — men hver femte rytter modsiger den. Det er præcis thelamba's *"under 5 points forskel i deres max"* på to ryttere med 2½ stjernes forskel.

**Håndhæv IKKE I1 nedad.** Alle 710 spiller-ejede brud har allerede en evne over det loft de ville få — op til 42 point. Det ville nedgradere ryttere folk har købt og trænet.

Retningen jeg vil have undersøgt (min beslutning mangler — spørg mig): frys det opnåede loft for eksisterende ryttere, luk døren for ny vækst, og lad potentiale-tallet følge loftet ved 1-99-migrationen. Så bliver bestanden ærlig uden at nogen mister noget.

Bemærk koblingen: I1 er en **port på trin 1** (§6), og den står på 79,7 %. Remappen kan ikke passere sin egen port mod den nuværende bestand. Det er en reel blocker på kæden, ikke en detalje.

### 3. #3582 → #3580 → #3578 — penge uden modydelse (EKSEKVÉR #3582)

Rækkefølgen er låst 11/8. Revisionssporet først: sweepet finder 21 auktioner hvor rytteren ikke fulgte pengene, men kun én kan bekræftes, fordi budhistorikken blev cascade-slettet 9/8. Uden sporet retter vi i blinde.

Første leverance er klassifikationen af de 21 — og den **skal** bruge heal-sweepens egen diskriminator (`getRidersInActiveStageRace`), ellers producerer vi falske positiver som i #3330.

**Åben post:** BPTrain mangler stadig 40.000 CZ$ for Seojun Choi. Jeg valgte bevidst ikke at kompensere før rettelsen. Den lukkes som en del af #3580 — mind mig om den.

### 4. #2650 + #3461 — trætheden rammer kun spillerne

Genmålt 11/8: AI median 0 og nul ryttere på 95+; human median 82 og 925 af 3.399 på 95+. PR #3246 rettede AI-siden 3/8, human-siden aldrig. Det er en fairness-fejl, ikke en kalibrering. #3461 ("Træn i dag" brænder dagens restitution før etaperne kl. 11-19) er formentlig mekanikken bag asymmetrien — undersøg dem sammen.

En spiller sidder fast i det lige nu: *"Har endnu engang overtaget en rytter med 0 i form og 100 i fatigue... han stiger ikke i form ved træning."*

### 5. #3620 — kontrakt-udløb forkortes stadig ved akademi-flyt

Rapporteret igen 10/8, efter #2881 blev lukket 6/8. En rettelse der ikke rettede. Find ud af hvorfor #2881's fix ikke holdt, før du skriver en ny.

### 6. #3585 + #3600 — e-mail-loopet, begge før #2853 flippes

Day 1-mailen selecter `race_results.created_at`, som ikke findes (kolonnen hedder `imported_at`). Den vil fejle for ALLE hold i det sekund loopet tændes. Og loopet genforsøger aldrig.

### 7. #3593 → #3591 pkt. 2 — identiteten gøres færdig før 16/8

Spec §12 blok 1. #3593: udfyld anlægget for de 577 fra `secondary_type`-kolonnen (ren forankring, intet synligt skifter). #3591 pkt. 2: kontrolleret re-derive af AI-caps — **dry-run + mit go først**. 61,6 % skifter type; det må ikke ske som sideeffekt af race-day-flippet 23/8.

### 8. Rollbackplan for 23/8, pr. komponent (SKRIV DEN)

Fire ting flippes 23/8 (markedsvægt→1,0 → #3393 løn → race-day-flip #3459 → mandat #3514), og S3 starter dagen efter. Spec §7 har efterlyst planen siden 9/8; den findes stadig ikke. Skriv den mens der er ro — ikke på dagen. Pr. komponent: hvad ruller vi tilbage, hvordan, hvor længe er vinduet, og hvad kan IKKE rulles tilbage.

### 9. #3449 / 16/8-sweepen — de 8 CodeRabbit-fund + T4-niveau-gates før merge

To af fundene (sweep/trainingSweep-race på søndage, dedup-log efter writes) er reelle korrekthedsfejl for netop søndagskørslen.

### 10. #3632 — prod-verifikation søndag 16/8

Jeg lukkede den for tidligt i sweepen 11/8 og har genåbnet den som `claude:done` (gated). Første rytter født med nyt sekundært anlæg kommer med søndagens intake-drip. **Luk den 16/8 når det er målt** — ikke før.

### 11. #3631 → #3634 — sekundær-fordelingen (16/8→23/8, kun flow)

Målt efter migrationen: spillernes sekundære type er rouleur 31,6 % + sprinter 30,7 % = 62 % i to typer. Klatrer, brosten, baroudeur og tt ligger alle under 6 %. Simulér-før-ship mod ægte population.

### 12. #3586 — skema-guard i CI

Ville have fanget #3585. Der er 553 selects i kodebasen, og vi har haft to bugs af samme klasse på én dag.

### 13. #3172 — CI-flaken der gør `verify-local` upålidelig

Stod som done; flyttet tilbage 11/8 fordi sidste kommentar var en ny observation, ikke en løsning. En pre-flight man ikke kan stole på, lærer os at ignorere røde checks.

### 14. #3628 — `toggleDmPref` lyver om tilstanden

Plus tre andre bekræftede i ProfilePage.

### 15. #3638 + backlog-kadencen

#623 målte 5 % miss-rate på patch notes 25/5 og lukkede med "kan splittes til ny issue" — den blev aldrig oprettet. Og: 261 issues oprettet på 12 dage mod 245 lukket. #3154's mål på ~200 er aritmetisk uden for rækkevidde ved den intake. Foreslå en kadence der holder — ikke en engangsoprydning, og ikke en kill-liste.

## Mine klik (husk at minde mig)

- **[#3553](https://github.com/NicolaiDolmer/CyclingZone/issues/3553)** — støjen er allerede fjernet i [PR #3641](https://github.com/NicolaiDolmer/CyclingZone/pull/3641) (afventer mit go, ikke merged). Tilbage til mig: ny klassisk PAT med `project`-scope i `secrets.PROJECTS_PAT` — **eller** beslutte at roadmap-boardet er dødt, og så slette workflowet i stedet. Spørg mig hvilken.
- **[#3486](https://github.com/NicolaiDolmer/CyclingZone/issues/3486)** — `VERCEL_TOKEN` i Infisical. Låser #1784. Vercel CLI er stadig ikke installeret.
- **Post kommunikationspakken** (`docs/discord/2026-08-10-kommunikationspakke.md`, EN+DA klar) + akademi-kompensationen.
- **Svar på forum-spørgsmålet** i tråden "New update: Rider types": *"What do you mean 'it can be reversed'?"* — står ubesvaret siden 11/8 08:39.
- **Patch notes v7.112-7.116** mangler i Discord (alle fra 11/8). Efterslæbet var mindre end antaget — du postede selv catch-up 10/8.

## Spørg mig om det her undervejs

1. **#3503-retningen** (punkt 2) — fryse + lukke fremad + lade tallet følge loftet? Det er den eneste af mine beslutninger der mangler, og den blokerer trin 1.
2. **Kompensations-reglen.** Mit udgangspunkt fra 11/8: kompensér når spilleren har taget en beslutning og betalt for den, og vi bagefter ændrede grundlaget. Skal den skrives ned og vises til spillerne?
3. **Rækkefølgen ovenfor** — hvis Discord viser noget der brænder mere, så sig det og begrund det.

## Arbejdsform

- Verificér i prod/kode før du kalder noget løst. Ingen evidens → sig det eksplicit.
- Vis mig visuelt UNDERVEJS ved UI-arbejde — ikke "test selv til sidst".
- Migrationer: du applier selv efter merge (idempotent + post-verify). Destruktive klasser er stadig mine.
- **Gen-tænd aldrig et live spiller-vendt system uden mit go.**
- Ved bugfix: postmortem i `.claude/learnings/`. Læg det i en eksisterende fil hvis fejlen er samme klasse — der er allerede tre instanser af "målt langs den forkerte akse" fra 11/8.
- Close-out per CLAUDE.md, og foreslå hvad næste session starter med.
