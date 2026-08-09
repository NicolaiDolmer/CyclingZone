# Progressionskæden samlet: potentiale → loft → type → værdi → løn (#3564)

**Status:** v0.3 — harness-runden GENNEMFØRT 9/8 aften (10-agent workflow + egne verifikationer; resultater i §11). Alle 15 porte implementeret + negativ-testet (PR [#3567](https://github.com/NicolaiDolmer/CyclingZone/pull/3567) merged). Alle 5 ejer-beslutninger fra §8 står, MEN harness-runden har rejst 4 nye ejer-beslutninger (§11.5, stilles én ad gangen) — trin 1-migrationen og trin 2-kalibreringen er blokeret på dem.

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
- **Referencepopulation:** de 384 rene akademi-kandidater kan identificeres eksakt (`academy_intake status='offered'`, oprettet <9/8; alle uden hold/condition/træning). **Forlig 9/8 aften:** "bedste evne snit 19,4/median 18" er målt over ALLE 15 evner og domineres totalt af aggressions aldersgulv (aggression alene: 19,33/18); over de 10 FYSISKE evner er tallet 9,40/9. Brug altid 10-fysiske-definitionen som reference. **Forlig 2:** "224/248 pot-6 ejede" = human (166) + AI (58); frie = 24 — human-ejede alene er 166.

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

**Trin 2 — vækstkurven** (#2698 · træningsscore · udviklingshastighed · #3459-kobling · beslutning 4-5, BEGGE LÅST 9/8)
Indhold: kontinuert absolut-niveau-kurve i motoren (gap-relativ logik udfases som primær driver); potentiale som multiplikator på daglig trænings-kvalitet; træningsscore 1-99 (privat, synlig pr. dag + 30-dages historik) som det led udviklingen afledes af; race-day-motorens devMult 1,15 indregnes; UI/hjælpetekster formidler trinbånd. Designmål: max nås ~27 år.
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
- [x] 2 (ejer 9/8): **#2798 = A + remap-koblingen** — potentiale-leddet fjernes fra PUBLICERET værdi for <22-årige uden handelsevidens (synlige evner + alder + type); fuld model forbliver intern. AI-bud på ungdom kører også på offentlig værdi (ellers bliver budadfærd ny sidekanal). Rækkefølge i trin 1: offentlig-pris-fix FØR 1-6→1-99-remappen rammer prod. Konsekvens-sim af de ~1.200 unge priser før ship (port i trin 4).
- [ ] 3: …
- [x] 3 (ejer 9/8): **Ét potentiale pr. rytter + 8 type-loftprofiler.** Rytteren har ét skjult 1-99-tal; hver ryttertype definerer en kalibreret profil for hvordan tallet fordeles over evne-grupperne (erstatter de grove rollefaktorer 1,0/0,82/0,45/0,12; skærpes ved højt potentiale → løser #3503). Scouting forbliver ét estimat.
- [x] 4 (ejer 9/8): **#2698 = kontinuert absolut-niveau-kurve i motoren** ("jo højere niveau, jo langsommere vækst"); trappetrins-sprog KUN i hjælpetekster/UI. **Potentialet ganger ind på den daglige trænings kvalitet** (jo bedre potentiale, jo bedre daglig træning). **Hårdt designmål (ejer-citat): ryttere når deres max omkring 27 år — færdigudviklet ved 20-21 er en fejltilstand.** Kalibreres mod skelettet (§5).
- [x] 5 (ejer 9/8): **Træningsscore = synlig daglig score 1-99 pr. rytter** ("hvor god var dagens træning") med 30 dages historik-visning; **udviklingen afledes af scoren**: score = f(potentiale, alder, intensitet, form/træthed, faciliteter, fokus) → evne-gevinst = f(score, absolut niveau). Byggesten: `tickResult.score` (normaliseres til 1-99, persisteres, UI). **Design-antagelse (Claude, ikke modsagt):** scoren er PRIVAT for ejeren af rytteren, og dagsstøjen er stor nok til at talent-signalet kræver uger — talent-opdagelse tjenes gennem eget akademi-arbejde (gameplay-kanal) i stedet for den lukkede værdi-sidekanal. Offentliggøres scoren, genåbnes #2798 ad bagdøren.

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

## 11. Harness-runden 9/8 aften (v0.3) — resultater og nye beslutningspunkter

Workflow `wf_8830557f-820` (10 agenter: dateret prod-snapshot + frontloading-krydsmåling + remap-dry-run + #2798-sim + gates + kurve-harness + 3 research-spor + kritiker). Alle resultater egen-verificeret ved genkørsel i main checkout.

### 11.1 Porte (leverance 1) — ✅ leveret, merged

15 porte i `backend/scripts/dev/lib/progressionGates3564.mjs`; bevis i `gates3564NegativeProof.mjs`: **hver port fejler på ≥1 kendt defekt (F1 7/8-config · F2 9/8-underkorrektion · F3 frontloaded motor · F4 dateret prod-stock · F6/F7 syntetiske) OG består F5 (sund reference).** `checkYouthBand2064.mjs` rettet til tosidet check — dagens config rapporteres nu korrekt UNDER MÅL. Halemasse forligt: diskret 1-6-hale P(≥5,5)=0,322 % ≠ kontinuert 1-99-hale P(≥90)=0,201 % (`continuousTailProbability99`) — brug den rigtige pr. skala. Rest: T4-gates er testet på abstrakte før/efter-arrays, ikke wiret til ægte værdikæde (planlagt afhængighed for trin 4); hale-gates kræver stokastisk population (trin 3-afhængighed); gate-lib mangler egne `node --test`-filer.

### 11.2 Frontloading prod-krydsmålt (leverance 2) — ✅ delvist bekræftet, skarpere end sim

Prod kan ikke afprøve flerårs-banen (max 48 kalenderdages motor-vækst siden 22/6), men fænomenet er bekræftet og **trænings-dage-gated, ikke alders-gated**: +11-35 pp %-af-loft på ~20-41 dage, SAMME tempo pr. dag for 16- og 20-årige; enkelte ryttere allerede på 86-97 % af loft efter 48 dage. En median/p90-gate ville bestå i dag mens halen allerede fejler — bekræfter §4.2. Motor-livscyklus-sim (F3) reproducerer "pot-6 ~94 % af loft ved 19". Anbefaling til trin 2: overvej trænings-dage-siden-generering som supplerende gate-akse.

### 11.3 Kurve-harness (leverance 3) — ✅ fit fundet, 2 strukturelle fund

`curveHarness3564.mjs`: S = 1-99-score af (Q × potMult × ±15 % støj); delta = A×(S/50)^β × 1/(1+(L/L0)^γ) × (1−L/cap)^0,3. **Fit: A=0,7 · L0=9 · γ=0,6 · β=1,6 · softLoftExp=0,3** — alle §5-ankre inden for ±15 % (22-års-søjlen +3-13 %, 28-års −2-4 %), %loft@22 64-68 %, @25 81-84 %, max ved 28 (off-by-én pga. decline-start), anti-frontloading 19-årig 42-47 % ✅. Kurver visualiseret for ejeren 9/8 aften (ny vs gammel motor pr. potentiale). To strukturelle fund der IKKE kan tunes væk:
- **Specialiserings-gab = 0,0 strukturelt:** 7/8 typer har 2+ evner med rollefaktor 1,0; med én rider-niveau-score får de identiske baner for evigt. Gab-målet (≥2/≥4/≥6) er uopnåeligt i den låste modelfamilie → beslutning D i §11.5.
- **Træningsscore afslører potentiale på 1-3 dage, ikke uger:** potMult-spredningen (±38 %) ≫ dagsstøjen (±15 %). Beslutning 5's privatlivs-antagelse er empirisk modbevist → beslutning C i §11.5.

### 11.4 Trin 1 (leverance 4) — dry-run kørt; migration BLOKERET på beslutning A

- **Remap-dry-run** (`remapDryRun3564.mjs` + [dry-run-rapport](2026-08-09-3564-trin1-remap-dryrun.md)): §6-algoritmen kørt bogstaveligt mod dateret snapshot: 0 rang-brud, 5/6 aldersbånd består ±2pp, stock-gate rammer 0,22 % mod mål 0,20 % — MEN den nedjusterer **88,8 % af hele bestanden** (100 % af alle tiers 2,0-6,0; kun tier 1,0 urørt) og barberer **-27,0 % af total base_value** (607→444 mio.), fordi stock i ALLE tiers er survivorship-tæt ift. friskt-kulds-geometrien. Det er langt bredere end "udligning af overskuddet" — ejer-beslutning A i §11.5.
- **#2798-A-sim** (`sim3564_2798_public_price.mjs`): 1.538 <22-årige uden handelsevidens (mod estimatet ~1.213 — definitions-afklaring udestår). Median-delta 0, men p10 −72 %/p90 +60 % (re-fordeling); human-ejede unge −36 % median, frie +34 %; korrelation pct×potentiale r=−0,96. Bisektion: før fix genfindes potentiale (fejl <0,1); efter fix ikke-invertérbar per konstruktion. **KRITISK NYT FUND: `GET /riders/:id` sender `base_value_preview` LIVE-beregnet med SAND potentiale til alle loggede-ind brugere (api.js ~932-973) — en separat lækagevej der SKAL med i PR-0**; `value-trend`-ruten er sekundær kandidat (uauditeret). AI-bud-motor findes ikke endnu (fremtidssikring: skal læse market_value).
- **PR-plan trin 1** (rækkefølge): **PR-0** #2798-A (neutraliseret potentiale-input i predictBaseValueV4-kald for <22 u. evidens + `riderValueRefresh` skriver offentlig værdi + base_value_preview-fix + bisektions-verify) → **PR-1** skala-fundament 1-99 (skala-tolerante læsere, fælles mål-geometri for ALLE generator-stier — OBS: `fictionalRiderGenerator.buildDemographics` bruger i dag tier-intervaller + aldersbonus, IKKE geometrien — skæv estimat-generator på 1-99) → **PR-2** selve migrationen (snapshot → remap+estimat-regen i én kørsel → post-verify T1-N3/T1-H1/I1 → ejer-go på dry-run-diff FØR apply; rollback-SQL skrevet FØR) → **PR-3** #3503-A rollefaktor-eftersyn (efter 23/8). Fictional-preview før/efter blev IKKE leveret: preview-fladen er en afkoblet launch-population uden drawPotentiale (+ v3-model) — accept af udeladelse eller alternativ leverance udestår hos ejeren.
- **Overlever-scan (egen, 9/8 aften):** 0 akademi-skabte loft-brud — #3561-oprydningen var komplet. 362 loft-brud er ALLE 22/6-seed-legacy (inkl. Carlos Lozano 74 mio.) = den kendte klasse til 16/8-verify-beslutningen (§7 pkt. 2).

### 11.5 Nye ejer-beslutninger (stilles én ad gangen, rækkefølge = blokerings-orden)

- [x] **A. Remap-afgrænsning (ejer 9/8 aften): variant B — hale-korrigeret remap + fredningsgulv.** Tiers 1,0-4,0 form-bevares (intra-tier-spredning); kun ≥4,5-klassen (961) presses mod planens hale-ankre (≥74,5/≥84,3/≥94,1 = 0,70/0,32/0,11 % pr. aldersbånd). **Ejer-justering efter første diff: gammel 6,0'er aldrig under 80** (fredningsgulv; accepteret hale-overskridelse ≥74,5: 98 mod plan 57 — eroderer ved aldring, flow følger geometrien). Dry-run: 470 nedjusterede (kun pot 5,0-6,0), −7,4 % værdi (mod bogstavelig variants 7.243/−27 %), 0 rang-brud, ≥84,3/≥94,1/stock-gate på plan. Rapport: [trin1-remap-dryrun](2026-08-09-3564-trin1-remap-dryrun.md). **Åbent delspørgsmål:** analogt gulv for 5,5 (nu hårdest ramt, → ~70; hul 75-79) eller kun 6,0-fredning? Migrations-målet for PR-2 = variant B m. gulv; T1-N3 omdefineres til hale-ankre + form-bevarelse + frednings-undtagelse.
- [ ] **B. §2a vs §5-konflikten (blokerer trin 2-kalibrering):** bevist af to uafhængige spor: population-bred §2a-median kan ikke nå "bedste 6" når 83 % af massen er pot ≤2, OG §5-skelettet krydser §2a's graduerings-12 allerede ved 16,8-18,7 år. §2a's 20-21-anker 12/12 = LOFTET ved dagens bånd (gab matematisk umuligt; 96,9 % nul-gab målt). Valg: (a) §2a omfortolkes til per-tier-medianer, (b) 20-21-ankeret flyttes under loftet via båndudvidelse (sim-evidens: statCeil 58 + base 49 + slope 1,3 + luck 0,8 → graduering ~15/21, nul-gab halveret til 46 %), (c) §5 nedjusteres. Anbefaling: **a+b sammen** (per-tier-mål + moderat båndudvidelse; genåbner §2a-ankeret = eksplicit ejer-sag).
- [ ] **C. Træningsscorens privatliv (blokerer beslutning 5-implementering):** "talent kræver uger" er modbevist (1-3 dage). Valg: (a) dagsstøj op til ±40-50 %, (b) potMult-spredning ned, (c) acceptér hurtig aflæsning (genåbner reelt #2798 ad bagdøren). Anbefaling: **a** (+ genkør harness med valgt støj FØR konstanterne låses).
- [ ] **D. Specialiserings-gab (blokerer gab-portene):** (a) lille pr.-evne-støjkomponent i score→gevinst-leddet, (b) gab-mål redefineres for multi-signatur-typer (bedste-primær vs bedste-neutral), (c) overlades til beslutning 3's type-loftprofiler. Anbefaling: **a+c** (støj giver mikro-variation nu; profilerne bærer den ægte differentiering).
- Derefter (ikke-blokerende): type-peaks-tabellen (research-forslag: sprinter 26 · rouleur/puncheur/climber 27 · tt 28 · gc/brosten/baroudeur 29; hybrid-anbefaling: godkend RETNINGEN, implementér som egen slice efter #3564) · scouting-rollen (anbefaling: Model B udvidet — dybde-rapport pr. evne + peak-prognose; afhænger af C) · fictional-preview-udeladelsen.
