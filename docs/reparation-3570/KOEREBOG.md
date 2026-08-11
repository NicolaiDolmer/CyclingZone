# Kørebog — #3570 ryttertype-reparationen (indstilling D)

Skrevet til at blive fulgt af en person der ikke har læst natbølgen.
Alt hvad der står her er kørt igennem i en simulering mod en ægte PostgreSQL 18.3
med prod-skemaet og hele 10/8-populationen. **Intet af det er kørt mod produktionen.**

> **Læs først:** trin 0 og 1 afgør om dagen overhovedet kan gennemføres.
> Springes de over, opdager du problemet efter at have skrevet til 8.193 ryttere.

---

## Før du begynder

| Ting | Værdi | Hvorfor |
|---|---|---|
| Skrivedag-suffiks | `YYYYMMDD` i dansk tid, fx `20260816` | Navngiver backup-tabellerne. **Samme værdi i alle tre kommandoer.** |
| Plan-fil | den godkendte D-plan (JSON) | Uden `--plan-fil` skriver værktøjet sin EGEN målfunktion (rev2) — 2.211 ryttere ville få en anden type end ejeren godkendte. |
| Kørselstid | identitet ~40 batches, lofter ~7.900 rækker | Skrivevinduet er 90–150 s. AI-hold-trimmen sletter ryttere imens; det er forventet. |
| Forbindelse | `$SUPABASE_DB_URL` (Infisical, env `prod`) | **Ikke `$DATABASE_URL`** — den findes ikke. Bruges den, rammer `psql` localhost og fejler med «Connection refused», hvilket ikke ligner det det er. Målt 11/8. |
| Rollback | `backend/scripts/dev/repair3570Rollback.sql` | Genereret fil. Ret den **aldrig** i hånden. |

Alle kommandoer køres fra `backend/`.

---

## Trin 0 — er planen stadig gyldig? (2 min, ingen skrivning)

```bash
node scripts/dev/repair3570Apply.mjs --selvtest --plan-fil=<sti-til-D.json>
```

**Forventet:**

```
  254.192 sammenligninger · 0 afvigelser
  ✅ planlæggeren reproducerer det godkendte dry-run
Planfil-selvtest mod <sti>
  376.890 sammenligninger · 0 afvigelser
  ✅ D — ejer-valgt indstilling (låst 10/8) …
  ✅ 8193 identiteter · 122895 loft-celler celle-identiske · 2211 afviger fra værktøjets egen løser
```

**Afbryder hvis:** planfilen og koden er uenige om ét eneste loft, én kvote eller én
type. Så er enten planen eller en delt lib flyttet sig, og dagen er aflyst indtil
det er forstået. Kør ikke videre.

---

## Trin 1 — dækker planen dagens population? (3 min, kun SELECT)

```bash
infisical run --env=prod -- node scripts/dev/repair3570Apply.mjs \
  --plan-fil=<sti-til-D.json> --backup-suffix=<YYYYMMDD>
```

Dette er dry-runnet. Det skriver ingenting.

**Forventet (tallene fra simuleringen på 10/8-populationen):**

```
── 1b/8 Godkendt skriveplan ──
  ✅ 376.890 sammenligninger · 0 afvigelser · 8193 identiteter
── 3/8 Planen bygges forfra ──
  8193 ryttere i skrive-scopet · 5977 skifter synlig type
  planfilen dækker 8193 af 8193 i scopet · 2211 identiteter afviger fra værktøjets egen løser
── 5/8 Idempotens-bevis ──
  anden kørsel ville skrive 0 rækker
── 6/8 DRY-RUN — intet skrives ──
  ville skrive identitet for 8193 ryttere og lofter for 7899
```

og i sammendraget: `alle` L1 `55.3 → 7.7`, `menneske-ejede` 2.700 nye typer,
`menneske-ejede 22+` L1 `128.0 → 23.6`.

**⚠ Den mest sandsynlige afbrydelse på dagen:**

```
STOP: N ryttere i skrive-scopet har ingen godkendt identitet i <fil>,
og 0 udelades af filen. Det er ryttere der er født efter planen blev lavet.
```

Det er **ikke** en fejl i værktøjet — det er fail-closed med vilje: restpopulationen
må ikke falde tilbage på løseren, for så ville to målfunktioner blive blandet i én
skrivning. Bestanden driver hele tiden (AI-hold oprettes og trimmes), så regn med at
den fyrer. **Løsningen er at generere D-planen forfra på et friskt snapshot** og køre
trin 0 og 1 igen. Se «Åben afhængighed» nederst.

