# Sponsor-timing-hul — D2/D3/D4 gennemgang (4/9)

## Resumé (5 linjer)
1. Samme hul som D1 (§3 SPONSOR_RULES.md): batch-fornyelsen `expireAndRenewContracts` kørte i ÉT
   sammenhængende vindue 2026-08-23 18:21:48–18:23:01 (S3-transition), EFTER at oprykninger var
   skrevet i `teams.division` — auto-'safe'-aftaler i det vindue låser derfor NY division i stedet
   for den division holdet reelt forhandlede sig op fra.
2. D2: 15 hold ramt — alle oprykket D3→D2, prissat 515.200 (D2-base 400k×1,40×0,92) i stedet for
   437.920 (D3-base 340k×1,40×0,92).
3. D3: 12 hold ramt — alle oprykket D4→D3, prissat 437.920 (D3-base 340k×1,40×0,92) i stedet for
   405.720 (D4-base 315k×1,40×0,92).
4. D4: 0 hold ramt — D4 er bundniveau, ingen "gammel lavere division" findes at prissætte forkert
   imod. Dobbelt-oprykkede D4→D2-hold (analogt Bad At Names) findes ikke i batch-vinduet; de 7
   D4→D2-hold i data er alle manuelt forhandlet FØR oprykningen (korrekt prissat).
5. Alle 27 flaggede hold har renown-multiplier i loft (1,40), samme mønster som D1 (§8.7).
   Anbefaling uændret fra D1-analysen: lås `signed_division` FØR sæsonens oprykninger skrives.

## Flaggede hold

### Division 2 (15 hold) — bør korrigeres til 437.920 (diff −77.280/sæson pr. hold)
StormBreaker Continental Team · Trader Joe / Schwan's · Team Velocity One · Team Discover ·
MatsenSid · Team Riskær · Fellaini Racing Team · Universal Cycling · Bouboule Team ·
Air France-KLM Team · Scallabis Cycling Team · Breda · Team CSC · martharacing · Indeso

Alle: nuværende division 2, S2-slutdivision 3, variant `safe`, `guaranteed_base` 515.200,
`created_at` 2026-08-23 18:21:52–18:23:01.

### Division 3 (12 hold) — bør korrigeres til 405.720 (diff −32.200/sæson pr. hold)
ADM Cycling · Visma LAB · De Opwijkse Pedaalstoempers · den usaltet smør · Ponot Cycling ·
lopel racing · Sportivianna DeLuxe · Efapel cycling · Ballets Cycling · One Two Three Cycling Club ·
Cana Climbers · Camargue Pro Cycling

Alle: nuværende division 3, S2-slutdivision 4, variant `safe`, `guaranteed_base` 437.920,
`created_at` 2026-08-23 18:21:50–18:22:55.

### Division 4
Ingen flaggede hold.

## Totaler

| Division | Flaggede hold | Nuværende base | Korrigeret base | Diff/hold/sæson | Total diff/sæson |
|---|---|---|---|---|---|
| D2 | 15 | 515.200 | 437.920 | −77.280 | **−1.159.200** |
| D3 | 12 | 437.920 | 405.720 | −32.200 | **−386.400** |
| D4 | 0 | – | – | – | 0 |
| **Alt** | **27** | | | | **−1.545.600 / sæson** |

(Til sammenligning: D1-korrektionen 3/9 var 3 hold × (772.800−515.200) = 772.800/sæson.)

<details>
<summary>SQL brugt (til efterprøvning)</summary>

```sql
-- Batch-vindue + base pr. division (D2-D4, safe/1-sæson, aktiv)
select t.division, t.id as team_id, t.name, sc.guaranteed_base, sc.start_season, sc.created_at
from sponsor_contracts sc join teams t on t.id = sc.team_id
where sc.status='active' and sc.variant='safe' and sc.length_seasons=1 and t.division in (2,3,4)
order by t.division, sc.created_at;

-- S2-slutdivision vs. nuværende division (finder oprykkere/nedrykkere)
select ss.team_id, t.name, t.division as current_division, ss.division as s2_division,
  ss.rank_in_division
from season_standings ss join teams t on t.id = ss.team_id
where ss.season_id = '00000000-0000-0000-0000-000000000002' and t.division in (2,3,4)
  and ss.division <> t.division
order by t.division, ss.division;

-- Flag-kriterie: created_at i batch-vinduet 2026-08-23 18:21:48–18:23:01 OG s2_division > current_division
-- (oprykket), korrigeret base = SPONSOR_INCOME_BY_DIVISION[s2_division] × 1.40 × 0.92
-- (SPONSOR_INCOME_BY_DIVISION: D1=600000 D2=400000 D3=340000 D4=315000, backend/lib/economyConstants.js)
```
</details>
