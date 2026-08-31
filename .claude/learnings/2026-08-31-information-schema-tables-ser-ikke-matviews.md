# Postmortem · 2026-08-31 · information_schema.tables ser ikke materialiserede views

## Hvad skete der?

#4333 skulle holde operationelle backup-tabeller ude af de genererede
Supabase-typer. Issuet paastod "59 backup-tabeller, 143 aegte". Da tallene
blev maalt mod prod, var ingen af dem rigtige: 66 backups og 145 aegte. En
del af afvigelsen var almindelig forael, men 4 relationer manglede af en
aarsag der er vaerd at huske: `information_schema.tables` indeholder slet
ikke materialiserede views.

## Root cause

To uafhaengige fejlkilder i det oprindelige tal:

1. Issuet talte kun moenster 1 (`backup_`-praefiks, 59 stk.) og kaldte resten
   "en haandfuld snapshot-tabeller med andet navnemoenster". Den haandfuld var
   7 relationer fordelt paa to andre navnekonventioner.
2. `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`
   giver 207. Det ser ud som et fuldt relations-tal, men Postgres udstiller
   ikke materialiserede views i `information_schema` overhovedet. De ligger
   kun i `pg_matviews` / `pg_class`. Projektet har 4, saa det sande tal er 211.

Fejl 2 er den lumske: forespoergslen fejler ikke, den svarer bare for lavt,
og svaret ser autoritativt ud. Supabase-typegeneratoren OG
`database/schema-snapshot.json` tager matviews med, saa et tal maalt via
`information_schema` kan aldrig afstemmes med de to spejle uden at afvige.

## Fix

Ingen kodefejl at rette. Tallene i doc-blokkene blev maalt om og skrevet
praecist, med kilden naevnt eksplicit, i:

- `scripts/lib/operational-backup-relations.mjs` (doc-blok, commit 3f376868d)
- `.github/workflows/ci.yml` (kommentar over vagt-trinnene, commit c1b934d19)

Formuleringen naevner nu begge kilder frem for at skrive et bart totaltal:
"information_schema.tables lister 207 relationer i public, og pg_matviews
laegger 4 materialiserede views oveni som den ikke daekker, altsaa 211 i alt".

## Forhindret-fremover

`scripts/strip-backup-tables-from-types.test.mjs` pinner klassifikatoren mod
de faktiske prod-navne, saa en fremtidig navnekonvention der ikke fanges,
dukker op som en fejlende test i stedet for som et stille forkert tal. Selve
tael-fejlen forebygges kun af disciplin, derfor denne note.

## Læring

Naar en relation skal taelles i Postgres: `information_schema.tables` daekker
tabeller og almindelige views, IKKE materialiserede views. Brug
`pg_class.relkind` (`r` tabel, `v` view, `m` matview, `p` partitioneret) hvis
tallet skal kunne afstemmes med noget andet, eller union'ér `pg_matviews` paa.

Den generelle version, som er bidt flere gange i dette repo ("46 af 143
tabeller", "115 ubeskyttede ruter"): et tal i et gammelt issue er en
paastand, ikke data. Maal det selv foer du bygger paa det, og skriv i
kommentaren HVILKEN forespoergsel tallet kom fra, saa den naeste kan
efterproeve det uden at gaette.
