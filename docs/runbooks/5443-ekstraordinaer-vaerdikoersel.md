# Runbook: den ekstraordinære værdikørsel (#5443)

Rytterværdier flytter sig normalt **kun søndag fra kl. 06** dansk tid, med ét
dato-claim pr. søndag (`ECONOMY_RULES` §9.1). Ejeren besluttede 20/9 at
model-skiftet skal ud som **én ekstraordinær kørsel uden for søndagen**, så
snart alt er klart. Det her er rækkefølgen for netop den ene kørsel.

**Modellen er `v6`** — den typefri model med marked (#5497/#5502, ejer-lås
24/9, [indfasningsplanen](../superpowers/specs/2026-09-24-vaerdi-indfasningsplan.md)).
Den oprindelige plan var `v5` (typet); den er droppet. Scriptet nægter at
skrive med andet end `v6`, og kun med et gyldigt markeds-fit i
`app_config.rider_valuation_v6_market`.

**Alt i listen er ejer-handlinger.** Claude kører intet mod prod ud over SELECT.

| Rolle | Værktøj |
|---|---|
| Kørslen | `backend/scripts/riderValueExtraordinaryRun5443.js` (tørkørsel som standard) |
| Klik-knap | `scripts/run-value-event-5443.ps1` |
| Tørkørsel *før* nøglen flippes | samme script/knap: står nøglen ikke på `v6`, regner tørkørslen `v6` pinnet (samme funktion, samme marked, trin 0) |
| Tal pr. rytter/hold (privat) | `backend/scripts/dev/valuationV5DryRun5443.mjs --to=v6 --step=0`, eller admin-siden `/admin/value-preview` |
| Backup-tabel | `backup_5443_value_event_20260920` |
| Dato-claim + log | `rider_value_sunday_log` (samme mutex som søndagen) |

---

## Rækkefølge

### 1. Spillerbeskeden er ude

Udkast: `docs/drafts/2026-09-20-vaerdiskifte-udmelding-og-patch-note.md`
afsnit 1, med tilføjelserne fra indfasningsplanens afsnit 6 (typefri pris,
gradvis elitepræmie). Ejeren poster selv, kun EN. Udmeldingen lover en besked
**aftenen før** kørslen, så rækkefølgen er: udmelding → aftenen-før-besked →
trin 7. **Beskeden skal ud FØR kørslen** — værdi-deltaer sammenligner mod
forrige værdi, så begivenheden ser ud som en ægte ændring på hver eneste
rytterprofil.

### 2. Merge

Ejeren merger PR'en manuelt. Den indeholder `database/*.sql`, så den må aldrig
auto-merges (hard rule 9).

### 3. Migrationerne og nøglerne (post-verify)

`auto-migrate.yml` kører migrationerne ~3 min efter merge. Verificér:

```sql
select key, value from public.app_config
 where key in ('rider_valuation_model', 'rider_production_value_model');
-- forventet: begge findes, begge står '"v4"'

select key, jsonb_typeof(value) as type, value->>'schema' as schema
  from public.app_config
 where key in ('rider_valuation_v6_market');
-- forventet: object, schema 'typefree-market-fit/1' (selve tallene er private)

select to_regclass('public.backup_5443_value_event_20260920') as backup_tabel;
-- forventet: tabellen findes

select count(*) from public.backup_5443_value_event_20260920;
-- forventet: 0
```

Står nøglerne 'v4' og er backup-tabellen tom, har merge **ikke** flyttet nogen
værdi. Det er meningen.

### 4. Tørkørsel (nøglen står stadig på `v4`)

```powershell
pwsh -File scripts/run-value-event-5443.ps1
```

Skriver intet. Står `rider_valuation_model` endnu ikke på `v6`, pinner den
`v6` med markeds-fittet fra `app_config` og regner gennem **præcis den
funktion** trin 7 bagefter skriver med (trin 0, løngrundlaget frosset). Den
viser:

- om markedet er med (`marked=ja`). Står der `NEJ`: **STOP**, trin 5.
- hvor mange ryttere der ville ændre sig, op og ned
- **hvor mange løngrundlag der flytter sig** — skal være **0**: kørslen rører
  ikke `current_production_value` overhovedet

Er løngrundlags-tallet ikke 0: **STOP**. Så er opdelingen brudt.

Vil ejeren have tal pr. rytter og pr. hold, kører han i stedet
`backend/scripts/dev/valuationV5DryRun5443.mjs --to=v6 --step=0` (read-only,
skriver kun lokale filer under `balance-internals/`, som aldrig committes),
eller åbner `/admin/value-preview`.

Nøglen flippes **ikke** for at se tallene. Et flip uden kørslen lige efter ville
lade søndagskørslen regne trin 1 uden at trin 0 nogensinde er skrevet.

### 5. Markeds-nøglen er på plads

`--apply` nægter uden et gyldigt fit i `rider_valuation_v6_market` (ejer-lås:
markedet tæller med fra første aktivering). Nøglen skrives som sit eget
ejer-"kør" (indfasningsplanen afsnit 1 punkt 2). Tørkørslen i trin 4 viser
`marked=ja`, når den er klar.

### 6. Ejeren siger "kør"

Ordret go. Ingen andre trin må startes på et "vi tager den bagefter".

### 7. Flip prisens nøgle og kør apply i SAMME omgang

