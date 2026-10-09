# Roadmap-forslag 10/10 - IKKE live uden ejer-go

Kilde: `roadmap_items` læst 10/10 kl. 00:30 (prod, read-only). Billede: `pr-screens/roadmap-10-10/card.png`.
Roadmappet er data, ikke kode, så forslaget er SQL til efter dit go (eller samme ændringer i /admin/growth → Roadmap).

## Ændringer

| # | Punkt | I dag | Forslag | Hvorfor |
|---|---|---|---|---|
| 1 | Training fixes (#6139) | in_progress, titel "Train now no longer locks your line-up..." | Ny titel, issue_ref #6123 | Train now låser bevidst nu (ejer 8/10). Låsen og alle løbsdage er leveret |
| 2 | Real training depth (#4850) | in_progress | shipped 9/10 | Programmer live for alle 9/10 23:23 |
| 3 | Teamwork values (#5268) | in_progress | shipped 10/10 | Apply 9/10, patch note 7.350 |
| 4 | Pick the rider first (#6035) | next, beta_soon | shipped 9/10 | PR #6053 live |
| 5 | Copy one day's plan (#6060) | later | next, planned | Lovet 2/10, bygges i nat |
| 6 | Assistant everywhere (#4522) | later | next, planned | Lovet 31/8, bygges i nat |
| 7 | Nye løbsregler | mangler | nyt punkt, shipped 10/10 | Ugens største ændring |
| 8 | Form og formtoppe (#6156) | mangler | nyt punkt, in_progress | Spillerne har meldt fejlen. Status "in_progress" først når du har valgt dato (morgenkort 1) |
| 9 | Næste sæsons kalender (#5841) | mangler | nyt punkt, next, planned | Dit direktiv 27/9 |

Tekster (EN først, DA under, `docs/TONE_OF_VOICE.md`):
- 1: "Training fixes: reset a rider to the team program, and clearer race-day numbers in the report." / "Rettelser i træningen: sæt en rytter tilbage til holdets program, og tydeligere løbsdag-numre i rapporten."
- 7: "New race rules: real time gaps, and no team chases a group with its own rider in it." / "Nye løbsregler: rigtige tidsgab, og intet hold jagter en gruppe med sin egen rytter i."
- 8: "Form and form peaks count in races again." / "Form og formtoppe tæller i løbene igen."
- 9: "See next season's calendar before the season switch." / "Se næste sæsons kalender før sæsonskiftet."

## SQL (køres kun efter ejerens ordrette "kør")

```sql
begin;
update roadmap_items set title_en = 'Training fixes: reset a rider to the team program, and clearer race-day numbers in the report.',
  title_da = 'Rettelser i træningen: sæt en rytter tilbage til holdets program, og tydeligere løbsdag-numre i rapporten.',
  issue_ref = 6123, updated_at = now() where id = '5e5b83a5-eb1d-4779-b604-9c1b037537c7';
update roadmap_items set status = 'shipped', shipped_at = '2026-10-09', updated_at = now()
  where id in ('00000954-0000-4000-8000-000000000004', '00006149-0000-4000-8000-000000000004');
update roadmap_items set status = 'shipped', shipped_at = '2026-10-10', updated_at = now()
  where id = '00006149-0000-4000-8000-000000000015';
update roadmap_items set horizon = 'next', status = 'planned', updated_at = now()
  where id in ('00006149-0000-4000-8000-000000000003', 'ee2ef408-b4a6-4c75-8b37-efe9e7a1dbae');
insert into roadmap_items (engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, shipped_at) values
  ('races', 8, 'New race rules: real time gaps, and no team chases a group with its own rider in it.',
   'Nye løbsregler: rigtige tidsgab, og intet hold jagter en gruppe med sin egen rytter i.', true, 'shipped', 'next', 6199, '2026-10-10'),
  ('races', 6, 'Form and form peaks count in races again.', 'Form og formtoppe tæller i løbene igen.', true, 'in_progress', 'next', 6156, null),
  ('races', 25, 'See next season''s calendar before the season switch.', 'Se næste sæsons kalender før sæsonskiftet.', true, 'planned', 'next', 5841, null);
commit;
```

Tjek før kørsel: kolonnedefaults for `id`/`created_at` i `database/schema-snapshot.json`; `roadmap-drift`-tjekket (#6162) bagefter.

## Spørgsmål til morgenblokken (ét ad gangen)
1. Godkender du de 9 ændringer som vist på billedet?
2. Form (#8): skal punktet stå som "in progress" nu, eller først når du har valgt tændingsdato?
