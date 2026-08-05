# Aftenbølge 2026-08-05

> Skrives **løbende**, ikke ved close-out (ejerens ugentlige forbrugsloft nulstilles torsdag 6/8 kl. 10; bølgen kan ramme loftet før den er færdig). Prioritering: merge + done-flip før nye spor.

| Metrik | Værdi |
|---|---|
| Start (lokal tid) | 16:10 CEST |
| Gate (#3367) | ✅ lukket 16:44 — PR #3384 merged |
| PR'er merged | #3383, #3384 · auto-merge: #3363, #3275 |
| Issues → `claude:done` | #3367, #3336 |
| Åbne PR'er (loft 5) | se løbende status nederst |

---

## Spor 0 — worktree-isolation (#3367) ✅ LUKKET

Gaten fra hard rule 14. Tre symptomer fra natbølgen skulle lukkes: manglende `backend/node_modules`, manglende `backend/.env`, og `npm ci` gennem en junction der tømmer hoved-checkoutet.

**Fundet der afgjorde designet:** issuets egen anbefaling (B: preinstall-guard) virker ikke. `npm ci` sletter `node_modules` **før** `preinstall` kører — verificeret på npm 11.13.0 med en sentinel-fil, som allerede var væk da preinstall fyrede. En lifecycle-guard råber først op efter skaden er sket.

**Løsning (PR #3384):** worktrees junctioner til en lockfile-hashet cache i `%LOCALAPPDATA%\CyclingZone\node-modules-cache\<pkg>-<hash>\`, uden for begge checkouts. Der findes ingen sti fra et worktree ind i mains `node_modules`. Cachen er selv-helende og nøglet på lockfile-hash, så en branch med ændrede dependencies automatisk får sit eget install (lukker også #2967's stille korrekthedsfejl).

**Verifikation — frisk worktree, nul manuelle indgreb:**

| Check | Resultat |
|---|---|
| backend `node --test` | 5256/5256 |
| Junction-mål | `...\node-modules-cache\backend-43f1db52a01a\node_modules` (ikke main) |
| `backend/.env`, `frontend/.env` | til stede |
| **Destruktiv test:** `npm ci --prefix frontend` gennem junctionen | main urørt: 18/177/325 pakker før og efter, `express` + `react` loader stadig |

**Oprydning i eksisterende drift:** preflight fandt **54 legacy-junctions** ind i main. 25 merged worktrees ryddet, 7 resterende rebuildt → `[ok] ingen worktree-junctions ind i hoved-checkoutet`.

---

## Uplanlagt fund 1: main var RØD uden en eneste ny commit (PR #3383)

`frontend/src/lib/firstBidRecommendation.test.js` byggede sine auktioner med `FAR_FUTURE = NOW + 1t` (fast `2026-08-05T12:00:00Z`) men kaldte funktionen **uden** `now` — den faldt tilbage på vægur-tiden.

| Tidspunkt (UTC) | main-commit | frontend `node --test` |
|---|---|---|
| 12:32 | `21e9a4de` | ✅ grøn (CI: success) |
| 13:00 | `21e9a4de` uændret | 💥 bomben detonerer |
| 14:20 | `21e9a4de` uændret | ❌ 5 af 9 fejler |

`frontend-build` er en required check, så **enhver PR branchet efter kl. 13:00 ville arve fejlen** — samme klasse som 23/6, hvor 15 PR'er blev røde på én gang. Fanget af preflightens `origin/main`-test-sanity (uafhængig bekræftelse) og af den første worktree-verifikation.

**Fix:** en lokal `pick()`-wrapper injicerer `now: NOW` medmindre testen selv angiver et — det gør det umuligt at glemme igen. 1683/1683 grønne. Merged 16:31.

**Restrisiko:** 6 andre frontend-testfiler bruger faste `new Date("20...")`-konstanter. De er grønne i dag, men samme fælde kan ligge dér. Der er ingen guard mod klokke-afhængige tests — værd at oprette et issue på.

## Uplanlagt fund 2: repoet var en shallow clone

`git merge origin/main` i #3275's worktree fejlede med `refusing to merge unrelated histories`. Årsag: `.git/shallow` (oprettet 5/8 kl. 02:10, under natbølgen) med graft-punkt `dc619476` fra 4/8. Lokalt så main ud til at have **85 commits** med rod 4/8; GitHub har fuld historik (3496 commits).

Det forklarer også ejerens observation om at `git rebase` "genafspiller hele historikken fra Initial commit": med graften ser git de to historikker som urelaterede. Løst med `git fetch --unshallow origin`. **Værd at kende:** en shallow clone gør merge umulig og rebase katastrofal på ældre branches.

---

## Spor 1 — merge-køen

| PR | Issue | Status |
|---|---|---|
| #3363 lånebekræftelse | #2815 | merged main ind i eget worktree, 1690/1690 frontend-tests, eslint 0 errors, i18n grøn, bundle 909,9 KB mod 917,7 KB loft (**ingen budget-hævning nødvendig**), build grøn → ready + auto-merge |
| #3275 pulje-reseed | #2557 | merged main ind (efter unshallow), backend 5288/5288, frontend 1683/1683, i18n grøn, migration-idempotency grøn, backend eslint rent → ready + auto-merge. Migrationen `2026-08-04-pool-reseed-flag.sql` er **inert**: `ON CONFLICT DO NOTHING`, værdi `'off'`, koden fail-safe ved manglende nøgle. Flaget forbliver slukket. |

---

## Spor 2 — ryttertype-backfill: ✅ KØRT 5/8 kl. 20:2x efter ejer-go

Ejeren så før/efter-fordelingen nedenfor og gav go. **Resultat:** 8.176 ryttere, 4.249 `primary_type` skiftet. Post-verificeret mod snapshottet: `valuation_type` ændret for **0** ryttere. `base_value`/`market_value` ændret for 63, men 22 af dem skiftede ikke type og typeandelen blandt de 63 (65 %) ligger tæt på baseline (52 %) — da værdisætningen læser `valuation_type`, som er urørt, kan backfillen ikke være årsagen. Det er den normale værdi-refresh i de 3½ time siden snapshottet.

Snapshot-tabellen `riders_type_backfill_snapshot_20260805` beholdes indtil fordelingen er set an i drift.

### Tallene der lå til grund for go'et

### (a) Før-snapshot taget

`public.riders_type_backfill_snapshot_20260805` — 8176 rækker, verificeret 8176/8176 identiske med live. Taget 2026-08-05 14:50:55 UTC. Indeholder `id, primary_type, secondary_type, valuation_type, base_value, market_value`.

### (b) Dry-run: hvad backfillen ville gøre

Målt 2026-08-05 14:52 UTC mod prod. **8176 ryttere** (issuets tal på 8.171 var en uge gammelt og er genmålt).

- `primary_type` ændres for **4244 ryttere (51,9 %)**
- `secondary_type` ændres for **6580 ryttere (80,5 %)**

| Type | Før | Efter | Δ |
|---|---:|---:|---:|
| climber | 3694 (45,2 %) | 3227 (39,5 %) | −467 |
| tt | 3635 (44,5 %) | 927 (11,3 %) | **−2708** |
| sprinter | 538 (6,6 %) | 1748 (21,4 %) | **+1210** |
| baroudeur | 62 (0,8 %) | 798 (9,8 %) | +736 |
| puncheur | 25 (0,3 %) | 759 (9,3 %) | **+734** |
| gc | 35 (0,4 %) | 361 (4,4 %) | +326 |
| brostensrytter | 61 (0,7 %) | 181 (2,2 %) | +120 |
| rouleur | 126 (1,5 %) | 175 (2,1 %) | +49 |

I dag er **89,7 %** af hele populationen enten climber eller tt. Efter backfillen er den mest almindelige type 39,5 %, og alle otte typer er reelt repræsenteret.

Største enkeltskift: `tt → sprinter` (1203), `tt → climber` (919), `climber → puncheur` (713), `climber → baroudeur` (609), `tt → gc` (324).

**Pr. aldersgruppe** (andel der ændres): ≤21 år 50,6 % · 22-25 år 49,7 % · 26-29 år 50,6 % · 30-33 år 55,6 % · 34+ år 64,3 %. Effekten er altså jævn på tværs af alder — det er ikke en ungdoms- eller veteran-specifik korrektion.

### (c) `valuation_type` er URØRT — verificeret i koden, ikke antaget

1. `backfillCores.js:127` bygger update-payloaden som `{ id, primary_type, secondary_type }`. `updateRidersConcurrent` sender præcis de felter videre til `supabase.update()`. `valuation_type` indgår ikke.
2. `riderValuation.js:111`: `const type = rider?.valuation_type ?? rider?.primary_type ?? null;` — værdisætningen læser `valuation_type` **først**.
3. Live: `valuation_type` er NULL for **0** ryttere og lig `primary_type` for **8176/8176**.

Fordi (2) læser den frosne kolonne og (3) viser at den er sat for alle, kan backfillen ikke flytte en eneste trupværdi. Det er præcis hvad #3345/#3357 blev bygget til.

### (d) Én kommando til ejeren

```bash
cd backend && node scripts/backfillRiderTypes.js
```

Dry-run igen først (skriver intet): `cd backend && node scripts/backfillRiderTypes.js --dry-run`

**Rollback** (hvis noget ser forkert ud):
```sql
UPDATE public.riders r
   SET primary_type = s.primary_type, secondary_type = s.secondary_type
  FROM public.riders_type_backfill_snapshot_20260805 s
 WHERE r.id = s.id;
```

**Sammenhæng ejeren bør kende:** dette er sandsynligvis også en stor del af svaret på **#3349** (terræn-mixet skævt mod fladt, puncheur 0,1 % af populationen). Puncheur går fra 0,3 % til 9,3 % og baroudeur fra 0,8 % til 9,8 % alene ved reklassificeringen. Feltsammensætningen ændrer sig altså markant **før** generatoren overhovedet røres — så #3349's måltal bør sættes på den POST-backfill population, ikke på dagens.

---

## Spor 3+ — bølgen (batch 1)

Dispatch-forfilter kørt på alle 20 kandidater før fan-out. **#3336 var allerede shippet** i PR #3340 (merged 4/8) → done-flippet uden at bygge noget.

Batch 1 (3 kode-spor + 2 rene målinger; målinger giver ingen PR og belaster ikke 5-PR-loftet):

| Spor | Issue | PR | Resultat |
|---|---|---|---|
| Dashboardets "Seneste resultater" linker ikke til løbssiden | #3373 | #3388 | ✅ merged |
| Divisionsbonus-copy forveksler division og placering | #3100 | #3387 | ✅ merged |
| Auktioner desktop: fører-holdnavn kun i hover-tooltip | #3099 | #3386 | ⏸ **afventer ejerens visuelle go** |
| Pengemængden firdobles over 5 sæsoner | #3360 | — | ✅ målt, oplæg postet |
| Betaler specialisering sig? | #3337 | — | ✅ målt, svar postet |

5 agenter, 0 døde, 1,12 mio. tokens, 38 min wall-clock. Ingen node_modules-relaterede spor-fejl — første bølge efter #3367.

### Hvorfor #3386 ikke blev merget

Agenten flagede det selv: ændringen er en anelse bredere end issuets ordlyd (ny "Ingen bud endnu"-tilstand, og fører-navnet vises nu også når spilleren selv fører). Merge-gaten er forudgående enighed, ikke risiko — vi aftalte problemet, ikke denne løsning. Plus UI-reglen fra 31/7. PR'en er grøn og klar; den mangler kun ét ord.

De to der blev merget er begge tilfælde hvor issue-teksten selv beskriver fixet: et dødt link skal virke, og en forkert tekst skal være rigtig.

### Fund fra sporene der er større end sporene selv

**#3360 — det er økonomien, ikke tærsklen.** Issuets 4,24× er delvis en målefejl: `freshPopulationBurden.js:61` kalder `computeFrozenSalary({base_value,...})`, men funktionen blev omskrevet 18/7 (#2594) til kun at læse `current_production_value` → `undefined` → fallback 1.288 CZ$ løn pr. hold pr. sæson, identisk i alle divisioner. Rettet giver harnessen 2,54× i stedet for 4,24×.

Men prod er værre end issuet: **+500.198 CZ$ garanteret net pr. hold pr. sæson** (mål: 37.500). Lønbyrden er **5,6 % af sponsoren** mod designets 85 %; en gennemsnitsrytter er værd 97.513 og koster 1.697 pr. sæson. Absorptionen er 17,3 % mod designkravet på ≥90 %. Sæsonskiftet 26/7 udbetalte **+42,9 mio. på én dag**, og median-auktionsprisen gik fra 20.160 til 35.985 ugen efter.

1,3×-målet er sporbart (ejer-låst 21/6) men blev sat da startkapitalen var 800k, sænket til 500k dagen efter (#1717) og aldrig genbesøgt. Det ændrer ikke konklusionen: ved +500.198/sæson rammer man 5× efter fem sæsoner.

**#3337 — specialisering betaler sig kraftigt, men kun i to discipliner.** Ved samme pris giver den spidse rytter **+84 % point**; ved samme evne-budget 5,6×. Bredde er spillets dårligste køb (bred allrounder: 0,0 % GC-sejre over 648 simulerede løb). Kontrolleret for pris slår den spidse halvdel den brede i **alle 10 pris-deciler**.

Men bjerg + højbjerg er **84,6 %** af al GC-tid, så kun klatring og spurt er levedygtige specialer. Enkeltstarts-specialisten er død (490 point pr. mio.), og puncheuren har en **7,9× prispræmie** i `riderValuationModelV4.json` fittet på 19 observationer, mens den leverer 503 point pr. mio. mod climberens 1.358. Spillerne betaler altså for meget for en type der ikke leverer — hører hjemme i #3353.

Issuets påstand om at "vinderne har næsten dobbelt TT" holder ikke: genmålt er klatring 2,31× og TT 1,51× mod feltet.

**Konsekvens for #3349:** terræn-mixet halverer skævheden, men lukker den ikke (klatring forbliver 2,8× punch). `GAP_MODEL` er den reelle balance-knap: fladt spread 40 mod bjerg 600 betyder at 31 % af etaperne bidrager 4 % af GC-tiden.

---

## Afvigelser/læringer

- **Issuets anbefalede løsning kan være forkert.** #3367 anbefalede en preinstall-guard; det tog ét 30-sekunders eksperiment at vise at den fyrer for sent. Test anbefalingen før du bygger den.
- **En grøn CI-kørsel beviser kun at koden var grøn dengang.** main var grøn kl. 12:32 og rød kl. 14:20 uden en eneste commit imellem. Klokke-afhængige tests er tidsbomber, ikke flakes.
- **Shallow clones er usynlige indtil de bider.** Intet i det daglige arbejde afslørede graften; den dukkede først op som "unrelated histories" på en to dage gammel branch.
- **Genmål altid.** 8.171 → 8.176 ryttere. Lille afvigelse denne gang, men reglen holdt.
