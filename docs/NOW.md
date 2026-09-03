# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **1) Retningssamtale om træningssiden 4/9 (#4613):** retning B (trup-først) er bygget i PR #4736 (draft, intet live), men ejeren sagde 3/9 kl. 20:40 "ikke sikker på at dette er den side spillet har brug for". Start med *hvad siden skal gøre for spilleren på en almindelig dag* før A/B/C genåbnes; mockups + skærmbilleder i #4613-tråden. **2) S4-apply-kæden (#4270, inden 10/9, hård dato 27/9):** dry-run = 0 placeringsbrud; kommando i #4270 (3/9 kl. 15) kræver `--allow-uniform-target-drift --allow-finale-drift` (8 balance-afvigelser) — ejer-valg: acceptér flagene ELLER løft højbjerg via kataloget. **3) Ejer-only, én ad gangen:** nøgleblok #4616 → merge PR #4608 · **i18n #4733 landet** (PR #4735/#4737/#4738/#4739): tilføj `key-coverage` + `delta-pending` som required checks, så spejles `scripts/ci-required-checks.json`; næste #4734 + #4110 · Discord-post 7.239 + afstemning #4714 (`docs/drafts/`). Mandagstal man 7/9 kl. 09. **3) i18n #4733 landet 3/9** (pipeline, required checks spejlet, snapshot refreshet); udestaaende paa #4733-close-out: ejer `npm run sync-deps` (laast rolldown-fil) · ejer A/B auth-mails #413 · naeste dev #4734 (backend-tekster uden om i18n) · EN-banner DA-only patch notes (#413, ejer-go) · #4110 trigger-maaling kvartalsvis.

> **⏳ Venter på DIN beslutning (stil dem enkeltvist):** **#4629** træningsprogrammer, spec §8: 3 A/B (snapshot · vent på #4632 · review af 16 default-programmer) · **#4632** løbsdagens intention, afsnit 8: 3 A/B (anbefalet model C · samme effort-felt · ship nu) · **#4700** luk eller hold 14 dage (målt 0, audit-script i main) · **#4376/PR #4388** S3-kompensation (A anbefalet) · **#4177** `CUSTOM_END_MIN_HOURS` 1→12 (hænger på #4714) · **#4576** intake-reparation apply · **#4485** · **#4448** · **#4098** · **#3512** anbefalet lukket.

> **🔴 Åbne fund:** **#4595** chunk-fejl: PR #4725 lukket uden merge (5-min-cache kostede mere end den gav); rodfix = Skew Protection **#2423** (fund i tråden) · **#3777** grants-audit rød · **#4453** Railway-logvagt mangler secret · **#4537** fair play 2 hold · **#2960** React 19 egen session · #4146 · #4530 · #4531 · #4423 · **#3422** pile-migrering (222 pile/63 filer, kræver snapshot-refresh) · **#4109** planlægnings-fladen kræver mockups først.

> **✅ Bølge 3/9 (13 opgaver via Workflow, 11 PR'er merget):** #4720 sikkerhed (qs 6.16, CodeQL, Supabase-WARNs) · #4722 cron-vagt + 3 race_results-indeks (post-verify ok, cron kører fra Railway) · #4723 anti-slop-ratchet · #4724 inaktiv-rapport (111 inaktive, 110 kandidater, 78 m. samtykke) · #4726 dobbeltbooking-audit · #4727 skadet rytter (#4701) · #4728 præmie-udfoldning (#4697/#4698) · #4729/#4730 specs · #4731 assistent-plan (#4699) · #4732 årsmøde S-M2d (#4557, beta). Patch notes 7.242-7.244. Alle Opus-workers døde på 529 og blev genkørt på Sonnet.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). PR #4608 merges efter #4616. Pro v1.1 live. #4645 pris-vagt-script i main. #4646 frafald udskudt af ejer 3/9. #4512 dunning · #4511 EU-moms.

> **💰 Værdier, fast dato søn 6/9:** markedsblendet 15 % (ejer-go 30/8, #4449). Før flip: runtime læser v2-artefakt, tørkørsel mod prod, ejer-go, spillerbesked. SSOT `ECONOMY_RULES.md` §9.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Kalender-invariant-audit grøn 3/9. Audit 3/9: 63 issues lukket, ledger #627.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028).
- **Race engine:** v3 låst fallback; v4-flip ejer-only, gate = 5-seed-middel; F3-ankre grønne 2/9. Næste: #4707. **Bonustilbud (Regel A):** ét tilbud lever præcis én sæson.
- **Økonomi/værdier S3:** låst. **Sikkerhed:** kun #691 åben. **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik (#428).
- **Mekanik:** PR'er merges med `--admin` (én ad gangen); `database/*.sql` applies af auto-migrate.yml ved merge, Claude laver kun post-verify.

> **🤖 Working agent:** Ingen aktiv session (Fable lukkede #4733-sessionen 3/9 kl. 20:45; 13-opgavers boelgen fra kl. 16 er ogsaa afsluttet, ejer bekraeftede eneste session).

_Historik i git-log, issue-tråde + docs/audits/._
