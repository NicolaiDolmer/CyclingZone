# PCM rytter-matcher tabte 88% af ryttere på PostgREST 1000-row-loft

**Dato:** 2026-05-30
**Issue/PR:** #770 / PR #771 (bug introduceret i #668)
**Symptom:** Live-importen (Figueira Champions Classic) flagede 34 scorende ryttere som "umatchede" — heriblandt store navne (Alaphilippe, Schachmann, Magnus Cort Nielsen) der tydeligt burde være i DB.

## Rod-årsag

`buildRiderMatcher` i `pcmRiderMatcher.js` hentede ryttere med et naivt
`.select("id, firstname, lastname, team_id")` **uden `.range()`**. PostgREST
(Supabase) returnerer maks **1000 rækker** pr. select uden eksplicit
paginering. `riders` har 8.699 rækker → kun de første 1000 blev indekseret,
de resterende ~7.700 (88%) var usynlige for matcheren og faldt igennem til
`status: "missing"`. Scorede en af dem, gik point/præmie tabt (`team_id=null`).

## Hvorfor det ikke blev fanget tidligere

- #668-harnessen rapporterede "0 umatchede scorende i 11 sæson-1-filer".
  Den måling skete sandsynligvis via direkte SQL-join mod hele tabellen —
  ikke gennem den faktiske `buildRiderMatcher`-kodesti, som rammer loftet.
  **Verificér gennem den rigtige kodesti, ikke en parallel SQL-approksimation.**
- #770 blev fejlagtigt rammet som et "navnevariant"-problem. Den synlige
  ⚠-liste lignede edge-cases, men 34 stjernerytter i ét endagsløb var et
  signal om noget systematisk — ikke spredte stavevarianter.

## Diagnose-vej der virkede

1. Slog de konkrete ⚠-navne op i prod → de fandtes ALLE entydigt i `riders`.
   Det udelukkede "navnevariant" og pegede på ekstraktion eller load.
2. Tjekkede ekstraktion (parser/`extractIndividualRows`) → navnet kom rent ud.
3. `count(*) riders = 8.699` ≫ 1000 + grep efter eksisterende paginering →
   `dynCyclistSync.js:81` havde allerede kommentaren "paginate to bypass
   Supabase 1000-row default limit". Mønstret fandtes; matcheren manglede det.

## Fix

`fetchAllRows(label, buildRangeQuery)`-helper der paginerer i sider à 1000;
brugt i både `buildRiderMatcher` og `buildTeamMatcher`. Verificeret: alle 34
⚠-navne → 34/34 entydigt exact-match → umatchede-scorende 34 → 0.

## Forward-guard

- **Ethvert fuldt tabel-load (>1000 mulige rækker) mod Supabase SKAL paginere
  med `.range()`.** Et naivt `.select()` lyver stille med max 1000 rækker.
- Test mod mock der håndhæver 1000-row-loftet, så regression fanges.
- Når et "matching/lookup"-symptom rammer kendte-gode entries: mistænk
  load-fuldstændighed (paginering, filtre, RLS) FØR matching-logikken.

## Relateret

Samme PR tilføjede nordisk-fold (ø/æ/å) + tom rytter-alias-tabel som ægte
forebyggelse for fremtidige navnevarianter — men det var ikke årsagen her.
