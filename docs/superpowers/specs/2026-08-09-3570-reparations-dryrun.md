# #3570 fase 2 — reparations-dry-run for de 2.356 eksisterende unge (16-21)

Ingen mutation. Kilde: dateret snapshot (9/8 15:30 UTC) suppleret med tactics/positioning
(manglede i original-snapshottet, hentet read-only fra live DB — begge felter var 0 rækker
NULL, så suppleringen er komplet og uden gæt). Kæde: fase 2-koden i
`C:\Dev\CyclingZone\.claude\worktrees\wf_c31faf2d-109-1` (guard-sletningen + draw-caps-grenen
allerede aktiv). Script: `backend/scripts/dev/repairYouth3570Phase2DryRun.mjs` (samme worktree).

## 1. De 3 vigtigste tal

1. **Baroudeur-krisen rettes markant, men lander skævt hos rouleur:** human-ejede baroudeur
   falder 76,6 % → 15,2 %, men rouleur (samme population) springer fra 0,3 % → **41,4 %**
   — langt over ejerens 17 %-mål og højere end den 20,3 % totalpopulationen lander på.
2. **Spillerbeskyttelsen holder 100 %** — 0/2.356 ryttere fik et loft under deres nuværende
   evne. Men 1.081 ryttere (45,9 %) får mindst ét loft SÆNKET ift. i dag (median største
   reduktion 17 point, p90 35, max 49) — reelt spillervendt tab af fremtidigt headroom, ikke
   et brud på garantien.
3. **Værdi-frysningen holder 100 % i dag** (0 kr. ændret — valuation_type røres ikke af denne
   reparation), men den kontrafaktiske eksponering hvis frysningen senere løftes er stor:
   936/2.356 (39,7 %) ville flytte ≥20 % i base_value, median 11,4 %, worst-case +831 %.

