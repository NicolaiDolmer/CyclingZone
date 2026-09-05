# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (ejer-styret, ét kort ad gangen): merge-runden efter natbølge 5-6/9.** Kø + politik pr. PR i `docs/audits/night-wave-2026-09-05.md` (28 PR'er, 0 merget i nat) + **#4824** fra triagen 5/9 (telemetri-boundary, CYCLINGZONE-5B). 1) Ejer-go pr. PR, `--admin` én ad gangen: docs/backend først, de 8 UI-drafts (visuelt go på screenshots) sidst; done-flip PR-for-PR. 2) Én samlet patch note (udkast i sessionens scratchpad, kun det merget). 3) Apply-GO-kort ét ad gangen: #4495 fangne graduates · #4539 dublet-enkeltstart · #4750 tilbagerulning. 4) #4804: bekræft at auto-merge-workflowet fjernes (din beslutning 4/9). 5) Derefter det tidligere: #4147 flag-flip · #4753 post-verify · omdømme PR 2 (#1099, backfill + `shadow`) · #4616 · #3512 · #4736/#4613 retning.

> **⏳ Venter på DIN beslutning:** 6 ejer-valg i `docs/audits/ai-triage-2026-09-06-a.md` (+ del B) · **#4814** foto-plads + /seasons-skygger · **#4629** · **#4632** · **#4613** · **#4714** · #4627 · **#4235** (15/9) · spand D i `stale-issues-audit-2026-09-04.md`.

> **🔴 Åbne fund:** **#2423** skew protection SLÅET FRA (kun selvheling #4595 + ét deploy-vindue pr. bølge) — CYCLINGZONE-56 eskalerer: 113 events/28 spillere på 24 t (5/9), og samme skew gav #4823 (4 spillere fik fejlside) · **#4811** signup-sprog måles ikke (0 rækker) · **#4828** 4 D4-puljer kører 25/24 (AI-trim-markører; CYCLINGZONE-58 måler markørens alder, ikke blokeringens) → **#4829** verificér efter Settimana-finalen 5/9 10:00 UTC · #4453 · #4537 · #4530 · #4531 · #4109.

> **✅ Natbølge 5-6/9 (Fable):** 26 spor i 7 workflows → 28 PR'er (#4784–#4817), 6 nye issues (#4811–#4816), 6 agenter frøs tavst og blev recoveret i samme worktrees. Læring: frosne agenter holder deres samtidigheds-plads, så stop workflowet og relancér (runbook + `.claude/learnings/2026-09-06-*`).

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 12 betalende (MRR 436 kr). #4616: EUR-planer i Alunta men ikke i checkout, Railway mangler EUR-nøgler → ejer-klik. #4514: kunden beholder Pro (ejer 4/9). B2C-only ønske (#4511/#4616 pkt 8).

> **✅ S3 kører:** 529 løb, 28/8 → søn 27/9. Etaper hver hele time; scheduler hvert 5. min.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (GT-hviledage bundet, #4209). **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** v3 låst fallback; v4-flip ejer-only. Krav til v4 (ejer 4/9): #2789 rute-huller, #2944 graduerede styrt + mekaniske uheld uden DNF, #2582 tidsgrænse.
- **Grundregler (rytter, værdi/løn, økonomi-balance) udskudt til efter 27/9** (ejer 28/8 + 4/9).
- **Mekanik:** PR'er merges med `--admin` én ad gangen, ÉT deploy-vindue pr. bølge; `database/*.sql` applies af auto-migrate.yml, Claude laver post-verify. Workers: maks 3 tunge, push senest efter 15 min, fremdrift måles på branchens sidste push.

> **🤖 Working agent:** Ingen aktiv session (natbølge-sessionen 5-6/9 lukkede kl. ~06:30; merge-runden genoptages i samme session med ejeren).

_Historik i git-log, issue-tråde + docs/audits/._
