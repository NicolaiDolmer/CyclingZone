# #5928 verificering mod prod-data: træthed og form 5x pr. dato (29/10)

Undersøgelsesspor (#5220), read-only. Ingen kode og ingen prod-skrivning. Alle tal kommer fra Supabase SELECT 29/10.
Managerhold = `teams.is_ai = false AND is_bank = false AND is_test_account = false`.

## Rettelser der er målt
- #5926 (merget 29/9): træthed og form afregnes én gang pr. dato med datoens samlede, normaliserede belastning. Cutover blev gennemført aftenen 29/9 (#5937, #5962, #5969).
- #6672 (merget 15/10): GT-træthed hober sig op (etapens plads i løbet og reelt arbejde) bag revisionen `s5_profiles_v1`. Revisionen blev aktuel med #6699 (17/10).
- Vuelta Ibérica S4 (18-23/10) er det første og hidtil eneste GT kørt på `s5_profiles_v1`. Giro (`orders_gc_v2`) og Tour (`official_times_v3`) S4 kørte på den gamle model og fungerer som kontrolgruppe.

## 1. 5x-effekten: før rettelsen, før S4 og nu

Før rettelsen (28/9) kørte 5 ticks pr. dato. Kilden er `training_day_runs.report->riders`, hvor `form` og `fatigue` er værdien EFTER tick og `fatigue_delta` er tickets ændring (`dailyTrainingEngine.js:1528-1530`).
28/9 var også S4's sæsonreset. Derfor er 28/9 målt inden for datoen, fra tick gd0 til gd4 (4 ticks), for ryttere med alle 5 ticks (n=2.757). Så indgår resettet ikke.

| Periode, managerhold | Træthedsændring pr. dato, median / p90 / max | Formændring pr. dato, \|median\| / \|p90\| / min..max |
|---|---|---|
| Før S4, 26-27/9 (1 tick pr. dato) | -10..-8 / 2..4 / 11..12 | 1 / 3 / -4..+3 |
| **Før rettelsen, 28/9, kun 4 af 5 ticks** | 0 / **26** / **31** | 4 / **12** / **+4..+12** |
| Før rettelsen, 28/9, hele datoen inkl. reset | 4 / 41 / 50 | 28 / 39 / -36..+54 (resettet indgår) |
| Efter rettelsen, 29/9-1/10 | 6..8 / 8..11 / 11..13 | 1 / 1..3 / +1..+3 |
| **Sidste 7 dage, 22-28/10** | 0..10 / 4..11 / 12..42* | 1..2 / 1..3 / **-4..+3** |

\* Ryttere uden løbsbelastning, 22-28/10 (n=13.235 rytter-datoer): median +2, p90 +10, max **+12**. Det er samme loft som før S4. Over +14 forekommer kun hos ryttere med løbsbelastning (50 af 8.658). Det er G3's tilsigtede etapeløbstræthed.

Form 22-28/10: ingen rytter-dato med |Δform| > 4 (`form_gt4 = 0` på alle datoer 29/9-28/10).

**Dom, punkt 1:** 5x-effekten er væk. Efter rettelsen ændrer træthed og form sig pr. dato som før S4 (form -4..+3, træthed uden løb højst +12).

Kontinuitet: `opening_condition` på dato d er lig `applied_condition` på d-1 for alle managerhold-ryttere 16-25/10 og 28/10. Der er altså ingen skjult ekstra afregning mellem datoerne. Der er to forklarlige brud:
- 26/10: S5-sæsonreset (`season_form_reset_runs`, decay 25/10 20:27 UTC).
- 27/10: alle ryttere åbner med træthed 20 (7.858 af 7.864; 6 står på 0). Det er sæsonstartens fastsatte niveau (#7282/#7288, mellem sæsoner). Det er en engangshændelse og ikke en per-tick-fejl. Det hører ikke under #5928.

## 2. Grand Tour: hober trætheden sig op, så uge 3 bliver hård? (ejer 15/10)

Løbsbelastning pr. etape (`training_race_loads`, alle ryttere i løbet):

| GT S4 | Revision | Uge 1 gns / p90 | Uge 2 gns / p90 | Uge 3 gns / p90 | sd uge 3 |
|---|---|---|---|---|---|
| Giro | orders_gc_v2 | 12,7 / 18 | 16,0 / 20 | 15,7 / 20 | 3,9 |
| Tour | official_times_v3 | 11,0 / 12 | 15,0 / 20 | 16,2 / 24 | 5,0 |
| **Vuelta** | **s5_profiles_v1** | 15,8 / 23,6 | 25,7 / 35,8 | **31,1 / 44,8** | **9,2** |

Træthedsniveau efter aftenafregningen for GT-startere pr. løbsdato (`training_condition_settlements.applied_condition`):

| Løbsdato | Tour (gammel) median / p90 / andel ≥70 | Vuelta (ny) median / p90 / andel ≥70 (managerhold) |
|---|---|---|
| 1 | 33 / 58 / 0 % | 34,5 / 63 / 0 % |
| 2 | 33 / 56 / 0 % | 38 / 67 / 6,3 % |
| 3 | 35 / 57 / 0 % | 39 / 70 / 12,5 % |
| 4 | 34 / 58 / 0 % | 54 / 81 / 36,3 % |
| 5 | 39 / 61 / 0 % | **61,5 / 87 / 38,1 %** |
| 6 (sidste etape, kun én) | 41 / 63 / 0 % | 49 / 84,7 / 19,4 % |

**Dom, punkt 2:** GT-trætheden opfører sig, som ejeren besluttede. Den hober sig op over løbet: medianen stiger fra 34,5 til 61,5, og belastningen i uge 3 er dobbelt så stor som i uge 1. Uge 3 er hård, og etapeløb kan igen skubbe ryttere over 70 (0 % i Tour mod 38 % i Vuelta). Spredningen pr. rytter er markant større (sd 9,2 mod 5,0), så reelt arbejde koster. Faldet på dato 6 skyldes, at datoen kun har én etape.

## 3. Issuets 6 acceptkriterier

1. **G1 human/AI-median 40-60:** N/A for dette spor. Undtagelsen er midlertidigt ejer-accepteret 29/9 og følges i #5931 (human-niveau 22-25/10: median 36-37).
2. **G2 under 15 % på ≥70:** opfyldt. Højeste andel blandt managerhold 29/9-28/10 er 10,88 % (21/10, under Vuelta).
3. **G3 etapeløb kan skubbe over 70:** opfyldt i Vuelta (`s5_profiles_v1`), se punkt 2.
4. **Formændring pr. dato højst den gamle (±3/-4):** opfyldt. -4..+3 alle datoer, `form_gt4 = 0`.
5. **Sæsonudvikling pr. kohorte ±5 % af før S4:** N/A her. Det er udvikling og ikke træthed/form. Udviklingsbruddet 26/10 er rodårsagsanalyseret i #7316 (`docs/superpowers/specs/2026-10-29-7316-training-main-ability-rootcause.md`) og har intet med afregning pr. dato at gøre.
6. **Regressionstest, 5 løbsdage = én dag før S4:** N/A for prod-måling. Den er dækket af tests fra #5926 (`backend/lib/trainingDateCondition.integration.test.js`, `dailyTrainingEngine.test.js`). Prod-tallene i punkt 1 bekræfter adfærden uafhængigt.

## Samlet dom: LUK #5928

5x-effekten er væk i prod, og GT-trætheden følger ejerens beslutning 15/10. Der er ikke fundet noget, der stadig er galt inden for #5928's scope.

## SQL (read-only, gengivelig)

```sql
-- Før rettelsen, 28/9, inden for datoen (gd0->gd4)
with e as (
  select r.team_id, (x->>'rider_id')::uuid rider_id, (x->>'game_day')::int gd,
         (x->>'form')::numeric form, (x->>'fatigue_delta')::numeric fd
  from training_day_runs r, jsonb_array_elements(r.report->'riders') x
  where r.tick_date = '2026-09-28' and x->>'game_day' is not null
), human as (select id from teams where coalesce(is_ai,false)=false and coalesce(is_bank,false)=false and coalesce(is_test_account,false)=false),
d as (select rider_id, count(distinct gd) n,
   (array_agg(form order by gd desc))[1] - (array_agg(form order by gd asc))[1] form_span,
   sum(fd) filter (where gd>0) fat_span
 from e where team_id in (select id from human) group by 1)
select count(*), percentile_cont(0.5) within group (order by fat_span), percentile_cont(0.9) within group (order by fat_span), max(fat_span),
       min(form_span), max(form_span)
from d where n=5;

-- Efter rettelsen, pr. dato
with human as (...samme...),
s as (select tick_date, rider_id,
  (applied_condition->>'fatigue')::numeric - (opening_condition->>'fatigue')::numeric fat_d,
  (applied_condition->>'form')::numeric - (opening_condition->>'form')::numeric form_d,
  (applied_condition->>'fatigue')::numeric fat_lvl
 from training_condition_settlements
 where tick_date between '2026-09-29' and '2026-10-28' and status='complete' and team_id in (select id from human))
select tick_date, count(*), percentile_cont(0.5) within group (order by fat_d), percentile_cont(0.9) within group (order by fat_d), max(fat_d),
  min(form_d), max(form_d), count(*) filter (where abs(form_d)>4),
  round(100.0*avg((fat_lvl>=70)::int),2)
from s group by 1 order by 1;

-- GT-belastning pr. uge
select g.name, g.engine_rules_revision,
  case when l.stage_number<=6 then 'w1' when l.stage_number<=12 then 'w2' else 'w3' end wk,
  avg(l.load), percentile_cont(0.9) within group (order by l.load), stddev(l.load)
from training_race_loads l join races g on g.id=l.race_id
where g.season_id='00000000-0000-0000-0000-000000000004' and g.stages>=15
group by 1,2,3 order by 1,3;
```

GT-niveau pr. løbsdato: startere = distinkte `training_race_loads.rider_id` for løbet, joinet med `training_condition_settlements` på hver kalenderdato mellem løbets første og sidste `race_stage_schedule.scheduled_at`.
