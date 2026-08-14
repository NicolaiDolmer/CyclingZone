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

**Anvend ALDRIG en fil herfra i hånden uden at flytte den bagefter.** Gør du det,
holder mappen op med at fortælle sandheden: en anvendt fil ser derefter nøjagtig
ud som et uanvendt udkast, og et *halvt* anvendt forslag bliver umuligt at få øje
på. Det kostede [#3765](https://github.com/NicolaiDolmer/CyclingZone/issues/3765)
— `apply_race_results_batch` blev anvendt herfra, men kun `CREATE`-delen kom med;
de to `REVOKE`-linjer nederst i filen blev aldrig kørt, og funktionen stod
anon-kaldbar i ni dage.

**Håndhævelse (siden 14/8):** `scripts/proposals-reconcile.mjs` kører hver 6. time
via `.github/workflows/security-grants-audit.yml` og spørger prod om hvilke af
hver fils objekter der findes. Lever nogen af dem, åbnes et issue. Måling ved
indførelsen: **6 af 10 filer var allerede anvendt** uden at være forfremmet.

Bemærk hvad tjekket **ikke** kan: at et objekt findes beviser at scriptet startede,
ikke at det kørte færdigt. En datareparation kan have oprettet sit backup-bord og
være stoppet før sin `UPDATE`. Grant-linjer (`REVOKE`/`GRANT`) er heller ikke
objekter — dem dækker `scripts/security-grants.sql` i stedet. Verificér altid en
fils faktiske *effekt* før du forfremmer den.
