# 2026-09-08: Spoergeskema aabnet uden skrive-grants — 241 managers kunne ikke svare

**Issue:** #4943 (in-app spoergeskema). Hoerer sammen med #5006 (migration) og
2026-09-07-migration-halvt-applied-insert-aritet.md (samme migration, anden
fejlklasse, fundet aftenen foer). Hotfix-PR: se scripts/lint-sql-policy-grants.mjs.

## Hvad skete

8/9 kl. 14:30 blev spoergeskemaet '2026-09-features' aabnet (status draft ->
open) og 241 managers inviteret. Ingen kunne gemme et svar — hver
INSERT/UPDATE/DELETE mod `survey_responses` og hver INSERT mod
`survey_completions` fejlede med 42501 permission denied. RLS-policyerne i
`database/2026-09-07-4943-in-app-survey.sql` var korrekte (rigtig `auth.uid()`,
rigtig `status = 'open'`-check), men filen gav aldrig rollen `authenticated`
et tabel-GRANT for de skrivende operationer — kun SELECT var til stede.

## Rod-aarsag

Postgres tjekker tabel-privilegier FOER RLS-policies overhovedet evalueres.
En `CREATE POLICY ... FOR INSERT TO authenticated` uden et matchende
`GRANT INSERT ON <tabel> TO authenticated` er derfor unaaelig — afvisningen
sker et lag under policy-logikken, og fejlen ligner en RLS-fejl uden at vaere
en.

Den dybere aarsag til at det er let at glemme: frem til
`2026-08-14-2830-revoke-truncate-og-default-privileges.sql` (#2830) fik enhver
NY tabel i `public` automatisk fulde skrive-privilegier via Supabase'
`ALTER DEFAULT PRIVILEGES`. Den migration lukkede hullet for FREMTIDIGE
tabeller (SELECT er bevidst uroert). Enhver tabel oprettet paa eller efter
14/8 — herunder `survey_responses` og `survey_completions`, oprettet 7/9 — faar
derfor IKKE laengere skrive-adgang gratis. Det er en korrekt sikkerheds-
forbedring, men den flyttede en usynlig antagelse ("nye tabler kan bare
skrives") til en eksplicit pligt ("skriv GRANT'et selv"), og intet i
review-kaeden tjekkede at pligten var opfyldt.

## Hvorfor CI ikke fangede det

- `scripts/check-secdef-revoke-lint.mjs` ("Statisk REVOKE-lint") dækker kun
  SECURITY DEFINER-funktioner (REVOKE EXECUTE fra anon/authenticated) — ingen
  funktion er involveret her, kun almindelige RLS-policies paa tabeller.
- `security-grants-audit.yml`'s "Live grant-tjek mod prod"-job kører KUN
  uden for `pull_request` (`if: github.event_name != 'pull_request'` —
  trigget af `schedule`/`workflow_dispatch`, hver 6. time). Det er ikke et
  paths-filter eller et label-gate der forhindrer det — jobbet er design't
  til aldrig at koere paa en PR overhovedet, saa det viser "skipping" paa
  hver eneste PR (bekraeftet paa PR #5035 og #5006). Det ville foerst have
  fanget hullet ved sin naeste 6-timers-koersel, altsaa efter invitationen
  allerede var sendt.
- `scripts/lint-riders-column-grant.mjs` daekker kun kolonne-privilegier paa
  `riders`/`rider_derived_abilities` — et andet privilegie-lag helt.
- Ingen vagt tjekkede at en RLS-policy rent faktisk KAN naas via et
  tabel-grant. Det hul er nu lukket.

## Fix

- Manuel hotfix i prod 8/9 kl. 14:33 (ejer-go):
  `GRANT INSERT, UPDATE, DELETE ON public.survey_responses TO authenticated;`
  `GRANT INSERT ON public.survey_completions TO authenticated;`
  Verificeret med `has_table_privilege` (alle true).
- Skriftlig, idempotent version: `database/2026-09-08-4943-survey-grants-hotfix.sql`
  (samme to GRANT-linjer + eksplicit SELECT for alle fire spoergeskema-tabeller).
  CI's koersel af filen er en no-op i prod (GRANT er idempotent), men retten
  staar nu i git-historik og gaelder ogsaa lokale/staging-miljoeer.

## Forward-guard

- `scripts/lint-sql-policy-grants.mjs` (ny, #4943): for hver `CREATE POLICY
  ... FOR <op> ... TO authenticated` i en aendret migration, kraev et
  matchende `GRANT <op>` (eller `GRANT ALL`) paa samme tabel ET STED i
  `database/`. Koblet paa `security-grants-audit.yml`'s eksisterende
  PR-job ("Statisk REVOKE-lint"), samme trigger.
  - SELECT er bevidst UDENFOR scope: #2830s egen post-verify garanterer at
    SELECT altid er default-grantet, saa et krav om eksplicit `GRANT SELECT`
    ville vaere permanent stoej.
  - Skrive-ops (INSERT/UPDATE/DELETE) tjekkes KUN for tabeller hvis foerste
    `CREATE TABLE` i korpus daterer sig til 14/8 eller senere (#2830-cutover)
    — en tabel fra foer den dato arvede fuld skrive-adgang som default og har
    aldrig haft brug for et eksplicit grant. Uden dette filter gav en
    `--all`-koersel 140 fund, hvoraf de fleste var stoej fra foer-cutover-
    tabeller; med filteret blev det 16 reelle fund.
  - Kørt lokalt med `--all` mod hele `database/` (rapporteres i PR-body'en,
    ikke rettet i denne PR): udover survey-tabellerne fandtes tilsvarende
    huller paa `race_stage_timelines` (INSERT/UPDATE/DELETE helt ugrantet),
    `forum_thread_reads` (DELETE), `forum_reactions` (UPDATE),
    `forum_category_mutes` (UPDATE) og `forum_thread_views` (INSERT/UPDATE/
    DELETE — policyen hedder "..._deny_all", saa denne kan vaere en bevidst
    laasning, ikke en fejl). De tre sidste ligner tilsigtede snaevrere grants
    (toggle-moenster: insert/delete uden update), men boer bekraeftes af
    ejeren eller markeres med `-- policy-grant-ok: <begrundelse>`.

## Laering

En sikkerhedsforbedring der fjerner en implicit default (#2830: ingen gratis
skrive-adgang til nye tabler) skal parres med en vagt der haandhaever den nye
EKSPLICITTE pligt — ellers flytter man risikoen fra "for aaben default" til
"glemt eksplicit grant", og den anden fejlklasse er lige saa usynlig indtil
nogen rammer den i produktion. Et RLS-policy-review er ikke fuldt foer nogen
har svaret paa "har rollen overhovedet lov til at forsoege denne operation,
uafhaengigt af policy-logikken?".

Refs #4943 #2830
