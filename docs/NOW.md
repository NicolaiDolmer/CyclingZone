# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **#4370 er NØGLESTENEN — fix den først.** Målt 1/9: `playwright-smoke` rød på HVER branch siden 31/8 19:43 (sidste grønne 19:35); 5 fejl, alle `mobile-webkit` React #421. Den holder **tre færdige PR'er** nede: **#4546** (#4545, verificeret på preview, mergeable) · **#4533** · **#4388**. Fixes den, åbner tre merges på én gang. Derefter: **#2423 P1 Skew Protection** (ejer-godkendt 1/9 som næste PR). **Udestår også:** post fair play-opfølgningen (#4537, udkast klar) · **#4535** matrix-header afventer stadig ejer-retning (branch `feat/4535-matrix-calendar-strip`, ingen PR).

> **⏳ Venter på DIN beslutning (stil dem enkeltvist):** **#4376/PR #4388 S3-kompensation** — A = kun opad (anbefalet) / B = begge veje / C = begge veje uden minus. **Måling afstemt 1/9: 54 hold / +3.901.500 efter modifier** (56/3,32M var samme tal råt + 2 AI-hold; de 79/4,83M var forældede). Nedad = 10 hold, −195.000, og alle 10 udløber efter S3. **PR'en er rebaset og MERGEABLE** · **#4495** 7 ryttere fanget i akademiet (minimal reparation, SQL vises først) · **#3494** sponsor-målet (anbefalet: pensionér sponsor_growth minimal) · **#4485-genberegning** af de 3 løb ([`docs/audits/4485-genberegning-foreslag.md`](audits/4485-genberegning-foreslag.md), anbefaling A: efterbetal uden clawback) · **#4098 blødt loft**: designforslag i tråden, du valgte "dialog nu, beslut senere".

> **🔴 Åbne fund:** **#4545/PR #4546** chunk-fejl: manglende asset gav 200+HTML cachet `immutable` i et år, spiller sad permanent fast bag "Cycling Zone was updated"; nu 404 + chunk-fejl synlige i Sentry + post-deploy-probe. **Rest: 404'et bærer stadig `immutable`** (Vercel-headers matcher sti, ikke status) — lukkes af #2423 P1 · **#4537** fair play: spiller med 2 hold meldte sig selv, 57 auktioner annulleret 31/8; **udestår: han vælger hold, trup-håndteringen har ingen verificeret mekanik** · **#4370** (se Next action) · **#2960** React 19 + RR8: én allowlistet high-advisory venter på den; rører hydration overalt, så den skal have egen session · #4146 · #4493 · #4496 · #4530 · #4531.

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