---

## Trin 2 — sikkerhedskopien (eget, committet skridt)

Kopien skal committes FØR skrivningen. Den eneste virkelig farlige tilstand er
«identitet skrevet, ingen kopi», og den kan ikke opstå når kopien er commitet først.

Er skrivedagen **ikke** 16/8, generér filen med dagens suffiks først:

```bash
node scripts/dev/repair3570Apply.mjs --print-rollback-sql --backup-suffix=<YYYYMMDD> \
  > /tmp/rollback-<YYYYMMDD>.sql
```

Kør så **kun PART A** (alt før banneret `PART B — ROLLBACK`):

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f /tmp/rollback-<YYYYMMDD>.sql   # klip PART B fra
```

> **`-v ON_ERROR_STOP=1` er ikke valgfrit.** Uden det fortsætter `psql` efter en
> `RAISE EXCEPTION`, og spærrerne i A0/A3/B0/B2c holder op med at være spærrer.

**Forventet:** `psql` udskriver A3-portens `NOTICE` med formen
`Kopi: 8234 / 8234 riders, 8234 / 8234 abilities. Kontrol 1-4: 0, 0, 0, 0.` og
afslutter med `COMMIT`.

> Simuleringen kunne ikke opsamle selve NOTICE-teksten (PGlite har ingen
> notice-kanal), men den kørte PART A ordret og porten **passerede** — og A3 kaster
> hvis blot ét af de otte tal afviger. Rækketallene 8234/8234 er efterprøvet med
> direkte `count(*)`.

**Afbryder hvis:** A0 finder mere end 50 ryttere med `archetype_draw` (reparationen er
allerede helt eller delvis kørt — en kopi taget nu er en efter-tilstand og ubrugelig
som rollback-kilde), eller A3 finder at kopien ikke er komplet. Begge ruller hele
PART A tilbage; der er ingen halv kopi at rydde op i.

Kontrollér til sidst selv:

```sql
SELECT count(*) FROM public.riders_3570_backup_<YYYYMMDD>;                    -- 8234
SELECT count(*) FROM public.rider_derived_abilities_3570_backup_<YYYYMMDD>;   -- 8234
```

---

## Trin 3 — skrivningen

```bash
infisical run --env=prod -- node scripts/dev/repair3570Apply.mjs \
  --apply --jeg-har-set-dry-runnet \
  --plan-fil=<sti-til-D.json> --backup-suffix=<YYYYMMDD>
```

Begge flag skal med; `--apply` alene skriver ingenting.

**Forventet:**

```
── 6/8 Backup FØR skrivning ──
  genbruger eksisterende public.riders_3570_backup_<YYYYMMDD> (8234 rækker, 6 med draw)
  ✅ backup verificeret: 8234 riders-rækker + 8234 abilities-rækker
── 7/8 Skrivning ──
  identitet: 8193 ryttere i 115 batches (49 type-grupper)
  lofter: 7899 rækker
── 8/8 Post-verify ──
  ✅ 8193 ryttere kontrolleret · 0 afvigelser
  ℹ N ryttere blev SLETTET under kørslen (AI-hold-trim, forventet — ikke en fejl)
```

**Det der IKKE er en fejl:** `forsvundetUnderKoerslen` og `traenetUnderKoerslen`.
Ryttere slettes løbende af `aiTeamTrimHealSweep` (målt 180 på 12,5 timer 10/8), og
en rytter kan træne midt i kørslen. Begge rapporteres, ingen af dem afbryder.

**Det der ER en fejl — alt andet.** Post-verify kaster ved: manglende `archetype_draw`,
`primary_type` der ikke resolver til draw'et, loft ≠ `buildCapsForRider`, loft under
rytterens nuværende evne, ændret `valuation_type`, en levende rytter uden
abilities-række, eller flere end `max(25, 5 %)` forsvundne. Sker det → **trin 4**.

---

## Trin 4 — rollback

Kør **PART B** (fra banneret og ned) af den SAMME fil du brugte i trin 2:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f /tmp/rollback-<YYYYMMDD>.sql   # kun PART B
```

**Forventet:** B0 kvitterer med `Backup OK: 8234 riders-rækker, … 6 med draw`, og
B2c med `Rollback kontrolleret på 8234 rækker: draw 0, primary 0, secondary 0,
caps 0, progress 0.` — derefter `COMMIT`.