**Anbefaling:** kør type+loft-reparationen i sin egen ejer-gated pass EFTER fase 2 er merged
(idempotent, #2642-rammer) og FØR 16/8-markedsmodel-sweepet (så modellen trænes på de
korrigerede labels, ikke de 76,6 %-baroudeur-skæve). Lad værdi-frysningen (#3345) blive
UÆNDRET i samme pass — den kontrafaktiske eksponering ovenfor viser hvorfor: at synke
valuation_type til de nye labels uden en V4-refit ville flytte enkeltryttere op til 831 %.
Rouleur-koncentrationen (41,4 % human) bør vises til ejeren FØR kørsel — det er ikke en fejl
i reparationen (kontrast-formlen er uændret siden #3325-kalibreringen), men et ægte fund om
den eksisterende population, og kan kræve en RIDER_TYPES-vægt-justering i Kandidat 2
(23/8-pakken) — IKKE rørt her per scope-grænsen.

## 2. Type-skift

- **1.336/2.356 (56,7 %)** af alle unge får en ny primær type. Blandt human-ejede:
  **721/1.155 (62,4 %)**.
- Fordeling FØR → EFTER (total / human-ejede):

| Type | Før (total) | Efter (total) | Før (human) | Efter (human) |
|---|---|---|---|---|
| sprinter | 6,0 % | 6,9 % | 5,6 % | 11,0 % |
| tt | 7,2 % | 17,2 % | 3,5 % | 5,4 % |
| climber | 24,4 % | 38,8 % | 1,4 % | 9,1 % |
| puncheur | 10,4 % | 0,5 % | 0,3 % | 1,0 % |
| brostensrytter | 2,3 % | 2,4 % | 3,7 % | 4,4 % |
| **baroudeur** | **42,3 %** | **7,6 %** | **76,6 %** | **15,2 %** |
| **rouleur** | **0,6 %** | **20,3 %** | **0,3 %** | **41,4 %** |
| gc | 6,8 % | 6,2 % | 8,6 % | 12,6 % |

- **gc bevæger sig kun svagt** for den EKSISTERENDE population (total 6,8 %→6,2 %; human
  8,6 %→12,6 %) — modsat den friske akademi-scorecardens 0 %→95,7 % (fase 2 §3570). Årsagen:
  eksisterende ryttere har intet persisteret `archetype_draw` — denne reparation klassificerer
  udelukkende mod deres EKSISTERENDE ability_caps (guard-sletningen alene), ikke mod et
  trukket anlæg. Det TRUKNE gc-anlæg findes kun for nye akademi-kuld fremover.
- Baroudeur→rouleur er langt den største enkeltbevægelse (478 ryttere, alle human-relevante).
  Baroudeur→climber (164) og baroudeur→sprinter (75) er de næststørste.

## 3. Caps-diff-fordeling (loft-bevægelse pr. evne-kategori)

| Kategori | # forøget | # sænket | Forøgelse median/p90/max | Sænkning median/p90/max |
|---|---|---|---|---|
| Fysisk (10 evner) | 5.724 | 1.962 | 15 / 25 / 58 | 14 / 32 / 49 |
| Teknisk (descending/cobblestone/positioning) | 30 | 761 | 16 / 17 / 22 | 14 / 33 / 48 |
| Taktisk/mental (aggression/tactics) | 0 | 758 | — | 14 / 33 / 48 |

- `positioning` og `tactics` rører sig ALDRIG (0 forøgelser, 0/2.356 sænkninger for
  positioning; tactics samme) — de indgår ikke i RIDER_TYPES-vægtene (ABILITY_KEYS i
  riderTypes.js har kun 13 af de 15 synlige evner), så reklassificeringen ændrer aldrig
  deres rolle-faktor. `aggression` sænkes for 758 ryttere (14/33/48) — ren sidegevinst af at
  miste "baroudeur" som type (aggression var baroudeurs stærkeste signatur-evne).
- Største enkelt-udsving: `punch` +58 (Gonzalo A. Cabrera, 14→72, baroudeur→ny type med punch
  som signatur), `flat` −48, `endurance` −49 (flere ryttere rammer identisk −49 — samme
  archetype-overgang, baroudeur→en type der ikke belønner endurance).
- **936/2.356 (39,7 %) har mindst ét evne-loft der flytter ≥20 point** — den praktiske
  "mærkbar ændring"-grænse. 63 af disse hos én enkelt manager (Robsteren, 30 ryttere i alt).

## 4. Spillerbeskyttelse (gulv-invariant)

- **0/2.356 brud** — buildCapsForRider's gulv (`max(tapered_absolut, nuværende_evne)`) holder
  for ALLE ryttere. Ingen spiller mister evne han allerede ejer, verificeret eksplicit
  pr. rytter pr. evne (15 evner × 2.356 ryttere = 35.340 kontroller, 0 brud).
- **I1-gaten** (caps ≤ potentiale-loft, `buildYouthCaps`-max) "fejler" på 23/2.356 (1,0 %) —
  men i ALLE 23 tilfælde er årsagen at den drivende evnes NYE loft er UÆNDRET fra det GAMLE
  (delta = 0) — dvs. gulvet var ALLEREDE bindende under den gamle type (rytteren har en
  nuværende evne der overstiger den nye types nominelle loft, fordi den var hans SIGNATUR
  under den gamle type). Eksempel: Carlos Lozano (pot 4,5, climbing 93 nu) var sprinter,
  bliver gc — climbing-loftet under "gc" er nominelt 75, men hans nuværende climbing (93,
  optjent under en TIDLIGERE klassificering) beskytter loftet uændret på 93. Dette er en
  KENDT, dokumenteret spænding i buildCapsForRider (se dens 2026-07-15-kommentar: "en voksen
  med høj current ville ellers få et loft under sin current") — ikke en ny defekt fra denne
  reparation, og ikke et gulv-brud (ingen af de 23 mister evne). I1 er skrevet til FRISK
  generering, hvor current aldrig kan overstige loftet ved fødsel; den holder ikke som
  literal invariant hen over en TYPE-ÆNDRING af allerede udviklede ryttere.

## 5. Scouting-/progressions-UI (afledte flader)

`buildTypeCeilingBands` (scoutingReport.js) læser `ability_caps` DIREKTE til loft-båndet
("ceilTruth = ratingFromAbilities(caps, key)") — reparationen ændrer derfor den VISTE
progressions-bar/scouting-ceiling for enhver berørt rytter, ikke kun label-badge'et.

- For de **1.020 ryttere hvis LABEL IKKE ændrede sig**, flytter selve loft-ratingen for deres
  (uændrede) type stadig median 2 point, p90 5, max 10 — en ren caps-reshaping-effekt, usynlig
  hvis man kun kigger på type-badge'et.
- For de 1.336 der SKIFTER label vises naturligvis en anden type + et andet loft — ejeren bør
  forvente supportspørgsmål ("hvorfor er min rytter pludselig rouleur, og hvorfor er hans
  loft lavere") særligt for de 1.081 med en reel sænkning.
- `now`-ratingen (dagens niveau) er UÆNDRET for alle — kun loft-båndet flytter sig, aldrig
  "nu"-tallet.

## 6. Værdi (frysning + kontrafaktisk eksponering)

- **base_value/market_value er 0 kr. ændret for alle 2.356** — bekræftet: reparationen rører
  hverken `valuation_type` eller de felter `predictBaseValue`/V4 læser. Frysningen (#3345)
  er urørt af denne reparation, som designet.
- **Kontrafaktisk** (hvis `valuation_type` senere synkes til den NYE primære type, uden
  V4-refit): median |delta| 11,4 %, p90 65,3 %, max +831 %. 936/2.356 (39,7 %) ville flytte
  ≥20 %. Værste eksempler er alle baroudeur→puncheur-skift (offset-forskellen mellem de to
  typer i V4-modellen er stor og upraktiseret for denne kombination).
- Dette bekræfter #3345's eksisterende regel: enhver fremtidig "lad værdien følge den
  korrigerede type"-beslutning kræver sin EGEN V4-refit (Monte Carlo-sæson-simulering) —
  IKKE en biprodukt af denne label/loft-reparation.

## 7. Pr. manager (human-ejede, top 15 efter antal type-skift)

| Manager | Ryttere | Type-skift | ≥1 loft flyttet | ≥1 loft sænket | ≥20p-udsving (antal) |
|---|---|---|---|---|---|
| Robsteren | 30 | 18 | 24 | 19 | 63 |
| dolamba | 24 | 18 | 19 | 18 | 22 |
| andrecl1 | 28 | 16 | 20 | 18 | 17 |
| kieferklausen | 23 | 16 | 19 | 11 | 20 |
| cmadsen68 | 23 | 15 | 20 | 17 | 35 |
| CyberSimon | 23 | 15 | 21 | 17 | 62 |
| pol19871 | 22 | 15 | 16 | 16 | 55 |
| trnondisclosure | 18 | 15 | 16 | 16 | 30 |
| mewager | 22 | 14 | 18 | 16 | 32 |
| chuppasheeps123 | 20 | 12 | 16 | 12 | 24 |

(Fuld liste, alle 173 managere med human-ejede unge, i JSON-outputtet.)

## 8. Timing (samlet vurdering)

Samme rammer som fase 1's timing-vurdering, nu udvidet med caps-dimensionen:

1. **Frysningen (#3345) er urørt** — ingen økonomisk risiko ved selve reparationen (§6).
2. **16/8-markedsmodel-sweepet** (V1, `primary_type` som feature — `fitMarketValueModelV1.js`
   i git-status) bør køre EFTER denne reparation, ikke før — ellers trænes den nye
   markedsmodel på de nuværende 76,6 %-baroudeur-skæve human-labels og arver skævheden.
3. **Scouting/progression-UI ændrer sig ØJEBLIKKELIGT** ved kørsel (§5) — caps er ikke
   frosne, kun værdien er. Anbefal patch-note samtidig med kørslen (obligatorisk per
   CLAUDE.md ved enhver brugerrettet ændring) der forklarer at nogle unges lofter/typer
   er korrigeret, inkl. at nogle lofter kan være LAVERE end i går (§4) uden at nogen
   evne er blevet taget fra dem.
4. **Rouleur-koncentrationen hos human-ejede (41,4 %)** bør vises ejeren FØR kørsel som et
   separat beslutningspunkt — det er en RIGTIG konsekvens af de UÆNDREDE RIDER_TYPES-vægte
   mod DENNE specifikke undergruppes ability-profil, og kan retfærdiggøre at fremrykke dele
   af Kandidat 2 (23/8-vægt-pakken) frem for at leve med en ny 41 %-koncentration i mellemtiden.
5. **Rækkefølge ift. PR-merge:** reparationen kræver fase 2-koden (guard-sletning +
   riderTypes.js-vægtene) i main — kør den EFTER fase 2-PR'en er merged, som sin egen
   ejer-gated, idempotent write-pass (#2642-rammer: dry-run-tal ovenfor + denne rapport er
   selve "ejer ser tilstanden før" per feedback_owner_reviews_live_before_destructive_ops).

## Filer

- Rådata (alle 2.356 rækker, top-50 store udsving, top-30 værdi-outliers): `reparations-dryrun.json` (samme mappe).
- Reparations-script: `backend/scripts/dev/repairYouth3570Phase2DryRun.mjs` i worktree `wf_c31faf2d-109-1` (ikke committed — ren dry-run-analyse, ingen prod-sti).
- Snapshot brugt: `../youth_16_21_full.json` (original + tactics/positioning suppleret fra live DB, read-only).
