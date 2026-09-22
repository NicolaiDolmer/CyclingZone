# Forslag til beregning: typefri rytterværdi med marked (#5497, R2-R5)

Status: **beslutningsgrundlag, ikke godkendt til build.** Ingen live-sti er ændret. Tal og navne står kun i den private rapport (`balance-internals/2026-09-22-5497-typefree/`). Låste beslutninger i #5497 genåbnes ikke.

## 1. I hverdagsord

En rytters pris = **hvad han forventes at tjene resten af karrieren** (som i dag), men regnet uden at kigge på hans type:

1. **Grundværdi fra evner.** Vi måler hvor godt rytteren passer til hvert terræn i ét fælles sæsonprogram (bjerg, tempo, sprint, brosten, bakker osv.) med de samme opskrifter som rating-kortet. Han bruges der hvor han gavner mest. Det giver én "effektiv evne", som omsættes til forventet præmie pr. sæson med én fælles kurve, fittet på en hel simuleret sæson. Intet tillæg eller fradrag pr. type.
2. **Typefri karriereprognose.** Fremtidige evner fremskrives med den samme vækst-, fald- og potentialekurve som i dag. Det eneste nye: hvilke evner der tæller som "rytterens styrker" (og derfor vokser mest og falder langsomst) læses af hans egne evnetal, ikke af hans type.
3. **Marked oven på.** Betalte priser fra rene handler justerer de relative priser: et fælles led (fx "markedet betaler mere/mindre for alder og niveau end modellen") og et lokalt led (ryttere der ligner hinanden). Det samlede kroneniveau flyttes ikke af markedet. Mistænkelige handler sorteres fra med de detektorer der allerede findes.

## 2. Formler

### 2.1 Grundværdi (R2)

For terræn *p* med rating-opskrift *R_p* (`weights/displayRecipes.js`) og programandel *share_p*:

```
O_tf(evner) = alpha · (1/beta) · ln( Σ_p share_p · exp(beta · R_p(evner)) ) + (1 − alpha) · snit(evner)
prod(O)     = exp(a + b·Ō + c·Ō²),  Ō = min(O, toppunkt hvis c < 0, output_max)
              (output_max = største O i fit-stikprøven; kurven er flad derover)
V_grund     = niveau · præmie( skala · Σ_s diskonto^s · S_s · prod(O_tf(evner_s)) )
```

