# RAPPORT — integrations-dry-run af apply-værktøjet mod D-planen

**Dato:** 2026-08-10 · **Branch:** `feat/3570-reparation` · **Issue:** #3570
**Ingen prod-mutation.** Ét read-only `SELECT` mod `information_schema.columns`.
Værktøjet er **ikke** kørt mod produktionen. Ingen PR oprettet, intet merget.

---

## 1. Hvad jeg gjorde — og hvorfor ikke en mock

Værktøjet har en indbygget dry-run-tilstand, men den kræver en levende
Supabase-forbindelse, og den kan hverken slette ryttere midt i en kørsel, afbryde
halvvejs eller køre `rollback.sql`. Jeg byggede derfor en simulerings-tilstand.

**Ikke en mock — en ægte PostgreSQL.** `@electric-sql/pglite` (PostgreSQL 18.3 i
WASM) lå allerede i `backend/node_modules`. Databasen oprettes med det **rigtige
prod-skema**, hentet 10/8 med ét read-only opslag i `information_schema.columns`:
rigtige typer (`riders.potentiale` er `numeric`, evne-kolonnerne `smallint`),
rigtige NOT NULL-krav, rigtige primærnøgler og FK'en
`rider_derived_abilities.rider_id → riders.id ON DELETE CASCADE`.

Det er ikke en detalje. Blokker B1′ handlede om **kolonnenavne der drev fra hinanden
mellem tre artefakter**. En håndskrevet mock håndhæver kun de navne dens forfatter
huskede at skrive ned — den kan strukturelt ikke være uafhængig af koden den tester.
Her håndhæver Postgres dem selv, og `rollback.sql`'s `DO $$ … RAISE EXCEPTION`-porte
bliver eksekveret af en server for første gang (spor VAERKTOEJ noterede eksplicit at
det manglede).

Populationen er `docs/snapshots/3570/` — det daterede 10/8-snapshot i repoet — plus
35 syntetiske pensionerede ryttere, så backup-tallet bliver 8.234 og `is_retired`-kanten
faktisk køres. De pensionerede filtreres fra af `!r.is_retired` og kan ikke påvirke planen.

Oven på databasen ligger en supabase-formet klient der returnerer `{data, error}`
(aldrig kaster), og som kan injicere: sletninger midt i skrivningen, en batch der
skriver 0 rækker men melder OK, en afbrudt forbindelse, og rækker der mangler i det
brede opslag men findes i eksistens-opslaget.

**Filer:** `sim/pgsim.mjs` (simulering) · `sim/10`–`sim/50` (kørslerne) ·
`sim/out-*.json` (rå output).

---

## 2. Blokkeren jeg fandt: `rollback.sql` PART A kunne ikke køre

Første forsøg på rundturen døde med:

```
PART A: FEJLEDE — relation "public.riders_3570_backup_20260816" does not exist
```

Isoleret (`sim/21-isoler-a0.mjs`) mod PostgreSQL 18.3:

| Situation | Committeret A0 | Nestet form |
|---|---|---|
| **Ren database — PART A's normale førstegangs-kørsel** | **FEJLER:** `relation … does not exist` | OK |
| Backup-tabellen findes (tom) | OK | OK |
| Databasen allerede repareret (8.193 draws) | **FEJLER med den forkerte besked** | `STOP: 8193 ryttere har allerede et archetype_draw` |

Årsagen er ét udtryk:

```sql
IF to_regclass('public.riders_3570_backup_20260816') IS NOT NULL
   AND (SELECT count(*) FROM public.riders_3570_backup_20260816) > 0 THEN
```

PL/pgSQL planlægger hele udtrykket under ét, og Postgres slår relations-navnet op
ved planlægning. `AND`-kortslutningen redder det ikke. Konsekvensen er ikke kosmetisk:

* **PART A kunne aldrig køre på en ren database** — altså præcis den situation den
  findes til. Sikkerhedskopien kunne ikke tages ad den vej.
* På en allerede repareret database fyrede spærren **ikke sin egen besked**. Operatøren
  ville se «relation does not exist» og med rimelighed konkludere «jeg mangler vist at
  oprette tabellen» — stik imod det spærren prøvede at sige.

**Rettet i generatoren** (`rollbackSQL()`), ikke i filen: eksistens-tjek og
række-tælling står nu i hver sin sætning, med `EXECUTE` for den indre. Filen er
regenereret; drift-vagten i testene består. Begge tabeller i tabellen ovenfor er nu
grønne, og den allerede-reparerede sag giver den rigtige `STOP`-besked.

**Afledt fund til kørebogen:** `psql` skal køres med `-v ON_ERROR_STOP=1`. Uden det
fortsætter den efter en `RAISE EXCEPTION`, og A0/A3/B0/B2c holder op med at være spærrer.

