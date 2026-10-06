# Prompt: næste Claude-session - merge køen fra 5/10 (kun merge)

> **Erstattet 6/10** af `2026-10-06-dagsplan.md` (Claude) og `2026-10-06-codex-dag.md` (Codex). Brug ikke denne som prompt.

Model: **Claude Fable 5.1**, indsats **høj**. Kopiér alt under stregen.

---

Ny session. Formål: **merge de seks PR'er, der står tilbage fra 5/10, én ad gangen, og kør backfillen på #6216 med ejeren.** Alt er reviewet, og ejerens go er givet på fire af dem. Der bygges INTET nyt, og der laves ikke nye reviews af det, der allerede er rent. Sessionens formål er bindende.

**Læs først:** `docs/NOW.md`, `.claude/learnings/2026-10-05-merge-session-review-runder-og-github-nedbrud.md`, og den seneste ejer-kommentar på hver PR (filtrér på author `NicolaiDolmer`; bot-kommentarer giver falske secret-alarmer).

## Tjek først
- GitHub Actions kører (`https://www.githubstatus.com/api/v2/summary.json`). 5/10 var der nedbrud fra ca. 21:20.
- Main: `CI (AI-Autopilot)` og `Deploy verify` grønne på nyeste commit (#6225, `c25caf905`, blev merget midt i nedbruddet; CI stod i kø). Er kørslen annulleret eller hænger, så `gh run rerun`.
- `node scripts/wave-policy.mjs inspect` fejler med "ingen markør".

## Regler (uændrede fra 5/10, plus to nye)
1. "Klar" = grøn CI på PR'ens nyeste commit. Tjek selv med `statusCheckRollup`; vent med en løkke på antal ikke-færdige tjek, ikke `gh pr checks --watch`.
2. Én merge ad gangen: `pwsh -File scripts/merge-queue.ps1 -Pr "N"` i baggrunden. Backend-merges venter på Railway (over 30 min er normalt). Aldrig oven på rød main.
3. Efter hvert merge: synk næste PR med `gh pr update-branch N` (merge, ikke rebase), og vent på grøn CI igen.
4. Ejerens go er ordret "merge" pr. PR og er givet, hvor tabellen siger det. Ændrer en synk mere end en ren fletning (konfliktløsning i kode), så vis ejeren det først.
5. Rettelser: `WAVE-FOLLOWUP:` i PR'ens eksisterende worktree, **højst to ad gangen** (ejer 5/10), bag `verify-lock -Max 2`. Aldrig `cd` til et andet worktree.
6. Codex retter egne PR'er (#6215 #6220 #6222) og melder `KLAR TIL MERGE-KØ <sha>` som PR-kommentar. Claude skriver fund og beslutninger som PR-kommentar.
7. Alt ejeren skal handle på, sendes som fil med svaret i billedteksten. Popup med nøgletal. Aldrig egne tidsskøn. Sig det højt, før noget startes, der holder sessionen åben.
8. Private balance-tal (scorecard, `balance-internals/`) må aldrig ende på GitHub.

## Køen (stand 5/10 kl. 23:55)
| # | PR | Hvad | Head | Ejer-go | Mangler |
|---|---|---|---|---|---|
| 1 | #6216 | "Sat af fra udbruddet", tre tilstande, migration + backfill (#6185) | `ae5ae0a18` | **merge** (5/10 23:05) | Grøn CI → merge → migration → dry-run → ejer ser tal → kørsel |
| 2 | #6223 | Tidsmodel bag v3 (#6199 #6200) | `c4b8277bf` | **merge** (5/10 23:15) | Grøn CI → merge |
| 3 | #6224 | Farlig rytter bag v3 (#5978) | `2ad45db50` | **merge** (5/10 23:40) | Synk efter #6223, ret RULES linje 60, grøn CI → merge |
| 4 | #6215 | Sponsor- og præmievisning (#5916 #5940), Codex | `2b2392547` | Nej | Codex bygger "eget estimat ± 20 %" (ejer 5/10 22:00) → kort nyt review → før/efter-billede → go |
| 5 | #6220 | Grants-skabelon og CI-vagt (#708), Codex | `0c5b77117` | Nej | Codex lukker hullet "ny tabel i ændret fil" → Claude afprøver → go |
| 6 | #6222 | Vercel bygger kun ved frontend-input (#6202), Codex | `e5e02c2dc` | **merge i sikker variant** (5/10 23:50) | Codex gør `backend/lib/` til byggeinput → Claude læser diffen → merge. Ejeren skal ikke spørges igen, hvis diffen kun gør det. |

Merget 5/10: #6217 (løbsfilm), #6218 (omdømme), #6225 (Spar kræfter bag v3).

### #6216 trin for trin
1. Merge gennem køen. Auto-migrate lægger migrationen på.
2. Post-verificér straks (SELECT'erne står i tredje review på PR'en): kolonnen `race_results.breakaway_dropped` er `boolean`, nullable, uden default; begge RPC'er har kolonnen; anon/authenticated kan ikke køre dem.
3. Læg migrationen på staging (`scripts/staging/apply-staging-migrations.ps1`).
4. Dry-run fra hoved-checkoutet efter pull: `node backend\scripts\backfill-6185-dropped-breakaway.js --since=2026-09-28` (startdato valgt af ejeren). Rollback-loggen havner i `backend\scripts\snapshots\6185\` (gitignoret).
5. Vis ejeren dry-run-tallene pr. type ændring (popup + fil). Først på ordret go: `--apply --owner-go`. Kør dry-run igen bagefter: 0 ændringer.
6. Roadmap: kendt fejl #6185 → `fixed`, når deploy og backfill er bekræftet.

### #6224 ved synken
`git merge-tree` viste ingen tekstkonflikter mod #6223. Efter synk: ret `docs/RACE_ENGINE_RULES.md` linje 60 ("se næste afsnit" peger forkert; tilføj #5978 i opremsningen af v3-pakken), og kør `breakaway.ownRiderAhead6187.test.ts` og `segmentLoop.timeModel6199.test.ts` (begges fastfrosne v1/v2-digests skal være grønne og uændrede).

## Når køen er tom
- **Patch note i ÉN PR** (EN + DA, kort, `docs/TONE_OF_VOICE.md`): løbsfilmen samler ens linjer (#6217) · omdømme-sortering + ny Hjælp-tekst (#6218) · mærket "Sat af fra udbruddet" (#6216) · sponsorsats og præmie-estimat (#6215). Intet om v3-reglerne (#6225 #6223 #6224), før ejeren tænder dem. Vis ejeren teksten før merge.
- Flip `claude:todo` → `claude:done` pr. merget PR, straks. Roadmap-siden: #5916 og #5940 → `fixed` efter #6215; #6199/#6200/#5978 bliver stående (ikke live).
- #6222: tæl production-byg over et helt UTC-døgn efter merge og skriv tallet på #6202 (se #6235).
- Opdatér masterplan-artifacten (https://claude.ai/artifact/UoZexVskbfA5xmvTnML4Bn): den er fra 5/10 eftermiddag og mangler alt siden.
- Close-out efter CLAUDE.md.

## Derefter
- **Bundle-modellen #6165 skal bygges senest fredag 9/10** (ejer 5/10). Egen byggesession; loftet står på 1177 og hæves ikke igen uden ejerens ja.
- `2026-10-05-session-a-motor-landing.md` (spring trin 2 over). Nye krav til tænd-tjeklisten for v3 står på #5978, #3460 og #6223: nr. 21-24 holdes ikke i snor · scorecardets bjergmål og kort afslutning opad rammes ikke · filmtekst for endagsløb · samlet balance · hjælpetekster EN + DA.
- `2026-10-05-session-b-morgenblok.md` (spring trin 0 over).
- Nye issues fra 5/10 aften: #6231 Supabase Log Watch (endpoint fjernet) · #6232 grants for funktioner og views før 30/10 · #6233 preview-byg kører altid · #6234 udbrydere vises "indhentet" af eget afsatte stykke · #6235 vagt mod forældet frontend.
