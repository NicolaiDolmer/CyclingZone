# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Natbølge 2/9-3/9 kører** (spor, worktrees og regler i [pengeplan §4](superpowers/specs/2026-09-02-30-dages-pengeplan.md)). **Morgen 3/9 kl. 09:00 (ejer, 30 min):** visuelt go på drafts (Pro-perks #4649, årsmøde-frontend #4557, design-kit #4625, mail v2 #2853, Tilmeld-knap #4592) → merge-runde (auto-merge grønne backend-PR'er #4648 #4646 #2816 #4555 #4645 #4644) → S-M2c-migration applies af Claude efter merge (GO) → nøgleblok #4616 (Alunta EUR-planer i checkout, Railway EUR-nøgler, Resend + unsub) → dry_run #2853 (GO). Mandagstal (§0.9) måles man 7/9 kl. 09 via SQL + Alunta. Ejerens område-rækkefølge for alt udskudt står i MASTERPLAN §G (design-kit først).

> **⏳ Venter på DIN beslutning (stil dem enkeltvist):** **#4376/PR #4388 S3-kompensation** — A = kun opad (anbefalet, 54 hold / +3.901.500) / B = begge veje / C = begge veje uden minus; PR rebaset og mergeable · **#4495** 7 ryttere fanget i akademiet (SQL vises først) · **#4485-genberegning:** audit skal genkøres m. U25-reglen (26 løb, 915 rækker), så ét go · **#4098 blødt loft**: dialog nu, beslut senere · **#3512** arketyper del 2: anbefalet lukket.

> **🔴 Åbne fund:** **#4644 HØJ: 15 daglige crons kører aldrig ved deploys** · **#4545/PR #4546** chunk-fejl: manglende asset gav 200+HTML cachet `immutable` i et år, spiller sad permanent fast bag "Cycling Zone was updated"; nu 404 + chunk-fejl synlige i Sentry + post-deploy-probe. **Rest: 404'et bærer stadig `immutable`** (Vercel-headers matcher sti, ikke status) — lukkes af #2423 P1 · **#4537** fair play: spiller med 2 hold meldte sig selv, 57 auktioner annulleret 31/8; **udestår: han vælger hold, trup-håndteringen har ingen verificeret mekanik** · **#4370** (se Next action) · **#2960** React 19 + RR8: én allowlistet high-advisory venter på den; rører hydration overalt, så den skal have egen session · #4146 · #4493 · #4496 · #4530 · #4531.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). Målt 2/9: MRR 113,87 kr, 3 abo, checkout 2 af 5. PR #4608 (sprog vælger valuta) rebaset + ejer-go 2/9, merges i natbølgen; EUR-checkout virker først når #4616-nøgleblokken er gjort. **#4648:** webhook smider subscription-events væk (nested `customer.external_customer_id`), Pro landede efter 55 min; fix i nat. #4512 dunning (ejer) · #4511 EU-moms (revisor).

> **💰 Værdier, fast dato søn 6/9:** markedsblendet tændes med **15 % vægt** (ejer-go 30/8, [#4449](https://github.com/NicolaiDolmer/CyclingZone/issues/4449)). Før flip: runtime skal læse v2-artefaktet, tørkørsel mod prod, ejer-go, spillerbesked. Kadence (søn kl. 06) live siden #4419. SSOT: [`ECONOMY_RULES.md`](ECONOMY_RULES.md) §9.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Nattens kalender-audit (05:50) = #4507-beviset - tjek den i næste session.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder. Alders-referenceår = `riderSeasonAge.js` SSOT (S3=2028; #4485-kodefix ligger i PR #4533).
- **Race engine:** v3 låst fallback; v4-flip ejer-only. **v4-gate = 5-seed-middel (ejer 2/9); alle tre F3-ankre GRØNNE 2/9: nedkørsel 0,46, bjerg 208 s (måles på topankomster, ejer-valg A), sprinter 95 %. Næste: #4615 harness-TeamOrders + M5/M6/M14.** **Bonustilbud (Regel A, ejer 31/8): et tilbud lever præcis én sæson** - sæson-slut-tilbud indløses hele den følgende sæson.
- **Økonomi/værdier S3:** låst. [`ECONOMY_RULES.md`](ECONOMY_RULES.md). **Sikkerhed:** kun #691 åben.
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik (#428); tråd-bank #4117.

> **🤖 Working agent:** Claude Fable 5.1 · Code · DolmerPC · 2/9 20:30 → 3/9 09:45: natbølge (pengeplan §4), worktrees under `C:\Dev\CyclingZone-worktrees\`. **Playwright-slottet er optaget af orkestratoren.**

_Historik i git-log, issue-tråde + docs/audits/._
