# #6061: førstegangstilstand og kontrolleret genopretning

Ejer-go: 3/10 i denne Codex-chat: forebyg fejlen og forbered genopretning af tabte dage. Intet prod-go.
SSOT: docs/TRAINING_RULES.md (Førstegangsregistrering, Tilstand én gang pr. dato), docs/PROGRESSION_RULES.md (delta/lofter), docs/GAME_INVARIANTS.md (idempotens).

Forebyggelse: opret kun manglende førstegangstilstand ved ny rytter/ny ejer før første aktivitet. Genbrug registreringens neutrale standard og historikværn; eksisterende tilstand/skade bevares. En DB-trigger dækker alle oprettelses-/købsveje atomisk. Den skaber ingen historisk afregning eller flag-flip.
Recovery: read-only manifest af alle karantæner fra aktivering til eksplicit cutoff, dedup pr. rytter/sæson/løbsdag. Dokumentér tilstand, gemt aktivitetsbevis og manglende historiske input; intet gæt eller re-simulering af løb. Holdskifte og eksisterende historik er egne afviste/review-grupper. Apply klargøres først mod dokumenterede input og kræver senere ejer-go.

- [x] PGlite regressioner røde for ny-ejet rytter uden condition før første load, køb fra fri pool, eksisterende skade, tidligere history, retry/idempotens og invoker/grants.
- [x] Idempotent migration oprettet med CLI; trigger/helper bruger samme historikværn og skaber ingen row-backfill ved installation.
- [x] Read-only recovery-klient og manifest testes mod komplette, manglende og modstridende beviser. Prod-udtræk skrives privat; offentlig status indeholder kun anonymiserede aggregater og kildebeskrivelse.
- [x] SSOT/postmortem/patch note opdateres i samme PR. Ingen ny feature/flag, FEATURE_REGISTRY urørt.
- [ ] TIER FULL, preflight, SQL-idempotens/rolle-tests, uafhængigt review, CodeRabbit og CI. Før release ser ejeren dry-run og patch-note-teksten.
- [ ] PR og durable handoff. Migration/merge/prod-reparation følger ejer-gates; ingen automatiske prod-skrivninger udføres her.

3/10: ejeren godkendte kompensation med nuværende planer/motor. Den konkrete pakke er beregnet og gemt privat i OneDrive: 16 ryttere, 130 slots, 19 løbsdage; fire ejer-review. 23 komplette source-checks beskytter beregning og atomisk RPC; skriveforslaget er kun i database/proposals. Operator-klienten er lokal dry-run som standard og kræver separat prod-go plus præcis fil-hash for apply. Historiske condition-afregninger/rapporter opfindes ikke.

Verifikationsledger: 47 forebyggelses-SQL-tests, 10 recovery-tests og 23 kompensationstests grønne; fuld backend 12663 pass/3 skip/0 fail, tidligere frontend 4275 pass og build grøn. Preflight 0 lint-fejl/advarsler; token-hygiejne 0 fail. Uafhængigt review rent efter konkrete regressioner. Lokal fuld e2e: 1480 pass/164 skip/24 fail; isoleret retry 23 pass/1 fail. Sidste sponsor-sprogfejl reproduceret på uændret main-kode. CI-e2e på forebyggelsescommit grøn; league-size-invariant blokerer (#6115). PR #6119, ingen merge/prod-apply.

CodeRabbit-fund reproduceret: inventar-blokeringer afvises før kompensationsberegning; active help EN/DA suppleret. Uafhængigt gen-review rent. Ny fuld verifikation afventes; tidligere green-ledger ovenfor gælder før disse reviewrettelser. Ingen prod-go.
