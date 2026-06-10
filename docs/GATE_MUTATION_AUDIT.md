# Gate-mutation-audit — kill-rate for launch-gates (#1198)

_Oprettet 2026-06-10 (Refs #1198 + #1144). Genkøres med:_

```
cd backend
npm run gates:mutation-audit          # alle gates
node scripts/gateMutationAudit.js --gate=race   # enkelt gate
```

## Hvorfor

#1144-kommentaren afslørede det klassiske harness-hul: race-dry-run havde 4 fejlede
target-bands men exit 0. Et orakel der aldrig fejler er kun et dashboard. Denne audit
beviser pr. mutant at hver gate faktisk KAN fange en ødelagt spiltilstand — eller
dokumenterer præcis hvorfor den ikke kan (= fund, ikke harness-fejl).

Harnesset er 100 % DB-frit: mutanter konstrueres som midlertidige fil-patches i
worktree (restaureres altid) eller som in-memory fixtures mod de rene lib-kerner.
Baseline-kontrakt: den u-muterede gate SKAL være exit 0 — ellers afbryder harnesset
(en permanent rød gate kan ikke skelne "kalibreret" fra "katastrofalt ødelagt").

## Stramninger landet i samme PR (gør 13/20 mutanter fangbare)

| Gate | Stramning | Fanger |
|---|---|---|
| `scripts/simulateSeasonDryRun.js` | Ny sektion D: strukturelle motor-oracles (`lib/raceDryRunOracles.js`) håndhævet med `process.exitCode = 1`: (1) vinder-⌀ i nøgle-evnen > felt-median pr. terræn, (2) ≥2 distinkte vindere pr. terræn, (3) GC-vinderen har feltets laveste samlede etape-tid (uafhængig genberegning fra stage-rækkerne), (4) værdi-sanity: top-overall-decilen dyrere end bund-decilen. Kalibrerings-bånd (sprinter ≥90 % osv.) er fortsat rapport-only og kan håndhæves med `--enforce-targets` (default off — targets afventer ejer-beslutning, jf. kalibrerings-loggen i scriptet) | race-M1, M2, M5, M6 |
| `scripts/previewFictionalPopulation.js` | Bånd-definitionen flyttet til `lib/fictionalLaunchPopulation.js` (`LAUNCH_VALUE_BANDS`) med superstjerne-grænse = `STAR_RIDER_MARKET_VALUE` (én delt konstant, #1210) + type-mix-oracle (`checkLaunchTypeMix`: alle 9 typer + gulve gc≥30/sprinter≥40) håndhævet ved launch-count 800 | pop-MUT-4, MUT-6 |
| `scripts/fitRiderValuationModel.js` + `lib/riderValuationFit.js` | `evaluateFitGuards`: monotoni-guard udvidet til BEGGE fortegns-kombinationer (også U-kurve b<0/c>0) + hård-bånds-befolknings-guard (0 anchors ≥15M = ordens-guard de facto slukket → exit 1). Warning ved typer uden anchor | fit-VM-M1, VM-M2 |
| `scripts/auditValuationCutover.js` → ny kerne `lib/valuationCutoverAudit.js` | (1) vacuous-truth-guard: 0 aktive ryttere → exit 1, (2) market_value ≤ 0 for aktive → exit 1, (3) check (d) fikset: `market_value` strippes før `calculateRiderMarketValue`-kaldet så fallback-grenen faktisk udøves (var en tautologi der matematisk aldrig kunne fyre), (4) `--expect-fictional`-flag: aktive ryttere med pcm_id → exit 1 (post-relaunch-tjeklisten SKAL bruge flaget) | cut-M1, M3, M4, M5 |
| `scripts/relaunchSeason1.js` + `lib/relaunchOrchestrator.js` | `isProdSupabaseUrl()`: prod-detektion casing-normaliseret (DNS er case-insensitive — `https://GHWVKXZHSBBLTZFNUHHZ.supabase.co` rammer prod, men den gamle case-sensitive substring-match sagde "non-prod" og ville køre fuld destruktiv apply UDEN guard) | rel-M2 |

Alle stramninger har regressionstests (`lib/raceDryRunOracles.test.js`,
`lib/valuationCutoverAudit.test.js`, udvidede `riderValuationFit.test.js`,
`fictionalLaunchPopulation.test.js`, `relaunchOrchestrator.test.js`).

## Kill-rate pr. gate (genereret af scripts/gateMutationAudit.js)

| Gate | Kill-rate | Mutanter |
|---|---|---|
| Race-engine dry-run (#1102) | **4/6** | 🟢 race-M1-total-inversion<br>🟢 race-M2-monopol-sprinter<br>🔴 race-M3-baroudeur-bjerge<br>🔴 race-M4-rolling-classic-spurter<br>🟢 race-M5-vaerdiinversion<br>🟢 race-M6-gc-inverteret |
| Fiktiv launch-population preview (#669/#677) | **2/5** | 🔴 pop-MUT-1-pyramide-kollaps<br>🔴 pop-MUT-2-navnekollision-rng-shift<br>🟢 pop-MUT-4-taerskel-drift-8m<br>🔴 pop-MUT-5-type-offset-tabt<br>🟢 pop-MUT-6-gc-kollaps |
| Værdimodel-fit med ordens-guard (#1101 v3) | **2/3** | 🟢 fit-VM-M1-tomt-hardband<br>🟢 fit-VM-M2-ukurve<br>🔴 fit-VM-M5-anchorlos-baroudeur |
| Værdimodel cutover-audit (#1101 slice 2) | **4/5** | 🟢 cut-M1-runtime-divergens<br>🔴 cut-M2-flad-fordeling<br>🟢 cut-M3-negativ-market-value<br>🟢 cut-M4-tom-population<br>🟢 cut-M5-pcm-overlever-relaunch |
| Relaunch-orchestrator prod-guard (#1103) | **1/1** | 🟢 rel-M2-prod-guard-casing |

### Detaljer pr. mutant

- 🟢 FANGET **race-M1-total-inversion** — Motoren inverteret: dårligste rytter i nøgle-evnen vinder (terrainScore → -s)
  - exit 1 · ❌ ORACLE-BRUD: · - flat: vinder-⌀ i nøgle-evnen (sprint 1) er ikke over felt-medianen (18) — motoren belønner ikke evnen · - rolling: vinder-⌀ i nøgle-evnen (endurance 5) er ikke over felt-medianen (29) — motoren belønner ikke evnen · - hilly: vinder-⌀ i nøgle-evnen (punch 1) er ikke over felt-medianen (26) — motoren belønner ikke evnen
- 🟢 FANGET **race-M2-monopol-sprinter** — Én gudelig sprinter vinder samtlige flade løb (distinkt=1/300)
  - exit 1 · ❌ ORACLE-BRUD: · - flat: kun 1 distinkt(e) vinder(e) på 300 løb (kræver ≥2) — monopol-degeneration · Færdig. Read-only — intet skrevet til prod/DB. Exit-kontrakt: ❌ exit 1 (oracle-/bånd-brud).
- 🔴 SLIPPER IGENNEM **race-M3-baroudeur-bjerge** — Baroudeurer fejer bjergene (intra-gruppe-skævhed skjult af gruppe-bånd)
  - exit 0
- 🔴 SLIPPER IGENNEM **race-M4-rolling-classic-spurter** — Rolling/classic = rene massespurter (terræner uden bånd)
  - exit 0
- 🟢 FANGET **race-M5-vaerdiinversion** — Værdimodellen inverteret: domestique > GC-stjerne (b-fortegn flippet)
  - exit 1 · ❌ ORACLE-BRUD: · - værdi-sanity: median base_value for top-decilen (overall) er 137 ≤ bund-decilens 1223 — værdimodellen er flad/inverteret · Færdig. Read-only — intet skrevet til prod/DB. Exit-kontrakt: ❌ exit 1 (oracle-/bånd-brud).
- 🟢 FANGET **race-M6-gc-inverteret** — GC omvendt: lanterne rouge vinder (kumulativ tid desc)
  - exit 1 · ❌ ORACLE-BRUD: · - GC-vinderen har 5194s samlet etape-gab men feltets minimum er 325s — klassementet er ikke laveste-tid-vinder · Færdig. Read-only — intet skrevet til prod/DB. Exit-kontrakt: ❌ exit 1 (oracle-/bånd-brud).
- 🔴 SLIPPER IGENNEM **pop-MUT-1-pyramide-kollaps** — Superstjerne-tier kollapser (statMean 70.75→66) — bånd langt fra targets
  - exit 0 · bånd 1/75/207/517 vs targets 12/60/230/500 — bånd-tolerance er ejer-beslutning, rapport-only
- 🔴 SLIPPER IGENNEM **pop-MUT-2-navnekollision-rng-shift** — DB-navnekollision forskyder RNG-strømmen — certificeret ≠ shipped population
  - certificeret 12/68/203/517 vs 1 kollision 13/84/187/516 — gaten har intet --existing-names-input og kan pr. konstruktion ikke se det
- 🟢 FANGET **pop-MUT-4-taerskel-drift-8m** — STAR_RIDER_MARKET_VALUE ændres uden at bånd-definitionen følger med
  - bånd-grænsen fulgte konstanten til ≥10.000.000 — drift er strukturelt umulig (delt konstant via LAUNCH_VALUE_BANDS)
- 🔴 SLIPPER IGENNEM **pop-MUT-5-type-offset-tabt** — Model-refit taber sprinter-offsettet (alle sprintere ÷2,9 i værdi) — bånd ser BEDRE ud
  - exit 0 · bånd 11/61/210/518 (certificeret 12/68/203/517) — per-type værdi-niveau er ikke båndlagt (#1196)
- 🟢 FANGET **pop-MUT-6-gc-kollaps** — GC-typen kvalt i generatoren (gulv + tier-vægte fjernet) — TdF uden GC-ryttere
  - exit 1 · ❌ TYPE-MIX-ORACLE FEJLEDE (launch-gulve, ejer-spec 2026-06-07): · - type 'gc' har 6 ryttere — ejer-gulvet er ≥30 · Exit-kontrakt: ❌ exit 1 (type-mix-oracle brudt) · pyramide-bånd er rapport-only (bånd-tolerance = ejer-beslutning, #1198).
- 🟢 FANGET **fit-VM-M1-tomt-hardband** — Alle ≥15M-anchors droppet ved resolution — ordens-guarden de facto slukket
  - 0 resolved anchors med mål ≥15M — den hårde ordens-guard er de facto slukket (topstjerne-anchors droppet ved resolution?)
- 🟢 FANGET **fit-VM-M2-ukurve** — Ekstra-nuller-typo i 2 bund-anchors → U-formet ln-kurve (vrag-ryttere dyrest)
  - b=-0.361, c=3.80e-3 · modellen er ikke monoton voksende på [0,99] (b=-0.3609, c=3.800e-3) — bedre ryttere skal altid være dyrere
- 🔴 SLIPPER IGENNEM **fit-VM-M5-anchorlos-baroudeur** — Type uden anchor (baroudeur) får offset 0 → out-pricer Pogacar — LIVE i committed model
  - baroudeur@output 86.8 ≈ 189M vs Pogacar predicted 164M — gaten evaluerer kun anchor-punkter; fix = ejer tilføjer baroudeur-anchor (warning tilføjet i gaten)
- ⚪ **fit-baseline-groen** (kontrol) — (kontrol) committed anchors består alle guards
  - alle guards grønne på committed anchors
- 🟢 FANGET **cut-M1-runtime-divergens** — Runtime-fallback-formlen divergerer fra DB'ens GENERATED-formel (base×3)
  - 1 ryttere hvor runtime-fallback-formlen divergerer fra DB'ens GENERATED-formel
- 🔴 SLIPPER IGENNEM **cut-M2-flad-fordeling** — Backfill skriver konstant 1000 til alle — Pogacar-klassen = neo-pro
  - formel-konsistens grøn trods flad skala — fordelings-bånd hører til ejer-scorecardet #1196
- 🟢 FANGET **cut-M3-negativ-market-value** — Negativ prize_earnings_bonus giver market_value -50.000 (ingen DB-CHECK)
  - 1 aktive ryttere med market_value ≤ 0 (negativ prize_earnings_bonus? fx Fixture Rytter = -50000)
- 🟢 FANGET **cut-M4-tom-population** — Halvfejlet swap: 0 aktive ryttere — vacuous truth
  - tom: 0 aktive ryttere — auditen er vakuøs (tom riders-tabel eller alle retired efter halvfejlet swap?) · hel-retired: 0 aktive ryttere — auditen er vakuøs (tom riders-tabel eller alle retired efter halvfejlet swap?)
- 🟢 FANGET **cut-M5-pcm-overlever-relaunch** — 3 rigtige PCM-ryttere aktive efter relaunch (--expect-fictional)
  - --expect-fictional: 3 aktive ryttere med pcm_id (rigtige ryttere overlevede relaunch — fx Fixture Rytter, Fixture Rytter, Fixture Rytter) · uden flag: grøn (pre-relaunch-tilstand er legitim)
- 🟢 FANGET **rel-M2-prod-guard-casing** — Uppercased SUPABASE_URL omgår prod-detektionen (DNS er case-insensitive)
  - uppercased prod-URL detekteres som prod → --apply uden --target-prod kaster

## Fund der kræver ejer-beslutning (IKKE strammet — bevidst)

De 7 sluppede mutanter er alle balance-/design-følsomme. Ingen spekulative bånd:

1. **race-M3 (baroudeur fejer bjergene):** mountain-/high_mountain-båndet aggregerer
   gc+climber+baroudeur som ÉN gruppe — intra-gruppe-fordeling er usynlig. Kræver
   ejer-defineret sub-fordeling (fx "gc+climber ≥60 % af gruppens sejre") — samme
   beslutning som #1144's "mountain sub-distribution".
2. **race-M4 (rolling/classic uden bånd):** 2 af 8 terræner har ingen targets.
   Ejer skal definere mål-vinderrater for rolling/classic (eller eksplicit fravælge).
3. **pop-MUT-1 (pyramide-kollaps, exit 0):** bånd-targets (12/60/230/500) printes
   men håndhæves ikke — der findes ingen ejer-defineret tolerance (±hvor meget?).
   Beslut tolerance → så er håndhævelsen 5 linjer.
4. **pop-MUT-2 (navnekollision forskyder RNG):** preview certificerer ALTID med tomt
   navne-sæt; orchestratoren folder alle DB-navne ind. 1 kollision flytter bånd fra
   12/68/203/517 til 13/84/187/516. Fix-retning: `--existing-names`-input til preview
   ELLER flyt certificeringen til relaunch-dry-run (hvor DB-navnene kendes).
5. **pop-MUT-5 + cut-M2 (per-type/flad værdi-skala):** bånd-counts kan se BEDRE ud
   mens en hel rytterklasse er fejlprist; formel-konsistens er grøn ved flad skala.
   Det er præcis hullet ejer-scorecardet **#1196** skal lukke (fordelings-bånd:
   median, top-8-typer, per-type-niveau).
6. **fit-VM-M5 (anchorløs baroudeur — LIVE i committed model):** baroudeur har ingen
   anchor → offset 0 → en elite-baroudeur @output 86.8 prissættes ~189M > Pogacar
   predicted ~164M. Fix = ejer tilføjer en baroudeur-anchor i
   `riderValuationAnchors.json` + re-fit. Gaten warner nu om anchorløse typer.

## IKKE dækket (DB-/env-bundne gates) — eksplicit

Prioritering fulgte launch-kritikalitet (relaunch > værdimodel > race > progression),
men kun 100 % DB-frie gates kan mutation-testes sikkert i dette miljø (ingen
disposabel Supabase-branch til rådighed; ALDRIG mutation-fixtures mod prod).
Dækkede relaunch-/cutover-mutanter er de DB-frie guard-/kerne-dele.

| Gate | Hvorfor ikke dækket | Vigtigste kendte huller (fra #1198-recon, uverificeret her) |
|---|---|---|
| Relaunch-orchestrator dry-run (#1103), resten | Kræver disposabel Supabase preview-branch (apply er den ægte verifikation) | Ingen oracles på sluttilstand (legacy-ryttere aktive, starthold <8, fairness-bånd beregnes men håndhæves ikke, frozen-founder mister badge) |
| Sæson-transitions dry-run (#1155) | Kræver DB med aktiv sæson | Invariant-brud er print-only ⚠️; auto-loop-guard-linjen er hardcoded påstand uden DB-opslag; tavs query-fejl → falsk grønt |
| previewRiderProgression (#1137) | Kræver SUPABASE_URL mod ægte population | Rapport-only: U25-target "≥3 sum/sæson" sammenlignes aldrig programmatisk; teenage-superman/død vækstmotor slipper igennem |
| previewTraining (#1163) | Kræver DB | Cap-brud printer ❌ men exit 0; cap-tæller næsten død kode; tomme caps = blind |
| previewDerivedAbilities (#1122) | Kræver DB; kalibreringscockpit, ikke gate | Ingen assertions overhovedet |
| verify-invariants | Kræver live DB | negotiating-status uden for dublet-tjek; balance/ledger-dimension umålt; vakuøst grøn mod tom/forkert DB |
| driftMonitor (Loop A) | Kræver DB + kører mod prod-skema | Salary-bånd false-alarmer post-#1101; squad-bånd er no-op (D1-string vs integer-division); fail-open ved query-fejl |
| economyBaselineSimulation | Kræver DB (readonly-env) | Ingen oracle; RLS skjuler boards → systematisk optimistisk |
| verifySeasonEndRepair | Hardkodet sæson-6-kontekst | Count-equality i stedet for set-equality; beløb/fortegn umålt |
| Discord-canaries (#748/#1115) | Kræver token/netværk | Kun auth-aksen; miljø-/identitets-/delivery-/webhook-akser udækkede |
| CI/agent-gates (RLS-audit m.fl.) | Egen CI-infrastruktur | Ikke spilbalance-domæne (#1198 retter sig mod de 4 balance-domæner) |

Næste skridt for de udækkede gates: #1199 (natlig harness-vagt) + en preview-branch-
baseret relaunch-øvelse (#1103) er de rigtige steder — fixtures findes som opskrifter
i #1198-mutant-kataloget.
