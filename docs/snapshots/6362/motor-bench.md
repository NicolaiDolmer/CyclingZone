# #6362 S5 motor-bench: resultat (offentlig udgave)

Tal står ikke her (hard rule 17). Den fulde rapport med tal, tabeller og før/efter-forslag ligger privat i `balance-internals/6362/motor-bench.md` (+ `motor-bench-gate.md`, `motor-bench-all.md`).

## Hvad benchen er

`backend/scripts/dev/s5MotorBench.mjs` kører v4-motoren under regel-revisionen `s5_profiles_v1`, kun i benchen (flaget og prod-revisionen er uændrede), på S5-ruter genereret lokalt med generatoren (`profileModel: "s5"`, samme sæson-træk som `scripts/dev/s5ProfileDryRun.mjs`). Feltet er det anonymiserede Giro-felt fra `backend/scripts/baselines/`, alle hold kørt som AI-hold. Etapeløb køres i rækkefølge med klassement og med akkumuleret træthed: samme sekvens som løbsmotorens helløbs-sti (`raceRunner.entrantFatigueSequences`, delt funktion, ikke en kopi), inklusive Grand Tour-hviledagenes restitution ud fra kalender-planens løbsdage. Sene Grand Tour-etaper køres altså med trætte ryttere, ikke friske. Flere motor-seeds pr. rute. Tidsgabet er vinder til nr. 10 med samme definition som benchmarken (GT 2021-2025, `docs/design/s5-benchmark/`).

Gatens del (4) læser nu dommen fra `backend/lib/__fixtures__/s5MotorBench.json` (inden for / under / over benchmarkens kvartil-interval pr. afslutning) i stedet for stubben, og en rød dom blokerer. `backend/lib/engine/v4/s5MotorBench.test.ts` genkører benchen og kræver samme dom, så filen kan ikke drive fra motoren eller generatoren.

**Vindertype-dommen i CI.** Tærsklen for hvor stor en andel den forventede type skal vinde er privat. Dommen er en ren funktion af målingerne og tærsklen, så fixturen bærer pr. afslutning et sha256 over præcis de målinger dommen bygger på (hver af gatens etaper: vandt den forventede type eller ej). CI genkører benchen og kræver samme digest. Flytter en motor- eller generatorændring blot én vinder, kan den committede dom ikke genberegnes uden tærsklen, og testen er rød, indtil dommen er skrevet igen med den private fil (`--write-fixture`). Digesten afslører hverken tærskel eller andel. Lokalt med den private fil genberegnes dommen desuden direkte.

Mur og bakke findes ikke i S5's Grand Tours (kvoterne giver dem ikke), så de måles på sæsonens andre løb; resten måles på Grand Tours som benchmarken.

## Resultat

| Afslutning | Dom mod virkeligheden |
|---|---|
| Flad spurt | inden for |
| Stigende spurt | inden for |
| Bakke | inden for |
| Mur | inden for |
| Bjergtop | inden for |
| Nedkørsel | inden for |
| **Enkeltstart** | **under: for små tidsgab** |

Genkørt med akkumuleret træthed og hviledage (review-runde 3): alle domme er uændrede, og ingen af iagttagelserne nedenfor skifter retning. Trætheden flytter medianerne en smule, ikke dommene.

**Gaten er rød på del (4) på grund af enkeltstarten.** Motorens enkeltstarter spreder feltet mindre end virkelighedens, både på den korte flade og den lange kuperede. S5-generatoren lægger desuden en kort prolog-agtig enkeltstart i hver Grand Tour, som trækker medianen ned.

### Stigende spurt

Tidsgabene ligger inden for virkeligheden (et par sekunders splittelse på rampen). Men vinderprofilen er den samme som på flad spurt: den samme hurtige rytter vinder begge, og punch flytter ikke vinderen. Issuets mål (sprint + punch, Matthews-typen) er ikke indfriet. Virkelighedens stigende spurter (fx Giro-etaper med 3-5 % til stregen) vindes oftere af hurtige ryttere med punch end af de rene topspurtere.

### Mellembjerg

- Flad spurt efter mellembjerg: et udtyndet felt spurter, ingen enkelt ryttertype dominerer. Realistisk.
- Nedkørsel: motoren samler favoritterne tættere end virkeligheden.
- Bjergtop på en kat. 2: motoren spreder mere end virkeligheden, og udbruddet vinder ofte.
- Benchmarkens stikprøver for mellembjerg er små, så ingen af de tre afvigelser er en dom endnu.

## Forslag (ikke implementeret, kræver ejer-go)

1. **Enkeltstart (rød):** enten øges enkeltstartens tidsspredning i motoren bag `s5_profiles_v1`, eller gaten dømmer enkeltstart pr. distance i stedet for rå sekunder (spec-ændring). Uden en af dem stopper `buildSeasonCalendar --apply` for S5 på del (4).
2. **Stigende spurt:** mere vægt på punch i finalens placerings-demand (`S5_PROFILES_TUNING.finaleBase.uphill_sprint`), mindre på ren spurt og acceleration.
3. **Mellembjerg:** ingen ændring nu; mål igen efter en sæson med rigtige felter.

Konkrete før/efter-tal: `balance-internals/6362/motor-bench.md`.

## Hvad benchen ikke dækker

- Ét felt (Giro-feltet), ikke alle divisioners felter; AI-ordrer, ikke spillernes.
- Ryttertyper er spillets klassifikator z-scoret mod feltet, ikke rytternes gemte type.
- Benchmarken har ingen udbruds- eller vindertype-kolonne; sammenligningen af vinderprofiler med virkeligheden er kvalitativ.
- Efter-tal for forslagene er ikke målt i motoren.
- Træthed: alle ryttere starter løbet uden træthed, og akkumuleringen er løbsmotorens egen rene model. I prod afregner træningen (`training_condition_per_date`) trætheden pr. dato og motoren læser den fra databasen før hver etape; den sti har ingen ren funktion at genbruge.