---

## 3. Værktøjet skrev rev2, ikke D — nu målt, og lukket

Spor PLAN meldte det som et fund. Simuleringen sætter tal på: kørt uændret mod
10/8-populationen skriver værktøjet en plan hvor **2.211 navngivne ryttere får en
anden type end D** — 2.177 i segment B, 34 i segment D, 0 i A og C. Typefordelingen
er identisk (kvoterne er de samme i rev2 og D); det er tildelingen der er en anden.

Jeg valgte **ikke** at bygge D's målfunktion ind ved siden af rev2's — så ville næste
beslutning kræve en tredje. I stedet læser værktøjet nu identiteten fra den godkendte
plan:

```
--plan-fil=<sti>
```

* Identiteten (primær + sekundær) kommer fra filen.
* **Lofterne kommer aldrig fra filen.** De genberegnes altid med `buildCapsForRider`
  ud af rytterens *friske* evner — det var hele grunden til at værktøjet tager sit eget
  snapshot (gulv-garantien). Et loft fra en fil er per definition forældet.
* **Fail-closed:** står en rytter i det friske skrive-scope uden identitet i filen,
  stopper kørslen. Der faldes ikke tilbage på løseren for restpopulationen — det ville
  blande to målfunktioner i én skrivning.
* Uden flaget siger rapporten det nu højt: *«Tildelingen kommer fra VÆRKTØJETS EGEN
  løser … Er en anden indstilling låst, skal den gives med --plan-fil.»*

### Paritets-gate (ny selvtest)

```
node scripts/dev/repair3570Apply.mjs --selvtest --plan-fil=<D.json>
  254.192 sammenligninger · 0 afvigelser        (planlæggeren mod facit)
  376.890 sammenligninger · 0 afvigelser        (planfilen mod repoets funktioner)
  ✅ 8193 identiteter · 122.895 loft-celler celle-identiske · 2.211 afviger fra løseren
```

De 122.895 celler er **ikke** en tautologi: D-filens `skrives_ability_caps` er beregnet
af spor PLAN's egen kode, og værktøjet genberegner dem med `buildCapsForRider`. De
122.895 celler er ægte sammenligninger mellem to uafhængige beregninger. Dertil
kvoterne pr. type, gulv-garantien og at den frosne type resolver til sig selv.

---

## 4. De fire simuleringer

### 4.1 Dry-run mod D-planen

```
── 1b/8 Godkendt skriveplan ──  ✅ 376.890 sammenligninger · 0 afvigelser · 8193 identiteter
── 3/8 Planen bygges forfra ──  8193 i skrive-scopet · 5977 skifter synlig type
                                planfilen dækker 8193 af 8193 · 2211 afviger fra løseren
── 4/8 Diff mod 10/8 ──         0 nye labels · 0 nye lofter · 0 får en anden frossen type
── 5/8 Idempotens ──            anden kørsel ville skrive 0 rækker
── 6/8 DRY-RUN ──               identitet 8193 · lofter 7899
── 7/8 Backup (dry-run) ──      8234 + 8234 rækker VILLE blive kopieret
```

**Dry-runnet rørte ingenting:** 16.468 rækker sammenlignet felt for felt før og efter,
0 ændrede felter.

**D's tal reproduceret gennem værktøjet:**

| Mål | Brief | Målt |
|---|---|---|
| typeskift i alt | 5.977 | **5.977** |
| typeskift menneske-ejede | 2.700 | **2.700** |
| L1 alle | 7,7 | **7,72** |
| menneske 22+ L1 | 23,6 | **23,65** |
| menneske 22+ baroudeur | 11,0 % | **10,97 %** |
| identiteter | 8.193 | **8.193** (primær og sekundær, 0 afvigelser mod filen) |

### 4.2 B1′ — backup → skrivning → rollback, felt for felt

Den **committede** `repair3570Rollback.sql` kørt ordret, i to varianter:

| Vej | Backup | Skrevet | Rundtur |
|---|---|---|---|
| PART A tager kopien → værktøjet genbruger | 8.234 + 8.234, `genbrugt`, `verificeret` | identitet 8.193 · lofter 7.899 | **identisk=true**, 16.468 rækker, 0 afvigende felter |
| Kun DDL → værktøjet fylder selv | 8.234 + 8.234 indsat, `verificeret` | identitet 8.193 · lofter 7.899 | **identisk=true**, 16.468 rækker, 0 afvigende felter |

Efter skrivningen var ændringerne: `archetype_draw` 8.193 · `primary_type` 5.977 ·
`secondary_type` 6.302 · `ability_caps` 7.899. Efter PART B: nul. Kørt igen: stadig nul
(rollbacken er idempotent). Post-verify bestod begge gange med 8.193 kontrollerede og
0 på alle otte fejlkategorier.

