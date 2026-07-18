# 2026-07-19 — "Forberedt, IKKE kørt" SQL blev auto-applied af auto-migrate (footgun)

## Hvad skete

PR #2659 (18/7, #2644/#2623) inkluderede en backfill-SQL som eksplicit var
"forberedt til ejer-review, IKKE kørt" — committet som
`database/2026-07-18-scout-report-riders-intake-backfill-2623.sql`.
`auto-migrate.yml` matcher `database/2026-*.sql` (top-niveau) ved push til main
og kørte filen **17:32:56Z, ~3 min efter merge**. Sessionen troede fortsat den
ikke var kørt: 2 timer senere (i #2623-tråden) blev det BESLUTTET ikke at køre
den, fordi den organiske vej (#2627-udløbssweep → 24h-auktion → #2648-provenu)
var strengt bedre. Beslutningen var de facto allerede overhalet.

## Konsekvens

- 16 `academy_intake`-rækker → `'expired'` UDEN 24h-auktion og UDEN
  #2648-kompensation til de 14 menneske-managere der mistede tilbuddene.
- 3 af de 16 tilbud var kun 1-4 dage gamle (backfillen havde INTET aldersfilter
  — den var skrevet før 7-dages-reglen var normen for udløb).
- Dagskvoten (30/døgn, #2646) blev delvist ædt: 22:00-sweepen 18/7 kørte no-op
  (44 hændelses-udløb + 16 backfill = 60 ≥ 30), så FØRSTE reelle
  `expired_intake_team_id`-stemplede auktionsbølge blev udskudt til 19/7 22:00.
- Skadesbegrænsning der HOLDT: filens ejerskabs-guard (kun team-løse ryttere)
  og idempotens. Ingen ejede ryttere ramt; ingen datakorruption.

## Rod-årsag

To-lags-fejl:
1. **Mekanisk:** `database/2026-*.sql` ER en eksekverings-kø, ikke et arkiv.
   Kommentarer i filen ("STATUS: IKKE KØRT") er usynlige for workflowet.
2. **Proces:** "skriv SQL'en men kør den ikke"-opgaver giver en fil der SKAL
   ligge et sted — og det naturlige sted (database/) var netop det farlige.
   Agenten der skrev filen kendte auto-migrate, men koblede ikke commit=kørsel.

## Forward-guards (implementeret 19/7)

- `database/proposals/` oprettet — udkast-SQL uden for auto-migrate-globben
  (`find -maxdepth 1` tager ikke undermapper). README med regler.
- `AGENTS.md` hard rule 9 (SQL-mandatet): eksplicit advarsel om at
  forberedt-men-ikke-kørt SQL aldrig må committes som `database/2026-*.sql`.
- Backfill-filens header omskrevet til at afspejle virkeligheden (auto-applied).

## Lærdom (klasse)

Enhver fil-konvention der TRIGGER automatik (auto-migrate, auto-deploy,
cron-pickup) er en eksekverings-kanal: "jeg committer den bare, den kører ikke
før nogen beslutter det" er falsk hvis stien matcher globben. Tjek
trigger-globs FØR du vælger placering til udkasts-artefakter.
