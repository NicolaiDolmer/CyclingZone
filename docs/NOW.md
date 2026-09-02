# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Ejer: svar på G-rækkefølgen i `MASTERPLAN.md` §G** (session B = bestyrelsen #4579/#4586/#4578 → S-M2c; session C = **#4595** chunk-budget, deploy-verify FEJLER på det siden 11:51 + #4548). **#4635 merget (#4618 lukket); TASTE.md GODKENDT** → **#4624 audit = næste design-session** (ejer Playwright-slottet). **Næste session = #4616 Infisical** (EUR-planer i Alunta ✅ oprettet 2/9; rest: Railway-nøgler `ALUNTA_CZ_PRO_PLAN_ID_*_EUR`, DKK 6 mdr reprise 295→265, ejer-visuelt go på /pro EN+DA, Resend-nøgler, checkout-sprog, #4511) → merge PR #4608 → mail-loop dry-run (`docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md`). **Derefter (forslag 2/9, hård dato 27/9):** bestyrelsens beta-blokkere #4579/#4586/#4578 → S-M2c årsmødet (#4557) · design-audit #4624 når TASTE er godkendt (eget worktree) · #4619 spec (flip ved cutover 28/9) · #4388 S3-komp. (A anbefalet) · #4615 harness-TeamOrders · #3512 anbefalet lukket. **Leveret 2/9:** TASTE.md godkendt (#4623), ungdoms-handoff i `docs/design/youth-tiers/` (#4617, regler i `YOUTH_RULES.md` §2.6), slice 0 merget (#4618). **Træning 2/9:** `TRAINING_RULES.md` §12 + #4629-#4634, roadbook-udkast i `docs/discord/`; rækkefølge mod #4624 fri.

> **⏳ Venter på DIN beslutning (stil dem enkeltvist):** **#4376/PR #4388 S3-kompensation** — A = kun opad (anbefalet, 54 hold / +3.901.500) / B = begge veje / C = begge veje uden minus; PR rebaset og mergeable · **#4495** 7 ryttere fanget i akademiet (SQL vises først) · **#4485-genberegning:** audit skal genkøres m. U25-reglen (26 løb, 915 rækker), så ét go · **#4098 blødt loft**: dialog nu, beslut senere · **#3512** arketyper del 2: anbefalet lukket.

> **🔴 Åbne fund:** **#4545/PR #4546** chunk-fejl: manglende asset gav 200+HTML cachet `immutable` i et år, spiller sad permanent fast bag "Cycling Zone was updated"; nu 404 + chunk-fejl synlige i Sentry + post-deploy-probe. **Rest: 404'et bærer stadig `immutable`** (Vercel-headers matcher sti, ikke status) — lukkes af #2423 P1 · **#4537** fair play: spiller med 2 hold meldte sig selv, 57 auktioner annulleret 31/8; **udestår: han vælger hold, trup-håndteringen har ingen verificeret mekanik** · **#4370** (se Next action) · **#2960** React 19 + RR8: én allowlistet high-advisory venter på den; rører hydration overalt, så den skal have egen session · #4146 · #4493 · #4496 · #4530 · #4531.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). Pro-checkout åben 2/9 (#4597). **Sprog vælger valuta (ejer 2/9): DA=kroner 49/265, EN=euro 6,49/34,99** — PR #4608 draft (kode + docs færdige, EUR-planer oprettet i Alunta 2/9), blokeret på #4616: Railway-nøgler + DKK-halvår 265 + visuelt go. Alunta-checkout-siden er dansk uanset sprog (målt 2/9). #4514 rod-årsag bekræftet 1/9 · #4541 · #4542 · #4512 dunning (ejer) · #4511 EU-moms (revisor).

> **💰 Værdier, fast dato søn 6/9:** markedsblendet tændes med **15 % vægt** (ejer-go 30/8, [#4449](https://github.com/NicolaiDolmer/CyclingZone/issues/4449)). Før flip: runtime skal læse v2-artefaktet, tørkørsel mod prod, ejer-go, spillerbesked. Kadence (søn kl. 06) live siden #4419. SSOT: [`ECONOMY_RULES.md`](ECONOMY_RULES.md) §9.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Nattens kalender-audit (05:50) = #4507-beviset - tjek den i næste session.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder. Alders-referenceår = `riderSeasonAge.js` SSOT (S3=2028; #4485-kodefix ligger i PR #4533).
- **Race engine:** v3 låst fallback; v4-flip ejer-only. **v4-gate = 5-seed-middel (ejer 2/9); alle tre F3-ankre GRØNNE 2/9: nedkørsel 0,46, bjerg 208 s (måles på topankomster, ejer-valg A), sprinter 95 %. Næste: #4615 harness-TeamOrders + M5/M6/M14.** **Bonustilbud (Regel A, ejer 31/8): et tilbud lever præcis én sæson** - sæson-slut-tilbud indløses hele den følgende sæson.
- **Økonomi/værdier S3:** låst. [`ECONOMY_RULES.md`](ECONOMY_RULES.md). **Sikkerhed:** kun #691 åben.
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik (#428); tråd-bank #4117.

> **🤖 Working agent:** Session B (bestyrelsens beta-blokkere #4586 → #4579 → #4578, worktree `C:devCyclingZone-worktreesix-4586-voice-name-salt`, startet 2/9 aften; Playwright-slottet ejes af session A, kun board-specs koeres her). Derefter S-M2c-spec.

_Historik i git-log, issue-tråde + docs/audits/._
