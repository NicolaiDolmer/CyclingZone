# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **1) Retningssamtale om træningssiden 4/9 (#4613):** retning B (trup-først) ligger i PR #4736 (draft, intet live), men ejeren sagde 3/9 "ikke sikker på at dette er den side spillet har brug for". Start med *hvad siden skal gøre for spilleren på en almindelig dag* før A/B/C genåbnes; mockups i #4613-tråden. **2) S4-apply-kæden (#4270, inden 10/9, hård dato 27/9):** dry-run = 0 placeringsbrud; kommandoen (3/9 kl. 15) kræver `--allow-uniform-target-drift --allow-finale-drift` (8 balance-afvigelser) — ejer-valg: acceptér flagene ELLER løft højbjerg via kataloget. Derefter #4557-flip-forudsætninger (13 hold uden bestyrelse, tørkørsel). **3) Ejer-only, én ad gangen:** nøgleblok #4616 → merge PR #4608 → mail dry_run (#2853) · `npm run sync-deps` (låst rolldown-fil) · Discord-post 7.239 + afstemning #4714 (`docs/drafts/`) · mandagstal man 7/9 kl. 09.

> **⏳ Venter på DIN beslutning (én ad gangen):** **#4629** træningsprogrammer §8 (3 A/B) · **#4632** løbsdagens intention (model C anbefalet) · **#4201** assistent-tilstand proactive/late_fill/opt_in (mekanik merget, flag off) · **#4700** luk eller hold 14 dage (målt 0) · **#3426** nedkørsel shippet 7/8, ventet 4 uger på din prod-observation — luk? · **#4376/PR #4388** S3-kompensation (A anbefalet) · **#4177** `CUSTOM_END_MIN_HOURS` 1→12 · **#4576** intake-apply · #4485 · #4448 · #4098 · #3512 (anbefalet lukket).

> **🔴 Åbne fund:** **#4595** chunk-fejl (PR #4725 lukket umerget; rodfix = Skew Protection #2423) · **#3777** grants-audit rød · **#4453** Railway-logvagt mangler secret · **#4537** fair play 2 hold · **#2960** React 19 egen session · #4146 · #4530 · #4531 · #4423 · **#3422** pile-migrering (kræver snapshot-refresh) · **#4109** planlægnings-fladen kræver mockups.

> **✅ 3/9:** Bølge (13 opgaver, 11 PR'er, patch notes 7.242-7.244) + i18n #4733 landet (PR #4735/#4737/#4738/#4739; required checks spejlet; næste dev #4734 + #4110). Audit aften: 5 lukket (#4697 #4698 #4699 #4701 #4721) · #4267 leveret (hard rule 33 dublet-tjek + 34 masterplan→artifact) · masterplan-drift rettet (16 lukkede refs) · artifact republiceret. Ledger #627. Done-gated: 15.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). PR #4608 efter #4616. Pro v1.1 live. #4645 pris-vagt i main (synk efter #4608). #4646 udskudt af ejer 3/9. #4512 dunning · #4511 EU-moms.

> **💰 Værdier, fast dato søn 6/9:** markedsblendet 15 % (ejer-go 30/8, #4449). Før flip: runtime læser v2-artefakt, tørkørsel mod prod, ejer-go, spillerbesked. SSOT `ECONOMY_RULES.md` §9.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Kalender-invariant-audit grøn 3/9.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028).
- **Race engine:** v3 låst fallback; v4-flip ejer-only, gate = 5-seed-middel; F3-ankre grønne 2/9. Næste: #4707. **Bonustilbud (Regel A):** ét tilbud lever præcis én sæson.
- **Økonomi/værdier S3:** låst. **Sikkerhed:** kun #691 åben. **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik (#428).
- **Mekanik:** PR'er merges med `--admin` (én ad gangen); `database/*.sql` applies af auto-migrate.yml ved merge, Claude laver kun post-verify.

> **🤖 Working agent:** Fable (orkestrator), aftenbølge 3/9 fra kl. 22:20: 2 Sonnet-workers i worktrees — #2423 Skew Protection (`fix/2423-skew-protection`) · #3777 proposals-forfremmelse (`chore/3777-promote-applied-proposals`). Flere laner afventer ejer-valg.

_Historik i git-log, issue-tråde + docs/audits/._
