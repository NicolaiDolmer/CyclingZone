# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Ejer-beslutninger 2/9 (alle 7 kort truffet):** mail-loopet JA (PR #4602 draft: Del D + gyldig Resend-nøgle mangler) · U25 = UCI, 25 og yngre (MERGET #4593, migration kørt: 744 ryttere re-flagget, backup-tabel) · U25-genberegning: samlet besked FØRST ved genberegning (26 S3-løb, 28.125 CZ$ slutpræmier; audit skal genkøres m. ny regel) · Agony-kort: ejer spørger spillerne · v4 F3 = JA, parallel worker (IKKE startet; #4246 = A: taktik-kortet vinder pr. etape, rollen er standard) · Pro-checkout ÅBNES NU (PR #4597 rebaset, CI-vagt, merge ved grønt) · dagsform 11 trin (-5..+5), kun eget hold, rytterens stemme (PR #4603 WIP-draft) · inaktiv-epic #4592 (S3-prep MERGET #4601; kør `backend/scripts/dormantTeamsReport.js` før S4). #4584 og #4597 MERGET 2/9 ~09:50 (løbsside-perf live, Pro-checkout åben; udkast til spillerbesked i docs/drafts/pro-checkout-open-2026-09-02.md). **Næste session:** F3-worker på **#4604** (sprinter-ankeret først, scorecard-gate) → #4485-audit m. ny regel → #4602 Del D + Resend-nøgle → #4568 rebase → #4603.

> **⏳ Venter på DIN beslutning (stil dem enkeltvist):** **#4376/PR #4388 S3-kompensation** — A = kun opad (anbefalet) / B = begge veje / C = begge veje uden minus. **Måling afstemt 1/9: 54 hold / +3.901.500 efter modifier** (56/3,32M var samme tal råt + 2 AI-hold; de 79/4,83M var forældede). Nedad = 10 hold, −195.000, og alle 10 udløber efter S3. **PR'en er rebaset og MERGEABLE** · **#4495** 7 ryttere fanget i akademiet (minimal reparation, SQL vises først) · **#4485-genberegning:** auditten ([`docs/audits/4485-genberegning-foreslag.md`](audits/4485-genberegning-foreslag.md), 3 løb) er FORÆLDET efter U25-reglen 2/9 (målt: 26 løb, 915 rækker); genkør audit m. ny regel, så ét go på rang+point+penge samlet (ejer 2/9: besked først ved genberegning) · **#4098 blødt loft**: designforslag i tråden, du valgte "dialog nu, beslut senere".

> **🔴 Åbne fund:** **#4545/PR #4546** chunk-fejl: manglende asset gav 200+HTML cachet `immutable` i et år, spiller sad permanent fast bag "Cycling Zone was updated"; nu 404 + chunk-fejl synlige i Sentry + post-deploy-probe. **Rest: 404'et bærer stadig `immutable`** (Vercel-headers matcher sti, ikke status) — lukkes af #2423 P1 · **#4537** fair play: spiller med 2 hold meldte sig selv, 57 auktioner annulleret 31/8; **udestår: han vælger hold, trup-håndteringen har ingen verificeret mekanik** · **#4370** (se Next action) · **#2960** React 19 + RR8: én allowlistet high-advisory venter på den; rører hydration overalt, så den skal have egen session · #4146 · #4493 · #4496 · #4530 · #4531.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). **Rod-årsag BEKRÆFTET 1/9** (triage-måling i #4514): perioden rullede til 1/10 uden faktura og uden træk; faktura #2 er 24 dage over. Nye: **#4541** (Aluntas svarform aldrig verificeret - dry-run venter) + **#4542** (cache-friskhed kan ikke aflæses) · #4512 dunning (ejer) · #4511 EU-moms. Spor D aktivt: #2853-mailtekster + /pro #4074 · #2813 (needs-decision).

> **💰 Værdier, fast dato søn 6/9:** markedsblendet tændes med **15 % vægt** (ejer-go 30/8, [#4449](https://github.com/NicolaiDolmer/CyclingZone/issues/4449)). Før flip: runtime skal læse v2-artefaktet, tørkørsel mod prod, ejer-go, spillerbesked. Kadence (søn kl. 06) live siden #4419. SSOT: [`ECONOMY_RULES.md`](ECONOMY_RULES.md) §9.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Nattens kalender-audit (05:50) = #4507-beviset - tjek den i næste session.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder. Alders-referenceår = `riderSeasonAge.js` SSOT (S3=2028; #4485-kodefix ligger i PR #4533).
- **Race engine:** v3 låst fallback; v4-flip ejer-only. **Bonustilbud (Regel A, ejer 31/8): et tilbud lever præcis én sæson** - sæson-slut-tilbud indløses hele den følgende sæson.
- **Økonomi/værdier S3:** låst. [`ECONOMY_RULES.md`](ECONOMY_RULES.md). **Sikkerhed:** kun #691 åben.
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik (#428); tråd-bank #4117.

> **🤖 Working agent:** Ingen aktiv session (status quo-session 2/9 lukket ~09:30: 9 merges, 3 draft-PR'er, rapport: artifact 8d54da64). 2/9: Discord-sweep → #4588 #4589 #4590 #4591. #4596 kortlagde `rolling` i ni grupperinger → CALENDAR_RULES §5a. Boardroom BETA (kun admin).

_Historik i git-log, issue-tråde + docs/audits/._
