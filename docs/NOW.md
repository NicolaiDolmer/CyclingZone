# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (ejer-styret, ét kort ad gangen):** **0) Start:** er PR #4836 (patch note 7.255) ikke merget, så merge den (grøn lokalt; vagten døde med sessionen 5/9). **1) #4789 færdig-samtale** (ejer: "tal færdig i en anden session"): dry-run viser 4 promoveres, 1 promovering fuldføres, 1 slippes; PR-body har tabellen → merge → apply-GO. **2) Træningspakke inden 8/9:** #4801 (+1-loft, draft klar) + træningssidens retning (#4613, draft #4736) + valg fra #4629/#4632 → én samlet opdatering. **3) #4835 mobil-merge:** ejer opretter PAT (classic, scope repo, 90 dage) som repo-secret `AUTO_MERGE_PAT` → merge #4835 (Dependabot patch/minor må også, ejer 5/9). **4) Apply-GO:** #4539 (etape 3, kun hvis ukørt). **5) Derefter:** #4147 flag-flip · #4753/#4829 post-verify · omdømme PR 2 (#1099) · #4616 nøgler · Railway-MCP mangler egen token (#2409; CLI virker efter `railway login`) · #3512.

> **⏳ Venter på DIN beslutning:** Discord catch-up v7.239–7.255 sendes igen i næste session (du poster) · 6 ejer-valg i `docs/audits/ai-triage-2026-09-06-a.md` (+ del B) · **#4814** foto-plads + /seasons-skygger · **#4629** · **#4632** · **#4714** · #4627 · **#4235** (15/9) · spand D i `stale-issues-audit-2026-09-04.md`.

> **🔴 Åbne fund:** **#2423** skew protection SLÅET FRA → CYCLINGZONE-56: 133 chunk-fejl/24 t efter 25 deploys 5/9 (deploy-verify rød på budgettet, selvheling #4595 virker) · **#4811** signup-sprog måles ikke · **#4828/#4829** 4 D4-puljer på 25/24, verificér efter Settimana-finalen · #4453 · #4537 · #4530 · #4531 · #4109.

> **✅ 5/9 (Fable, natbølge + merge-runde):** 26 spor → 29 PR'er, **31 merget** i dag (inkl. #4794 #4803 #4824 #4830 #4833 #4834), patch note **7.254** + 7.255 live, CodeQL #356 fixed, 6 frosne agenter recoveret. Audit: **30 lukket**, 550 åbne. 7 nye issues (#4811–#4816, #4831). Læring: frosne agenter holder samtidigheds-plads → stop + relancér (runbook).

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 12 betalende (MRR 436 kr). #4616: EUR-planer i Alunta men ikke i checkout, Railway mangler EUR-nøgler → ejer-klik. #4514: kunden beholder Pro (ejer 4/9). B2C-only ønske (#4511/#4616 pkt 8).

> **✅ S3 kører:** 529 løb, 28/8 → søn 27/9. Etaper hver hele time; scheduler hvert 5. min.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (GT-hviledage bundet, #4209). **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** v3 låst fallback; v4-flip ejer-only. Krav til v4 (ejer 4/9): #2789 rute-huller, #2944 graduerede styrt + mekaniske uheld uden DNF, #2582 tidsgrænse.
- **Grundregler (rytter, værdi/løn, økonomi-balance) udskudt til efter 27/9** (ejer 28/8 + 4/9). **Træning: maks +1 pr. evne pr. dag** (ejer 5/9, lander med #4801).
- **Mekanik:** PR'er merges med `--admin` én ad gangen, ÉT deploy-vindue pr. bølge; `database/*.sql` applies af auto-migrate.yml, Claude laver post-verify. Workers: maks 3 tunge, push senest efter 15 min, fremdrift måles på branchens sidste push.

> **🤖 Working agent:** Ingen aktiv session (Fable lukkede 5/9 kl. ~10:00).

_Historik i git-log, issue-tråde + docs/audits/._
