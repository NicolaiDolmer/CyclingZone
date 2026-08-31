# Beslutningsark 31/8 2026 — 8 blokerede ejer-beslutninger, målt og verificeret

> Fase A i oplås-og-byg-sessionen. Hver måling er lavet read-only mod prod + kode af en måle-agent
> og derefter adversarisk efterprøvet af en uafhængig verify-agent (verdikter: CONFIRMED/ADJUSTED).
> Kilder: SQL mod prod (ghwvkxzhsbbltzfnuhhz), fil:linje-citater og issue-tråde. "Formodet" = uden kilde.

## Status på #4482 (afgjort undervejs 31/8, ikke længere åben)

CI-uheldet (auto-migrate kørte det manuel-only-markerede oprydningsscript ved merge af PR #4508) udløb
alle 36 gamle bonustilbud kl. 17:43 uden spillerbesked. Ejeren valgte **Regel A**: et lag 6-tilbud lever
præcis én sæson — sæson-slut-tilbud indløses i hele den følgende sæson, mid-season-tilbud resten af sæsonen.
PR #4524 implementerer reglen (sæson-slut-tilbud stemples NULL og re-stemples af transitionen), genskaber
de **21 S2-slut-tilbud** som aktive stemplet S3, og tilføjer forward-guard mod manuel-only-SQL i
auto-migrate-globben (+ `database/manual/`-konvention). De 15 øvrige (1 mid-S1, 10 S1-slut, 4 mid-S2) er
retmæssigt udløbet under Regel A. Den gamle `[DATO]`-spillerbesked er dermed overflødig — patch noten dækker.

---

## 1. #4485 — Ungdomsklassementet inkluderer 26-årige (verify: CONFIRMED, alle 16 nøgletal eksakte)

**Hvad står stille:** 3 fuldt afsluttede S3-løb har et ungdomsklassement hvor hver 4. plads sidder forkert,
inkl. selve vinderen ("den unge trøje") i 2 af 3 løb. raceRunner bruger wall-clock-år (2026) i stedet for
sæson-referenceåret (2028), så fødselsår 2002-2003 tæller fejlagtigt som U25.

**Målt:** 268 young-rækker i S3, **64 forkerte (24 %)**. 2 af 3 løbsvindere forkerte (Gonzalo Herrera f.2002
burde være Ryan Whitfield f.2004; Daan Visser f.2003 burde være Florian Wolf f.2008). 203 af 204 gyldige
rækker ville flytte placering ved genberegning. **36 rigtige spillerhold** berørt (0 AI). Præmier: 39.900 CZ$
udbetalt i young-klassementer, heraf **19.200 CZ$ (48 %) til for gamle ryttere**. Rod: `raceRunner.js:1031-1053`
(`loadSeasonReferenceYear` læser `seasons.start_date`-år); SSOT `riderSeasonAge.js` gør det rigtigt.
Bonus-fund (samme fejlklasse): `seasonAcademyIntake.js:202` — ikke talsat.

- **A:** Ret koden nu, lad de 3 kørte løb stå (dokumentér i patch note). Ingen prod-mutation, men 2 løb
  beholder permanent forkert trøje-vinder og 19.200 CZ$ står hos for gamle ryttere.
- **B:** Ret koden OG genberegn de 3 løbs young-rækker (ejer-gated migration; skal forholde sig til de
  allerede udbetalte præmier).

**Anbefaling:** Kodefixet er en ren FEJL og bygges nu uanset. B er billigst NU (kun 3 løb, 64 rækker) og
bliver dyrere for hver dag S3 kører — men kør den først når du har set de 3 klassementer før/efter. 👍 B.

## 2. #4495 — Ryttere fanget i akademiet (verify: ADJUSTED — tallet er 7/5, ikke 8/6)

**Hvad står stille:** En graduate-auktion der slutter UDEN bud muterer intet på rytteren — han forbliver
i akademiet, umulig at promovere/sælge/frigive. Det ejer-godkendte designspec (18/6) siger eksplicit
"free agent ved ingen bud"; koden implementerer det ikke (`auctionFinalization.js`: no-bid-grenen
linje 1489-1513 rører ikke rytteren). Bekræftet BUG mod låst spec.

**Målt (genverificeret 1/9):** **7 ryttere på 5 hold** (issuets 8/6 kunne ikke reproduceres — tælle-unøjagtighed,
ingen prod-drift kan forklare differencen). PR #4494 (merget i dag) fixer kun sweep-låsen, ikke no-bid-hullet
og frigør ikke de 7.

- **A:** Minimal datareparation nu (gør de 7 til free agents, præcis som spec'en lover) + fix no-bid-grenen
  i koden så det ikke sker igen. Du ser SQL + de 7 navne/hold før kørsel.
- **B:** Vent — men ingen eksisterende mekanik samler dem op af sig selv (målt: sweepet rører dem ikke).

**Anbefaling:** A — det er en spec-brud-fejl, reparationen er lille og veldefineret. 👍 A.

## 3. #4376 / PR #4388 — guaranteed_base rebases ikke (verify: CONFIRMED, alle tal eksakte)

**Hvad står stille:** 21 af 24 D1-hold kører på en sponsor-base signeret i en lavere division (8 fra D3,
11 fra D2, 2 fra D4) og betaler D1-upkeep (220.000) af den. PR #4388 gør IKKE hvad man tror: den rører
INGEN løbende S3-udbetalinger uanset hvornår den merges — motoren fyrer først ved S3→S4-transitionen 27/9.

**Målt:** Rå D1-tillæg hvis korrektion: D3→D1 = 130.000 · D2→D1 = 100.000 · D4→D1 = 142.500 pr. hold,
total 2.425.000 CZ$ (før bestyrelses-modifier 0,80-1,20 → formodet 1,94-2,91M). På tværs af alle divisioner:
54 hold, rå-total 3.295.000 CZ$. PR'ens migration er ikke-destruktiv (ny nullable `signed_division`,
backfillet for 210 af 231 kontrakter). Den beslutning der faktisk flytter penge er en TREDJE: det separat
ejer-gatede backpay-script. Åben rest fra din egen Discord-sweep 29/8: mistanken om de 3 "korrekte" D1-hold
er ikke afklaret i tråden.

- **A:** Merge PR #4388 nu — `signed_division` gemmes korrekt for nye kontrakter fra i dag, og 27/9-transitionen
  beregner rigtigt. Ingen S3-effekt.
- **B:** Vent til efter din gennemgang — men bemærk at hvis den ikke er merget FØR 27/9, kører S3→S4-skiftet
  endnu en gang med den forkerte base.

**Anbefaling:** A når du har set den (den er din eksplicitte parkering) — reel deadline er 27/9. Backpay for
S3 er en separat beslutning du kan tage uafhængigt. 👍 A inden 27/9.

## 4. #4356 + #4357 — De etaper der kørte med to kaptajner (verify: ADJUSTED — sæsonfordelingen manglede)

**Hvad står stille:** 37 etaper (ikke 34) kørte med dobbelt kaptajn-effekt hos 14 hold. Fejlen er intern
hold-omfordeling (beskyttelsen flytter mellem to ryttere på SAMME hold, aldrig mellem hold) og er allerede
rettet fremadrettet (PR #4353, 28/8).

**Målt (verify-korrigeret):** Fordelingen er **8 etaper i S1, 27 i S2, kun 2 i S3** (Etoile de Bessages
Mineure et. 1 / Nexora Technologies + Giro della Penisola et. 4 / Wander Riders; de to etapers egne resultater:
103 point + 7.725 CZ$). En re-sim ville køre HELE feltet om og også ramme uskyldige hold; S1/S2 er lukkede
sæsoner med udbetalte præmier.

- **A:** Re-simulér (destruktiv prod-mutation, rører op til 5.233 resultatrækker på tværs af 3 sæsoner).
- **B:** Stå ved resultaterne; #4357 (ORDER BY + første-vinder-guard) merges som ren fremadrettet fix.

**Anbefaling:** B — kun 2 etaper i den kørende sæson, intern omfordeling, og re-sim straffer hold der intet
gjorde. 👍 B, og #4357 bygges i fase B.

## 5. #4098 — Unge markeres "done" under eget maks (verify: ADJUSTED — AI-hold forurenede tallene)

**Hvad står stille:** En ung rytters SVAGHEDS-evne (fx climbing for en rouleur) har et lavt rolle-loft (25),
og når han rammer det, står der bare "done" — spilleren tror rytteren er færdigudviklet generelt. Koden gør
præcis hvad den ejer-låste rolleklasse-cap-mekanik (PROGRESSION_RULES, låst 13/8) foreskriver.

**Målt (kun menneskehold):** **321 ryttere på 101 hold (43,3 % af 233 hold med unge)**, 429 done-evnefelter,
gennemsnitligt gab til eget maks 67,1 point, samlet 28.782 point. Gennemsnitligt cap-niveau for done-evnerne: 25,9.

- **A:** Kald det en fejl og rør cap-tallene i S3 — men det ER grundreglen fra PROGRESSION_RULES; at ændre
  den midt i sæsonen er præcis det din egen S3-ramme forbyder.
- **B:** Udskyd balance-spørgsmålet ("er svaghedstag 25 for lavt?") til efter 27/9 — men byg en ren
  UI-forklaringstekst NU ("Klatring er en svaghed for en rouleur — han er så langt han kommer her"),
  som løser spillerforvirringen (5 rapporter) uden at røre balance.

**Anbefaling:** B med UI-teksten bygget i fase B (tekst er ikke en grundregel-ændring). 👍 B.

## 6. #4103 — Kalender-audit S3 (verify: ADJUSTED — per-division-tal korrigeret, konklusion uændret)

**Hvad står stille:** Højbjerg-etaper ligger skævt: klatrere i D1/D2 har for lidt at køre efter, D4 har for
meget. Og der lever to konkurrerende brosten-mål i koden (5 % fra §6b 23/8 og 6 % fra KB_TARGET 6/8) — det
er aldrig afgjort hvilket der gælder.

**Målt (mål 12 % ±2pp):** Højbjerg: D1 7,7 % · D2 5,6 % · D3 10,6 % (OK) · D4 16,1 % → **brudt i D1, D2, D4**.
Brosten: D1 3,9 % · D2 4,8 % · D3 7,1 % · D4 4,8 % — ved 5 %-målet er kun D3 brudt, ved 6 % kun D1.
Fuld regenerering er UDELUKKET (kodeblokeret på aktiv sæson + ejer-forbudt + allerede brugt 2 gange før
aktivering). En "reparation" kan kun være manuel omklassificering af enkelt-etaper og kan kun hjælpe D1/D2
(D4 er katalog-begrænset, D3 er OK).

- **A:** Acceptér S3-kalenderen; byg §6b-målene ind i generatorens filler-vægte til S4 og afgør 5/6 %-brosten
  FØR S4-kalenderen (deadline: din egen #4176-frist 4/9).
- **B:** Manuel stage-patch af D1/D2 i den kørende sæson (kendt risiko-mønster fra #4140/#4218).

**Anbefaling:** A. CALENDAR_RULES §6b siger selv at målene er en måle-kontrakt, ikke en generator-kontrakt.
Den ene ægte beslutning her er brosten-tallet: **5 % eller 6 %?** 👍 A + vælg brosten-mål.

## 7. #3494 → #4265 — sponsor_income er ens for alle hold (verify: CONFIRMED, alle 7 tal eksakte)

**Hvad står stille:** Bestyrelsens "sponsor-vækst"-mål (fx "0/8") kan ALDRIG rykke sig for nogen spiller:
det måler `teams.sponsor_income`, et dødt legacy-felt som spillets rigtige sponsorøkonomi aldrig skriver til.

**Målt:** 368/368 hold har identisk 240.000 i feltet; de AKTIVE sponsorkontrakter varierer reelt
(157.500-772.800, snit 359.317). **135 hold ser lige nu et sponsor_growth-mål der er matematisk umuligt.**
0 write-paths til feltet efter oprettelse (grep-audit af hele backend).

- **A (minimal):** Pensionér/erstat sponsor_growth-målet nu — ren fejlrettelse (dødt felt), passer i S3-rammen.
  Fuld re-point til sponsor_contracts + #4265's UI-adskillelse venter til efter 27/9.
- **B:** Udskyd alt — 135 hold ser det umulige mål resten af S3, og dit eget #4265-direktiv ("i sæson 3")
  bliver de facto S4.

**Anbefaling:** A minimal i fase B; den fulde re-point + #4265 planlægges efter 27/9. 👍 A.

## 8. #4479 — Lønfrys-afvigelsen (verify: ADJUSTED — kernetal bekræftet eksakt)

**Hvad står stille:** Ingenting længere, reelt. /rules lovede lønfrys ved 6,7 % af markedsværdi; koden bruger
35 % af produktionsværdi — men det var et bevidst ejer-valg 14/7 (#3989), og /rules-teksten var en glemt rest,
som PR #4483 (merget 31/8) allerede har rettet. Paritetsvagten låser fremtidig drift.

**Målt:** 6.363 signerede kontrakter; 0 ville få identisk løn under begge regler. At "opfylde det gamle løfte"
ville koste +8,8-9,1M CZ$ i samlet løn (+67-76 %) midt i S3, ujævnt fordelt (værst: Hardly Athletic +611.684).

- **A:** Stå ved koden (allerede sket — teksten er rettet). Luk #4479.
- **B:** Ret koden til 6,7 % — genindfører problemet #3989 blev bygget for at fjerne.

**Anbefaling:** A, luk issuet. 👍 A.

---

*Genereret af fase A-workflowet (8 måle- + 8 verify-agenter, 2,2M tokens, alle read-only). Fuld rådata:
sessionens workflow-output + issue-trådene.*