Backup og rollback kan altså nu bruges **sammen** — det var blokker B1′'s kerne.

### 4.3 B5 — «slettet undervejs» mod «skrivningen fejlede»

Fem scenarier. Ét skal bestå, fire skal fejle — ellers beviser det første ingenting.

| # | Scenarie | Resultat |
|---|---|---|
| 1 | 12 ryttere slettet midt i skrivningen | **BESTOD** — 8.181 af 8.193 kontrolleret, `forsvundetUnderKoerslen: 12`, 0 fejl |
| 2 | En identitets-batch skriver 0 rækker, men melder OK | **FEJLEDE** — `udenDraw: 100` |
| 3 | 3 abilities-rækker slettet, rytterne lever | **FEJLEDE** — `manglerAbilitiesRaekke: 3` |
| 4 | 450 forsvinder (loft = 410) | **FEJLEDE** — `forsvundneOverGraense: 1` |
| 5 | 9 mangler i det brede opslag, men **findes** | **FEJLEDE** — `manglerRaekke: 9` |

Scenarie 5 er den vigtige: en læsefejl må ikke kunne gemme sig som en sletning. Det
selvstændige eksistens-opslag fanger den, og FK'ens CASCADE er ægte her — scenarie 3
kunne ikke konstrueres i en mock uden at mocken selv definerede reglen.

### 4.4 B4 — afbrudt kørsel, derefter ny backup

Afbrudt efter 40 batches: `nåede 3786/8193 ryttere`. Databasen bærer nu 3.792 draws.

| Vej | Resultat |
|---|---|
| **a) Ny backup, nyt suffiks — nuværende kode** | **NÆGTER.** `STOP: public.riders indeholder 3792 ryttere med archetype_draw …` Den nye kopi-tabel indeholdt **0 rækker**. |
| **b) Samme kald, FØR-koden** | `verificeret=true` — kopien fyldt med 8.234 rækker, **heraf 3.792 med `archetype_draw`**: en efter-tilstand solgt som rollback-kilde. |
| **c) Den rigtige vej: PART B mod den originale kopi** | Tilbage ved udgangspunktet felt for felt (16.468 rækker), draws tilbage på 6. **Først derefter** tillod værktøjet en ny kopi: `verificeret=true`, 8.234 rækker. |

b) er kørt med den faktiske FØR-fil fra spor VAERKTOEJ (kun lib-importerne omskrevet
til absolutte stier), mod samme ægte Postgres. Spor VAERKTOEJ målte det samme under
deres egen mock; her er det målt mod en server.

---

## 5. Et fund til: værktøjets diff kalder rækkefølge for datadrift

Første dry-run rapporterede *«8 ryttere får en ANDEN frossen type end 10/8-planen»* —
på **bit-identiske data**. Isoleret (`sim/15-raekkefoelge.mjs`):

| Rækkefølge på input | Ryttere med en anden primær |
|---|---|
| Snapshottets egen (kontrol) | 0 |
| Sorteret efter `id` (= som databasen leverer dem) | **8** |
| Omvendt | **18** |

Objektværdien er identisk til 1e-10 i alle tre — det er ægte uafgjorte, som løseren
bryder efter indeks. Kvoterne rammes eksakt i alle tre rækkefølger (min første
sammenligning sagde noget andet; den var følsom over for nøgle-rækkefølge i et
JSON-objekt og var forkert — tallene i tabellen er efterprøvet type for type).

Betydningen: `selectPaged` kalder ikke `.order()`, og PostgREST garanterer ingen
rækkefølge. **Værktøjets trin 4 ville altså på dagen melde «verden flyttede sig» om
ryttere hvor intet var flyttet sig** — et falsk signal i præcis det skærmbillede
operatøren skal bruge til at afgøre om planen stadig gælder.

`--plan-fil` fjerner det: identiteten kommer fra filen, så kørslen er
rækkefølge-invariant. Målt — med D-planen er trin 4 nu `0 får en anden frossen type`.
Uden plan-fil består problemet, og det er endnu et argument for at planen, ikke
løseren, skal bestemme.

---

## 6. Negativ-test af det jeg selv byggede

Porten skal kunne fejle, ellers beviser den grønne kørsel ingenting.