> Samme forbehold som i trin 2: NOTICE-teksten er ikke opsamlet i simuleringen, men
> B2c-porten passerede, og den kaster hvis ét af de fem tal er forskelligt fra nul.
> At før-tilstanden faktisk er genskabt er efterprøvet uafhængigt af porten — se
> nedenfor.

Rollbacken er idempotent — anden kørsel rammer 0 rækker og er stadig grøn.

**Verificeret i simuleringen:** backup → skrivning → rollback bringer alle 16.468
rækker tilbage til udgangspunktet, felt for felt, 0 afvigelser. Både når PART A tog
kopien og når værktøjet selv fyldte den.

**Hvad rollbacken IKKE kan** (står også i filens B4): alt der er sket siden
skrivningen, spillernes handlinger truffet på den nye identitet, løbsresultater kørt
med de nye lofter, ryttere oprettet efter kopien, ryttere slettet siden kopien — og
det spillerne har SET.

---

## Hvis en kørsel bliver afbrudt midtvejs

Værktøjet skriver hvor langt den nåede:

```
UPDATE riders: nåede 3786/8193 ryttere (40 batches OK), batch …@300 fejlede: …
```

**Gør IKKE dette:** tag en ny backup med et nyt suffiks. Databasen bærer nu en halv
reparation, så enhver kopi taget herfra er en efter-tilstand. Værktøjet nægter og
siger det:

```
STOP: public.riders indeholder 3792 ryttere med archetype_draw (før reparationen er
tallet ≤ 50). En kopi taget NU ville være taget EFTER en reparation og duer ikke som
rollback-kilde.
```

(Målt i simuleringen: den nye kopi-tabel indeholdt **0 rækker** da spærren fyrede.)

**Gør i stedet ét af to:**

1. **Rul tilbage først** — kør PART B mod den ORIGINALE kopi, kør så hele dagen
   forfra fra trin 1. *Verificeret: bringer alle 16.468 rækker tilbage, og først
   DEREFTER tillader værktøjet en ny kopi.*
2. **Genoptag** — kør trin 3 igen med samme suffiks og `--fortsaet-delvis`.
   Den gyldige før-kopi genbruges. Læs advarslen i flagets hjælpetekst først.

---

## Åben afhængighed — læs før du planlægger dagen

`--plan-fil` gør værktøjet i stand til at *anvende* D. Det gør det ikke i stand til at
*regenerere* D: generatoren for indstilling D ligger i en session-scratchpad, ikke i
repoet. Og trin 1 vil efter al sandsynlighed kræve en regenerering, fordi bestanden
driver mellem plan og skrivedag.

To veje, og de skal vælges FØR skrivedagen:

**A) Commit D-generatoren** til `backend/scripts/dev/`, med en selvtest der reproducerer
D's tal mod det daterede snapshot. Skrivedagen bliver: generér plan → trin 0 → trin 1
→ trin 3. Værktøjet forbliver målfunktions-agnostisk, så næste beslutning ikke kræver
endnu en kodeændring.

**B) Byg D's målfunktion ind i `buildPlan`** og drop plan-filen. Én kommando, ingen
dæknings-gate der kan fyre. Til gengæld ligger ejerens beslutning så i koden, og en
ændret beslutning kræver en ny PR.

**Anbefaling: A.** Beslutningen er allerede truffet én gang og kan blive truffet igen;
at have den i en fil frem for i en `if`-gren er billigere at leve med. A giver
desuden dæknings-gaten, som er den der fanger «rytteren blev født efter planen».

---

## Ét-siders opsummering

| Trin | Kommando | Skriver? | Afbryder hvis |
|---|---|---|---|
| 0 | `--selvtest --plan-fil=…` | nej | plan og kode uenige |
| 1 | `--plan-fil=… --backup-suffix=…` | nej | rytter i scopet mangler i planen |
| 2 | `psql -v ON_ERROR_STOP=1 -f …` (PART A) | ja, kun kopien | >50 draws, eller kopien ufuldstændig |
| 3 | `--apply --jeg-har-set-dry-runnet --plan-fil=… --backup-suffix=…` | **ja** | backup ikke verificeret, post-verify fejler |
| 4 | `psql -v ON_ERROR_STOP=1 -f …` (PART B) | ja, tilbage | kopien mangler, er tom eller er en efter-tilstand |
