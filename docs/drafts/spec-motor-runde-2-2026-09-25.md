# Spec: løbsmotor v4, runde 2 (#5580 indsats model 3 → #5577 sejrstype → #5578 de to umålte ankre)

> Cloud-session 24/9-c. Byggeklar spec, ingen kode. Refs #5580 #5577 #5578 #4914 #5515 #5583. SSOT: `docs/RACE_ENGINE_RULES.md` (§1b intention, §2 mekanik, §7 række 18, §7b ankertabel, §9 flip-krav).
> Linjenumre er fra `main` @ `8c684dc`. Runde 1 (#5576 enkeltstart, #5571 AI-taktik, #5570 holdspecifik jagt) er merget natten 23-24/9 under ejerens betingede go (#4914-kommentar 24/9 kl. 00:37).
> **Hard rule 17:** ingen motor-interne vægte i PR, issue eller denne spec. Tal ligger i `balance-internals/` og deles i chat.

## Formål (én linje)

Indsatstrappen bliver "pris og gevinst" (alle fem trin er rigtige valg), løbsfilmen stempler sejrstypen efter det der skete, og de to ankre uden måling får en værdi og en dom, så flip-klar-rapporten (#5515) kan genkøres uden huller.

## Ejer-beslutninger (citeret)

- **23/9, valg 1 (model 3)** ([#4914](https://github.com/NicolaiDolmer/CyclingZone/issues/4914#issuecomment-5797011227)): "En højere indsats køber position: rytteren holder front- eller stigningsgruppen længere og presser hårdere i finalen, betalt med reserven. Er reserven tom, knækker han og taber mere. En lavere indsats giver slip tidligere [...] Alle fem trin skal være rigtige valg." Låst: work-cost-aksen, model C, M12 på kravet, hale-gaten på 3 seeds, monotoni på samme trin.
- **23/9, valg 1c + 2 (trappen)** ([kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/4914#issuecomment-5797459603)): `protect` = "Arbejd eller angrib"; `all_out`-prisen følger terrænet under hjulene; huller: `all_out`-hjælper tæller ikke som hjælp, AI bruger trappen, én effort-kilde, målingen ser `protect` + holdroller. Realisme-kontrol ejeren godkender før merge: `all_out` er et ægte væddemål på kanten af frontgruppen; `save`/`grupetto` slår aldrig `normal` på en etape der afgøres på stigningerne; ankre + hale-gate holder; favoritraten stiger ikke.
- **23/9, tændingen** ([kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/4914#issuecomment-5798300004)): "ekstra fokus på raceenginen nu [...] bygge den fremragende og langsigtet færdig." #5577 er flip-blokker.
- **#5578** (ejer 23/9, "følg realismen"): udbrudsbåndet sættes ud fra virkelige udbrudsrater pr. terræn (research med kilder) og godkendes af ejeren; GC-harnessen køres efter ITT-rettelsen.
- **Fund 24/9 nat lagt i #5580** ([kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/5580#issuecomment-5804686141)): (a) på en v4-enkeltstart giver indsatsen aldrig mere fart; (b) indsatsen påvirker ikke trætheden efter etapen (`applyFatigue`/`effortsSequenceForRider` læser kun `race_stage_roles`).

## Hvad koden gør i dag (main @ 8c684dc)

| Emne | Hvor | Fund |
|---|---|---|
| Indsatsen virker kun på kraftkravet | `mechanics/effortCost.ts` (`applyEffortToDemand`), kaldt fra `segmentLoop.ts:63`; tabellen `tuning.ts:596-615` (`EFFORT_COST_EXTRA_TUNING`, `demandMultiplierAllOutByProfile` kun flat/rolling efter #5521) | intet led belønner højere indsats; fart og front følger evnen |
| Stigningsselektion | `mechanics/climbSelection.ts:155-261` (`computeSelections`, `guardedSplitRiderIds`, `grupettoDropBackForced` :61) | kun grupetto har et effort-led (og kun i `effort_weighted`) |
| Finale | `finale.ts:154-200` (`computeFinaleAbilityScore`, `wprimeReserveFraction`), `finale.ts:480-505` (`sprint_decided` udsendes for enhver vindergruppe) | reserven vægter, indsatsen ikke |
| Holdspil | `mechanics/teamPlay.ts:172-190` (`supportShare(workerCount)`), `:304-316` (hjælperens pris, `all_out` => 0) | en `all_out`-hjælper tæller i `workerIds` og giver kaptajnen læ gratis |
| Effort-kilder | `raceStageRoles.js:17-35` (`race_stage_roles`), `raceTeamOrdersApi.js:3-4, 198-252` (`race_team_orders` "eneste sandhed for etapens overlay"), `raceRunner.js:417-425, 478-490` (motoren læser stage-roles; kun når `race_engine_v3_scoring`), `raceRunner.js:2215` (`applyFatigue` med `effortByRider` fra stage-roles) | to kilder, uenige i 3.597 af 14.548 rækker (issue) |
| Sejrstype | `engine/v4/index.ts:166-175` (`PLACEHOLDER_WIN_TYPE = "group_finish"`), `raceNarrative.js:50-51, 205-220` (gap-klassifikation `SPRINT_GAP_S`/`CLOSE_GAP_S`, itt/ttt egen nøgle), frontend `raceReport.js:46-81` (`WIN_MOMENT_KEYS`, `solo`/`bunch_sprint`), fixtures `engine/v4/fixtures/*/expected.json:135` | alle v4-massestarter er `group_finish`; filmen skriver "kampen står mellem X og jagerne" |
| Ankre | `scripts/lib/headToHeadAnchors.js:372-395` (`breakaway_rate_per_terrain`, v4 N/A, bånd `{}` :728), `:563-569` (`gt_winner_margin` N/A), `mechanics/descent.ts:322-325` (`newGroupKind`: nedkørselsangreb med flere ryttere bliver `breakaway`) | 2 af 13 ankre "ikke målt" (#5523) |
| Måling | `scripts/v4EffortTwinMeasure.js:81` (`TWIN_EFFORTS = ["all_out","grupetto","save"]`, `:119` alle `free_role`, `:163/267` `orders: []`), `scripts/headToHeadV4.js:78-100` (`--orders=ai` sætter `Entrant.effort` fra ordren siden #5571) | tvillingerne ser hverken `protect`, `team_id` eller roller |

## Spor M1: #5580 indsats model 3 (B4)

**Gevinsten** (ny, additiv tuning-blok `effortGainExtra` i `tuning.ts`, samme mønster som `effortCostExtra` :602):

1. **Stigningen** (`climbSelection.ts:155-216` `computeSelections`): rytterens split-score får et indsats-led: `protect` og `all_out` sænker sandsynligheden for at blive sat (holder gruppen længere), `save` hæver den lidt, `grupetto` som i dag (`grupettoDropBackForced`). Prisen er allerede der (kravet), så en tom reserve (`energyDeficit01` :145) trækker hårdere end leddet giver: han knækker. Monotoni pr. trin: property-test at `P(sat)` er ikke-stigende i trappen ved samme evne.
2. **Finalen** (`finale.ts:154-200`): `computeFinaleAbilityScore` får et indsats-led på placeringen inden for gruppen, vægtet af `wprimeReserveFraction`; en rytter med tom reserve på `all_out` taber pladser (det er "knækker og taber mere"). `sprint_decided` røres ikke her (det er M2's spor).
3. **`protect` = arbejd eller angrib** (`teamPlay.ts:304-316`): en hjælper på `protect` betaler hjælperens pris i flere segmenter (bliver ved kaptajnen længere: udvid det segment-vindue hvor `helperCostMultiplier` > 0) og kaptajnen får `supportShare` af de arbejdende længere. En leder på `protect` følger angreb: i `breakaway.ts:181-206` (`selectBreakawayRiders`/`joinProbability`) tæller `protect` som et lille plus for kaptajn/leder, aldrig for hjælpere. Holdprisen (work-cost-aksen, `tuning.ts:1001` `effortCostMultiplier`) er låst.
4. **`all_out`-prisen pr. segment** (`segmentLoop.ts:369-372` → `effortCost.ts:87-94`): profilopslaget skifter fra etapens `profile_type` til segmentets `kind` (`SegmentKind`), så en stigning på en "flad" etape koster som en stigning. `demandMultiplierAllOutByProfile` (`tuning.ts:608`) bliver `...BySegmentKind`; #5521's flat/rolling-værdier overføres 1:1 som startværdier for `flat`/`rolling`-segmenter.
5. **Hullet i `supportShare`** (`teamPlay.ts:316`): `team.workerIds` filtreres for `effort === "all_out"` før `supportShare` (en `all_out`-hjælper arbejder for sig selv). Test: kaptajnens bonus falder når hjælperen sættes på `all_out`.
6. **Én kilde til effort:** `race_team_orders.riders[].effort` er sandheden (ejer 21/8, `raceTeamOrdersApi.js:3-4`). `raceStageRoles.js:53-126` (`resolveStageEntrant`) læser ordren først og falder tilbage til `race_stage_roles.effort` kun når ordren mangler; skriveren i `raceTeamOrdersApi.js:241` spejler effort til `race_stage_roles` i samme upsert, så de to kolonner aldrig igen er uenige. Backfill af de 3.597 uenige rækker: read-only rapport først (`backend/scripts/dev/effortSourceDiff5580.mjs`, ny), ejer-go før en `database/` migration (risk:high).
7. **Indsats i trætheden efter etapen** (fund b): `raceRunner.js:2215` `applyFatigue({ effortByRider })` får den RESOLVEREDE effort pr. rytter (samme kort som `se.effort` :489), ikke `effortByRiderForStage(stageRoleOverrides)` (`raceStageRoles.js:199`). Bag `race_engine_v4`? Nej: trætheden er v3-motorens kode i dag, men effort-kilden er den samme for begge motorer, så ændringen gælder når v3-scoring er on (som i prod). **Ejer-port:** det er en synlig ændring for spillerne på v3 (all_out koster mere træthed bagefter). Anbefaling: bag et nyt flag `effort_fatigue_single_source` (off) til flip-dagen.
8. **Måling** (`v4EffortTwinMeasure.js`): `TWIN_EFFORTS` += `protect`, `normal` (som reference); tvillinger får `team_id` + roller (hjælper + kaptajn på samme hold, `:119`); `--orders=ai` som i `headToHeadV4.js:78-100`. Output: pris (tid tabt) og gevinst (pladser vundet) pr. trin pr. terræn, 5 seeds, `balance-internals/`.

**Realisme-kontrol (ejeren godkender måltal før merge, tal privat):** `all_out` vinder pladser for ryttere på kanten af frontgruppen og taber for ryttere med tom reserve; `save`/`grupetto` slår aldrig `normal` på bjerg/kuperet (tvillinger); 13 ankre + hale-gate PASS som §7b; `favorite_win_rate` stiger ikke (den er allerede rød, #5583).

**Filer M1 ejer:** `engine/v4/tuning.ts`, `mechanics/effortCost.ts(.test)`, `mechanics/climbSelection.ts(.test)`, `finale.ts` (kun `computeFinaleAbilityScore` + test), `mechanics/teamPlay.ts(.test)`, `mechanics/breakaway.ts` (kun join-leddet + test), `segmentLoop.ts:369-372` (+ `segmentLoop.effortCost.test.ts`), `raceStageRoles.js(.test)`, `raceTeamOrdersApi.js(.test)`, `raceRunner.js` (kun :2215 + flag), `scripts/v4EffortTwinMeasure.js(.test)`, `backend/scripts/dev/effortSourceDiff5580.mjs`, RULES §1b + §2 (indsats-rækken).

## Spor M2: #5577 sejrstype (B2)

1. `index.ts:166-175` (`buildFinishEvent`): `win_type` klassificeres af motorens egen viden i stedet for placeholderen: `route.finale_type` (`types.ts:133`), vindergruppens `kind` og størrelse ved mål (`finale.ts:480-505` har `placementGroups`/`winnerGroup`), og om gruppen var `breakaway`/`solo` (`descent.ts:322-325` `newGroupKind`, `breakaway.ts`). Mapning til de EKSISTERENDE nøgler: `sprint_win` (vindergruppe ≥ N ryttere og massefinale), `close_win` (reduceret gruppe, 2 til N-1), `solo_win` (gruppe = 1, eller udbrud der holder hjem med 1), `breakaway_survived` som moment ved udbrudssejr med flere, `itt_win`/`ttt_win` som i dag (`teamTimeTrial.ts:396`, ITT efter #5597). N = massespurt-grænsen står i `tuning.ts` (finaleExtra), ikke i spec'en.
2. `finale.ts:491-502`: `sprint_decided` udsendes KUN når `win_type` er `sprint_win`; ellers `finale_attack`/`solo_finish` (findes de? **verificér** `types.ts` TimelineEvent-typerne; ny type kræver bro-mapping).
3. `raceEngineV4Bridge.js` + `raceNarrative.js:205-220`: v4-vejen bruger `finish.params.win_type` fra tidslinjen i stedet for gap-klassifikationen (`SPRINT_GAP_S`), som fortsat gælder v3. Frontend `raceReport.js:62-81` læser allerede nøglerne.
4. Golden fixtures (`engine/v4/fixtures/{bjerg-selektion,flat-massespurt,itt-solo,nedkoerselsfinale,punch-finale-forspring}/expected.json`) regenereres bevidst i samme PR med før/efter-tabel i PR-body: bjerg → `solo_win`/`close_win`, flad → `sprint_win`, punch → `close_win`, nedkørsel → afhænger.
5. Copy: kun eksisterende EN/DA-nøgler (`races.json:1038-1042, 1081`, `dashboard.json:179-184`). Ny copy kun med ejer-go.

**Verify:** fordeling af sejrstyper pr. etapetype på 5 seeds mod v3 (`headToHeadV4.js`) og mod virkeligheden (research: andel massespurter på flade Tour-etaper, solosejre på bjergetaper); løbsfilm på preview med skærmbillede (UI-tekst → ejer-go).

**Filer M2 ejer:** `engine/v4/index.ts(.test)`, `finale.ts` (kun event-udsendelsen :480-505 + test), `fixtures/*/expected.json`, `fixtures.test.ts`, `raceEngineV4Bridge.js(.test)`, `raceNarrative.js(.test)`, RULES §7 række 18. **`finale.ts` deles med M1**: M1 rører `computeFinaleAbilityScore` (:154-200), M2 rører event-blokken (:480-505). Serialiseres: M1 merges først, M2 rebaser.

## Spor M3: #5578 de to umålte ankre (B10)

1. **Udbrud pr. terræn i v4** (`headToHeadAnchors.js:372-395`): definition = vinderen kom fra en gruppe med `kind` ∈ {`breakaway`, `solo`} der blev dannet FØR finale-segmentet og aldrig blev hentet (`breakaway_caught`-events i tidslinjen, `segmentLoop.ts:738`). Nedkørselsangreb udelukkes: grupper født i `descent.ts:322-325` markeres med `origin: "descent"` (nyt felt på `RaceGroup`, additivt) og tæller ikke. Bånd pr. terræn sættes fra virkelige tal (research med kilder: fx andel udbrudssejre på flade/kuperede/bjerg-etaper i Grand Tours 2015-2025) og godkendes af ejeren; indtil da rapporteres værdi uden dom.
2. **GT-vindermargin** (`headToHeadAnchors.js:563-569`): ny harness `backend/scripts/v4GcMargin.mjs` (+ test): 3 pinnede grand tours (etapelister fra `baselines/v4-proxy-stages-2026-09-06.json` grupperet pr. løb; **verificér** at filen har race-id'er, ellers pin 3 GT'er fra S3-kalenderen read-only) × 5 seeds, fast felt, tid minus bonus (`bonusSeconds.ts`), OTL/DNF ude. Output: vindermargin til nr. 2 pr. GT pr. seed → anker 1-8 min (#2415). Kører efter #5576/#5597 (ITT), som er merget.
3. `renderV4AnchorTable.mjs --write` + `buildV4AnchorBaseline.mjs`: kun i B13 (#5515), ikke her; M3 leverer tal i PR-body og `balance-internals/`.

**Filer M3 ejer:** `scripts/lib/headToHeadAnchors.js(.test)`, `scripts/v4GcMargin.mjs` (ny + test), `mechanics/descent.ts` (kun `origin`-feltet + test), `engine/v4/types.ts` (kun `RaceGroup.origin`), `segmentLoop.ts` (kun propagering af `origin` ved merge/split), RULES §7 række 1 + §7b-fodnote.

## Rækkefølge og overlap

| Bølge | Spor | Hvorfor i den rækkefølge |
|---|---|---|
| R2a | **M1** (#5580) | ejer: "#5580 derefter #5577 og #5578"; ejer `tuning.ts` og `finale.ts` først |
| R2b | **M2** (#5577) + **M3** (#5578) parallelt | M2 rebaser på M1's `finale.ts`; M3 rører ikke M1/M2's filer (`descent.ts`/`types.ts`/`segmentLoop.ts` deles ikke med M1: M1's `segmentLoop.ts`-ændring er :369-372, M3's er gruppe-origin i merge/split. **Serialisér alligevel** M1 → M3 på `segmentLoop.ts`) |
| R2c | B13 (#5515) | baseline-JSON + §7b regenereres én gang; flip-klar-rapport genkøres |

Ingen fil-overlap med S4-sporene, chunk-spor 5 (K1-K4) eller billedstationen (#5565).

## Tests (fælles)

- v4-suiten: `node --test --import ./test-setup.js "lib/engine/v4/**/*.test.ts"` grøn i hvert spor (621 på main 24/9).
- Property: monotoni pr. trin (M1), `all_out`-hjælper giver ingen `supportShare` (M1), `win_type` ∈ kendte nøgler for alle fixtures (M2), `breakaway`-origin bevares gennem merge/split (M3).
- Harness: `headToHeadV4.js --seeds=s1..s5` + `v4TailSpread.js --gate` (3 seeds) i hvert spor; `renderV4AnchorTable.mjs --check` må ikke fejle før B13 (baseline røres ikke).

## Risici

1. **Favorit-raten** er rød i forvejen (62-64 %, #5583) og ITT-rettelsen løftede den. M1 må ikke løfte den yderligere; M2 ændrer ikke placeringer, kun stempler.
2. **Effort-backfill** (M1 punkt 6) er en prod-skrivning: ejer-gated, dry-run først.
3. **Fatigue-kilden** (M1 punkt 7) ændrer v3-spillernes træthed: bag flag, flip-dag.
4. **Golden fixtures** fryser bevidst; M2 regenererer dem, M1 må ikke (M1's ændringer må ikke flytte fixtures med alle på `normal`: test som i #5521).
5. **Research-bånd** (M3): et bånd uden kilde rapporteres ikke som PASS (AGENTS.md "et gulv er aldrig en godkendelse").
