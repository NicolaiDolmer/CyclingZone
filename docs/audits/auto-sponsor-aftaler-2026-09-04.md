# Auto-tildelte sponsoraftaler — undersøgelse (4/9)

## 1. Kodevej for auto-tildeling
`backend/lib/sponsorContractsService.js` (`expireAndRenewContracts`, kaldt fra `seasonTransition.js`
ved hver sæson-transition): har holdet ingen matchende `pending`-kontrakt for den nye sæson, oprettes
en `DEFAULT_RENEW_VARIANT = "safe"`-aftale direkte som `active` (#2914, ejer-beslutning 25/7 — "et
ikke-valg binder 1 sæson, ikke 3"). Ingen kolonne markerer "auto" — variant/length er identisk med
en manager der bevidst vælger 'safe'.

`safe` (`sponsorOffers.js`): `guaranteedFraction 0.92 · raceDayShare 0.08 · lengthSeasons 1` — den
**højeste garanti-andel** af alle 5 arketyper (loyal 0,78 · ambition 0,70 · results 0,60 · racing
0,50). Til gengæld intet upside: total potentiale fast 1,00× `renownTarget` (mod fx results'
0,72–1,25× eller ambition 0,90–1,28×). `renownTarget = SPONSOR_INCOME_BY_DIVISION[div] ×
clamp(1+0,45×resultsScore, 1.00, 1.40)`. D1-base = 600.000 (`economyConstants.js`).

## 2. Fingerprint for auto vs. manuelt i data
Ingen `source`-kolonne. Men: alle 'safe'/1-sæsons-aftaler oprettet **direkte som `active`** i samme
sekund-vindue er batch-fornyelser (auto); manuelt valgte 'safe'-aftaler ligger som `pending` i ugerne
før og bliver kun `UPDATE`'et til `active` (samme `created_at` som da manageren valgte).

D1, `variant='safe'`, `status='active'` (10 hold) — sorteret:

| Hold | guaranteed_base | created_at |
|---|---|---|
| **Bad At Names** | **772.800** | 2026-08-23 18:22:38 |
| TR Cycling | 772.800 | 2026-08-23 18:22:19 |
| Apex Cycling | 772.800 | 2026-08-23 18:22:27 |
| L'Échappée du Soleil | 515.200 | 2026-08-22 11:17:59 |
| NewE Pro Cycling | 515.200 | 2026-08-17 12:05:22 |
| Pro Cycling Team | 515.200 | 2026-07-28 11:38:52 |
| Bacon Fræsers | 515.200 | 2026-08-21 17:54:41 |
| Équipe Lorraine Acier | 515.200 | 2026-08-18 21:23:44 |
| Vallados del Sur | 437.920 | 2026-07-27 17:39:39 |
| Chuchiet | 368.000 | 2026-07-27 12:57:14 |

De tre 772.800-rækker deler sekund-nøjagtigt `created_at` (18:22:19–18:22:38) — det er batch-køret
`expireAndRenewContracts` for S3. De 7 andre blev valgt individuelt, dage/uger tidligere, og kun
aktiveret (ikke oprettet) ved samme transition. **Kun Bad At Names, TR Cycling og Apex Cycling er
reelt auto-tildelte S3-aftaler.**

## 3. Division/manuel-sammenligning (aktive kontrakter, S3)

| Division | Bucket | n | median base | max base |
|---|---|---|---|---|
| D1 | safe/auto (10) | 10 | 515.200 | **772.800** |
| D1 | manuel andet (14) | 14 | 263.500 | 392.000 |
| D2 | safe/auto (26) | 26 | 515.200 | 515.200 |
| D2 | manuel andet (22) | 22 | 220.804 | 347.480 |
| D3 | safe/auto (79) | 79 | 421.119 | 437.920 |
| D3 | manuel andet (17) | 17 | 245.700 | 347.480 |
| D4 | safe/auto (66) | 66 | 305.976 | 405.720 |
| D4 | manuel andet (2) | 2 | 189.000 | 220.500 |

Mønsteret er **struktur**, ikke et auto-specifikt problem: 'safe' har den højeste garanti-andel
(0,92) af alle 5 arketyper, så ENHVER 'safe'-aftale — auto eller selvvalgt — slår `guaranteed_base`
for hold der valgte en lavere-garanti/højere-upside-variant. 96 % af D3's 'safe'-hold er da også
selv auto-fornyet (79 af 96), fordi de fleste ikke aktivt vælger om.

## 4. Bad At Names i detalje
S1: D3 rang 13 → S2: **D3 rang 1** (vandt divisionen) → S3: **D1** (sprang D2 over — direkte
dobbelt-oprykning). Aftale: `safe`, `guaranteed_base 772.800` = D1-base 600.000 × **maks
renown-multiplier 1,40** × 0,92. Det er loftet for hvad NOGEN D1-'safe'-aftale kan give — ingen
kan komme højere med samme variant.

**Rod-årsagen til at Bad At Names/TR/Apex ligger på 772.800 mens de fem andre 'safe'-hold ligger på
515.200:** 515.200 / 0,92 / 1,40 = **400.000 = D2-basen**, ikke D1's 600.000. De fem hold der valgte
manuelt gjorde det på et tidspunkt hvor deres `teams.division`-felt endnu stod på D2 (før
oprykningen var skrevet — præcis den kendte fælde i `SPONSOR_RULES.md` §3: "aftalen prissættes mod
den division holdet var i på VALGTIDSPUNKTET, før op-/nedrykning er skrevet"). Bad At Names/TR/Apex
fik i stedet deres aftale skrevet af auto-fornyelsen, som kører EFTER at oprykningen til D1 var
skrevet i `teams`-tabellen — så den låste den fulde D1-base i stedet for den forældede D2-base.
Alle tre havde i øvrigt renown-multiplier i loft (1,40) — konsistent med kendt åben modsigelse
§8.7 i SPONSOR_RULES.md ("alle 24 D1-hold har resultsScore=1,0 → multiplier 1,40 fordi de alle blev
forfremmet").

## 5. Konklusion (5 linjer)
1. Auto-tildelte aftaler er ikke systematisk bedre pga. at de er auto — 'safe' er den
   højeste-garanti-arketype for ALLE der vælger/får den, manuelt eller ej; det er ren
   variant-mekanik, ikke en auto-bonus.
2. Bad At Names ER dog et reelt outlier: 772.800 er den absolutte D1-loft-værdi (D1-base × maks
   multiplier × 0,92) og ligger 50 % over de andre fem 'safe'-D1-hold (515.200) og næsten 2× over
   den bedste manuelt forhandlede D1-aftale (392.000).
3. Årsagen er en timing-fejl, ikke en "belønning for at glemme": aftalen prissættes mod
   `teams.division` PÅ SKRIVETIDSPUNKTET. Hold der forhandlede manuelt FØR deres oprykning var
   skrevet, blev prissat mod den gamle (lavere) division; Bad At Names/TR Cycling/Apex Cycling fik
   deres auto-aftale skrevet EFTER oprykningen, så de fangede den fulde nye D1-base — samme kendte
   hul som SPONSOR_RULES.md §3 allerede beskriver og har en plan for (divisions-tillæg, ikke bygget
   endnu).
4. Kun 3 af 230 hold er ramt af akkurat denne variant af hullet i S3 (Bad At Names, TR Cycling,
   Apex Cycling) — alle dobbelt-/hurtig-oprykkede hold hvor auto-fornyelsen faldt efter
   divisionsskrivningen.
5. **Anbefaling: B-variant, målrettet** — ikke et generelt cap på auto-aftaler (de er ikke
   overordnet skæve, jf. pkt. 1), men luk selve timing-hullet: lås `signed_division` til holdets
   division FØR sæsonens oprykninger skrives (samme kolonne §3 i SPONSOR_RULES.md allerede
   planlægger), så alle aftaler — auto og manuelle — prissættes mod samme division uanset hvornår
   på sæsonen de laves. Det retter både denne skævhed og #4376 i samme ombæring.

<details>
<summary>SQL brugt (til efterprøvning)</summary>

```sql
-- Hold-opslag
select id,name,division from teams where name ilike '%bad at%' or name ilike '%names%';

-- Variant/status-fordeling
select variant, length_seasons, status, count(*), min(created_at), max(created_at)
from sponsor_contracts group by variant, length_seasons, status order by count(*) desc;

-- Bad At Names' kontrakthistorik
select sc.*, t.name, t.division from sponsor_contracts sc join teams t on t.id=sc.team_id
where sc.team_id = '814b9df1-e2b9-4a3c-9ac1-ac33d7439bc4' order by sc.created_at;

-- Auto/safe vs. manuel pr. division
select t.division,
  case when sc.variant='safe' and sc.length_seasons=1 then 'auto_or_safe' else 'manual_other' end as bucket,
  count(*), round(avg(sc.guaranteed_base)) as avg_base,
  percentile_cont(0.5) within group (order by sc.guaranteed_base) as median_base,
  max(sc.guaranteed_base) as max_base, min(sc.guaranteed_base) as min_base
from sponsor_contracts sc join teams t on t.id=sc.team_id
where sc.status='active' group by t.division, bucket order by t.division, bucket;

-- D1 safe-kohorte, sorteret
select t.name, sc.guaranteed_base, sc.start_season, sc.created_at
from sponsor_contracts sc join teams t on t.id=sc.team_id
where t.division=1 and sc.status='active' and sc.variant='safe' and sc.length_seasons=1
order by sc.guaranteed_base desc;

-- Divisions-historik
select ss.season_id, t.name, ss.division, ss.rank_in_division
from season_standings ss join teams t on t.id=ss.team_id
where t.name in ('Bad At Names','TR Cycling','Apex Cycling','L''Échappée du Soleil','Pro Cycling Team')
order by t.name, ss.season_id;
```
</details>
