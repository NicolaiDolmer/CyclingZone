# Til økonomi-sessionen: trin 4 flytter grundlaget under rytterværdien

**Fra:** loft- og udviklingsfart-sessionen (#3709 trin 3-5, worktree `feat-3709-trin3-haandvaerkstaget`)
**Til:** økonomi- og træningsside-sessionen (hoved-checkoutet)
**Dato:** 15/8 · **Status:** PR [#3739](https://github.com/NicolaiDolmer/CyclingZone/pull/3739) og [#3741](https://github.com/NicolaiDolmer/CyclingZone/pull/3741) er grønne og venter på netop denne samtale

---

## Det korte

**Ved deploy flytter markedsværdierne sig ikke.** Målt på hele populationen: 0 af
8.717 ryttere. Værdimodellen læser `abilities`, og trin 3-5 rører ikke en eneste
nuværende evne.

**Over en karriere flytter de sig meget.** Og det er ikke gennemsnittet der er
problemet, det er spredningen.

## Det ene spørgsmål jeg har brug for svar på

**Antager jeres værdi- og løn-model at en rytters værdi kan aflæses af hans
potentiale og nuværende evner alene?**

Hvis ja, brister den antagelse med trin 4. Efter trin 4 afhænger værdien også af
**hvordan han er blevet trænet**, og forskellen er ikke lille.

## Tallene

`predictBaseValue` kørt på 1.200 friske ryttere simuleret fra 16 til 30 år gennem
produktionens egen `applyDailyTick`, én gang med dagens motor og én gang med
kandidaten. Median markedsværdi ved 30 år:

| ledelse | i dag | efter trin 4 | delta |
|---|---:|---:|---:|
| standard (assistenten vælger) | 25.595 | 24.355 | **−4,8 %** |
| bedste spil | 27.096 | 22.193 | −18,1 % |
| **dårligste spil** | 23.272 | **9.447** | **−59 %** |

Det tal I skal regne med i det daglige er **−4,8 %**. Det er småt.

Det tal der kan ændre jeres design er dette:

| | i dag | efter trin 4 |
|---|---:|---:|
| spænd mellem bedste og dårligste ledelse | **16 %** | **158 %** |

I dag er en rytters værdi stort set afgjort ved genereringen. Efter trin 4 kan den
samme rytter være 9.000 eller 24.000 værd afhængigt af hvem der har haft ham.

## Hvorfor det rammer jer specifikt

Kæden er verificeret i koden:

```
abilities → outputScore()      (riderValuation.js:46)
          → predictBaseValue() → market_value
          → lønnen             (#3393 prissætter løn efter markedsværdi)
```

Så lønnen arver spredningen. To ting følger, og jeg ved ikke hvilken I vil have:

1. **Selvkorrigerende.** En dårligt ledet trup bliver billig i både værdi og løn.
   Manageren får automatisk lavere lønudgifter når han spiller dårligt, hvilket
   holder ham i live.
2. **Dødsspiral.** Samme manager har nu ryttere der er mindre værd at sælge, og en
   trup der taber løb. Hvis lønnen ikke falder *hurtigt nok* i forhold til
   indtægten, forstærker det sig selv.

Hvilken af de to det bliver, afgøres af jeres kurve, ikke af min motor. Jeg kan
ikke svare på det herfra.

## Tre ting mere I bør kende

**1. Facilitets- og staff-effekten er nu målt.** Hul 7 er lukket. En træner +
facilitet giver median **+12,9 %** og op til **+38,9 %** hurtigere daglig
udvikling. Specen troede maks +8,3 %. Det rammer 79 af 372 hold og 1.932 ryttere.
Hvis I prissætter facilitets-upkeep, er det afkastet. Rapport:
`docs/audits/2026-08-15-3709-hul7-staff-stien-verificeret.md`

**2. Træningsfladen får to label-ændringer jeg ikke har rørt.** #3721 er jeres.
`focusTrainability` kan efter trin 4 ikke skelne håndværk (tag 0,95) fra
andenRolle (0,70) — begge læses som "limited". Labelen læser kun den ene af
modellens to knapper. Det er pinnet i en test med en HÅNDVÆRK-note, så en ændring
bliver et valg og ikke en overraskelse. Hvordan den skal se ud er en
designbeslutning på jeres flade.

**3. Der er kommet et nyt issue på jeres flade: [#3743](https://github.com/NicolaiDolmer/CyclingZone/issues/3743).**
Ejer-beslutning 15/8: assistentens træningsvalg skal afhænge af trænerens evner.
I dag er assistenten lige så god som det bedste spil (28 mod 28 i rating), så der
er reelt ingen grund til at bruge træningssiden. Det hører sammen med #3721's
struktur.

## Hvad jeg foreslår

Jeg merger ikke #3741 før I har set tallene. Konkret har jeg brug for ét af tre
svar:

- **"Vores model tåler det"** — så merger jeg, og I bygger videre.
- **"Vi skal se det først"** — sig hvilken måling I mangler, så kører jeg den.
  Harnessen ligger i `backend/scripts/rytterudviklingScorecard.js` og tager en
  `--baseline`-worktree, så I kan også køre den selv.
- **"Det ændrer vores design"** — så skal vi tale sammen før nogen af os merger.

Alt underlag: `docs/audits/2026-08-15-3709-flow-scorecard.md` (afsnittet
"Markedsværdi ved 30 år").
