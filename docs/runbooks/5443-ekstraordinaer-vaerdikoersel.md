# Runbook: den ekstraordinære værdikørsel (#5443)

Rytterværdier flytter sig normalt **kun søndag fra kl. 06** dansk tid, med ét
dato-claim pr. søndag (`ECONOMY_RULES` §9.1). Ejeren besluttede 20/9 at
model-skiftet skal ud som **én ekstraordinær kørsel uden for søndagen**, så
snart alt er klart. Det her er rækkefølgen for netop den ene kørsel.

**Alt i listen er ejer-handlinger.** Claude kører intet mod prod ud over SELECT.

| Rolle | Værktøj |
|---|---|
| Kørslen | `backend/scripts/riderValueExtraordinaryRun5443.js` (tørkørsel som standard) |
| Klik-knap | `scripts/run-value-event-5443.ps1` |
| Tørkørsel *før* nøglen flippes | `backend/scripts/dev/valuationV5DryRun5443.mjs` |
| Backup-tabel | `backup_5443_value_event_20260920` |
| Dato-claim + log | `rider_value_sunday_log` (samme mutex som søndagen) |

---

## Rækkefølge

### 1. Spillerbeskeden er ude

Udkast: `docs/drafts/2026-09-20-vaerdiskifte-udmelding-og-patch-note.md`
afsnit 1 (afløser afsnit B i `2026-09-20-vaerdimodel-spillerbesked.md`). Ejeren
poster selv, kun EN. Udmeldingen lover en besked **aftenen før** kørslen, så
rækkefølgen er: udmelding → aftenen-før-besked → trin 4. **Beskeden skal ud FØR kørslen** — værdi-deltaer sammenligner mod forrige
værdi, så begivenheden ser ud som en ægte ændring på hver eneste rytterprofil.

### 2. Merge

Ejeren merger PR'en manuelt. Den indeholder `database/*.sql`, så den må aldrig
auto-merges (hard rule 9).

### 3. Migrationerne er kørt (post-verify)

`auto-migrate.yml` kører dem ~3 min efter merge. Verificér:

```sql
select key, value from public.app_config
 where key in ('rider_valuation_model', 'rider_production_value_model');
-- forventet: begge findes, begge står '"v4"'

select to_regclass('public.backup_5443_value_event_20260920') as backup_tabel;
-- forventet: tabellen findes

select count(*) from public.backup_5443_value_event_20260920;
-- forventet: 0
```

Står nøglerne 'v4' og er backup-tabellen tom, har merge **ikke** flyttet nogen
værdi. Det er meningen.

### 4. Flip prisens nøgle

```sql
update public.app_config set value = '"v5"'::jsonb
 where key = 'rider_valuation_model';
```

