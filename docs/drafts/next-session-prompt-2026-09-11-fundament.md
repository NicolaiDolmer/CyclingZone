# Prompt til næste session: Fundament-bølgen (skrevet 11/9 2026 kl. 12:50)

Model + indsats: hovedtråd Fable, high. Workers: opus til kode/review, sonnet til docs/målinger. `model` EKSPLICIT i hvert kald. Kopiér teksten under stregen ind som første besked i en ny Claude Code-session i C:\Dev\CyclingZone. Ejeren sidder med (dagsession) og svarer på kort ét ad gangen.

Sådan kørte 11/9 (gentag det der virkede, undgå det der bed): worker → read-only reviewer → ret-trin i SAMME worktree → go-kort på diffen med billede; merge-kø én ad gangen; dry-run-tal i selve prod-kortet og ordret go pr. skridt. Bed: 9 håndskrevne subagenter på én gang (CPU 100 %, ejeren spurgte to gange); go-kort på UI uden skærmbilleder (ejeren spurgte to gange); "udskudt til efter S4" på majors (ejeren: udskyd aldrig selv). Standard v2 (#5142, PR #5147) er svaret: én indgang.

---

Ny session (fundament-bølgen, 12/9 eller senere). Læs `docs/NOW.md` først, derefter `CLAUDE.md`-afsnittet "Orkestrator-standard", derefter dette. Ejeren er ved maskinen. Alt der skriver i prod venter på ordret "merge"/"kør" med tal i kortet. Maskinen er dedikeret til Claude Code: loftet er 4 laner + verifikations-semafor 2, hele dagen, og det håndhæves af hooken. Byggearbejde starter KUN gennem `Workflow({ name: "wave" })` med `.claude/workflows/wave.js`; Agent-tool bruges kun til én opfølgning (præfiks `WAVE-FOLLOWUP:`) eller read-only review (`WAVE-REVIEW:`/`READ-ONLY:`). Første bølge nogensinde gennem wave.js: mål CPU hvert 15. min (livstegns-vagten starter selv) og skriv resultatet på #5142 (accept-kriteriet "under 75 %" er umålt).

## Fase 0 (Fable, 10 min, read-only)

`Get-Date` · `git pull` · `gh pr list` (forvent: #5135 klar, #5139 draft holdt, patch-note-PR fra `docs/patch-note-7270` klar, evt. #5147 hvis den ikke nåede merge 11/9: merge den FØRST via `scripts/merge-queue.ps1 -Pr "5147"`, ellers findes wave.js ikke på main) · Sentry 24 t (`infisical run --env=dev -- node scripts/sentry-issues.mjs --period=24h`) · Supabase security-advisors (MCP `get_advisors`, forvent 12 WARN, se #5153) · puljer 9/13: `infisical run --env=prod -- node backend/scripts/retire-stuck-ai-teams.js --dry-run` (forvent 24/24 efter lørdag 12:00, ellers kommentar på #4959) · spørgeskema-svartal (`select count(*) from survey_completions`, log på #5121) · omdømme-audit #1099 (7-dages regel).

## Fase 1: beslutninger, ét kort ad gangen (ejeren svarer, ca. 30 min)

Kontekst og tal INDE i hvert kort; A/B + anbefaling. Rækkefølge:
1. **Merge-klar:** #5135 (akademirytter-sweep; dry-run 11/9 viste 1 rytter, additiv; reviewer + 4 rettelser inde; sweepet kører kl. 22-24, så merge før 22 og kør `detect-missed-graduates.js --dry-run` derefter `--execute --owner-go` på ejer-go) · patch note 7.270 (docs-PR).
2. **#5154 PITR** (A slå til / B behold; slå prisen op i Supabase-dashboardet og skriv den i kortet).
3. **#5156 CodeRabbit-loft** (A opgradér / B reviewer-agent som formel gate; læs prisen).
4. **#5158 TypeScript-retning** (A nye filer i TS + checkJs i race engine/økonomi / B nej).
5. **#5136 late_fill-afstemning:** har ejeren postet forum-udkastet (`docs/drafts/forum-poll-assistant-fill-timing-2026-09-11.md`)? Resultat afgør flip + merge af #5108.
6. **#4270 S4-kalender A/B** efter #4845 (bane 1, hård deadline 27-28/9).
7. **#5113 visuel identitet:** de 6 spørgsmål i kommentaren 11/9 (nationalitet, ældning, morale på kort, TT-hjelm, logo-upload, kun mænd) + er Claude Design-filerne eksporteret (`docs/drafts/claude-design-prompt-export-and-hold-2026-09-11.md`)? Lig dem i `docs/design/visual-identity/`.
8. **Ejer-trin der stadig venter:** `AUTO_MERGE_PAT` (#4812, 5 min), Discord-opslag om spørgeskemaet (#5121), fog of war-afstemning #5107, nøgler (PostHog, GSC, Resend-webhook, EUR-testkøb, `SUPABASE_ACCESS_TOKEN`), ubetalt faktura 61,25 kr, 'claude'-automationen der fejler på bot-kommentarer (config-valg).

## Fase 2: fundament-bølgen (ét Workflow-kald, 4 laner, prioriteret kø)

Køen i rækkefølge efter hvad der brænder og hvad der giver mest langsigtet værdi. Hvert spor: worker (opus) → read-only reviewer → ret-trin → go-kort med billede (UI) eller dry-run/smoke-tabel (backend). Verify-niveau TARGETED medmindre andet står; CI er fuld gate; maks 5 åbne PR'er.

1. **#3069 rød CI-vagt (48 t-reglen):** feature-liveness har fejlet 12/12 kørsler siden 7/9. Whitelist de 5 drift-findings med begrundelse eller gør checket advisory til det er retvisende. Ingen "kendt audit" i go-kort fremover.
2. **#5153 Supabase-advisors:** hærdnings-PR (is_admin anon, 4 definer-rpc'er, 4 matviews #5088, btree_gist, search_path) + 7-dages regel; test rpc-flows på preview som authenticated.
3. **Chunk-epic #5162, spor 2 (#5160) og spor 4 (#5161) parallelt:** to-build-bevis med Sentry-transformation aktiv (blokerende CI-gate) og boot-vagtens tomme liste (browsertest med rigtigt HTML). Spor 1 (#5159, reload-koordination) starter når 2 og 4 har PR: det er det største og rører 7 spilflader. #5139 forbliver draft; dens kode genbruges i #5159. De tre krav i epicet er gate; ingen Skew Protection.
4. **Bane 1 / S4 (deadline 27-28/9):** #4845 kalenderpakker (samme antal løbsdage i alle divisioner; FØR #4270) og #4846 træning pr. løbsdag-tick (kæden #4846 → #4847 → #4851). Dette er spillerværdi NU; må ikke skubbes af fundamentet.
5. **Hastighed + mobil + SEO (må ikke udskydes igen):** #5131 baseline (Lighthouse mobil/desktop på offentlige sider + bundle-tabel; W9 blev stoppet 11/9, genstart som sonnet READ-ONLY) → derefter #5055 og de 3 største fund som spor; #1602/#5124 D-047 til de fire håndrullede mobiltabeller; #4067 SEO-site fase 1 (marketing-sitet er nu Tailwind 4). Ét spor pr. område i denne bølge, ikke alle tre samtidig.
6. **Tailwind 4-kæden #5150 → #5151 (+#3952) → #5152:** trin 1 kan køre nu (lille, før/efter-billede); trin 2 efter Codex-spor 1, fordi begge rører de samme UI-filer.
7. **Hygiejne-blok (MASTERPLAN 15b), i rækkefølge:** #5155 prioritets-regel-script + dry-run (audit 4b: 12 kandidater) · #5157 drafts #3512/#4736 (afgør: færdig eller luk) · #5085 CI for marketing (lint er knækket: TS 7 vs typescript-eslint) · #5143 egen node_modules for dependency-baner · #4577 dotenv 17 + @types/node ^24 (worktree `chore-4577-dotenv17-types-node24` har 26 ucommittede filer fra 11/9; genoptag dér, commit ikke rod) · #4924 worktree-oprydning (wave.js sidste fase, dry-run først; 21 registrerede + ca. 680 mapper).
8. **GitHub-audit-rester** (`docs/audits/2026-09-11-github-audit.md`): 19 lukket 11/9; tilbage: 12 gamle priority:high (afsnit 4b) til dry-run i #5155, #4959 lukkes efter lørdags-tjek, #4203/#452 done-gated med gate. Husk done-flip PR for PR, og aldrig `claude:done` på delvist arbejde (audit 2b).

## Regler for hele sessionen

- Én beslutning pr. kort; kontekst og tal i kortet; UI-kort ALTID med ét samlet skærmbillede sendt med SendUserFile i samme tur (rigtige skærmbilleder fra branchen på mock-data, desktop + mobil, EN/DA). Backend-kort med dry-run/smoke som "billede". Go = ordret "merge"/"kør".
- Workers rører aldrig `docs/NOW.md`, `MASTERPLAN.md`, `PatchNotesPage.jsx`/`patchNotes.js`, `help.json`; patch notes samles ved close-out (7.271).
- NOW.md ≤ 1.200 tok og MASTERPLAN ≤ 1.500 tok holdes ajour VED HVERT merge (ikke kun close-out); `Get-Date` før hver logning.
- Aldrig "kendt audit" som undskyldning; aldrig udskyde på egen hånd; aldrig symptomrettelse på chunk-fejl uden epicets kæde.
- Codex' rapport `docs/audits/2026-09-11-codex-audit-chunk-fejl.md` er sandheden om chunk-forløbet; PR-bodies er det ikke.
- Close-out: NOW.md (Next action + Working agent nulstillet), MASTERPLAN, patch notes, done-flips, `scripts/check-agent-token-hygiene.ps1`, `scripts/close-out-cleanup.ps1`, postmortems i `.claude/learnings/`, og en ny "next-session-prompt" i `docs/drafts/`.
