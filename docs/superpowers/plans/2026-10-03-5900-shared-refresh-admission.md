# #5900: fælles admission til eksisterende ranking refresh

**Mandat:** ejerens Codex-session 3/10 og #5900; afgrænset fejl i eksisterende koalescering, ingen scheduler-adfærdsændring.
**SSOT:** `docs/GAME_INVARIANTS.md` finaliserings-/heartbeatkontrakten og `docs/RACE_ENGINE_RULES.md`; #5692's ejer-godkendte friskhed 2/10. Resultat/klassement publiceres straks; globale snapshots opdateres samlet. Træningsprioritering #5911 bevares.

- [x] Reproduceret i rigtig helper: Safe, cron/Gated, training, finalization og recovery gav samtidighed 2; forventning 1.
- [ ] Ny `.ts`-kerne: én aktiv pass og én fælles pending pass pr. delt klient/process. Pending caller venter på en ny snapshot-pass; får aldrig blot det gamle resultat.
- [ ] Wrap eksisterende Safe; bevar RPC-rækkefølge, false/deferred/coalesced-kontrakter og heartbeat kun efter succes. Test clock er eksplicit.
- [ ] Regressioner for dirty-data-opfølgning, ny request under pending pass, fejl/cleanup, separate klienter og uændret #5911.
- [ ] Preflight/FULL gennem verify-lock, uafhængigt review, CodeRabbit, merge-kø og post-verify.
- [ ] Første merge: flip #5900 til done og flyt RESTEN til deduplikationskontrolleret issue med design-/testplan-beslutning.

**Uleveret:** durable refresh-claim på tværs af processer/restarts; tick-budget/backpressure/retry+jitter; samlet efterarbejde pr. tick; #5692's concurrent transport og bevis for normal friskhed. #5900's kommentar 2/10 kræver #3511/#6102 og samlet design/testplan før scheduler-adfærdsændring; dette helperfix foregriber ingen af dem.
**Spillertekst:** urørt efter OPERATING_PLAN; Claude håndterer samlet kommunikation. Ingen feature/flag/livscyklusændring, SQL eller manuel prod-skrivning.
