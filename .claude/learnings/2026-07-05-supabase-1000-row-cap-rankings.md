# Supabase Data API 1000-rækkers cap slugte rangliste + standings (#2206)

**Dato:** 2026-07-05
**Type:** bugfix-postmortem
**Flader:** rytterrangliste (`useRiderRankings.js`), holdstilling (`StandingsPage.jsx`)

## Symptom
Spiller-rapport (Discord #bugs, 4/7): rytterrangliste-siden viste "only 264 riders … all the first not exists" — de top-rangerede manglede helt.

## Rod-årsag
PostgREST/Supabase Data API capper ethvert svar ved `db-max-rows` (1000 på dette
projekt), også uden eksplicit limit. Et naivt `.from(...).select()` returnerer
stille kun de første 1000 rækker — ingen fejl, ingen advarsel.

`useRiderRankings.js` lavede to brede reads:
- `rider_rankings_mv` (3142 rækker for sæsonen) → kun 1000 hentet.
- `riders` hvor `is_retired=false` (5590 rækker) → kun 1000 hentet, og enhver
  matview-rytter uden display-match blev droppet (`if (!d) continue`).

De top-rangerede ryttere er ofte nyere fiktive ryttere med højere id'er → de
faldt uden for de første 1000 og forsvandt. Det præcise synlige antal svinger
med hvor mange løb der er kørt (264 den 4/7, 773 ved reproduktion 5/7).

## Fix
Wrap alle brede reads i den eksisterende `fetchAllRows`-paginering
(`frontend/src/lib/supabasePagination.js`) med en stabil `.order()`.

**Backwards-check afslørede 3 søster-bugs på StandingsPage** (samme familie,
#2196 nævnte /standings + /rider-rankings sammen):
- `team_race_points_mv` (1321) → progressionsgraf mistede punkter.
- trup-styrke-riders `.not("team_id","is",null)` (4871) → Linse B manglede hold.
- `team_standings_ext_mv` (172, under cap i dag, men pagineret for forward-safety).

## Læring / forward-guard
- **Enhver frontend-read der KAN overstige 1000 rækker SKAL bruge `fetchAllRows`.**
  Helper'en fandtes allerede (skrevet til præcis dette i #2175) — den var bare
  ikke brugt på disse flader. Et cap-drop fejler tavst, så build/test/lint fanger
  det ALDRIG; kun en tælling mod ægte prod-data afslører det.
- Verificér altid tabel-størrelsen mod prod-DB (`execute_sql count(*)`) FØR man
  antager et `.select()` er sikkert.
- **Mulig opfølgning:** en lint/CI-guard der flagger `.from("<stor-tabel>").select()`
  uden `.range()`/`fetchAllRows`/scoped `.eq()`. Ikke bygget her (false-positive-
  risiko på legitime scoped queries) — vurdér om det er værd.
- Restende ikke-fixede kandidater (lav impact, noteret): `RidersPage.jsx:290`
  nationalitets-filter (5590 → 1000, men ~40 nationer fanges statistisk alligevel).
