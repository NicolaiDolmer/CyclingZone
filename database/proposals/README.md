# database/proposals/ — udkast-SQL der IKKE må auto-køres

SQL her er **forslag til ejer-review** og køres ALDRIG automatisk: `auto-migrate.yml`
matcher kun `database/2026-*.sql` på top-niveau (`find -maxdepth 1`), så denne
undermappe er uden for globben.

**Hvorfor mappen findes (hændelse 18/7-2026):** en backfill-fil markeret
"STATUS: IKKE KØRT — forberedt til ejer-review" blev committet som
`database/2026-07-18-scout-report-riders-intake-backfill-2623.sql` og dermed
auto-applied ~3 min efter merge — kommentarer i filen beskytter ikke mod
workflowet. Postmortem: `.claude/learnings/2026-07-19-prepared-sql-auto-applied-footgun.md`.

**Regler:**
- Udkast/forslag/backfills der afventer ejer-beslutning → læg dem HER.
- Når ejeren godkender: flyt filen til `database/2026-*.sql` (top-niveau) i en
  PR — merge = kørsel (jf. `AGENTS.md` hard rule 9).
- Filer her skal stadig være idempotente, så flytningen er risikofri.
