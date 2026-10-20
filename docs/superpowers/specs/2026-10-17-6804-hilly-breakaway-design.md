# #6804 v2-udbrudspakken: design (S5, bag s5_profiles_v2)

Status: design, intet bygget. Refs #6804 #6748 #6912 #6818 #6909 #6156.
SSOT: `docs/RACE_ENGINE_RULES.md` (afsnittene "Udbrudsmål", "Jagten under official_times_v3",
"Udbrudsopfølgningen under s5_profiles_v2"). Bygge-PR'en opdaterer reglen dér i samme PR.
Hard rule 17: ingen vægte, tærskler eller målte andele her. Baseline og kalibrering
ligger privat i `balance-internals/6804/2026-10-20/`.
Hard rule 36: offline motor-baseline målt 20/10; den lokale PG17-baseline (testporten på S5-ruterne) køres og noteres FØR første motor-PR i trin 2 (se §9). Denne PR er ren docs.
Ejer-beslutninger 18/10 (B) og 19/10 (1-6) er låste og genåbnes ikke her.

## 1. Problem (målt 20/10, tal privat)

1. **Kuperet vinder for sjældent fra udbruddet uden for GT**, og næsten aldrig på
   spurt-, bakke- og murafslutninger i korte etapeløb. Nedkørselsafslutninger i
   endagsløb vinder derimod meget ofte.
