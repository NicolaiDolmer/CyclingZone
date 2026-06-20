# Concurrency / race-condition audit — 2026-06-20

> Natbølge-audit (forever-relaunch-readiness): 4 concurrency-scannere (auktion-finalisering/proxy-bud, transfer/loan-flush, cron-overlap, balance/trup-integritet) + adversariel verifikation + synthesis. Adversariel fase var kritisk: ~25 af 26 påståede races faldt ved verifikation. Filer: `auctionFinalization.js`, `academyIntake.js`, `proxyBidding.js`, `loanEngine.js`, `squadEnforcement.js`, `cron.js`, `database/2026-05-09-balance-rpc.sql`, `database/2026-05-10-*late-bid*.sql`.

## Bundlinje

**Præcis ÉN reel race på tværs af alle 4 audits — og den er allerede sporet (#1558).** De øvrige påstande faldt fordi koden har de rigtige guards. Backend er i god concurrency-form. Den eneste launch-blocker er #1558.

**Ops-kontekst (vigtig):** cron kører **in-process** i samme Node-proces som API'et (`server.js:58 → startCron()`), og `trackedTick` er **ikke en mutex** (tæller kun til graceful shutdown). Overlappende ticks er fysisk mulige hvis en tick varer længere end sit interval — realistisk under relaunch-batch-last (mange udløbne auktioner i én tick). Railway-replica-count kunne ikke probes (secret-hook blokerede). Så "to samtidige finalize-paths" er en præmis der IKKE kan afvises → den underbygger #1558.

## Eneste bekræftede race → #1558 (HØJ, haster før relaunch)

**Vigtig dybere indsigt end økonomi-auditen gav:** #1558 har **TO krydser**, og **idempotency-key alene lukker den IKKE.**
- `auctionFinalization.js:179-239` (`finalizeYouthAuctionRecord`) + `academyIntake.js:198-246` (`signAcademyCandidate`) laver begge et **ulåst `getTeamAcademyCount()`** FØR de skriver `riders` + debiterer.
- De to stier bruger **forskellige idempotency-keys** (`youth_auction_winner:${auctionId}` vs. INGEN key på `academy_signing`) → to separate `finance_transactions` → begge debiteringer lander. **Man kan ikke lukke racen ved blot at tilføje én idempotency-key.**
- Ingen guard dækker: advisory-lock holdes kun INDE i balance-RPC'en (spænder ikke over count→update→debit); ingen DB-cap-constraint (COUNT≤8 kan ikke være CHECK).
- **Fix skal lukke BEGGE krydser** (finalize-vs-finalize OG signAcademyCandidate-vs-finalize): atomær check+placement+debit i én RPC med `pg_advisory_xact_lock(team_id)` over hele sekvensen, ELLER betal-efter-placering med rollback. Detaljer + sporing: **#1558**.

## Edge-cases der fejler i SIKKER retning (ingen launch-handling)

- **`repayLoan` dobbeltklik** (`loanEngine.js:476-548`): ét ejer-kaldested; balance-check + clamp + RPC-lås → worst-case kosmetisk `amount_remaining`-drift, **ingen tabt penge**.
- **Senior-auktion/proxy balance-gate**: soft pre-check + hård RPC; balance-dyk → negativ balance (bevidst gæld-feature), ikke korruption. Proxy INSERTer ikke bud ved utilstrækkelig balance (defensiv).
- **Graduation-sweep vs. season-transition**: `UNIQUE(rider_id, season_id)` + status-reread → worst-case redundant UPDATE; season-auto-transition er desuden DEAKTIVERET (kræver manuel admin samtidig med 22:00-sweep). Lav-sandsynlig, ikke-destruktiv.
- **Squad-enforcement mid-crash** (`squadEnforcement.js:24-26`): kendt+kodedokumenteret ~50-200ms vindue; per-team `idempotency_key` forhindrer dobbelt-debit ved replay. Overvej per-team-records-tabel KUN hvis observeret i metrics post-launch.

## Solidt — verificeret korrekt beskyttet (ros)

- **`reject_late_auction_bid`-trigger** (BEFORE INSERT) afviser på både `bid_time >= calculated_end` OG `status NOT IN ('active','extended')` — DB-håndhævet forsvar mod sene bud + cron-finalize-race. Dræber flest race-påstande.
- **`increment_balance_with_audit`-RPC**: `pg_advisory_xact_lock` + atomisk `UPDATE ... RETURNING`; **ALLE balance-mutationer går herigennem** (ingen rå `UPDATE teams SET balance` findes — grep-bekræftet). Lost-update udelukket over hele økonomien.
- **`uniq_finance_idempotency_key` + 23505-skip**: dræber dobbelt-finalize/cron-retry-dup overalt hvor begge paths deler key (dvs. overalt undtagen #1558's tværgående kryds).
- **In-statement rider-guards** (`.eq("team_id", x).is("pending_team_id", null)` i SAMME UPDATE): forhindrer at en rytter ender på to hold via samtidige handler.

## Anbefaling

Luk **#1558** før forever-relaunch (atomær RPC, begge krydser). Alt andet er enten verificeret beskyttet eller fejler i sikker retning. Den vigtigste ops-opfølgning: bekræft Railway-replica-count = 1 (ellers er cron-overlap-overfladen større end in-process-antagelsen) — eller flyt cron til en dedikeret single-instance worker før skala.
