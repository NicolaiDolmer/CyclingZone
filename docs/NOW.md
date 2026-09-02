# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Ejer: læs design-auditten** (PR #4641, `docs/audits/design-quality-audit-2026-09.md`: TL;DR + top-10) → #4624 done. Session C = **#4595** chunk-budget (intermitterende rød deploy-verify) + #4548. **TASTE.md GODKENDT; #4624 leveret** → næste design-session = **#4625 kit** (fire kit-fund i auditten). **Næste session = #4616 Infisical** (EUR-planer i Alunta ✅ oprettet 2/9; rest: Railway-nøgler `ALUNTA_CZ_PRO_PLAN_ID_*_EUR`, DKK 6 mdr reprise 295→265, ejer-visuelt go på /pro EN+DA, Resend-nøgler, checkout-sprog, #4511) → merge PR #4608 → mail-loop dry-run (`docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md`). **Derefter (ejer-godkendt 2/9, hård dato 27/9):** bestyrelsens beta-blokkere #4579/#4586/#4578 → S-M2c årsmødet (#4557) · #4625 kit ∥ #4626 CI-vagter · #4619 spec (flip ved cutover 28/9) · #4388 S3-komp. (A anbefalet) · #4615 harness-TeamOrders · #3512 anbefalet lukket. **Leveret 2/9:** #4623 TASTE, #4617 ungdoms-handoff (`YOUTH_RULES.md` §2.6), #4618 merget. **Træning 2/9:** `TRAINING_RULES.md` §12 + #4629-#4634, roadbook i `docs/discord/`.

> **⏳ Venter på DIN beslutning (stil dem enkeltvist):** **#4376/PR #4388 S3-kompensation** — A = kun opad (anbefalet, 54 hold / +3.901.500) / B = begge veje / C = begge veje uden minus; PR rebaset og mergeable · **#4495** 7 ryttere fanget i akademiet (SQL vises først) · **#4485-genberegning:** audit skal genkøres m. U25-reglen (26 løb, 915 rækker), så ét go · **#4098 blødt loft**: dialog nu, beslut senere · **#3512** arketyper del 2: anbefalet lukket.

> **🔴 Åbne fund:** **#4545/PR #4546** chunk-fejl: manglende asset gav 200+HTML cachet `immutable` i et år, spiller sad permanent fast bag "Cycling Zone was updated"; nu 404 + chunk-fejl synlige i Sentry + post-deploy-probe. **Rest: 404'et bærer stadig `immutable`** (Vercel-headers matcher sti, ikke status) — lukkes af #2423 P1 · **#4537** fair play: spiller med 2 hold meldte sig selv, 57 auktioner annulleret 31/8; **udestår: han vælger hold, trup-håndteringen har ingen verificeret mekanik** · **#4370** (se Next action) · **#2960** React 19 + RR8: én allowlistet high-advisory venter på den; rører hydration overalt, så den skal have egen session · #4146 · #4493 · #4496 · #4530 · #4531.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). Pro-checkout åben 2/9 (#4597). **Sprog vælger valuta (ejer 2/9): DA=kroner 49/265, EN=euro 6,49/34,99** — PR #4608 draft (kode + docs færdige, EUR-planer oprettet i Alunta 2/9), blokeret på #4616: Railway-nøgler + DKK-halvår 265 + visuelt go. Alunta-checkout-siden er dansk uanset sprog (målt 2/9). **#4636/#4541 lukket 2/9** (PR #4637: vilkårsaccept ≠ kunde, `plan_interval` normaliseret, reconcile kører ved boot) · #4514 · **#4640 merget: reconcile hver time + 3-døgns respit** · #4512 dunning (ejer) · #4511 EU-moms (revisor).

> **💰 Værdier, fast dato søn 6/9:** markedsblendet tændes med **15 % vægt** (ejer-go 30/8, [#4449](https://github.com/NicolaiDolmer/CyclingZone/issues/4449)). Før flip: runtime skal læse v2-artefaktet, tørkørsel mod prod, ejer-go, spillerbesked. Kadence (søn kl. 06) live siden #4419. SSOT: [`ECONOMY_RULES.md`](ECONOMY_RULES.md) §9.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Nattens kalender-audit (05:50) = #4507-beviset - tjek den i næste session.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder. Alders-referenceår = `riderSeasonAge.js` SSOT (S3=2028; #4485-kodefix ligger i PR #4533).
- **Race engine:** v3 låst fallback; v4-flip ejer-only. **v4-gate = 5-seed-middel (ejer 2/9); alle tre F3-ankre GRØNNE 2/9: nedkørsel 0,46, bjerg 208 s (måles på topankomster, ejer-valg A), sprinter 95 %. Næste: #4615 harness-TeamOrders + M5/M6/M14.** **Bonustilbud (Regel A, ejer 31/8): et tilbud lever præcis én sæson** - sæson-slut-tilbud indløses hele den følgende sæson.
- **Økonomi/værdier S3:** låst. [`ECONOMY_RULES.md`](ECONOMY_RULES.md). **Sikkerhed:** kun #691 åben.
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik (#428); tråd-bank #4117.

> **🤖 Working agent:** **B** (bestyrelsen #4586 → #4579 → #4578, worktree `CyclingZone-worktrees/fix-4586-voice-name-salt`) → S-M2c-spec. Session A lukket ~15:45 (audit leveret, PR #4641); **Playwright-slottet er frit.**

_Historik i git-log, issue-tråde + docs/audits/._
