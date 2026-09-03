# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **S4-apply-kæden (#4270), ejeren vil tage den en dag inden 10/9 (ejer 3/9: "haster ikke"; hård dato 27/9).** Alt før "kør" er gjort: #4203-pakkeren merget (PR #4718), dry-run fra main = 0 placeringsbrud, scorecard i [`season4-calendar-dryrun-2026-09-03.md`](audits/season4-calendar-dryrun-2026-09-03.md). Kommentaren på #4270 (3/9 kl. 15) har den præcise apply-kommando: kræver `--allow-uniform-target-drift --allow-finale-drift` (8 balance-afvigelser: D2/D3 højbjerg under 12 %, §7b finale-bånd), ellers afbryder scriptet. Ejer-valg først: acceptér flagene ELLER løft højbjerg via kataloget + ny dry-run. Derefter post-verify + årsmøde-tørkørsel. **Ejer-only, én ad gangen:** nøgleblok #4616 (EUR-planer synlige i Alunta-checkout, Railway-nøgler `..._EUR`, `RESEND_API_KEY`, `RAILWAY_TOKEN` som repo-secret så #4453/#4269-vagterne kører) → merge PR #4608 · #4388 S3-kompensation (A anbefalet) · Discord-post 7.239 (`docs/drafts/discord-patch-7239-2026-09-03.md`) · afstemning #4714 (`docs/drafts/forum-poll-free-agent-auction-time-2026-09-03.md`). Mandagstal (§0.9) man 7/9 kl. 09.

> **⏳ Venter på DIN beslutning (stil dem enkeltvist):** **#4376/PR #4388 S3-kompensation** — A = kun opad (anbefalet, 54 hold / +3.901.500) / B = begge veje / C = begge veje uden minus · **#4177** `CUSTOM_END_MIN_HOURS` 1→12 for holdløse ryttere (hænger sammen med afstemningen #4714) · **#4576** reparations-script for 105 forladte intake-tilbud: apply + backup-migration (dry-run matcher) · **#4485-genberegning:** audit genkøres m. U25-reglen, så ét go · **#4448** luk på leveret + opfølger, eller hold åbent · **#4098 blødt loft**: dialog nu, beslut senere · **#3512** arketyper del 2: anbefalet lukket.

> **🔴 Åbne fund:** **#4595 chunk-fejl over budget** (rodfix #2423; #4545 rest: 404 bærer stadig `immutable`) · **#3777** natlig Security grants audit rød (tre proposal-filer ikke forfremmet) · **#4453/#4269** log-vagter fejler dagligt på manglende secrets (ejer-nøgleblok) · **#4537** fair play: spilleren med 2 hold skal vælge · **#2960** React 19 + RR8 kræver egen session · #4146 · #4530 · #4531 · #4423 (Connor Walker ikke repareret).

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 3/9-snapshot: 7 aktive abo (growth_metric_snapshots). PR #4608 (sprog vælger valuta) merges lige efter #4616-nøgleblokken. Pro v1.1 live (#4649, patch 7.240). #4512 dunning (ejer) · #4511 EU-moms (revisor).

> **💰 Værdier, fast dato søn 6/9:** markedsblendet tændes med **15 % vægt** (ejer-go 30/8, [#4449](https://github.com/NicolaiDolmer/CyclingZone/issues/4449)). Før flip: runtime skal læse v2-artefaktet, tørkørsel mod prod, ejer-go, spillerbesked. SSOT: [`ECONOMY_RULES.md`](ECONOMY_RULES.md) §9.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Natlig kalender-invariant-audit grøn 3/9 (#4507-beviset, lukket). **Audit 3/9:** 63 issues lukket (57 done-sweep + 6 K-verificeret), 2 done→todo, K-cache 59; ledger #627.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder. Alders-referenceår = `riderSeasonAge.js` SSOT (S3=2028).
- **Race engine:** v3 låst fallback; v4-flip ejer-only. **v4-gate = 5-seed-middel (ejer 2/9); alle tre F3-ankre GRØNNE 2/9. Næste: #4707 jagt-kalibrering.** **Bonustilbud (Regel A, ejer 31/8): et tilbud lever præcis én sæson.**
- **Økonomi/værdier S3:** låst. [`ECONOMY_RULES.md`](ECONOMY_RULES.md). **Sikkerhed:** kun #691 åben.
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik (#428); tråd-bank #4117.

> **🤖 Working agent:** Ingen aktiv session (session lukket 3/9 kl. 15:20 efter audit + S4-forberedelse + #4670). Playwright-slottet er frit. Worktrees ryddet med `npm run cleanup:worktrees:run`.

_Historik i git-log, issue-tråde + docs/audits/._