- Ét fælles niveau-led; `offset[type]` findes ikke.
- Den bløde maksimum er kontinuert i evnerne: ét evnepoint flytter *O_tf* højst med den største opskriftsvægt-andel. Der er ingen rolle-label, som kan skifte. Fittet på S3 vælger næsten ren "bedste terræn" (stor beta). Det er stadig kontinuert, fordi springene i 1b kom af at skifte vægt-sæt og type-tillæg, ikke af selve maksimum-funktionen.
- `a, b, c, beta, alpha` fittes deterministisk på ln(forventet præmie) fra sæson-simuleringen (samme mål som v4-fittet). **Programandelene er låst** (lige vægt pr. terræn indtil R1). Hvis andelene fittes frit, ender de i de to terræner som v3-simuleringen betaler mest for. Det er et artefakt og ikke et program.
- Diskonto, overlevelse, alders-grænser og niveau-korrektion (#3449) er uændrede fra v4. Elite-**gulvet** er fjernet (låst). Den konvekse præmie over overall-tærsklen er bevaret uændret (se ejer-valg).

### 2.2 Typefri karriereprognose (R3)

For hver evne *i*, ud fra rytterens start-evner:

```
sig_i        = logistisk( (evne_i − (snit + k·sd)) / max(s·sd, gulv) )
loft_i       = afrund( evne_i + headroom(potentiale) · (off + (1 − off)·sig_i) )
fald_i       = sig_i · fald(speciale) + (1 − sig_i) · fald(øvrig)
```

Vækstkurve, `headroom`, fald-tabel, topalder og den **frosne potentiale-rate** er præcis v4's. Paritetstesten viser at `stepTypefree` regner bit-identisk med `expectedNextAbilities`, når den får v4's type-faktorer. Det eneste der ændres, er altså hvor speciale-graden kommer fra.

### 2.3 Markedskomponent (R4)

Pr. kvalificeret handel: `r = ln(betalt pris) − ln(V_grund ved handlen)` (evner fra historikken før handelsdagen).

```
fælles(x)  = γ1·(O − Ō) + γ2·(alder − ā) + γ3·(alder − ā)²        (ridge; skæringen γ0 rapporteres, anvendes ikke)
lokal(x)   = Σ K(x,x_i)·(r_i − fælles(x_i)) / (Σ K(x,x_i) + k0)    (Gauss-kerne på evneprofil + alder)
evidens(x) = Σ K / (Σ K + k0)                                        (typefri afløser for computeSupport)
V_marked   = V_grund · exp( clamp( w · (fælles + lokal), ±L ) )
```

- **Kvalifikation (misbrugsfilter):** reglerne fra V2-fittet (≥2 menneske-budgivere og hævet pris, forhandlet kun menneske↔menneske, ingen garanteret salg, par med gentagne handler ud) plus #3818 `computeDirectionalStrength` (ensrettede par ud) og #3438/#3231 `computePriceOutlierStrength` mod niveaujusteret grundværdi.
- **Holdout:** fit på handler før fit-datoen, test på handler efter. Tuning (kerne-bredde, krympning, ridge) sker på en indre tidsdeling af træningsdata.
- `w` (markedsvægt) og `L` (loft pr. rytter) er ejer-valg. `computeSupport`s kontrakt ændres: same-type-matchet erstattes af `evidens(x)`.

## 3. Hvad målingen viser (kvalitativt; tal i privat rapport)

| Egenskab | Resultat |
|---|---|
| Typebyte → samme værdi | ✅ 0 afvigelser i stikprøven. v4 giver forskellig værdi for alle i stikprøven, typisk med en faktor på flere gange |
| Glathed (+1 evnepoint) | 🟡 Spring på samme niveau som v4 med fast type, og ingen rolleskifte-hop. **Men** i få procent af tilfældene sænker +1 værdien en smule, fordi profil-referencen flytter sig. Rettes i build (reference uden evnen selv) |
| Forklaringskraft på simuleringen | ✅ Den typefri funktion forklarer simuleret præmie bedre end v4's type-keyede funktion, også på en holdout-halvdel |
| Markeds-holdout | ✅ Grundværdien alene rammer betalte priser mindst lige så godt som v4. Fælles+lokal forbedrer lidt. Det lokale led er kun reelt aktivt for unge, fordi handlerne ligger der |
| Omfordeling | ⚠️ Puncheurer og brostensryttere falder markant (v4's største type-tillæg forsvinder). GC, sprintere og rouleurer stiger. Unge 22-29 stiger mest |
| Krone-niveau | ⚠️ Med v4's omregning uændret falder medianen tydeligt, fordi den nye simulering betaler mindre pr. rytter end den v4 blev fittet på. Se ejer-valg 1 |
| Løn (CPV) | Egen kontrakt. Ikke sammenlignelig før niveau-valget er truffet |

### Scorecard: eksisterende regressionsgrænser (hver for sig)

| Grænse | Resultat |
|---|---|
| Skala-kontinuitet (median ±15 %) | Grøn ved niveau B (tautologisk: B holder medianen), rød ved niveau A |
| Elite ukøbelig (gammel formulering) | Rød. Forventet: den forudsatte elitegulvet, som er låst væk. **Omformulering:** "ingen overall ≥ 55 er billigere end medianen for overall 45-54" (rangorden, intet beløb) → grøn |
| Udvikl-og-sælg | **Rød.** Net-positiv, men ROI over loftet: den typefri prognose giver unge med højt potentiale stærkere vækst i værdi end v4. Skal løses før build (kandidat: signatur-referencen, eller at potentiale-headroom kun gælder profil-styrker) |
| Determinisme | Grøn (fast start, ingen tilfældighed; input-hash i rapporten) |

### Nye kvalitetsmål (rapporteres separat)

Typebyte-ækvivalens, rolle-tie-glathed, kontanter og rytterværdi hver for sig pr. menneskehold, tabsliste (menneskehold-ryttere der taber over halvdelen), fælles/lokal indflydelse pr. aldersgruppe og niveau-bånd, samt markeds-holdout med og uden prisafvigelses-filteret.

## 4. Build-plan når ejeren har sagt "godkendt til build"

1. Nyt model-id (`v6-typefree`) i `riderValuationModelSelect.js` `MODEL_PATHS` + model-JSON. v4-stien og `valuationTypeFor` skal forblive bit-identiske (faldgrube 1-2).
2. `computeSupport` → `evidens(x)`; `marketValueModelV2.type_column` udgår for den nye model.
3. `eliteUnbuyableGate` omformuleres (ovenfor). Type-økonomi-tabellen erstattes af typebyte-ækvivalens.
4. R1: referenceprogram på S4-kalenderens tørkørsel **uden** uniform tilt (#5405). Programandelene sættes fra den, og fittet genkøres.
5. 1c admin-forhåndsvisning → 1d visning (#5435) → #5461 kørselsdag med backup/rollback (ECONOMY_RULES §9).

## 5. Begrænsninger

- **R1 mangler:** programmet er S3/v3-simuleringens kalender. S4-tørkørslen uden uniform tilt (#5405) er ikke leveret endnu. Programandelene er derfor lige vægt og ikke den faktiske terrænfordeling.
- v3-simuleringen udtager kaptajner efter type. Præmiefordelingen, der fittes mod, bærer derfor stadig et typespor. v4-hjælperprøverne (hold-point/støtte) er metodeprøver på et ikke-godkendt program og indgår ikke i fittet.
- Markedsdata: handler i et afgrænset vindue. Potentiale læses fra snapshottet og ikke fra handelstidspunktet. Holdout-sættet er lille.
- Populationen er et S3-snapshot og ikke prod i dag. Ingen prod-læsning og ingen skrivninger.
