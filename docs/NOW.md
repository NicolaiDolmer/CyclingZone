# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (næste session, ejer-styret, ét kort ad gangen):** **1) #4147 flag:** vagten har kørt siden 4/9 12:32 med 0 fund (ejer: vent til 5/9 ~12:30) → ejer-GO → `race_finalize_resumable_enabled = on` + verificér `[finalize-state]` på et rigtigt løb. **2) #4753 post-verify:** puljer 8/10/11/15 står på 25 indtil Coppi e Bartali etape 4 (lør 5/9 kl. 12:00); vindue 12–18 → alle 15 = 24 → ejer lukker. **3) Omdømme PR 2 (#1099, spec `docs/superpowers/specs/2026-09-04-reputation-system-design.md` §8):** ejer-go → `node backend/scripts/reputation-backfill.js --apply --owner-go` + flag `rider_reputation_enabled = shadow` → 7 dages natlig audit → PR 3 synlighed (vis på preview). **4) #2261** løses af PR 3. **5) needs-decision-kort** ét ad gangen (`docs/audits/needs-decision-kort-2026-09-04.md`; brænder: #4582 WIP i worktree `fix-4582-demote-inherits-contract`, #3460, #3200, #4149). **6) #4616:** ejer testkøb EUR+DKK (pkt 4) · Alunta-support om B2B-blokering mandag 7/9 (pkt 8). **5) #3512** parkeret: cherry-pick lokalt WIP `a03b6eb40` fra worktree feat-3458-archetype-gen-pr2, vis typefordeling før merge. **6) #4736/#4613** træningsside: egen retningssamtale (mockups A/B/C, #4629, #4632). **7) Community fredag:** ejer poster selv fra `docs/drafts/community-fredag-2026-09-04.md` + svarudkast `docs/drafts/forum-svar-udkast-2026-09-04.md`.

> **⏳ Venter på DIN beslutning:** **#4629** træningsprogrammer · **#4632** løbsdagens intention · **#4613** træningssiden (PR #4736 draft) · **#4714** afstemning (ejer poster) · #4627 design-sync · **#4235** forummets rolle: måling 15/9 · 12 punkter i `docs/audits/stale-issues-audit-2026-09-04.md` spand D (ét ad gangen).

> **🔴 Åbne fund:** **#2423** Skew Protection via `__vdpl`-cookie er SLÅET FRA (hotfix 057622162): Vercel pinner assets men ikke dokumentet ved browser-navigation → alle spillere med cookie fik 404 efter hvert deploy. Kun selvheling (#4595, live) + deploy-disciplin (ét vindue pr. bølge). · **CYCLINGZONE-56** chunk-fejl skal falde nu · **#4453** Railway-logvagt mangler secret · #4537 · #4530 · #4531 · #4109.

> **✅ Session 4/9 aften (Fable):** merget #4779 + #4781 (#1237 bestyrelsens økonomi-mål på nettostilling, patch note 7.253, done-label), #4780 (omdømme-motor #1099 bag flag off; migration + grants verificeret i prod, kalibrering `docs/audits/reputation-calibration-2026-09-05.md`: p50 5,4 · 1,34 % ≥70 · 0,24 % ≥90), #4782 (grants + eslint efter #4780) · omdømme-spec ejer-godkendt afsnit for afsnit · #3494 lukket (allerede rettet af #4550) · nyt issue: preflight mangler grant-lint + warning-budget · `schema-snapshot.json` IKKE refreshed (Infisical ikke logget ind på denne PC → ejer-klik `infisical login`).

> **✅ Session 4/9 dag (Fable):** 14 PR'er merget (forum-pakke, Pro i euro, sponsor gulv+50 %, patch note 7.252, CI-vagt skew) · prod m. ejer-go: #4485 U25-reparation, #4376 sponsor-korrektion (indbakke-besked til 234), flag `ai_team_retire_enabled` ON · audits + needs-decision-kort i `docs/audits/` · nye regler: TONE_OF_VOICE.md først; ingen patch notes i PR'er i bølger.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 12 betalende (MRR 436 kr). #4616: EUR-planer findes i Alunta men ikke i checkout, Railway mangler EUR-nøgler → ejer-klik. #4514: kunden beholder Pro (ejer 4/9). B2C-only ønske (#4511/#4616 pkt 8).

> **✅ S3 kører:** 529 løb, 28/8 → søn 27/9. Etaper kører hver hele time; scheduler hvert 5. min.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (GT-hviledage bundet, #4209). **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** v3 låst fallback; v4-flip ejer-only. Krav til v4 (ejer 4/9): #2789 rute-huller, #2944 graduerede styrt + mekaniske uheld uden DNF, #2582 tidsgrænse.
- **Grundregler (rytter, værdi/løn, økonomi-balance) udskudt til efter 27/9** (ejer 28/8 + 4/9).
- **Mekanik:** PR'er merges med `--admin` én ad gangen, ÉT deploy-vindue pr. bølge; `database/*.sql` applies af auto-migrate.yml, Claude laver post-verify. Workers: maks 3 tunge, "push senest efter 15 min", fremdrift måles på branchens sidste push.

> **🤖 Working agent:** Ingen aktiv session (Fable lukkede 4/9 kl. ~23:50).

_Historik i git-log, issue-tråde + docs/audits/._