```sql
update public.app_config set value = '"v6"'::jsonb
 where key = 'rider_valuation_model';
```

```powershell
pwsh -File scripts/run-value-event-5443.ps1 -Apply
```

**Løngrundlaget skal IKKE flippes** (ejer-beslutning 2: "Løn skal ikke følge
værdi"). `rider_production_value_model` bliver stående på `'v4'` indtil
kontraktforlængelserne ved sæsonskiftet er overstået.

Nøglerne læses ved hver værdi-kørsel, ikke ved boot: intet deploy, ingen
genstart. Fra flippet regner **også den førstkommende søndagskørsel** med `v6`
— derfor kommer apply i samme omgang, ikke dagen efter.

Wrapperen beder om bekræftelses-sætningen. Scriptet gør så, i rækkefølge:

1. tjekker **alle** låse, før det læser en eneste rytter: bekræftelses-sætning,
   miljø-ack, `rider_valuation_model = 'v6'`, gyldigt markeds-fit i
   `rider_valuation_v6_market`, `rider_production_value_model = 'v4'`
   (ejer-beslutning 2 — lønnen venter), og at det **ikke er søndag** (den dag
   ejer den ordinære kørsel og det samme dato-claim)
2. skriver **backuppen** af de seks kolonner (`base_value`,
   `current_production_value`, `primary_type`, `secondary_type`, `best_role`,
   `best_role_rating`) for hele populationen og verificerer antallet
3. **claimer dagen** i `rider_value_sunday_log` — er dagen allerede claimet,
   stopper den uden at skrive
4. sætter trin-tælleren `rider_value_phase_step` til **0**
5. kalder `refreshChangedRiderValues` — samme funktion som søndagen, ingen ny
   formel. I **samme** kørsel skrives den nye pris (typefri + marked, trin 0),
   `primary_type`/`secondary_type` og `best_role`/`best_role_rating`.
   `current_production_value` lades urørt.
6. fylder log-rækken ud og kører post-verify

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

select key, value from public.app_config
 where key in ('rider_valuation_model', 'rider_production_value_model', 'rider_value_phase_step');
-- forventet: '"v6"', '"v4"', 0

-- Løn-kontrollen: løngrundlaget må ikke have flyttet sig.
select count(*) as loengrundlag_flyttet
  from public.riders r
  join public.backup_5443_value_event_20260920 b on b.rider_id = r.id
 where r.current_production_value is distinct from b.current_production_value;
-- forventet: 0 (kørslen skriver ikke kolonnen)
```

Kontrollér desuden i appen: et rytterkort viser samme tal som databasen, og
auktions-startprisloftet (1× `market_value`) følger den nye værdi.

### 9. Rollback-vejen (hvis tallene er forkerte)

```powershell
pwsh -File scripts/run-value-event-5443.ps1 -Rollback
```

Lægger de seks kolonner tilbage fra backup-tabellen, kun for de ryttere der
faktisk afviger. En gentagen rollback er et no-op.

**Sæt nøglen og trin-tælleren tilbage med det samme** — ellers skriver den
førstkommende søndagskørsel de nye værdier igen:

```sql
update public.app_config set value = '"v4"'::jsonb
 where key = 'rider_valuation_model';
update public.app_config set value = '0'::jsonb
 where key = 'rider_value_phase_step';
```

Rækkefølgen mellem de to er ligegyldig, så længe begge sker. Scriptet advarer
selv, hvis nøglen stadig står på `'v6'` efter en rollback. Markeds-nøglen
fjernes efter indfasningsplanens afsnit 4.

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
- `--apply` sætter den til **0 efter backup og dags-claim**, lige før første
  rytterværdi skrives. En tørkørsel, en blokeret kørsel og en kørsel der
  afvises ved backup eller claim rører den ikke.
- Hver fuldført søndagskørsel med prisen på `v6` regner med nøgle + 1 (loft 4)
  og skriver trinnet tilbage. Under `v4`/`v5` røres nøglen ikke. Efter en
  kørsel lørdag regner søndagen derfor trin 1 (75 %) og skriver kun de
  ryttere hvis tal faktisk ændrer sig — ikke alt forfra fra trin 0.
- Post-verify i Railway: søndagens linje `💰 Søndags-værdier` viser
  `model v6 · phase step N · production_value changed: …`. Søndagen fryser
  **ikke** løngrundlaget: den almindelige ugentlige v4-opdatering (evner der
  har flyttet sig siden sidst) må give et tal over 0. Det er ikke værdiskiftet,
  og løn-nøglen skal stadig stå på `v4`.
- **Rollback:** nulstil nøglen i samme statement-sæt som model-nøglen, ellers
  arver et senere skifte et gammelt trin (se trin 9).

## Hvad der med vilje IKKE er automatiseret

- **Flip af nøglerne.** Det er ejerens ene skridt i `app_config`, ikke et
  script-argument. Et script der både kan tænde modellen og køre den, kan tænde
  den ved en fejl.
- **En anden kørsel end den ene.** Backup-tabellen skal være tom, og dagen skal
  kunne claimes. Begge dele gør et gentaget kald til en fejl, ikke til en
  gentagelse.
- **Markedsblendet** (`market_value_sweep_enabled`, #4449). Urørt, stadig
  slukket. v6's markedsled er noget andet og ligger i selve modellen.
