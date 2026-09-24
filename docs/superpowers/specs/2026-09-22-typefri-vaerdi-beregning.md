# Forslag til beregning: typefri rytterværdi med marked (#5497, R2-R5)

Status: **v3 (25/9): den samlede model er bygget bag nøglen `v6`, dev-only. Ikke godkendt til build.** app_config peger stadig på v4; intet flag er flippet. Se afsnit 0. Afsnit 1-6 er forslag v2 (23/9) og gælder uændret for selve beregningen.

## 0. v3: hvad der er bygget (25/9)

Ejer-direktiv 24/9: modellen der går live har alt med fra start, så spillerne ikke oplever at den laves om igen og igen. Typefri grundværdi, elitepræmien i trin og markedet ligger derfor i én model under én nøgle.

**Nøglen.** `v6` i `riderValuationModelSelect.js` (`MODEL_PATHS`, `VALUATION_MODEL_IDS`). Model-filen er `backend/lib/riderValuationModelV6Typefree.json` med de fittede parametre fra målescriptet (samme tal som den private model-fil). Fail-safe er uændret: alt ukendt og enhver læsefejl giver v4. Løn-nøglen (`rider_production_value_model`) accepterer ikke `v6` og falder tilbage til v4.

**Kaldestien.** `recomputeRiderValue` genkender den typefri model og regner prisen med `valueTypefree`: typefri grundværdi, elitepræmien på det valgte trin, markedsfaktoren ovenpå. `predictBaseValue` (rytterkort, backfill, progression) dispatcher også, på det trin loaderen har lagt på modellen (se "Trin-tælleren"). v4 og v5 er bit-identiske med før.

**Trin-tælleren (25/9, indfasningsplanen §5 valg 1).** app_config-nøglen `rider_value_phase_step` (heltal 0-4, manglende/ugyldig = 0, uden for intervallet klemmes) er det trin der **sidst er skrevet** til rytterne.

