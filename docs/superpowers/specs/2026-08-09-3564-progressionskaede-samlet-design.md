# Progressionskæden samlet: potentiale → loft → type → værdi → løn (#3564)

**Status:** v0.1 — research-fase afsluttet 9/8 (14-agent workflow + egne verifikationer). Afventer ejer-beslutning 1-5 (stilles én ad gangen, se §8). Måltal markeret **FORESLÅET** er ikke bindende før beslutningerne er faldet og harness-kørsler har bekræftet dem.

**Anker:** [#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564) · Baggrund: 9/8-hændelsen ([#3561](https://github.com/NicolaiDolmer/CyclingZone/issues/3561)) + postmortem `.claude/learnings/2026-08-09-gates-der-maaler-relativt-fanger-ikke-absolutte-niveauer.md`

---

## 1. Hvorfor én kæde

Ejer-beslutning 9/8: progressionsopgaverne planlægges som ÉN kæde, fordi de rører de samme funktioner (`drawPotentiale` → `buildCapsForRider` → `generateYouthStats` → `dailyAbilityDelta` → klassifikation → værdi → løn). #3561 beviste konsekvensen af at ændre ét led isoleret: `caps = max(potentiale-loft, current)` lod en generatorkonstant overskrive hele potentiale-systemet — 374 defekte ryttere, 1.473.300 refunderet.

## 2. Kæden som den faktisk er koblet (målt i kode, main post-#3562)

| Led | Funktion | Nøglekonstanter (verificeret 9/8) |
|---|---|---|
| 1 Potentiale | `drawPotentiale` (`academyGenerator.js:29-41`) | 11 trin 1,0-6,0, geometrisk decay 0,55/halvtrin (1,0=45,1 % … 6,0=0,11 %). Forlader ALDRIG serveren (`api.js:945,980,1689,1805,13789,13853`) |
| 2 Loft | `buildCapsForRider` (`riderProgression.js:375-385`) | `loftByPotential {1:35, 2:48, 3:60, 4:70, 5:80, 6:88}` × rollefaktor (primær 1,0 / sekundær 0,82 / neutral 0,45 / modsat 0,12) → alders-tapering → **`caps = clamp(max(tapered, current), 0, 99)`** — linje 382's `max()` var rodårsagen til #3561 |
| 3 Startniveau | `generateYouthStats` (`academyGenerator.js:165-274`) | baseStatAt16 47,5 · +1,4 rå/år · boost 0,8 · ceil 54 · damp 1,0 · startLuckSd 0,6. Rå→evne: `round(1+98×(raw-50)/35)` ⇒ rå 50-54 = evne 1-12 (`abilityDerivation.js:105-112`) |
| 4 Vækst | `dailyAbilityDelta` (`dailyTraining.js:89-113`) | base = gap × growthFractionForAge (0,35/0,28/0,18/0,10) / 28 dage, × 8 multiplikatorer: fokus (1,15/1,35/1,60), youthMultiplier (1,5→1,0 v. 16→22), `youthRateForPotential` (0,6→1,35 for pot 1→6), bonus 1,25, ±15 % støj, staff, facility, academy |
| 5 Type | `riderTypes.js` + `riderTypesBaseline.json` | z-score-kontrast mod **VOKSEN-fittet** baseline (n=8.266). time_trial z=-1,92 for ungdom ⇒ typer der straffer TT får gratis bonus |
| 6 Værdi | `predictBaseValueV4` | Karriere-NPV, læser `valuation_type ?? primary_type` — **frosset 4/8 (#3345)**. Strengt monoton i potentiale ⇒ #2798-lækagen (bisektion inverterer potentiale-tier fra offentlig pris, fejl <0,1) |
| 7 Løn | `current_production_value` × divisionssats | D1 0,3029 / D2 0,3238 / D3 0,1481 / D4 0,2087, frosset ved signering (#1309). #3393 (draft) skifter til `15.000×(market_value/100.000)^0,55`, gulv 250 |

**Kædens kritiske egenskab:** typen ændrer BÅDE offset OG hvilke evner der tæller — reklassificeringen 5/8 flyttede totalværdien -24,5 % uden at én evne ændrede sig (#3345). Alt nedstrøms arver enhver ændring opstrøms.

**Decline-ankre (ændres ikke i denne kæde):** peak 28 · decline 1,0/1,8/2,6 pr. sæson · offType ×0,7 · CAP_TAPER 1,0→0,0 over 12 år · pension 36-40 målt på afsluttet sæsons alder (`riderProgression.js:24-61,145-183,280-286`).

## 3. Målt nu-tilstand (prod ghwvkxzhsbbltzfnuhhz, 9/8 + genkørte scripts)

- **Population:** 8.186 (levende under målingen), 3.350 ejede / 3.473 AI / 1.363 frie. D1 er ren AI (503).
- **Vækst:** motorformlen er frontladet — pot-6 når ~76-77 af 88 som 19-årig (genkørt: 75,9); ~95 % af loftet ved 20. Specialiserings-gab kollapser 1,25 (16 år) → 0,11 (21 år); 70 % nul-gab ved 21. (#3564 citerer 1,15→0,39 fra en anden kørsel — samme fænomen, ikke bit-reproduceret.)
- **Ungdomsbånd (nyfødte, post-9/8-kalibrering):** 16-17 kerne 1/bedste 4 mod §2a-mål 3/6; 18-19: 5,5/12 mod 8/12; 20-21: 12/12 (mål 12/12). `checkYouthBand2064` siger "ok", men bunden ligger UNDER aftalen — **hotfixet er formentlig overkorrigeret i bunden** (median-aftale uden nedre niveau-gate, med modsat fortegn).
- **Type:** baroudeur 32,7 % / climber 26,9 % / sprinter 16,1 % / tt 10,1 % / puncheur 5,2 % / gc 4,7 % / brosten 3,0 % / rouleur 1,4 % — mod knaphedsmål 11/17/15/9/13/9/9/17. G1 (ungdoms-genfinding) ≈ 24,5 %; ungdoms-fittet baseline løfter til 75,5 % (sim A, bootstrap-loft 83,8 %). Baroudeur æder ~35 % af prod-ungdomskuldet (før 7/8) og ~70 % af generator-flowet i sim.
- **Potentiale, stock vs. flow:** trækket matcher geometrien (prod-verificeret 19/7), men BEHOLDNINGEN akkumulerer talent: 21,7 % af 16-17-årige har pot 5-6 mod trækrate 1,37 %. **Verificeret 9/8: survivorship, ikke generator-fejl** — af de 68 pot-6 16-17-årige er 65 ejede og 62 via akademiet, skabt jævnt siden 22/6 (managere beholder toptalenter; lav-potentiale udløber og slettes). Gates skal derfor måle FLOW (pr. kuld), ikke stock.
- **Værdi:** median 4.829, p95 276.365. **Top-outliers er legacy fra 22/6-populationen** (verificeret 9/8): 74,0 / 69,2 / 64,2 mio., alle skabt 22/6, alle frie agenter, alle med frosset `valuation_type` ≠ `primary_type` (fx Carlos Lozano, 21 år, sprinter/gc, pot 4,5, 74 mio.). IKKE 9/8-rester — men designbrudte og skal adresseres af sweep-loftet eller manuelt.
- **Løn:** 4.495/8.151 har salary>0; løn/værdi median 4,0 %, p95 12,2 %, én outlier 111 %. Manager-saldi: 190 reelle, median 763.397, max 1.276.576.
- **Fiktiv population (800, lokal kørsel af preview-modulet):** værdibånd 7/74/117/602 mod mål 12/60/230/500 — solid-båndet halveret ift. design. NB: admin-preview kører **v3-modellen**, ikke live-v4 — misvisende flade.
- **Backfill 5/8:** snapshot-tabel findes (`riders_type_backfill_snapshot_20260805`, 8.176 rækker). 5.234 fik ny primary_type; kun 1.654 fik reel base_value-ændring (median +5,7 %, hale +91,3 % / 3,99 mio.). `updated_at` er UBRUGELIG som audit-markør (98,3 % urørt trods bulk-updates) — **kalibreringer skal ske mod daterede snapshots, aldrig "nuværende DB"**.
- **Referencepopulation:** de 384 rene akademi-kandidater kan identificeres eksakt (`academy_intake status='offered'`, oprettet <9/8; alle uden hold/condition/træning; bedste evne snit 19,4/median 18).

## 4. Designprincipper (bindende for alle trin)

1. **Forholds-gate kræver søster-niveau-gate.** Ethvert mål formuleret som forhold (hit-rate, fordeling, MAE) skal ledsages af en gate på absolut niveau. (#3561-læringen.)
2. **Median-aftale kræver hale-gate.** (7,1 % fødtes på graduerings-niveau mens medianerne så pæne ud.)
3. **…og nedre niveau-gate.** Post-9/8-kalibreringen viser at man også kan fejle NEDAD mod en median-aftale.
4. **Flow, ikke stock.** Generator-gates måler pr. kuld; beholdningen er survivorship-forvredet (21,7 % vs 1,37 %).
5. **Negativ-test:** enhver ny gate skal BEVISES at fejle på den defekte 7/8-konfiguration (som I1-I3 blev).
6. **Snapshot før mutation** + dry-run-diff med absolutte deltaer forelagt ejeren (27/6- + 9/8-læring).
7. **Ren reference:** kalibrér mod utrænede/daterede populationer (de 384), aldrig mod levende DB.
8. **Omdøbning:** de nye invarianter fra 9/8 hedder fremover **I1** (caps ≤ potentiale-loft, 100 %), **I2** (ingen afledt evne > ungdomsbånd 15), **I3** (≤5 % født på graduerings-niveau) — for at undgå navnekollision med #3458-spec'ens oprindelige G6/G7 (Del B-kalibrering hhv. #3448-revalidering).

## 5. Måltal-skelettet (bedste evne ved 16 / 22 / 28 år pr. potentiale)

**MÅLTE ankre (genopfindes ikke):** lofter {35, 48, 60, 70, 80, 88} · §2a-ungdomsbånd (16-17: kerne 3/bedste 6 · 18-19: 8/12 · 20-21: 12/12) · peak 28 · senior-median 21.

**FORESLÅET skelet** (kræver harness-verifikation + beslutning 3-4 før låsning):

| Potentiale | 16 år | 22 år | 28 år (≈loft) | Loft |
|---|---|---|---|---|
| 1 | 4 | 22 | 33 | 35 |
| 2 | 5 | 29 | 45 | 48 |
| 3 | 6 | 36 | 57 | 60 |
| 4 | 6 | 42 | 67 | 70 |
| 5 | 6 | 48 | 77 | 80 |
| 6 | 6 | 53 | 86 | 88 |

Principper bag tallene:
- **16-års-søjlen er bevidst næsten flad** (4-6 uanset potentiale): en 16-årig pot-6 må ikke kunne aflæses på sine tal — det er hele pointen med skjult potentiale (#1138). Differentieringen ligger i VÆKSTHASTIGHED (`youthRateForPotential` 0,6→1,35 findes allerede).
- **Milepæle:** ~60 % af loft ved 22 · ~85 % ved 25 · loft først reelt ved 27-28. I dag: ~95 % ved 20. Kurveformen MELLEM ankrene er beslutning 4 (#2698).
- **Specialiserings-gab-mål (FORESLÅET):** median (bedste − næstbedste) ≥2 ved 16, ≥4 ved 22, ≥6 ved 28 — mod målt 1,25→0,11-kollaps. Pr. type moduleres HVILKE evner der bærer tallene via rollefaktorerne.
- Ungdomsbåndets smalhed (4 rå point = evne 1-12 for seks aldre × seks potentialer × otte anlæg) løses ikke ved at skrue på konstanter men i trin 3, EFTER kurven er valgt — hvor en rytter fødes afhænger af hvor kurven fører hen.

## 6. De fire trin og deres porte

Rækkefølge fra #3564 (ejer-godkendt): potentiale og lofter først, så vækstkurven, startniveauet til ALLERSIDST.

**Trin 1 — potentiale + lofter** (#2454 · #3503 · beslutning 1-3)
Indhold: 1-99-migration + skæv estimat-generator (bygges SAMMEN, jf. beslutning 1); loft-interpolation; fix af `max(tapered,current)`-udvandingen (#3503, ejer-aftalt "A nu, B senere", efter 23/8-cutover); I1 udvides til ALLE ryttere og alle 4 generator-stier (i dag kun academy — #3512's stier har ingen niveau-invarianter).
**Udligning af potentiale-overskuddet (ejer-krav 9/8, del af migrationen):** beholdningen har 11,7 % pot 5-6 mod planens ~1,4 % (målt 9/8: 248 pot-6, heraf 224 ejede + 713 pot-5; før-19/7-kohorten 15,2 %, efter-kohorten 8,7 % — andre generator-stier bruger ikke #2064-geometrien). Migrationen 1-6→1-99 udføres derfor som **rang-bevarende kvantil-remap** mod målfordelingen (geometrien oversat til 1-99), stratificeret pr. aldersgruppe: ingen rytter overhaler nogen, men fordelingens form presses ned på planen. Samme kørsel: scouting-estimater re-genereres mod de nye tal. Krav: snapshot FØR + dry-run-diff med absolutte deltaer (ejede vs. frie, pr. manager) forelægges ejeren før apply — 90 % af pot-6 er ejede, så dette er en manager-vendt mutation. Følgevirkning: værdien falder for nedjusterede ryttere (v4 er potentiale-monoton) — det er tilsigtet, men skal med i dry-run-diffen. Forward-guard: alle generator-stier (ikke kun akademiet) SKAL trække fra samme mål-geometri fremover + stock-gate på fordelingen.
Porte: forhold = G3 arketype-bevarelse ≥90 % pr. potentiale-bånd (skal GENMÅLES post-9/8 — de encifrede tal ved pot 5-6 er fra før rekalibreringen) · niveau = I1 100 % + p99(caps) ≤ loft pr. tier + post-remap-fordeling inden for ±2 pp af mål pr. aldersgruppe · hale = hårdt loft på antal pot ≥90 (1-99-skala) pr. kuld OG i beholdningen.

**Trin 2 — vækstkurven** (#2698 · træningsscore · udviklingshastighed · #3459-kobling · beslutning 4-5)
Indhold: kurveform mellem skelettets ankre; `tickResult.score` (logges allerede pr. rytter/dag i `training_day_runs.report`) som byggesten for en evt. spiller-vendt træningsscore; race-day-motorens devMult 1,15 indregnes.
Porte: forhold/median = median bedste-evne pr. (alder × potentiale) inden for ±15 % af skelettet · **niveau (anti-frontloading) = ingen årgang over aldersbåndets max-%-af-loft (fx 19-årig ≤70 % af eget loft)** — denne gate ville have flaget "77/88 ved 19" · hale = ≤5 % af 21-årige med nul-gab; ≤5 % pr. årgang over 85 % af loft før 24.

**Trin 3 — startniveau/generator** (#3561-re-kalibrering · ungdoms-fittet baseline · baroudeur-fix · #3512 genopbygges)
Indhold: generatoren kalibreres mod hvor den valgte kurve SKAL starte (og §2a-bunden genoprettes — kerne 3, ikke 1); ungdoms-fittet klassifikations-baseline (G1 24,5 → 75,5 %); baroudeur-formel-fix (32→22 %, Kandidat 2 — **afventer stadig eksplicit ejer-go**); #3512's arketype-prior genopbygges oven på den nye kalibrering med I1-I3 på alle 4 stier.
Porte: forhold = G1 ≥ sti-gulv + G4 ingen type <5 %/>30 % (flow pr. kuld) · niveau = I2 + "ingen genereret evne > loftByPotential[pot]" for voksen-stier · median+hale = G2 gab ≥1 + I3 ≤5 %. Plus: **værdi-effekt-sim** af reklassificering på fremtidige kuld (frysningen beskytter kun eksisterende ryttere).

**Trin 4 — værdi + løn på den nye kæde**
Indhold: V4-refit erstattes reelt af markedsmodellen ved global_weight→1,0 (23/8+); #3353 lukkes/omskrives med henvisning til #3448; frysnings-afvikling (`valuation_type` udfases); #2798-fix jf. beslutning 2.
Porte (køres FØR hvert sweep-flip og hver refit): forhold = holdout-MAE bedre end forgænger · **niveau = total market_value ±5 % af snapshot + hårdt enkeltrytter-loft + tier-antal mod prod-kalibreret mål** (IKKE den fiktive 800-populations 12/60/230/500 — kategoriskifte) · hale = p99 pr. aldersgruppe flytter ≤25 % pr. sweep. Løn: sum mod #3360-målene (løn i dag 5,6 % af sponsorindtægt; mål ~85 %), max enkeltløn-loft (genberegnes mod post-sweep-fordeling), ingen løn < gulv 250, p90 løn/værdi-loft (111 %-outlieren må ikke genopstå).

## 7. De fire ventende PR'er — rækkefølge

1. **#3524 (webkit-CI): merge først.** Ren test-infrastruktur, uafhængig af kæden, og NOW.md kræver #3429 løst før alle natbølger. Eneste gate: se PR'ens egen CI grøn (research-agenten her leverede en stub; "376/376 grønne" er syntese-agentens egen kørsel — verificér på PR'en).
2. **#3449 (markedssweep): drejebogen GÆLDER, datoen flyttes 9/8 → søndag 16/8.** Proceduren uændret: merge → migration post-merge → base_value-SNAPSHOT → flip 50/50 → verify → patch note. Før merge: (a) de 8 åbne CodeRabbit-fund (NaN-guard, sweep/trainingSweep-race på søndage, dedup-log efter writes — de to sidste er reelle korrekthedsfejl for netop søndagskørslen), (b) niveau-gates fra trin 4 implementeret i verify-steppet, (c) ✅ fit-renhed VERIFICERET 9/8: `fitted_at 2026-08-06T12:45Z`, defekt-generatoren deployet 7/8 (PR #3500) — ingen defekt-rytter kan indgå i fittet (kausalitet, ikke kun datering). Konsekvens af udskydelsen: én mistet 50/50-uge; ±25 %-loftet fortsætter ugentligt efter 23/8. NB: legacy-outliers (74 mio. m.fl.) trækkes kun langsomt ned af ±25 %-loftet — beslut ved 16/8-verify om de skal håndteres manuelt.
3. **#3393 (løn): 23/8 som planlagt.** Forbliver draft til efter 16/8-sweepen; anchorValue=100.000 SKAL re-checkes mod post-sweep-fordelingen før `salaryBasisRecompute --apply` (kalibreret mod 5/8-tal). Ejer-låste valg står (eksponent 0,55, ingen indfasning for de 17 D2-hold).
4. **#3512 (arketype-prior): forbliver parkeret.** CONFLICTING, 40 commits bagud, kalibreret mod forældet reference (G1 "95,6 %" → reelt 24,5 %), og dens 3 nye stier mangler I1-I3. Genopstår som implementerings-PR i trin 3. Luk ikke; rebase ikke isoleret. (Worktree `feat-3458-archetype-gen-pr2` bevaret.)

**23/8-dagen** (markedsvægt 1,0 + løn + race-day-flip + mandat-migration) mangler fortsat en skreven rækkefølge- og rollback-plan pr. komponent — skal skrives FØR dagen, som separat drejebog.

## 8. Åbne ejer-beslutninger (stilles én ad gangen)

1. **#2454: eksakt potentiale-tal (1-99) eller range?** — stillet 9/8, se beslutningslog nedenfor.
2. **#2798: sidekanalen.** Værdien er invertérbar til potentiale (v4 bevist; markedsmodellen har f_potentiale=0,2352 — lækagen består). Anbefaling forberedt: fjern potentiale-leddet fra PUBLICERET værdi for <22-årige uden handelsevidens; intern NPV/AI-beslutninger beholder det. Konsekvens-sim mangler (~1.213 ryttere).
3. **"8 potentialer pr. ryttertype":** ét potentiale + rollefaktorer (som i dag, skelettet antager dette) eller 8 uafhængige lofter (kræver helt andet skelet + 8× scouting-kompleksitet).
4. **#2698 kurveform:** cost∝level² vs. trinbånd — formen mellem skelettets ankre. 0 kommentarer siden 19/7.
5. **Træningsscore:** hvad er den en score FOR (spiller-feedback? AI-styring? løn-input?), og hvad påvirker den? `tickResult.score` er byggestenen.

**Beslutningslog:** (udfyldes løbende)
- [x] 1 (ejer 9/8): **A-pakken** — eksakt 1-99 i DB, migration + skæv estimat-generator bygges sammen, #2798-fix er bindende forudsætning før migrationen rulles. **Tillæg (ejer 9/8):** potentiale-overskuddet udlignes ved migrationen — der er lavet for mange høj-potentiale-ryttere ift. planen; se kvantil-remap i §6 trin 1.
- [ ] 2: …
- [ ] 3: …
- [ ] 4: …
- [ ] 5: …

## 9. Kendte huller og forbehold (fra kritiker-gennemgang, skal lukkes undervejs)

- Frontloading er sim-målt, ikke prod-krydsmålt som (alder × potentiale × % af loft) — netop trin 2's gate-tabel. Skal måles før trin 2 låses.
- Prod-alderskurven (median 18→58) er et TVÆRSNIT over generationer, ikke en karrierekurve — ældre ryttere blev genereret højt ved seed. Brug den ikke som vækst-facit.
- G3-profilen pr. potentiale-bånd er ikke genmålt efter 9/8-rekalibreringen.
- Ingen af de NYE gates (trin 0-niveau, anti-frontloading, værdi-niveau, løn-niveau) er kørt endnu — heller ikke som negativ-test. Skal ske i første harness-runde.
- 373 vs 374: admin_log dokumenterer 4+369=373 slettede; #3561 målte 374 defekte. Én rytter uforklaret — formentlig allerede fjernet ad anden vej; bør slås op.
- Baroudeur-tallene: 35,3 % (prod-kuld før 7/8) vs ~68-71 % (generator-flow i sim) — to forskellige størrelser, begge sande; brug flow-tallet for generator-gates.
- GC-guard-konstanter er rekalibreret undervejs (#3325 citerer 57/43/43; koden har 53/53/27; 296 består i dag) — dokumentér gældende sæt i trin 3.
- 23/8-rollback-plan pr. komponent mangler (se §7).
- Pengemængden er større end løn: absorption 17,3 % mod mål 90 %; 8 af 9 godkendte mekanismer (#3360) ligger UDEN FOR denne kæde og skal ikke glemmes.
- `simArchetypeCalibration3458`-sweepet: 0 af 54 konstant-kombinationer består alle gates — bekræfter at trin 3 kræver struktur-ændring (baseline + formler), ikke konstant-tuning.

## 10. Datakilder

Research-rapporter (14 agenter, 9/8): workflow `wf_35feb20d-788` (session-transcript). Prod-SQL: read-only mod ghwvkxzhsbbltzfnuhhz. Scripts genkørt 9/8: `checkYouthBand2064.mjs`, `simYouthClassificationFix3458.js`, `simRiderTypesCapsMeasure.js`, `fitYouthStartLuck3561.mjs`, `youthShowcase3561.mjs`, `simArchetypeCalibration3458.js` (alle verificeret read-only før kørsel). Egne verifikationer 9/8: fit-datering (`marketValueModelV1.draft.json`), top-8-outliers, pot-6-survivorship (68 ryttere dekomponeret).