| # | Beskadigelse | Resultat |
|---|---|---|
| 0 | D-filen som den er | **BESTOD** |
| 1 | En rytter fjernet fra filen | **BESTOD** — og rapporteret (se nedenfor) |
| 2 | Én loft-celle ændret med 1 | **FEJLEDE** — `caps-celler der afviger: 1` |
| 3 | Én rytter flyttet til en anden type | **FEJLEDE** — `kvote sprinter: 841 (forventet 842)`, `kvote gc: 506 (forventet 505)` |
| 4 | Primær og sekundær sat ens | **FEJLEDE** ved indlæsning |
| 5 | Ugyldig type-nøgle | **FEJLEDE** ved indlæsning |
| 6 | Rytter mangler, kørt mod den **friske** population | **FEJLEDE** — `STOP: 1 ryttere … har ingen godkendt identitet`. Draws uændret på 6, **0 rækker i backup-tabellen** — den stoppede før kopien. |

**#1 er ikke en svækkelse, det er en rettelse jeg lavede undervejs.** Først gjorde jeg
manglende dækning fatal i paritets-selvtesten. En repo-test afslørede at det var
forkert: planen skal efter sin egen forskrift *genereres forfra på skrivedagen*, og en
fil bygget på et nyere snapshot har et andet rytter-sæt end det daterede. Gaten ville
afvise præcis den fil man skal bruge. Nu er lagdelingen: selvtesten beviser **paritet**
på de navne begge sider kender (og fejler hvis der ikke er ét eneste), mens
**dækningskravet** håndhæves mod den friske population i `runRepair3570` — hvor
populationen er den rigtige, og hvor det er fail-closed. Scenarie 6 viser at det virker.

---

## 7. Verifikation

* `node --test` i `backend/`: **5.982 / 5.982**, 0 fejl.
* `repair3570Apply.test.js`: 41 → **48** tests (7 nye for `--plan-fil`, heraf 5 negative).
* `--selvtest --plan-fil`: 254.192 + 376.890 sammenligninger, 0 afvigelser, exit 0.
* `scripts/preflight-pr.ps1`: **GRØN** (4 kendte eslint-warnings, uændret).
* `backend/scripts/lintRiderTypeWrites.js`: grøn.
* Rollback-filens drift-vagt: grøn efter regenerering.

**Ikke verificeret:**

* NOTICE-teksten fra `RAISE NOTICE` er ikke opsamlet — PGlite har ingen notice-kanal.
  Portene er kørt og passerede (og de kaster ved enhver afvigelse), og rækketallene er
  efterprøvet med `count(*)`, men de præcise strenge operatøren ser i `psql` er læst ud
  af SQL'en, ikke observeret.
* Simuleringen kører PGlite (PostgreSQL 18.3); prod er PostgreSQL 17.6. A0-defekten og
  rettelsen er ikke afprøvet på 17.6. Plan-caching i PL/pgSQL er ens i begge, så jeg
  forventer samme adfærd, men jeg har ikke målt det.
* Simuleringen har ingen RLS, ingen concurrency og ingen netværks-latens. Batch-timing
  og lock-adfærd på prod er derfor ikke dækket.
* De 35 pensionerede ryttere er syntetiske (snapshottet indeholder kun levende).
  Rækketallet 8.234 stemmer med prod, men deres indhold gør ikke.

---

## 8. Det der skal besluttes før skrivedagen

`--plan-fil` gør værktøjet i stand til at **anvende** D. Det gør det ikke i stand til at
**regenerere** D: generatoren ligger i en session-scratchpad, ikke i repoet. Og trin 1 i
kørebogen vil efter al sandsynlighed kræve en regenerering, fordi bestanden driver
mellem plan og skrivedag (AI-hold oprettes og trimmes løbende). Fail-closed betyder at
kørslen så stopper — korrekt, men den skal kunne komme videre.

**A) Commit D-generatoren** til `backend/scripts/dev/` med en selvtest der reproducerer
D's tal mod det daterede snapshot. Skrivedagen: generér plan → trin 0 → 1 → 3.
Værktøjet forbliver målfunktions-agnostisk.
**B) Byg D's målfunktion ind i `buildPlan`.** Én kommando, ingen dæknings-gate.
Til gengæld ligger beslutningen i koden, og en ændret beslutning kræver en ny PR.

**Anbefaling: A.** Beslutningen kan blive truffet igen; en fil er billigere at leve med
end en `if`-gren. A beholder desuden dæknings-gaten, som er den der fanger «rytteren
blev født efter planen blev lavet».

---

## 9. Ændrede filer

| Fil | Ændring |
|---|---|
| `backend/scripts/dev/repair3570Apply.mjs` | `--plan-fil` (læsning, overlay, paritets-selvtest, fail-closed dækning, rapport-linjer) + A0-rettelsen i `rollbackSQL()` |
| `backend/scripts/dev/repair3570Rollback.sql` | regenereret (A0 nestet) |
| `backend/scripts/dev/repair3570Apply.test.js` | 7 nye tests |

Kørebog: `KOEREBOG.md`. Simulering og rå output: `sim/`.
