# Session-prompt: Sæsonstart-beredskab — holdudtagelse mod den nye S3-kalender

> Skrevet onsdag 27/8 kl. 00:15. **Sæsonen starter fredag 28/8 kl. 11.**
>
> Kalenderen blev regenereret i nat: 529 løb, 28/8 → søndag 27/9, scorecard 0 regelbrud.
> Kan startes PARALLELT med regenererings-sessionen — men rør IKKE `seasons`, `races`,
> `race_stage_*` eller feature-flags; den anden session ejer dem (se 🤖 Working agent i `docs/NOW.md`).

## 0 · Læs dette først

**Kør `date` før du skriver en dato nogen steder.**

**Mål mod prod med read-only SELECTs (Supabase-MCP), gæt ikke.** Slå kolonnenavne op i
`database/schema-snapshot.json` først.

**Arbejd i et worktree** (`scripts/new-worktree.ps1`) — hoved-checkoutet må ikke skifte branch.

## 1 · Mål

Holdudtagelsen skal være fejlfri, når 30 hold udtager forfra på den nye kalender.
Ejer-krav 25/8: "Holdudtagelse skal være fejlfri." Det var udtagelses-fejlene
(#4217/#4200/#4201/#4175) der udskød sæsonstarten — de må ikke gentage sig fredag.

## 2 · Tilstand efter nattens regenerering

- Alle 1.101 udtagelser slettet. Backup: `backup_4236_race_entries` m.fl. (5 tabeller).
- 237 form-peak-planer bevaret med `target_race_id = null` — spillerne skal re-targete.
- Ny løbsdags-akse: `game_day` er kontiguert PER PULJE (0 løbsdage over flere datoer, målt).
  GT'er har 2 hviledage der OPTAGER løbsdagen (spænd = etaper + 2) — de 3 GT'er har
  bevidste game_day-huller; det er IKKE en fejl.
- `race_entries.binding_span` beregnes mod den NYE akse — #4236/#4276-koden kørte første
  gang i prod i nat. Ingen entries findes endnu, så første rigtige test er spillernes udtagelser.
- Assistenten udtager 1 t før løb (#4174), men `auto_entry_generator_enabled` er OFF indtil
  ejeren tænder den (regenererings-sessionens sidste skridt — tjek flagget før du antager noget).

## 3 · Opgaver

1. **Kode-gennemgang:** binding_span-beregning + udtagelses-endpoints mod den nye akse.
   Særligt: GT-hviledage (optager løbsdag), overlap-reglen (1 rytter = 1 løb pr. løbsdag)
   og at spændet beregnes fra `race_stage_schedule.game_day`, ikke fra datoer.
2. **Tests:** backend-udtagelses-tests + e2e-udtagelses-flowet. Udtagelse er delt-lib →
   TIER FULL: fuld lokal suite før evt. push (`scripts/verify-local.ps1` + alle 3 playwright-projekter).
3. **Preview-verifikation:** udtag et hold som testbruger mod den nye kalender og dokumentér
   med rigtige screenshots (ejer-krav: kunne teste på preview før live).
4. **Fredag-morgen-tjekliste:** skriv en kort read-only SQL-tjekliste (kl. 9–11) til
   assistent-dækning, overlap pr. løbsdag og binding-sanity — læg den i denne fil eller NOW.md.
5. Fund → issues (søg dubletter først) + fixes via PR fra worktree. **Ingen prod-mutationer.**

## 4 · Må ikke

- Ingen writes mod `seasons`, `races`, `race_stage_*`, `race_entries`, feature-flags.
- Rør ikke #4278 (D4 for bjergrig — ejer-beslutning: tages efter sæsonstart).
- Ingen scope-udvidelse til dashboard/forum/UI-rework.

## 5 · Kendte løse ender (kun hvis tid, ellers lad ligge)

- #4281 — Playwright Smoke kører kun på PR'er; main kan stå rød uopdaget.
- verify-invariants.js har forældede typelister (finance/notification) + 24 hold over
  trupgrænse, 2 over gældsloft, 4 dobbelt-listede ryttere, 132 uforankrede anlæg (#3593).
  Målt i nat; ikke kalender-relateret. Regenererings-sessionen opretter issues i close-out.

## 6 · Fredag-morgen-tjekliste (kl. 9–11, read-only, Supabase-MCP)

> Skrevet 27/8 af beredskabssessionen. Alle queries er kørt og verificeret mod prod 27/8
> kl. ~00:30 (svar i parentes). Kør dem i rækkefølge; alle "skal være 0" er hard stops —
> afvigelse → find rod-årsag FØR kl. 11, ingen fixes uden ejer-go.

**1. Flag-tjek** (27/8: begge `on` — regenererings-sessionen har tændt dem):
```sql
select key, value from app_config
 where key in ('auto_entry_generator_enabled','stage_scheduler_enabled');
```

**2. Dagens løb + starttider** (forventet: løb i alle 4 divisioner, første start kl. 11 dansk = 09:00 UTC):
```sql
with s3 as (select id from seasons where status='active')
select r.league_division_id as pulje, count(distinct r.id) as loeb,
       min(sch.scheduled_at) as foerste_start_utc
  from races r join race_stage_schedule sch on sch.race_id=r.id, s3
 where r.season_id=s3.id and sch.scheduled_at::date = current_date
 group by r.league_division_id order by 1;
```

**3. Assistent-dækning** — kør kl. ~10:15 (assistenten udtager 1 t før løb, #4174).
Hold i puljen uden entries til et løb der starter inden for 2 t (skal være 0 kl. 10:15 for kl. 11-løbene):
```sql
with s3 as (select id from seasons where status='active'),
imminent as (
  select r.id, r.name, r.league_division_id, min(sch.scheduled_at) first_start
    from races r join race_stage_schedule sch on sch.race_id=r.id, s3
   where r.season_id=s3.id and r.stages_completed=0
   group by r.id, r.name, r.league_division_id
  having min(sch.scheduled_at) between now() and now()+interval '2 hours')
select i.name, i.first_start, t.name as hold_uden_entries
  from imminent i
  join teams t on t.league_division_id = i.league_division_id
 where not (t.is_bank or t.is_frozen or coalesce(t.is_test_account,false))
   and not exists (select 1 from race_entries e where e.race_id=i.id and e.team_id=t.id)
   and not exists (select 1 from race_withdrawals w where w.race_id=i.id and w.team_id=t.id);
```
(Kørt ordret 27/8 med 48t-vindue: 611 hold uden entries — forventet FØR assistenten har
kørt; den udtager først 1 t før hvert løb. Kl. 10:15 skal 2t-vinduet være 0.)

**4. Overlap pr. løbsdag** — skal være 0 (27/8: 0):
```sql
with s3 as (select id from seasons where status='active')
select d.rider_id, d.game_day, count(distinct d.race_id)
  from race_entry_days d, s3 where d.season_id=s3.id
 group by d.rider_id, d.game_day having count(distinct d.race_id)>1;
```

**5. Binding-sanity** — begge skal være 0 (27/8: 0 og 0 på de første 87 rigtige entries):
```sql
-- a) entries i bindende løb uden entry_days-rækker
with s3 as (select id from seasons where status='active')
select count(*) from race_entries e join races r on r.id=e.race_id, s3
 where r.season_id=s3.id and r.status <> 'completed'
   and not exists (select 1 from race_withdrawals w where w.race_id=e.race_id and w.team_id=e.team_id)
   and not exists (select 1 from race_entry_days d where d.race_id=e.race_id and d.rider_id=e.rider_id);
-- b) binding_span afviger fra den nye akse
-- RETTET 27/8 kl. 06:00: den oprindelige udgave manglede afmeldings-undtagelsen
-- som (a) har. Et AFMELDT hold beholder sine entries (#1823, saa gen-tilmelding
-- giver samme trup), men de binder ikke: binding_span er NULL og der er ingen
-- race_entry_days-raekker. Det er den KORREKTE tilstand, men uden `not exists`
-- nedenfor taeller den som et brud. Maalt i prod 27/8: praecis 1 saadan raekke
-- (Equipe Lorraine Acier, De Openingsklassieker) — en afmelding, ikke en fejl.
-- Uden rettelsen vokser tallet med hver afmelding fredag og ligner et brudt vaern.
with s3 as (select id from seasons where status='active'),
x as (select r.id race_id, min(s.game_day) a, max(s.game_day) b
        from races r join race_stage_schedule s on s.race_id=r.id, s3
       where r.season_id=s3.id group by r.id)
select count(*) from race_entries e join x on x.race_id=e.race_id
 where e.binding_span is distinct from int4range(x.a, x.b, '[]')
   and not exists (select 1 from race_withdrawals w
                    where w.race_id = e.race_id and w.team_id = e.team_id);
```

**6. Fejl-puls:** Sentry (backend-projektet) + Railway-log for `selection_rider_bound`,
`23505`/`no_rider_double_booking` og 500'ere på `/selection` siden kl. 9. Enkelte navngivne
409'ere er OK (spillere der rammer bindingen er by design); 500'ere og 23505 rå-fejl er ikke.
