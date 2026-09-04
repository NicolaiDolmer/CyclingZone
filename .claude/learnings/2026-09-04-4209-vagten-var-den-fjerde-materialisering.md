# En vagt der måler mod den forkerte mængde er værre end ingen vagt

**Dato:** 2026-09-04 · **Issue:** #4209 · **PR:** #4766 · **Kontekst:** ejer-beslutning 3/9 om at binde GT-ryttere på hviledage.

## Hvad skete

Opgaven var at bygge GT-hviledags-bindingen. Første skridt var at måle: den live
`race_entry_days_rebuild()` blev læst ud af prod med `pg_get_functiondef`, og den
skrev allerede hele spændet via `generate_series`. #4217 løste #4209 den 25/8, som
`CALENDAR_RULES.md` §3 endda sagde ordret. Issuet blev sat i bero 24/8 og genoptaget
3/9 uden at nogen havde efterprøvet om blokeringen var blevet løst undervejs.

Havde jeg bygget opgaven som stillet, ville jeg have skrevet en anden vej til en regel
der allerede var håndhævet: en parallel sti, præcis dét #3938's én-writer-princip
findes for at forhindre.

Den ægte fejl lå i vagten. `scripts/race-entry-days-drift-audit.sql` byggede stadig sin
`want`-mængde ved at joine `race_stage_schedule` direkte, altså #4173's etapedage.
Vagten sammenlignede derfor prod mod en ønske-mængde håndhævelsen ikke længere havde,
og rapporterede hver GT-hviledag og hvert spring i et etapeløb som `overskydende`.
Filens egen kontrakt definerer `overskydende` som "rytteren er bundet på en dag han
ikke kører, og blokeres unødigt". Vagten anbefalede altså ordret at slette præcis de
rækker #4217 findes for at skabe. Målt mod prod 4/9: 160 falske rækker på 11 fund.

To ting holdt fejlen skjult i ni dage:

1. Vagtens fund er ikke en del af det hårde fail-step, så et rødt tal væltede intet.
2. Tracking-issue-steppet på det daglige cron-run så slet ikke `entrydays`-outputtet.
   PR-runs kommenterede på det, men cron-runnet lod det ende i en artefakt ingen åbner.

Sekundært: PGlite-harnessen i `raceSelectionBulkRpc.integration.test.js` loadede 4173
og stoppede der, så den testede en rebuild-krop der ikke findes i prod.

## Læring

1. **Genoptag aldrig et issue der har været i bero uden at måle præmissen forfra.**
   Blokeringen forsvandt, og den PR der løste blokeringen løste også issuet. Statussen
   i issue-tråden er en påstand fra dengang; kun runtime siger hvad der gælder nu.
   Samme klasse som [[feedback_runtime_verify_first]], men med en ekstra kant:
   "sat i bero" er præcis det tidsrum hvor virkeligheden når at flytte sig.

2. **#4283's læring var rigtig, men blev anvendt for snævert.**
   `2026-08-27-guard-og-haandhaevelse-skal-dele-maengde-semantik.md` sagde: grep for
   ALLE steder mængden er materialiseret. De tre kandidater man tænker på (rebuild-
   funktionen, JS-pre-flighten, RPC-guarden) blev migreret. Den fjerde, en audit-SQL
   i `scripts/`, blev glemt fordi den ikke er en håndhævelses-sti. **En vagt er også
   en materialisering af mængden**, og den er farligst af dem alle: den håndhæver
   ingenting, men den fortæller et menneske hvad der skal rettes.

3. **En vagt hvis fund ikke kan vælte noget OG ikke rapporteres nogen steder, er død.**
   Advisory er en legitim beslutning (denne fils gate er bevidst snæver), men advisory
   skal stadig betyde SYNLIG. Er et fund kun i en artefakt, er vagten en `|| true` med
   flere trin. Tjek altid begge: hvad sker der på et PR-run, og hvad sker der på cron.

4. **En test-harness der loader migrationer i hånden driver ligesom alt andet hånd-
   vedligeholdt.** `createTestDb.js` advarer allerede om det for sin egen fil-liste;
   den advarsel gælder også hver enkelt integrationstest der ruller sin egen liste.
   Loader du en funktion, så load HELE dens apply-kæde til og med den nyeste
   `create or replace`, ellers tester du en krop der ikke findes i prod.

## Forward-guard

- `scripts/race-entry-days-drift-audit.sql` bruger nu spænd-semantik. Målt mod prod:
  0 mangler, 0 overskydende (mod 160/11 før).
- `calendar-invariant-audit.yml`: `entrydays`-fundet er nu med i det daglige
  tracking-issues betingelse, titel og body. Stadig bevidst uden for fail-steppet.
- `backend/lib/testdb/raceEntryDaysGtRestDay.integration.test.js`: 13 tests mod de
  ægte committede migrationer. Rød/grøn bevist, 5 af 13 fejler uden #4217.
- `raceSelectionBulkRpc.integration.test.js` loader nu 4191 + 4217.
- `CALENDAR_RULES.md` §3 + §2b og `PLANNING_CENTER_RULES.md` låser reglen med dato,
  issue, prod-tal og pegepind til begge vagter.