**Løngrundlaget skal IKKE flippes nu** (ejer-beslutning 2: "Løn skal ikke følge
værdi"). `rider_production_value_model` bliver stående på `'v4'` indtil
kontraktforlængelserne ved sæsonskiftet er overstået.

Nøglerne læses ved hver værdi-kørsel, ikke ved boot: intet deploy, ingen
genstart. Fra dette sekund vil **også den førstkommende søndagskørsel** regne
med v5 — derfor kommer kørslen herunder lige efter, ikke dagen efter.

### 5. Tørkørsel

```powershell
pwsh -File scripts/run-value-event-5443.ps1
```

Skriver intet. Den regner gennem **præcis den funktion** trin 7 bagefter
skriver med, og viser:

- hvor mange ryttere der ville ændre sig, op og ned
- **hvor mange løngrundlag der flytter sig** — forventet **0**, så længe
  løn-nøglen står på `'v4'`

Er det tal ikke 0: **STOP**. Så er løn-nøglen flippet ved en fejl, eller
opdelingen er brudt.

Vil ejeren have tal pr. rytter og pr. hold, kører han i stedet
`backend/scripts/dev/valuationV5DryRun5443.mjs` (read-only, skriver kun lokale
filer under `balance-internals/`, som aldrig committes).

### 6. Ejeren siger "kør"

Ordret go. Ingen andre trin må startes på et "vi tager den bagefter".

### 7. Apply

```powershell
pwsh -File scripts/run-value-event-5443.ps1 -Apply
```

Wrapperen beder om bekræftelses-sætningen. Scriptet gør så, i rækkefølge:

1. tjekker **alle** låse, før det læser en eneste rytter: bekræftelses-sætning,
   miljø-ack, `rider_valuation_model = 'v5'`, `rider_production_value_model =
   'v4'` (ejer-beslutning 2 — lønnen venter), og at det **ikke er søndag**
   (den dag ejer den ordinære kørsel og det samme dato-claim)
2. skriver **backuppen** af `(base_value, current_production_value,
   primary_type, secondary_type)` for hele populationen og verificerer antallet
3. **claimer dagen** i `rider_value_sunday_log` — er dagen allerede claimet,
   stopper den uden at skrive
4. kalder `refreshChangedRiderValues` — samme funktion som søndagen, ingen ny
   formel
5. fylder log-rækken ud og kører post-verify

Fejler noget før punkt 4, er der ikke skrevet en eneste rytterværdi. Låsene
ligger med vilje **før** backuppen: backuppen kan kun tages én gang, så en
afvisning efter den ville spærre næste forsøg.

### 8. Post-verify

```sql
select run_date, scanned, changed, written, completed_at
  from public.rider_value_sunday_log
 order by run_date desc limit 3;

select count(*) from public.backup_5443_value_event_20260920;
-- forventet: hele den aktive population

-- Løn-kontrollen: løngrundlaget må ikke have flyttet sig.
select count(*) as loengrundlag_flyttet
  from public.riders r
  join public.backup_5443_value_event_20260920 b on b.rider_id = r.id
 where r.current_production_value is distinct from b.current_production_value;
-- forventet: 0
```

Kontrollér desuden i appen: et rytterkort viser samme tal som databasen, og
auktions-startprisloftet (1× `market_value`) følger den nye værdi.

### 9. Rollback-vejen (hvis tallene er forkerte)

```powershell
pwsh -File scripts/run-value-event-5443.ps1 -Rollback
```

Lægger de fire kolonner tilbage fra backup-tabellen, kun for de ryttere der
faktisk afviger. En gentagen rollback er et no-op.

**Sæt nøglen tilbage med det samme** — ellers skriver den førstkommende
søndagskørsel de nye værdier igen:

```sql
update public.app_config set value = '"v4"'::jsonb
 where key = 'rider_valuation_model';
```

Rækkefølgen mellem de to er ligegyldig, så længe begge sker. Scriptet advarer
selv, hvis nøglen stadig står på `'v5'` efter en rollback.

---

## Bagefter

- Patch note (EN først, DA under) + `help.json` hvis mekanikken forklares.
- `ECONOMY_RULES` §9.1 har allerede kørslen med som punkt 8 — opdatér status
  fra "planlagt" til datoen den kørte.
- Drop backup-tabellen først når rollback-vinduet er lukket:
  `DROP TABLE IF EXISTS public.backup_5443_value_event_20260920;`
- Løngrundlaget (`rider_production_value_model`) flippes som **sin egen**
  beslutning, efter sæsonskiftet — ikke som en hale på denne kørsel.

## Indfasning uge 1-4

Denne kørsel er kun kørselsdagens trin (trin 0). Elitepræmien udfases derefter
over de fire følgende ordinære søndagskørsler (100 % → 75 % → 50 % → 25 % →
0 %) — ejer-direktiv 24/9, #5497. Rækkefølge, rollback pr. trin og forholdet
til sæsonskiftet 27-28/9 står i
[`docs/superpowers/specs/2026-09-24-vaerdi-indfasningsplan.md`](../superpowers/specs/2026-09-24-vaerdi-indfasningsplan.md).
Denne runbook dækker kun selve kørselsdagen; de fire efterfølgende trin kører
gennem den almindelige søndagskørsel, ikke gennem dette script.

### Trin-tælleren (`app_config.rider_value_phase_step`, #5497)

- Nøglen er det trin (0-4) der **sidst er skrevet** til rytterne. Manglende
  eller ugyldig værdi = 0 (fuld præmie).
- `--apply` sætter den til **0 som første skrivning**, før backuppen. En
  tørkørsel og en blokeret kørsel rører den ikke.
- Hver fuldført søndagskørsel med prisen på `v6` regner med nøgle + 1 (loft 4)
  og skriver trinnet tilbage. Under `v4`/`v5` røres nøglen ikke.
- Post-verify i Railway: søndagens linje `💰 Søndags-værdier` viser
  `model v6 · phase step N · production_value changed: 0`. Løngrundlaget skal
  stå på 0, så længe løn-nøglen er `v4`.
- **Rollback:** nulstil nøglen i samme statement-sæt som model-nøglen, ellers
  arver et senere skifte et gammelt trin:

```sql
update public.app_config set value = '0'::jsonb
 where key = 'rider_value_phase_step';
```

## Hvad der med vilje IKKE er automatiseret

- **Flip af nøglerne.** Det er ejerens ene skridt i `app_config`, ikke et
  script-argument. Et script der både kan tænde modellen og køre den, kan tænde
  den ved en fejl.
- **En anden kørsel end den ene.** Backup-tabellen skal være tom, og dagen skal
  kunne claimes. Begge dele gør et gentaget kald til en fejl, ikke til en
  gentagelse.
- **Markedsblendet.** Urørt, stadig slukket. Eget skridt (#4449).
