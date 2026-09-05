# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (ejer-styret):** **Næste session = løbsmotor v4 + taktik**, prompt designet med ejeren 6/9: [`docs/drafts/next-session-prompt-2026-09-07.md`](drafts/next-session-prompt-2026-09-07.md) (audit af v4 først → design ét spørgsmål ad gangen → byg-bølge → flip ved S4-start 28/9; bestyrelsens rest #4855-#4859 som sidespor). **Ejer-go der venter:** #4862 patch note 7.256 (Sponsors) · #4801 (+1-loft, ejer: "vent") · #4835 (opret `AUTO_MERGE_PAT`) · #4857 backfill (`--apply --owner-go`) · #4859 flip. **#4789** tages i en anden session. **S4-kalenderen (#4270) må IKKE applies før #4845.**

> **⏳ Venter på DIN beslutning:** Discord-udkast du poster selv: catch-up 7.239-7.255, side-om-side-mockups af træningssiden (spillerne vælger retning, #4613), Sponsors-siden (i PR #4862). Programmets rytme (7 løbsdage vs uge) parkeret. 6 ejer-valg i `docs/audits/ai-triage-2026-09-06-a.md` · #4814 · #4714 · #4627 · #4235 (15/9).

> **🔴 Åbne fund:** **#2423** skew protection SLÅET FRA (CYCLINGZONE-56) · **#4811** signup-sprog måles ikke · **#4828/#4829** D4-puljer, verificér efter Settimana · **#4856** bonustilbud skrives til gammel plan, ikke mandatet (før flip) · #4453 · #4537 · #4530 · #4531 · #4109.

> **✅ 6/9 (Fable, design-session med ejeren):** Træning: 6 beslutninger låst (tick pr. løbsdag, samme antal løbsdage, knap+bonus væk, intention i holdudtagelsen, træningsscore = passets kvalitet, kun egen manager, visning) → spec + `TRAINING_RULES.md` §13, epic **#4850** (deadline S4-start), #4851-#4854 (Belastning, Holdpas rollefordelt, Trætheds-grænse; udviklingsmål AFVIST: "mere fog of war"). Discord-analyse 20/8-5/9 → `docs/audits/discord-training-choices-2026-09-06.md`. Bestyrelsen: audit → **merget** #4841 (#4839 kvitteringer i beta), #4842 (#4837 #4838), #4840 (docs), **#4843 Sponsors-side live**, #4844 Boardroom overblik+faner (bag beta). Mockups i `docs/design/mockups-*-2026-09-06/`. Ny bindende regel i PAGE_TEMPLATES: overblik først + faner ud.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 12 betalende (MRR 436 kr). #4616 EUR-nøgler → ejer-klik. #4514 kunden beholder Pro.

> **✅ S3 kører:** 529 løb, 28/8 → søn 27/9. Etaper hver hele time; scheduler hvert 5. min.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (GT-hviledage bundet, #4209). **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** v3 låst fallback; v4-flip ejer-only, mål S4-start. Krav til v4 (ejer 4/9): #2789, #2944, #2582 + #4632 intention.
- **Træning:** nyt system (løbsdag som tick, #4850) live senest S4-start 28/9; kalenderpakker #4845 FØR S4-kalender. Grundregler (rytter, værdi/løn, økonomi) udskudt til efter 27/9.
- **Mekanik:** PR'er merges med `--admin` én ad gangen; `database/*.sql` applies af auto-migrate.yml, Claude laver post-verify. Workers altid i baggrunden, aldrig blokerende vent (ejer 6/9).

> **🤖 Working agent:** Ingen aktiv session (Fable lukkede 6/9 kl. ~19:30).

_Historik i git-log, issue-tråde + docs/audits/._
