# Startprompt: Claude Code merge-session (NicolaiPC, søndag aften 18/10)

Ny session på NicolaiPC. Kør `git pull --ff-only`, læs `docs/NOW.md` og denne fil. Svar på dansk i ALLE beskeder. Ejeren bruger Remote Control: tekst før et AskUserQuestion og wrap-up-boksen ses IKKE; skriv det vigtige i slutteksten, og send billeder som fil (SendUserFile). Stil spørgsmål ét ad gangen med en anbefaling og en forklaring for en ikke-udvikler.

## Din rolle i dag (ejer 18/10)

**Gør det åbne færdigt; byg intet nyt.** Gennemgå alle åbne PR'er for hvad der er relevant at gøre, merge det klare efter arbejdsstandarden (`docs/GITHUB_WORKFLOW.md`, `scripts/merge-queue.ps1`, ét køproces ad gangen), og gennemgå Codex' nye PR'er løbende i aften. Codex kører på samme maskine i egne worktrees; rør ikke dens worktrees.

Merge-regler: tekniske PR'er og spillervendte med design-go før byg merger du selv når testet + reviewet, og melder bagefter. Spillertekst, UI uden visuelt go, prod-data og motor-tænding: ejer-go pr. skridt, ordret "merge N" / "tænd". Codex-review: højst 2 runder, derefter opgave, medmindre fundet rører spillerdata, penge, prod eller svækker en gate.

## Åbne PR'er og hvad der skal ske

| PR | Hvad | Næste skridt |
|---|---|---|
| #6780 | bestyrelsesmandater: aktivt mandat for aktiv sæson + sikre skrivninger | Venter Codex runde 4 på `68b3eed5c`. Grøn + ren → merge selv. |
| #6680 | løbskalender-kort, status-prik, løbshistorik bag `race_library_v2` | Venter Codex på `369e9b991`. Merge selv. **Post-merge:** migrationen opretter flaget som off → tilføj `flag: race_library_v2` i `docs/FEATURE_REGISTRY.yml` + `node scripts/generate-feature-status.mjs`. #6872 rettes FØR ejeren siger "tænd beta". |
| #6873 | patch notes 7.368 (EN+DA, 11 poster) | Ejer-go givet 18/10 ("merge naar klar"): merge ved groen CI + ren Codex-review. |
| #6636 / #6634 | Codex' løbsbibliotek (kommende løb + historik-fane) + plan | Tjek overlap med #6680 (begge rører løbsbiblioteket). Vis ejeren forskellen med billeder og anbefal: luk som overflødig eller gør færdig. |
| #6248 | træning: maks +1 pr. evne pr. dato (Refs #6210) | Gammel (7/10). Tjek om reglen allerede håndhæves på main; relevant → gør færdig (Codex + Claude-review), ellers luk med begrundelse. |
| #6665 | ny forside med godkendt tekst | Ejeren læser selv: send skærmbilleder mobil + desktop i aften, vent på go. |
| #6839 | "Træn nu" 409 på løbsdag | **I morgen** med bedre UX-forslag (ejer). Ikke merge i dag. |
| #6819 / #6820 | tænd motor v2 (`s5_profiles_v2`) | **I morgen**, ejer-only tænding. |
| #6849 / #6843 / #6813 | designs til motor v2 | **I morgen** sammen med motor v2. |

## Også i aften

- **Roadmap på siden:** `infisical run --env=dev --silent -- node scripts/roadmap-drift.mjs` viste 18/10 16 punkter med færdigt issue men åben status (bl.a. #6362, #6363, #6463, #5385, #5978, #6645, #6201, #6648). Verificér hvert mod GitHub + prod, vis ejeren listen med tal, og ret på ejerens "kør" (prod-skrivning).
- **GitHub-audit** (skill `github-housekeeping`): done-men-åbne issues, labels, forældede PR'er/branches. Rapportér, luk kun det tydelige.
- **Close-out** ved sessionens slut: NOW.md (Next action + Working agent nulstillet), status board, token-hygiejne, `close-out-cleanup.ps1`.

## I morgen mandag 19/10 (ejer vælger opgaver mandag)

Ungdomsløbene i S5 (dry-runs, før 28/10) · motor v2 (tænd?) · bedre "Træn nu" (#6839) · UX-mockups (Dagens etape, bulk-træning #6523, beta-mærkning #6871) · `supabase login` (#6275). DST-audit #6862, token-audit #6863 og CI-baseline #6864 besluttes mandag.
