# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (morgen 4/9, ejer-only, én ad gangen):** **1) PR #4745 (#2423 Skew Protection):** læs PR-body, giv go → merge → slå Skew Protection TIL i Vercel (Settings → Advanced) → chunk-budget-gaten i deploy-verify (232/24 t mod 25) skal falde inden for et døgn. **2) Tænd bulk-skrivningen fra #4148** når du vil: `app_config.rider_values_bulk_write_enabled = true` (SQL i #4148-kommentaren 3/9) → mål `values(...)`-tallet i loggen. **3) Retningssamtale om træningssiden (#4613):** retning B ligger i PR #4736 (draft); start med hvad siden skal gøre for spilleren på en almindelig dag. **4) S4-apply-kæden (#4270, inden 10/9):** vælg drift-flag ELLER katalog-løft. **5) Nøgleblok #4616 → PR #4608 → mail dry_run (#2853)** · `npm run sync-deps` lokalt (react mangler i hoved-checkout, låst rolldown-fil) · Discord-post 7.239 + afstemning #4714 · mandagstal 7/9 kl. 09.

> **⏳ Venter på DIN beslutning (én ad gangen):** **#4629** træningsprogrammer §8 · **#4632** løbsdagens intention (model C) · **#4201** assistent-tilstand (mekanik merget, flag off) · **#4700** luk eller hold 14 dage · **#3426** nedkørsel, ventet 4 uger på din observation · **#4376/PR #4388** S3-kompensation (A) · **#4177** `CUSTOM_END_MIN_HOURS` · **#4576** intake-apply · #4485 · #4448 · #4098 · #3512 (anbefalet lukket) · **#4627** kræver at du kører `/design-sync`.

> **🔴 Åbne fund:** **#4753** 4 puljer på 25 hold (13 AI-hold utrimbare, FK-beslutning fra #4233 aldrig truffet) · **#4595** chunk-fejl (rodfix = #2423, PR klar) · **#4453** Railway-logvagt mangler secret · **#4537** fair play 2 hold · **#2960** React 19 egen session · #4146 · #4530 · #4531 · #4423 · **#4109** planlægnings-fladen kræver mockups · webkit-hydration #418 set intermitterende på PR-CI (datapunkt på #4370).

> **✅ Aftenbølge 3/9** (`docs/audits/night-wave-2026-09-03-aften.md`): 5 PR merget (#4740-#4744), #2423 PR #4745 afventer go, 166 locale-pile udestår på #3422.

> **🔍 Sentry/Railway-triage 4/9:** 4 Sentry-issues resolvet (støj/allerede fikset) · **PR #4754** (#4752) dedupe AI-trim-alarmen: 288 events i døgnet → 1, backend-only, 8330 tests grønne, **afventer dit go** (`audit`-check rød på en Supabase statement-timeout, urelateret — se PR-kommentar) · **#4753** rejst: 4 puljer på 25 hold fordi døde `transfer_offers` gør 13 AI-hold utrimbare — **kræver dit A/B/C-valg** (anbefaling: C).

> **📌 Til næste session:** 1) verificér PR #4754's CI + merge efter go · 2) **#3069** triageret 4/9: 6 af 7 "drift"-fund er kun formatuoverensstemmelse i `schema_migrations` (6 rækker uden `database/`-præfiks mod 391 med) — normaliserings-SQL ligger klar i kommentaren og **afventer dit go**; det 7. fund (`expire-stale-bonus-offers-4482.sql` applied, repoet har `restore-s2-end-...`) er ægte og skal ses af et menneske · 3) **#2738** rest: migrér `balanceDriftWatch` + `cronHeartbeat` til den nye `opsAlertDedupe`-hjælper.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). PR #4608 efter #4616. Pro v1.1 live. #4645 pris-vagt (synk efter #4608). #4646 udskudt 3/9. #4512 dunning · #4511 EU-moms.

> **💰 Værdier, fast dato søn 6/9:** markedsblendet 15 % (ejer-go 30/8, #4449). Før flip: runtime læser v2-artefakt, tørkørsel mod prod, ejer-go, spillerbesked. SSOT `ECONOMY_RULES.md` §9.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Kalender-invariant-audit grøn 3/9.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028).
- **Race engine:** v3 låst fallback; v4-flip ejer-only, gate = 5-seed-middel; F3-ankre grønne 2/9. Næste: #4707. **Bonustilbud (Regel A):** ét tilbud lever præcis én sæson.
- **Økonomi/værdier S3:** låst. **Sikkerhed:** kun #691 åben. **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik (#428).
- **Mekanik:** PR'er merges med `--admin` (én ad gangen); `database/*.sql` applies af auto-migrate.yml ved merge, Claude laver kun post-verify.

> **🤖 Working agent:** Ingen aktiv session (Fable lukkede aftenbølgen 3/9 kl. ~00:50; ejeren sov fra 23:55).

_Historik i git-log, issue-tråde + docs/audits/._
