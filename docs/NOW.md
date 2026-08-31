# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Start hotfix-sessionen med [`drafts/2026-09-01-session-prompt-planner-forbedringer.md`](../drafts/2026-09-01-session-prompt-planner-forbedringer.md).** Opgave 1 = **#4534** (matrixen kan FJERNE ryttere fra startede løb - live, game-breaking, ejer-bestilt straks) + Vidal-datareparation. Opgave 1b = **#4370** (React #421 stadig live på mobil-Safari: requestIdleCallback-fallbacken duer ikke i WebKit; når smoke er grøn merges også **PR #4533**, #4485-kodefixet, ejer-godkendt til merge). Derefter #4535 (tidsakse-mockup) + kø.

> **⏳ Venter på DIN beslutning (parkeret 31/8 "i aften/i morgen", stil dem enkeltvist):** **#4495** 7 ryttere fanget i akademiet (minimal reparation, SQL vises først) · **PR #4388** (#4376 sponsor-base; nul S3-effekt, reel deadline FØR 27/9) · **#3494** sponsor-målet (anbefalet: pensionér sponsor_growth minimal) · **#4485-genberegning** af de 3 løb ([`docs/audits/4485-genberegning-foreslag.md`](audits/4485-genberegning-foreslag.md), anbefaling A: efterbetal uden clawback) · **#4098 blødt loft**: designforslag i tråden (rekalibrering, ingen ny motor), du valgte "dialog nu, beslut senere".

> **✅ 31/8-bølgen (oplås-og-byg) leverede:** 8 beslutninger målt+verificeret ([beslutningsark](audits/beslutningsark-2026-08-31.md)) · **10 PR'er merget**: #4473 fair play · #4494 graduerings-sweep · #4508+#4524 bonustilbud **Regel A** (21 tilbud genskabt, post-verificeret; CI-uheldet → auto-migrate-guard + `database/manual/`, postmortem) · #4422 skade-DNS · #4525 #4507-vagten (3,6 s, prod-verificeret) · #4526 assistent-forslag (#4522, live) · #4527 hydrering (desktop; WebKit-hul åbent → Next action) · #4529 determinisme · #4528 kalender-vægte (brosten låst **5 %**, §6b-tilt klar til S4) · #4532 akademi-udskydelse · **PR #4323 sæsonmatrixen LIVE** (akse = løbsdage, ejer-låst; patch 7.223+7.224 ude; ejerens EN-opslag postet). Spillerfeedback samme aften → **#4534/#4535**; opfølgning #4530/#4531. #4479+#4482 lukket. Done-audit: 21 `claude:done` behandlet.

> **🔴 Åbne fund:** **#4534** (kritisk, se Next action) · **#4535** tidsakse · **#4146** beslutningsoplæg i tråden (mulighed A = ren omdøbning, kan bare bygges; balance venter på #4174-genmåling) · **#4493** sanitize falsk positiv · **#4496** CI-vagt.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). **Rod-årsag ÅBEN:** kortet trækkes aldrig - måles ved fornyelsen 1/9 · #4512 dunning (ejer) · #4511 EU-moms. Spor D aktivt: #2853-mailtekster + /pro #4074 · #2813 (needs-decision).

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Nattens kalender-audit (05:50) = #4507-beviset - tjek den i næste session.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder. Alders-referenceår = `riderSeasonAge.js` SSOT (S3=2028; #4485-kodefix ligger i PR #4533).
- **Race engine:** v3 låst fallback; v4-flip ejer-only. **Bonustilbud (Regel A, ejer 31/8): et tilbud lever præcis én sæson** - sæson-slut-tilbud indløses hele den følgende sæson.
- **Økonomi/værdier S3:** låst. [`ECONOMY_RULES.md`](ECONOMY_RULES.md). **Sikkerhed:** kun #691 åben.
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik (#428); tråd-bank #4117.

> **🤖 Working agent:** Ingen aktiv session. (Hotfix-sessionen er ejer-klareret til at starte på #4534/#4535/#4370 i eget worktree.)

_Historik i git-log, issue-tråde + docs/audits/._