2. **Forspring uden loft (#6912 reproduceret).** På bjerg og kuperet i etapeløb får
   en del udbrud mere end et kvarter, op til motorens øvre klemme; flade endagsløb
   lægger sig fast ved lad-gå-loftet. Udfaldet er et knivsæg: små forspring hentes
   næsten altid, meget store holder næsten altid. Mellemzonen, hvor
   virkelighedens udbrudsdage afgøres, er tynd.
3. **Sammensætning.** Kaptajner er aldrig med (korrekt). Men en af feltets bedste på
   dagens afslutnings-evne sidder ofte i udbruddet på bakke, mur og nedkørsel, og et
   lille udbrud har i nogle bjergetaper to fra samme hold. Tre fra samme hold er
   sjældent, men ikke udelukket på 1. etape.
4. **v2 = v1 for udbrud.** #6748-rettelserne flytter ikke (1)-(3); pakken skal bygges.

## 2. Rod-årsager (read-only gennemgang 19/10, bekræftet af målingen)

1. Kuperet med spurt jages som en flad massespurt: `stageWinFinaleWeight` er ens på
   tværs af profiler (S5 fjernede `breakaway`-finalen, #6368).
2. Lineær jagt over hele dagen på kuperet: `preFinalChaseClosingScale` er neutral,
   jagt-gulvet gælder kun flad/rullende, lad-gå-loftet er højt.
3. Lad-gå-loftet og lukningen kender ikke et realistisk forspring: intet led får
   feltet til at reagere før et forspring bliver uholdbart (#6912).
4. Udbruddets sammensætning vælges uden hensyn til dagens favoritter og holdfordeling
   i forhold til udbruddets størrelse.
5. Kuperede udbrud er for små i forhold til størrelsestrappen (`docs/RACE_ENGINE_RULES.md`).

Rettet fra v1-designet (review-fund): **endagsløb har en klassementsreaktion**
(`gcReactionSetup` med `one_day` + `oneDayProtectedRider` -> `winner_ahead`). Forskellen
mellem endags- og etapeløb forklares derfor IKKE af manglende reaktion, men af (a)
lad-gå-loftet pr. løbstype og (b) at etapeløbets klassementshold jager ud fra
truslen på top-10. Bygge-PR'en logger begge signaler pr. etape (endags vs. etapeløb)
i benchen, før en knap drejes.

## 3. Krav

- K1 Udbrudsbånd pr. løbstype (ejer 19/10 #1): ét bånd for Grand Tours, ét for korte
  etapeløb og ét for endagsløb, faldende i den rækkefølge mellem
  løbstyperne. Inden for hvert bånd ligger mindre løb (lavere divisioner, mindre felter)
  i den høje ende og store løb i den lave; det ændrer ikke rækkefølgen mellem typerne.
  Båndene står privat i `balance-internals/6804/`.
  Terrænbåndene i Udbrudsmål §2 gælder fortsat oveni.
- K2 Kuperet spurtafslutning kan være udbrudsdag, lavere chance end bakke/mur/nedkørsel,
  men ikke nær nul (ejer #2).
- K3 Realistisk forspring (ejer #3): typisk en mellemzone, sjældent en øvre zone (kun
  når ingen vil jage), aldrig over en hård grænse. Zonerne og grænsen står privat i `balance-internals/6804/`.
- K4 Sammensætning (ejer #4): GC- og etapefavoritter sjældent med; flere fra samme hold
  skalerer med udbruddets størrelse; ingen ulogiske udbrud.
- K5 Størrelse på kuperet efter størrelsestrappen (ejer #6).
- K6 Ingen ren lodtrækning (ejer #5): hver udbrudssejr kan forklares i løbsfilmen.
  Mulighed A (blind "for sent"-chance) er afvist og bruges ikke som reserve.
- K7 Uændret: bjerg/højfjeld-ankre, vindertype-dommen, "jag" øger kun, "lad gå" skaber
  aldrig forspring alene, et hold jager aldrig sine egne (#6187), top-10 får aldrig 5 min
  uden jagt (#5978), skala-invarians (#4707), determinisme pr. seed.
- K8 `s5_profiles_v1` og ældre bit-identiske; alt bag `isS5ProfilesV2OrLater`.

## 4. Pakken (byg-rækkefølge)

**P1 Slank B for jagten på kuperet** (ejer 18/10, B-trin 5 udgår: findes allerede som
`letGoBrakingTeams`, testet i #6457).
1. Profilafhængig finalevægt: `stageWinFinaleWeight` får en kuperet-faktor pr.
   afslutning; spurt på kuperet vægtes lavere end på flad, bakke/mur lavere end ren
   punch-finale på åbent terræn. Ordenen spurt < bakke/mur < nedkørsel i udbruddets
   favør bevares (K2).
2. Dæmpet jagt før finalen på kuperet: `preFinalChaseClosingScale` for kuperet under v2,
   så lukningen koncentreres i finalen (samme knap som bjerg).
3. Lavere lad-gå-loft på kuperet etapeløb.

**P2 Realistisk forspring (#6912, K3).** Ikke en klemme på uret, men feltets adfærd:
når forspringet nærmer sig det holdene tolererer pr. profil og løbstype, går
lad-gå-fasen over i kontrolleret jagt hos de hold der har etapeinteresse eller
klassementsinteresse. Interessen læses fra BEGGE kilder i `stageWinChaseForceV3`:
`interestByTeam` (etapeinteresse fra finale-rangerede ryttere) OG `teamSignals`
(klassementsreaktioner og ordrer). Kun POSITIVE `teamSignals` tæller som interesse (`let_go` skriver et negativt signal; samme
`Math.max(0, signal)` som i `stageWinChaseForceV3`). Et hold med kun positivt GC-signal
tæller som interesseret, så
et farligt udbrud aldrig vokser ind i den øvre zone mod K7's top-10-regel. Kun når INGEN hold har interesse,
kan forspringet vokse til den sjældne øvre zone. De meget store forspring, spillerne så (#6912), kræver
dermed et felt uden jagt-interesse, og det kan forklares i filmen ("ingen hold ville
jage"). Jagt-gulvet på flad/rullende beholdes; endagsløbets loft på bjerg (#6367)
beholdes.

**Automatisk jagt skal bære arbejde (Codex-fund 20/10).** I dag giver `interestByTeam`
lukkekraft, men fylder ikke `teamChasePlan.chaserWork`; trætheds-løkken (`applyChaseCost`)
og `breakaway_caught.chasing_team_ids` læser kun den work-map. Under v2 vælger et hold med
interesse (positiv `interestByTeam` eller positivt `teamSignals`) sine jagt-ryttere efter
samme udvælgelse som en ordret jagt (ikke beskyttede ryttere; aldrig hvis holdet har egne
i udbruddet, #6187), og skriver deres arbejde i `chaserWork` i forhold til interessen.
Dermed betaler den automatiske jagt træthed, og løbsfilmen kan navngive jagtholdene (P5).
Lukkekraften må ikke tælles dobbelt: work-mappen er kilden, `interestByTeam` er vægten.

**P3 Sammensætning (K4).** I udvælgelsen af hvem der får lov at gå (breakawayPermission /
attempt -> formed):
1. GC-favoritter: klassementets forreste (fra etape 2) og på 1. etape feltets bedste på
   klassementsevne (samme mål som #6748 punkt 1) slippes sjældent; slipper en med, jager
   klassementsholdene (eksisterende trusselsmodel).
2. Etapefavoritter: feltets bedste på dagens afslutnings-evne får mindre plads i
   udbruddet; feltet reagerer på dem som på en trussel mod etapen.
3. Ryttere pr. hold skaleret med udbruddets størrelse: et lille udbrud har sjældent to
   fra samme hold, et stort må have flere; reaktionen fra de andre hold vokser med et
   holds overvægt i udbruddet (thelamba #6912: "3 gange 2 fra samme hold").
4. Ingen ulogiske udbrud på 1. etape: ingen GC-favorit og aldrig mange fra samme hold.

**P4 Størrelse på kuperet (K5, ejer #6).** Kuperede udbrud dannes efter størrelsestrappen;
straffen for små udbrud må ikke trække under trappen. Udbruddets antal og flugt-evne
påvirker fortsat chancen monotont.

**P5 Fortælling (K6).** Ingen ny tilfældighed indføres. Hver udbrudssejr skal i
løbsfilmen kunne henføres til mindst en af fire årsager, som motoren allerede kender og
skal udsende som hendelser/params (kvalitative, ingen tal):
- jagtkapacitet: hvilke hold jagede, og at de blev færre/trætte (`breakaway_caught` /
  ny `chase_faded` med `chasing_team_ids`),
- samarbejde: hold der lod være / ventede på hinanden (`own_riders_ahead`,
  lad-gå-hold),
- træthed: jagthold der betalte for jagten (`applyChaseCost`),
- terræn: bakker/nedkørsel der åd jagtens lukning.
Filmen viser en kort linje pr. årsag (EN+DA, `docs/TONE_OF_VOICE.md`), og gab-kurven
skal vise det aktive udbrud (#6748 punkt 4 følger med). En udbrudssejr uden mindst en
årsag er en testport-fejl (§5 G7).

## 5. Testport (hard gates, alle under s5_profiles_v2; #6909-ruter + S4-ruter)

Benchen køres på S5-ruter fra `s5MotorBench --scope=all` og, når #6909 er klar, på
testportens S5-ruter med syntetisk startfelt; samme gates begge steder.

- G1 Udbrudsandel pr. løbstype inden for ejerbåndet (K1); pr. kuperet afslutning inden for
  det private anker, spurt > 0 og < bakke/mur (K2).
- G2 (ny, K3) Forspringsfordeling: median maks-forspring i mellemzonen på kuperet/bjerg i
  etapeløb; andelen i den øvre zone under et privat loft; **nul** etaper over den private hårde grænse, og
  enhver etape over den øvre zone skal have "ingen jagt-interesse" i sin hendelse.
- G3 (ny, K4) Sammensætning:
  a) GC-favorit i udbruddet sjældent (privat loft); aldrig på 1. etape.
  b) Etapefavorit (top på dagens afslutnings-evne) i udbruddet under privat loft.
  c) Flere fra samme hold i et lille udbrud sjældent (privat loft); mange fra samme hold
     aldrig på 1. etape og aldrig i et udbrud der holder hjem. Grænserne står privat.
- G4 Størrelse på kuperet inden for størrelsestrappen (fordelingskrav privat).
- G5 Uændret dom for bjerg, højfjeld, flad og vindertype; `breakawayHoldVsLegacy`
  (Udbrudsmål §3) ikke markant under legacy på nogen profil.
- G6 Bit-identitet: alle motortests under v1 grønne uden fixture-ændringer.
- G7 (ny, K6) Fortælling: hver udbrudssejr har mindst en årsagshendelse; kontrakt-test
  på hendelsernes form.
- G8 Kontrakt: monotoni i udbruddets flugt-evne og antal; "jag" øger, "lad gå" skaber
  aldrig forspring; skala-invarians.
- G9 Formtoppe (Codex P2 genreview): en kombineret v2-kørsel med repræsentative
  `peakDay`/`peakWindows` (benchen bygger i dag profiler uden `peakDay`, og Giro-fixturen
  har ingen `peakWindows`). G1-G4 skal holde både med og uden formtoppe.
- G10 Sammenligning mod gammel motor og virkelighed (ejer 8/10): udvalgte kuperede
  etapeløbsetaper og endagsløb vises ejeren før "tænd".

## 6. Verifikations-tier

**TIER FULL** (motor, delte libs): `scripts/verify-local.ps1`, hele backend `node --test`,
`s5MotorBench.test.ts`, tourDryRun-tests, testportens G1-G10. Frontend (filmens linjer):
`npm run lint`, `node --test`, build og hele `npm run test:e2e`; snapshots i alle 3
Playwright-projekter. help.json (en+da) og patch notes ved tænding.

**Hvad ejeren ser på preview (P5, før build-go til tænding):** løbsfilmen og gab-kurven for
udvalgte S5-etaper kørt under `s5_profiles_v2` (preview-override på etapesiden), med ét
annoteret før/efter-billede pr. PR (desktop 1440 + mobil 375, lyst og mørkt): en udbrudssejr
med årsagslinjer, en hentet udbrud, og en etape med meget stort forspring hvor ingen jagede.
**Tester-runde:** beta-testerne gennemgår en håndfuld v2-etaper på staging før tænding
(pakken er stor og spillervendt); fund samles på #6804, og tænding sker kun på ejer-go.

## 7. Filer (forventet, intet bygget)

- `backend/lib/engine/v4/mechanics/breakaway.ts` (P1, P2: jagt-interesse, lukning, lad-gå)
- `backend/lib/engine/v4/mechanics/breakawayPermission.ts` (P3, P4: hvem/hvor mange)
- `backend/lib/engine/v4/mechanics/gcThreat.ts` (P3: GC- og etapefavorit som trussel)
- `backend/lib/engine/v4/tuning.ts`, `mechanics/timeModel.ts` (knapper bag v2, ingen tal i
  kommentarer)
- `backend/scripts/dev/s5MotorBench.mjs` (`--revision`, forspring/sammensætning pr. etape,
  formtop-kørsel), `backend/scripts/dev/lib/tourScorecard.mjs`
- `frontend/src/lib/stageTimelineFilm.js` + i18n (P5)
- `docs/RACE_ENGINE_RULES.md` (reglen), `help.json`

## 8. Risiko

Bag slukket revision, ingen spillerpåvirkning før ejer-go. Største risiko: knivsægget
flytter sig i stedet for at forsvinde (G2 fanger det), og at GT-bjerg flytter sig (G5).
P2 og P3 rører udvælgelse og jagt samtidig; byg P1 -> mål -> P2 -> mål -> P3/P4 -> mål
-> P5, et trin pr. commit, så hver ændring kan isoleres i benchen.

## 9. Baseline (hard rule 36)

Målt 20/10 read-only og offline på `s5MotorBench`-ruterne (scope all, 3 sæson-træk x 3
motor-seeds, Giro-feltet), v1 og v2 side om side, med forspring og sammensætning pr.
etape. Tal: `balance-internals/6804/2026-10-20/`. Motoren laver ingen DB-I/O, så
målingen er DB-uafhængig; den lokale PG17 bruges i bygge-trinnet til testportens
S5-ruter fra #6909 (syntetisk felt på nuværende trupper) og skal køre før første
motor-PR.

## 10. Kilder til båndene

ProCyclingStats skal stadig verificeres manuelt (PCS afviser automatiseret hentning).
Sekundære kilder der støtter GT-båndet og størrelses-effekten:
- Frontier Economics, "Tour de France: Breaking down the breakaway" (114 Tour-vejetaper,
  ca. en fjerdedel vundet fra udbruddet; store udbrud lykkes langt oftere):
  https://www.frontier-economics.com/uk/en/news-and-insights/articles/article-i6444-breaking-down-the-breakaway/
- University of Stirling (udbrud lykkes oftere på kuperet og bjerg end flad):
  https://www.stir.ac.uk/research/hub/publication/522272