- Den ekstraordinære kørsel sætter den til 0 ved `--apply`, som første skrivning. Tørkørslen rører den ikke.
- Søndagskørslen læser den strikst og regner hele populationen med **nøgle + 1** (loft 4). Er prisen `v6` og refresh'en fuldført, skrives trinnet tilbage i samme afslutning som `completed_at`. Under v4/v5 røres nøglen ikke. En læsefejl frigiver dagen som enhver anden refresh-fejl; en fejlet op-tælling lader nøglen stå, så præmien bliver et trin længere, aldrig et trin for tidligt væk.
- Hvorfor "sidst skrevet" og ikke "næste": søndag 1 skal være 75 % (indfasningsplanen §2), og læse-fladerne kan bruge nøglen direkte som det trin databasen står på.
- Loaderne (`loadValuationModel`, `…Strict`, `…Cached`, `…ByIdWithMarket`) lægger trinnet på v6-modellen som `current_phase_step` sammen med markeds-fittet. `valueTypefree`, `predictBaseValue` og `recomputeRiderValue` bruger det, når kalderen ikke sender et eksplicit `phaseStep`; et eksplicit trin vinder altid. `refreshChangedRiderValues` sender altid sit eget trin (default 0), så et gemt trin aldrig tavst overtager en skrivende kørsel.
- Søndagens log-linje (cron) viser `model · phase step N · production_value changed: N` til post-verify i Railway.
- Rollback: nøglen nulstilles til 0 sammen med model-nøglen (runbooken #5443).

**Gamle læsere (reviewer 24/9).** Rytterkortets forventede pris og base_value-previewet (`predictBaseValue` via `loadValuationModelCached`) og sæson-transitionen (`riderProgressionEngine`, via `loadValuationModelStrict`) regner nu på samme trin som søndagen senest skrev, ikke trin 0. Admin-ruten `/admin/rider-valuation-preview-v4` kaldte `predictBaseValueV4` direkte og gav null for v6; den kalder nu `predictBaseValue`, som for v4/v5 dispatcher til præcis samme funktion (test). Sæson-transitionen med en pinnet v6 trækker ikke længere løngrundlaget med: det slås op med løn-nøglen, som aldrig giver v6. Løngrundlaget er dermed v4 på alle stier.

**Kontrakten med admin-forhåndsvisningen (#5686).**

```
recomputeRiderValue(riderRow, abilities, baseline, model,
                    { typeAbilities, youthBaseline, productionModel, phaseStep })
```

- `model`: `loadValuationModelById("v6")` virker uden opsætning, men **uden marked**. Skal markedet med, hentes modellen med `await loadValuationModelByIdWithMarket(supabase, "v6")`.
- `phaseStep`: 0-4 = antal søndagskørsler siden kørselsdagen (0 = fuld præmie, 4 = ny normal). Default 0. Uden for intervallet klemmes den ind; ugyldigt giver 0.
- Returnerer de samme fire felter som før. For v6 kommer `valuation_components` med: model-id, grundværdi før marked, markedsfaktor, om markedet var med, trin og præmie-faktor. Det er det admin-siden kan vise som "før/efter" og "hvor meget kommer fra markedet".
- `current_production_value` regnes altid med v4 for v6 (eller med den `productionModel` kalderen sender). Lønnen følger ikke værdien.

**Markedet.** Vægt, loft og selve markeds-fittet (fælles led + lokal kerne) er ejer-valg og afledt af rigtige handler. De står aldrig i repoet. De bor i app_config-nøglen `rider_valuation_v6_market`, som loaderen lægger på modellen som `market_fit`. Formen er `serializeMarketFit` / `hydrateMarketFit` i `marketComponent.js`; målescriptet skriver den som privat fil. Mangler nøglen, regner v6 uden marked og siger det (`market_applied: false`). Søndagskørslens strikse læsning stopper, hvis nøglen ikke kan læses.

**Tørkørslen.** `valuationV5DryRun5443.mjs --to=v6 --step=N --market=<privat fil>` regner hele prod-populationen read-only gennem `recomputeRiderValue` og skriver en trin-rapport under `balance-internals/`: population på alle fem trin, managerhold, løn, typebyte, +1-glathed og udvikl-og-sælg.

**Tørkørsel mod prod 24/9 (kvalitativt; tal privat):**

| Kontrol | Resultat |
|---|---|
| Løngrundlag flyttet | ✅ Ingen ryttere, på alle fem trin |
| Menneskeholds ryttere ændrer sig | ✅ Alle får ny pris på kørselsdagen. Omkring hver tredje stiger, resten falder |
| Typebyte | ✅ 0 afvigelser på alle fem trin |
| +1 evnepoint, grundværdi | ✅ Falder i under hver hundrede test |
| +1 evnepoint, med marked | 🟡 Markedsleddet giver små udsving: prisen falder i omkring hver syvende test, næsten altid under 1 % |
| Udvikl-og-sælg, ikke dominant | ✅ Grøn på alle fem trin |
| Udvikl-og-sælg, net-positiv (dyreste prospect) | Grøn på trin 0-3, rød i den nye normal (afsnit 4 punkt 1, ejer-valg) |

**Menneskehold.** Intet i stien kigger på hold. En rytter på et managerhold regnes præcis som en fri eller en AI-rytter, og søndagskørslens diff skriver ham (test + tørkørsel).

**Hvad v3 IKKE dækker:**

1. **Den ekstraordinære kørsels model-lås.** `riderValueExtraordinaryRun5443.js` kræver stadig `rider_valuation_model = 'v5'` og nægter derfor at køre med `v6`. Det skal rettes, før kørselsdagen kan køre den samlede model (uden for dette spor).
2. **Markeds-fittet i prod.** Nøglen `rider_valuation_v6_market` findes ikke endnu. Den skrives først efter ejerens "kør" (et prod-skridt med tal, ejer-gated). Indtil da viser admin-siden v6 uden marked, medmindre fittet gives direkte.
3. **Gaterne.** `eliteUnbuyableGate` og udvikl-og-sælg-gaten er ikke omformuleret (afsnit 4 punkt 1 er stadig et ejer-valg).
4. **R1** (S4-programmet) og en re-fit af markedet efter udfasningen (afsnit 6).
5. **Trin-nøglen i prod.** `rider_value_phase_step` findes ikke endnu (= 0). Den skrives første gang af den ekstraordinære kørsels `--apply`.

Tal og navne står kun i de private rapporter (`balance-internals/2026-09-24-5497-typefree-v3/`, `balance-internals/2026-09-24-5497-v6-dryrun-trin0/`) og i ejerens private valg-fil. Låste beslutninger i #5497 genåbnes ikke.

## 1. I hverdagsord

En rytters pris = **hvad han forventes at tjene resten af karrieren** (som i dag), men regnet uden at kigge på hans type:

1. **Grundværdi fra evner.** Vi måler hvor godt rytteren passer til hvert terræn i ét fælles sæsonprogram (bjerg, tempo, sprint, brosten, bakker osv.) med de samme opskrifter som rating-kortet. Han bruges der hvor han gavner mest. Det giver én "effektiv evne", som omsættes til forventet præmie pr. sæson med én fælles kurve, fittet på en hel simuleret sæson. Intet tillæg eller fradrag pr. type.
2. **Typefri karriereprognose.** Fremtidige evner fremskrives med den samme vækst-, fald- og potentialekurve som i dag. Det nye: hvilke evner der er "rytterens styrker" læses af hans egne evner, målt mod hans **øvrige** evner. Kun styrkerne får plads til at vokse, ligesom typens specialer gør i dag. Der deles lige så meget vækst-plads ud i alt som i dag; kun fordelingen mellem evnerne er ny.
3. **Marked oven på.** Betalte priser fra rene handler justerer de relative priser: et fælles led (fx "markedet betaler mere/mindre for alder og niveau end modellen") og et lokalt led (ryttere der ligner hinanden). Markedet må kun flytte en rytters pris en smule og aldrig mere end et loft. Mistænkelige handler sorteres fra med de detektorer der allerede findes.
4. **Elitepræmien udfases.** Præmien for de allerbedste falder med en fjerdedel pr. søndagskørsel. Efter fire uger er eliten prissat på præstation alene. Alt andet skifter på kørselsdagen.

## 2. Formler

### 2.1 Grundværdi (R2)

For terræn *p* med rating-opskrift *R_p* (`weights/displayRecipes.js`) og programandel *share_p*:

```
O_tf(evner) = alpha · (1/beta) · ln( Σ_p share_p · exp(beta · R_p(evner)) ) + (1 − alpha) · snit(evner)
prod(O)     = exp(a + b·Ō + c·Ō²),  Ō = min(O, toppunkt hvis c < 0, output_max)
              (output_max = største O i fit-stikprøven; kurven er flad derover)
V_grund     = niveau · præmie_t( skala · Σ_s diskonto^s · S_s · prod(O_tf(evner_s)) )
```

- Ét fælles niveau-led; `offset[type]` findes ikke.
- Den bløde maksimum er kontinuert i evnerne. Der er ingen rolle-label, som kan skifte.
- `a, b, c, beta, alpha` fittes deterministisk på ln(forventet præmie) fra sæson-simuleringen (samme mål som v4-fittet). **Programandelene er låst** (lige vægt pr. terræn indtil R1).
- **Krone-niveau (ejer-valg 22/9: A):** skala og niveau-korrektion er v4's uændret. Der findes ingen median-match. Diskonto, overlevelse, alders-grænser og niveau-korrektion (#3449) er uændrede fra v4. Elite-**gulvet** er fjernet (låst).

### 2.2 Typefri karriereprognose (R3), v2

For hver evne *i*, ud fra rytterens start-evner:

```
reference_i  = én af to former, begge af rytterens ØVRIGE evner (uden i):
                 soft_max_others: blød maksimum(øvrige; tau) − forskydning,   bredde fast
                 leave_one_out  : snit(øvrige) + k · spredning(øvrige),       bredde = max(spredning · s, gulv)
sig_i        = logistisk( (evne_i − reference_i) / bredde )
loft_i       = afrund( evne_i + headroom(potentiale) · sig_i )
fald_i       = sig_i · fald(speciale) + (1 − sig_i) · fald(øvrig)
```

Den valgte form og dens tal står i `profile_selection.chosen` i den private rapport og i model-forslaget ved siden af. På S3-snapshottet vælger reglen den bløde maksimum.

- **Kun styrker får vækst-plads** (sig nær 1). En tydelig svaghed får næsten ingen, som typens svagheder i dag. v1 gav alle evner mindst mellemniveauets plads.
- **Referencen regnes uden evnen selv.** Et evnepoint hæver derfor altid evnens egen speciale-grad. Den bløde maksimum flyttes næsten ikke af en lav evne. Træning af en evne rytteren ikke bruger, ændrer derfor ikke hans styrker.
- **Form og tal vælges ved en fast regel** i målescriptet, uafhængigt af udvikl-og-sælg-grænsen: samme samlede vækst-plads i populationen som v4 (inden for en lille tolerance), og blandt dem færrest tilfælde hvor +1 evnepoint sænker grundværdien. Kandidaterne (snit + spredning af de øvrige evner, og blød maksimum) står med resultat i den private rapport.
- Vækstkurve, `headroom`, fald-tabel, topalder og den **frosne potentiale-rate** er præcis v4's. Paritetstesten viser at `stepTypefree` regner bit-identisk med `expectedNextAbilities`, når den får v4's type-faktorer.

### 2.3 Markedskomponent (R4)

Pr. kvalificeret handel: `r = ln(betalt pris) − ln(V_grund ved handlen)` (evner fra historikken før handelsdagen).

```
fælles(x)  = γ1·(O − Ō) + γ2·(alder − ā) + γ3·(alder − ā)²        (ridge; skæringen γ0 rapporteres, anvendes ikke)
lokal(x)   = Σ K(x,x_i)·(r_i − γ0 − fælles(x_i)) / (Σ K(x,x_i) + k0)  (Gauss-kerne på evneprofil + alder; γ0 ud, så niveauet forbliver låst)
evidens(x) = Σ K / (Σ K + k0)                                        (typefri afløser for computeSupport)
V_marked   = V_grund · exp( clamp( w · (fælles + lokal), ±L ) )
```

- **Kvalifikation (misbrugsfilter):** reglerne fra V2-fittet plus #3818 `computeDirectionalStrength` og #3438/#3231 `computePriceOutlierStrength` mod niveaujusteret grundværdi.
- **Holdout:** fit på handler før fit-datoen, test på handler efter. Tuning sker på en indre tidsdeling af træningsdata.
- **Ejer-valg 22/9:** lille markedsvægt `w` og et loft `L` pr. rytter. Tallene står kun i ejerens private valg-fil; målescriptet læser dem derfra (`--choices`).

### 2.4 Elitepræmie i trin (ejer-valg 22/9)

```
præmie_t(v, overall) = v · exp( k · f_t · (overall − tærskel) ),   f_t = 1, ¾, ½, ¼, 0
```

- `t` = antal søndagskørsler siden kørselsdagen (`elitePremiumPhaseFactor`, ren funktion med test). Efter sidste trin står den på nul.
- **Kun præmien glider.** Grundværdi, prognose og marked skifter på kørselsdagen (#5461).

## 3. Hvad målingen viser (kvalitativt; tal i privat rapport)

| Egenskab | Resultat |
|---|---|
| Typebyte → samme værdi | ✅ 0 afvigelser på alle fem trin. v4 giver forskellig værdi for alle i stikprøven |
| Glathed, grundværdi (+1 evnepoint) | ✅ Markant forbedret: +1 sænker nu grundværdien i under hver hundrede test (22/9: få procent). Resten er næsten altid tilfælde hvor +1 på en af de bedste evner gør de næstbedste en anelse mindre fremtrædende |
| Glathed, samlet pris med marked | 🟡 Markedsleddet er en relativ korrektion og kan gå begge veje, så +1 sænker den samlede pris i knap hvert tredje tilfælde, men næsten altid med under 1 % |
| Forklaringskraft på simuleringen | ✅ Den typefri funktion forklarer simuleret præmie bedre end v4's type-keyede funktion, også på holdout |
| Markeds-holdout | ✅ Grundværdien alene rammer betalte priser bedre end v4 på det filtrerede holdout. Med prisafvigerne medregnet er de omtrent lige gode. Ejerens lille markedsvægt med loft ændrer næsten intet på holdout (lidt bedre på det ene mål, lidt dårligere på det andet) |
| Omfordeling | ⚠️ Som 22/9: puncheurer og brostensryttere falder mest, GC og sprintere mindst |
| Krone-niveau | ⚠️ Valg A: medianen falder tydeligt (ejer-accepteret 22/9) |
| Elitepræmie i trin | Eliten falder trin for trin mod præstationsværdien. Resten af feltet flytter sig næsten ikke mellem trinnene |

### Scorecard: eksisterende regressionsgrænser (hver for sig, på alle fem trin)

| Grænse | Resultat |
|---|---|
| Skala-kontinuitet | **Rød, ejer-accepteret 22/9 (valg A).** Grænsen er ikke ændret |
| Elite ukøbelig (gammel formulering) | Rød. Forventet: den forudsatte elitegulvet, som er låst væk |
| Elite-rangorden (omformulering fra 22/9) | Grøn på kørselsdagen, **rød fra første udfasnings-trin**: én ældre eliterytter bliver billigere end medianen for niveauet under, når præmien falder. Følge af valg 3 |
| Udvikl-og-sælg: ikke dominant (ROI under loftet) | **Grøn på alle trin** (22/9: langt over loftet på kørselsdagen) |
| Udvikl-og-sælg: net-positiv | Grøn på trin 0-3. **Rød i den nye normal:** den dyreste prospect er allerede prissat på det han bliver, så værdistigningen dækker ikke signeringsgebyr og løn. Medianprospecten er stadig net-positiv. Følge af valg 3, ikke af prognosen (v1 er også rød her) |
| Determinisme | Grøn |

### Rod-årsag til udvikl-og-sælg (22/9)

v1-prognosen havde ingen svagheds-klasse: alle evner fik mindst mellemniveauets vækst-plads. I alt delte den tydeligt mere vækst-plads ud end v4. Den ekstra vækst i svage evner løftede overall, og den konvekse elitepræmie gangede det op ved horisonten. v2 giver kun styrker vækst-plads og samme samlede mængde som v4. Den dyreste prospects forventede overall-stigning over fire sæsoner er nu under v4's for samme rytter (v1 lå over), og ROI ligger under loftet på alle trin.

## 4. Hvad skal til før "godkendt til build"

1. **Ejer-beslutning om de to grænser valg 3 gør røde** (udvikl-og-sælg net-positiv i den nye normal, elite-rangorden). Anbefaling: omformulér begge til den nye normal (fx udvikl-og-sælg målt på medianprospecten, elite-rangorden alders-justeret) frem for at bevare en rest-præmie, fordi valg 3 netop er "eliten prissat på præstation".
2. Ejeren har set den private rapport for v2 (populationen på alle fem trin, tabslisten og menneskeholdene).
3. R1 (S4-programmet uden uniform tilt, #5405) eller en eksplicit accept af at bygge på det lige program.

## 5. Build-plan når ejeren har sagt "godkendt til build"

1. ~~Nyt model-id i `riderValuationModelSelect.js` `MODEL_PATHS` + model-JSON.~~ **Gjort i v3** (nøgle `v6`, afsnit 0). v4-stien og `valuationTypeFor` er bit-identiske.
2. Markeds-fittet skrives til `rider_valuation_v6_market` (ejer-gated prod-skridt). `computeSupport` → `evidens(x)`; `marketValueModelV2.type_column` udgår for den nye model.
3. Præmie-trin: søndagskørslen (`riderValueRefresh`) læser et gemt trin-tal og tæller det op efter hver kørsel.
4. `eliteUnbuyableGate` og udvikl-og-sælg-gaten omformuleres efter punkt 4.1. Type-økonomi-tabellen erstattes af typebyte-ækvivalens.
5. R1: referenceprogram på S4-kalenderens tørkørsel **uden** uniform tilt (#5405). Programandelene sættes fra den, og fittet genkøres.
6. 1c admin-forhåndsvisning → 1d visning (#5435) → #5461 kørselsdag med backup/rollback (ECONOMY_RULES §9).

## 6. Begrænsninger

- **R1 mangler:** programmet er S3/v3-simuleringens kalender med lige terrænvægt.
- v3-simuleringen udtager kaptajner efter type. Præmiefordelingen, der fittes mod, bærer derfor stadig et typespor.
- Markedsleddet fittes på grundværdien på kørselsdagen (fuld præmie). Når præmien er udfaset, bør det fittes igen.
- Udvikl-og-sælg-grænsen måler én rytter (den dyreste prospect). Fordelingen over alle prospects står ved siden af i rapporten.
- Profil-valget er gjort på S3-snapshottet. Populationen er ikke prod i dag. Ingen prod-læsning og ingen skrivninger.
