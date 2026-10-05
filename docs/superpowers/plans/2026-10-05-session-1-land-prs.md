# Prompt: næste Claude-session - land de ni PR'er (merge-session)

Model: **Claude Fable 5.1**, indsats **høj**. Kopiér alt under stregen.

---

Ny session. Formål: **få de ni åbne PR'er fra 5/10 reviewet, rettet og merget, én ad gangen, uden at noget går i stykker.** Dette er en merge-session: der bygges INTET nyt. Rettelser efter review er tilladt, alt andet skrives som prompt til næste session. Sessionens formål er bindende.

**Læs først:** `docs/NOW.md`, `.claude/learnings/2026-10-05-review-foer-go-og-klar-betyder-groen-ci.md`, og de seneste kommentarer på hver PR og dens issue.

## Regler for denne session (lært 5/10, følg dem ordret)
1. **Review FØR ejeren ser noget.** Hver PR får et uafhængigt, read-only review på DIFFEN (opus, `WAVE-REVIEW:`-præfiks, model sat eksplicit), før der vises et billede eller stilles et go-spørgsmål. 5/10 godkendte ejeren #6216 på et billede; reviewet bagefter fandt to blokerende fejl.
2. **"Klar" betyder grøn CI på PR'ens nyeste commit**, inkl. typecheck, lint og alle e2e-shards. Tjek selv med `gh pr view N --json statusCheckRollup,mergeStateStatus`; stol ikke på en lanes "klar". 5/10 var #6217 meldt klar med seks tsc-fejl.
3. **Én merge ad gangen gennem `pwsh -File scripts/merge-queue.ps1 -Pr "N"`.** Vent på grøn main og grøn Deploy verify før den næste. Railway kan bygge i over 30 min: BUILDING er ikke en fejl (#6228). Merg aldrig oven på rød main.
4. **Efter hvert merge:** tjek `mergeStateStatus` på de resterende PR'er. Er en DIRTY, synkes den med main (merge, ikke rebase), og CI skal være grøn igen, før den går i køen.
5. **Ejerens go er ordret "merge" pr. PR.** PR'er med migration eller spillervendt tekst kræver det altid. UI-PR'er: ÉT annoteret før/efter-billede sendt som fil i samme tur som spørgsmålet; ejeren har Android, så tjek tryk-adfærd på mobil.
6. **Migrationer** lægges på af auto-migrate efter merge. Post-verificér straks med en SELECT, og læg den også på staging (`scripts/staging/apply-staging-migrations.ps1`).
7. **Rettelser:** `WAVE-FOLLOWUP:` i PR'ens eksisterende worktree, én ad gangen, verifikation i forgrunden bag `scripts/verify-lock.ps1 -Max 2`. Codex retter selv fund på sine fire PR'er, hvis en Codex-session kører (skriv fundene som PR-kommentar); ellers gør du.
8. **Kommunikation:** alt ejeren skal handle på eller kopiere, sendes som fil (SendUserFile) med svaret i billedteksten. Popup med nøgletal i spørgsmålet, højst 4 ad gangen. Aldrig egne tidsskøn. Sig det højt, før du starter noget, der holder sessionen åben længe.
9. **Patch note** samles i ÉN PR til sidst for alt spillervendt, der er merget (lanernes og Codex' forslag står i PR-bodies). Motorreglerne bag `orders_gc_v3` får først patch note og hjælpetekst, når ejeren tænder dem.
10. **Luk sessionen**, når køen er tom: close-out efter CLAUDE.md, opdatér masterplan-artifacten, og skriv prompten til næste session.

## Tjek først
- Main grøn? Seneste Deploy verify grøn? `node scripts/wave-policy.mjs inspect` skal fejle med "ingen markør" (bølgen 5/10 er ryddet op).
- "Supabase Log Watch" og "Advisor sweep": første kørsel med det nye token (sat 5/10 kl. 17:09). Grøn?
- Masterplan-artifacten (https://claude.ai/artifact/UoZexVskbfA5xmvTnML4Bn) mangler beslutningerne efter kl. 17 den 5/10. Opdatér den.

## PR'erne (status 5/10 kl. 19:45)
| # | PR | Hvad | Stand | Mangler |
|---|---|---|---|---|
| 1 | #6217 | Løbsfilm samler ens linjer (#6137), kun frontend | Ejer-go givet 5/10. `perf-gate` rød | Find årsagen til `perf-gate` (to kørsler 5/10: én rød, én grøn). Derefter merge |
| 2 | #6215 | Sponsor- og præmievisning (#5916 + #5940), Codex | CI uden fejl | Review, før/efter-billede, ejer-go. Lovet spillerne 30/9 |
| 3 | #6218 | Omdømme-sortering + Hjælp (#6209), Codex | CI uden fejl | Review, før/efter-billede, ejer-go. Lovet 3/10 |
| 4 | #6225 | Spar kræfter giver altid halv støtte (#3460), bag v3 | CI uden fejl, 3 filer | Review, ejer-go |
| 5 | #6223 | Tidsmodel (#6199 + #6200), bag v3, 18 filer | 1 tjek kørte stadig | Review (stor: isolation bag v3, golden uændret, nyt bjergmål 60-150 s i anker-tabellen), ejer-go |
| 6 | #6224 | Farlig rytter i udbrud (#5978) + review-rettelserne fra #6213, bag v3 | CI uden fejl | Review, ejer-go |
| 7 | #6216 | Afsat udbryder får mærket "Sat af" (#6185) + migration + backfill | **Review 5/10 BLOKERENDE**, e2e rød | Ret de to blokerende fund og bemærkningerne (seneste kommentar på PR'en), nyt review, ejer-go på startdato for backfill (28/9 eller 2/10), merge, migration, backfill som dry-run som ejeren ser, derefter kørsel |
| 8 | #6220 | Grants-skabelon, audit og CI-vagt (#708, frist 30/10), Codex | CI uden fejl | Review, ejer-go |
| 9 | #6222 | Vercel bygger kun, når frontend er ændret (#6202), Codex | CI uden fejl | Review (afviger fra den stående regel om altid at bygge main: vis ejeren konsekvensen), ejer-go, mål antal builds efter merge |

**Rækkefølge og hvorfor:** 1 er allerede godkendt. 2-3 er de ældste løfter til spillerne og rører ikke backend-motoren. 4 → 5 → 6 deler `tuning.ts`, `segmentLoop.ts` og `docs/RACE_ENGINE_RULES.md` og SKAL merges i den rækkefølge (bølgens egen anbefaling), med synk efter hvert merge. 7 kommer, når den er rettet. 8-9 er drift.

**Sådan får du fart uden at miste kvalitet:** start reviews af 2-9 i baggrunden med det samme (read-only, højst 4 ad gangen), mens du undersøger `perf-gate` på #6217. Vis ejeren go-kort i den rækkefølge PR'erne bliver klar, men merg i rækkefølgen ovenfor.

## Når køen er tom
- Flip `claude:todo` → `claude:done` på de issues, hvis PR er merget (straks pr. PR, ikke til sidst).
- Næste sessioner har færdige prompts: `2026-10-05-session-a-motor-landing.md` (mål hele v3-pakken i scorecardet, de sidste designpunkter, #6201, #6185 del 2, tænd-tjekliste; spring dens trin 2 over) og `2026-10-05-session-b-morgenblok.md` (Udvikling 2.0, udgifter, træning, go-kort; spring dens trin 0 over).
