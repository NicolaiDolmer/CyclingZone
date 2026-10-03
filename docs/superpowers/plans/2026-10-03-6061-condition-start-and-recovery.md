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

Verifikationsledger: 47 målrettede SQL-tests, 10 recovery-tests grønne; preflight 0 lint-fejl/advarsler. Uafhængigt review: P2 om ejer-kategori reproduceret rødt og rettet; gen-review rent. Read-only SDK/SQL-facit ens: 151 uafregnede slots, 20 ryttere, 10 hold, 8 aktuelt ejede førstegangskandidater. Historiske planinput mangler; kompensationspolitik forelagt ejeren, ingen apply-path. E2E første forsøg afbrudt før samtidig dist-build; genkøres sekventielt efter full-verifikation.
