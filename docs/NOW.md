# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **#4535 matrix-header: AFVENT ejer-retning FØR videre byg.** 3 design-iterationer 1/9-nat (egen strip afvist som duplikering → båndet er sidens ENE kalender; label-rækker Løb/Datoer/Trup/Løbsdag; skrå navne; sæson-løbsdagsnumre) — ejeren stadig ikke tilfreds, vender tilbage. Status + afklaringer i #4535-kommentaren; branch `feat/4535-matrix-calendar-strip` (pushet, ingen PR), preview `matrix-4535-mock` port 5216. **Stadig udestående:** post fair play-opfølgningen (#4537, 2 min, udkast klar) · **#4370** WebKit-hydration (smoke rød på ALLE branches; PR #4533 merges når grøn). ✅ 1/9-nat: **#4534 SHIPPED** — PR #4536 admin-merged forbi kendt rød smoke (ejer-valg), migration post-verificeret i prod, Vidal genindsat som kaptajn (ejer-GO), sweep: ingen andre spillere ramt. Patch 7.225 ude; Discord-udkast om planneren ligger i sessionen (ejer poster når #4535 er live).

> **⏳ Venter på DIN beslutning (stil dem enkeltvist):** **#4376/PR #4388 S3-kompensation** — A = kun opad (anbefalet) / B = begge veje / C = begge veje uden minus. **Måling afstemt 1/9: 54 hold / +3.901.500 efter modifier** (56/3,32M var samme tal råt + 2 AI-hold; de 79/4,83M var forældede). Nedad = 10 hold, −195.000, og alle 10 udløber efter S3. **PR'en er rebaset og MERGEABLE** · **#4495** 7 ryttere fanget i akademiet (minimal reparation, SQL vises først) · **#3494** sponsor-målet (anbefalet: pensionér sponsor_growth minimal) · **#4485-genberegning** af de 3 løb ([`docs/audits/4485-genberegning-foreslag.md`](audits/4485-genberegning-foreslag.md), anbefaling A: efterbetal uden clawback) · **#4098 blødt loft**: designforslag i tråden, du valgte "dialog nu, beslut senere".

> **✅ 31/8-bølgen (oplås-og-byg):** 8 beslutninger målt+verificeret ([beslutningsark](audits/beslutningsark-2026-08-31.md)), 10 PR'er merget, sæsonmatrixen LIVE (#4323). Detaljer i git-log + issue-tråde. Opfølgning: #4530 · #4531.

> **🔴 Åbne fund:** **#4535** header-design (se Next action) · **#4537** fair play: spiller med 2 hold meldte sig selv, 57 1-CZ-auktioner annulleret 31/8 (verificeret, backup taget); **udestår: han vælger hold, det andet lukkes — trup-håndteringen har ingen verificeret mekanik** · **#4370** WebKit (blokerer smoke) · **#4146** beslutningsoplæg i tråden · **#4493** sanitize falsk positiv · **#4496** CI-vagt.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). **Rod-årsag BEKRÆFTET 1/9** (triage-måling i #4514): perioden rullede til 1/10 uden faktura og uden træk; faktura #2 er 24 dage over. Nyt: `current_period_end` udløb i nat → Pro-mærket faldt for den eneste kunde (kosmetisk; ingen backend-gate). Nye: **#4541** (Aluntas svarform aldrig verificeret - dry-run venter) + **#4542** (cache-friskhed kan ikke aflæses) · #4512 dunning (ejer) · #4511 EU-moms. Spor D aktivt: #2853-mailtekster + /pro #4074 · #2813 (needs-decision).

> **💰 Værdier, fast dato søn 6/9:** markedsblendet tændes med **15 % vægt** (ejer-go 30/8, [#4449](https://github.com/NicolaiDolmer/CyclingZone/issues/4449)). Før flip: runtime skal læse v2-artefaktet, tørkørsel mod prod, ejer-go, spillerbesked. Kadence (søn kl. 06) live siden #4419. SSOT: [`ECONOMY_RULES.md`](ECONOMY_RULES.md) §9.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Nattens kalender-audit (05:50) = #4507-beviset - tjek den i næste session.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder. Alders-referenceår = `riderSeasonAge.js` SSOT (S3=2028; #4485-kodefix ligger i PR #4533).
- **Race engine:** v3 låst fallback; v4-flip ejer-only. **Bonustilbud (Regel A, ejer 31/8): et tilbud lever præcis én sæson** - sæson-slut-tilbud indløses hele den følgende sæson.
- **Økonomi/værdier S3:** låst. [`ECONOMY_RULES.md`](ECONOMY_RULES.md). **Sikkerhed:** kun #691 åben.
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik (#428); tråd-bank #4117.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
