# Næste session (18/9): "til bunds", intet udskudt

> Ejer-mandat 17/9 ved close-out: *"ny, meget fremragende session, der arbejder på de ting, vi ikke har nået endnu fra denne session + gør det hele endnu bedre. Til bunds i GitHub, ryddet godt op i projektet. Masterplanen og artifacten totalt up to date. Patch notes på hjemmesiden og Discord opdateres snarest."* Ingenting må blokere, ingenting må udskydes.

## Start (før første kort)

1. Læs `docs/NOW.md`, `docs/WEEKLY_STEERING.md`, dette dokument.
2. **Læs ejerens egne beskeder den sidste måned** i Discord (#the-roadbook `1524049112322932826`, #general `1504952590486474805`, #dansk-snak `1505478569969582182`, #feedback-from-dolmer `1522915781766283296`) FØR noget skrives i hans stemme. Hans dom 17/9: mit udkast "lyder som en AI".
3. Regler: ét spørgsmål ad gangen, hele konteksten INDE i kortet, aldrig bare issue-numre, visuelt før beslutning, Claude skriver mails/opslag færdigt og ejeren godkender.

## Blok A: åbne tråde fra 17/9 (ejer-beslutninger, i denne rækkefølge)

| # | Emne | Hvad ejeren skal beslutte | Forberedt |
|---|---|---|---|
| A1 | **Træningsdesign** (egen fokuseret blok, 30-45 min) | 1) tick-akse: løbsdage eller dato × 5 slots; 2) B3 #5281 + B4 #5264 merge + flag-dato; 3) PR #5169 skæbne; 4) loft-design (gulv vs vægtet rolleklasse) | `docs/audits/2026-09-17-traeningsdesign-session-brief.html`; ejeren lovede spillerne 15/9 "same number of race days from season 4" (Discord) |
| A2 | **Win-back-mail** (#2760) | Godkend ny tekst skrevet EFTER Discord-læsningen; derefter dry-run (frisk liste, tal) → send-go | Skabelon `backend/lib/emailTemplates.js` `buildWinbackEmail`; 92 sovende 14/9 |
| A3 | **S4-opslag** (Reddit r/procyclingmanager, Hattrick-forum, Discord) | Polér den godkendte åbning + resten af teksten; ejeren poster | `docs/drafts/growth-s4-launch-2026-09-17.md` |
| A4 | **Icebox-batch 2** | De 20 spil-idéer (marked, ryttere, løb, vision, træning, kalender) fra Del B + de 5 nye kandidater; forklaret i ord, ikke numre | `docs/audits/2026-09-17-styringssession-triage.md` Del B |
| A5 | **Sponsor lille rettelse** (PR #5336, #4860/#4376) | Go-kort på dry-run-tal → merge (ingen migration) | Worker bygger 17/9 |
| A6 | **#5323 Quad9** | Aflæs Sentry-gruppen `frontend-backend-network-error` (målt fra 17/9) → ejer-handling DNS (`nslookup api.cyclingzone.org 9.9.9.9` FØR flytning) | PR #5324 live |

## Blok B: GitHub til bunds (Claude, autonomt, rapport til ejeren)

- **Kategori K (glemt-done):** kør `github-housekeeping`-skillens crossref (Trin 2) på ALLE åbne issues mod merged PR'er sidste 30 dage; titel-match først, body-match via agenter. Mål: 0 leverede-men-åbne.
- **Label-hygiejne:** `needs-ai-triage` (25), `needs-decision` (48), `needs-user-action` (24): hver får en afgørelse eller et kort. `claude:done` (16+): ejer-verify-kort samlet i ét billede.
- **Epics (57):** hvert epic får status-linje (leveret/rest) i sin body; døde epics lukkes med ejer-go.
- **Duplikater:** kør dublet-scriptet; foreslå merges.
- **Mål ved close-out:** åbne issues < 550 (fra 656), `triage:new` ældre end 7 dage = 0, 0 BLOCKED PR'er uden aftalt næste skridt.

## Blok C: projekt-oprydning

- Worktrees: `scripts/close-out-cleanup.ps1 -Execute` (4 worktrees/5 branches uden lokalt arbejde) + de 4 med uncommitted arbejde: vis ejeren hvad der ligger (agent-a8d4…, wf_6e8b…, chore-4577-dotenv17, fix-4582-demote) og få go til at gemme/kassere.
- `docs/PUBLIC_ROADMAP.md` (forældet, "inden sæson 1") → erstattes af henvisning til roadmap-siden.
- `docs/drafts/`: 30+ filer; alt ældre end 14 dage arkiveres eller slettes (ejer-go pr. liste).
- Token-budget: AGENTS.md + FEATURE_STATUS.md var stadig FAIL på main efter #5335; verificér efter pull, ellers ny runde.
- `.claude/launch.json` uncommitted i hoved-checkoutet: afklar.

## Blok D: sandhed på fladerne

- **MASTERPLAN + Masterplan-artifact:** artifacten republiceres (samme URL) efter hver MASTERPLAN-ændring (hard rule 34); 17/9-ændringerne er IKKE republiceret endnu.
- **Patch notes:** hjemmesiden har 7.282/7.283 (17/9); Discord #patch-notes sidst opdateret 15/9 → udsnit "What changed" ordret (TONE §2), ejeren poster. #1888 (auto-post til Discord) genåbnes fra icebox hvis ejeren vil have det automatisk.
- **Roadmap-siden:** DM v1 markeres shipped; de 2 løfter uden plan (coaches/burnout, generational renewal) får et kort.
- **GDD:** D-049..D-057 landede 17/9; beslutningerne fra A1 tilføjes samme dag.

## Blok E: vækst-blok uge 38 (fortsat)

Handling 1 = opslaget (A3), handling 2 = win-back (A2), måling = signups pr. kanal (Reddit/Hattrick 0 de sidste 28 dage). `infisical login` er udløbet (ejer-handling).

## Close-out-krav

NOW.md (Next action + Working agent nulstillet), MASTERPLAN + artifact, WEEKLY_STEERING-log, patch notes, hygiejne-script uden FAIL, `close-out-cleanup.ps1`, issues done-flippet PR-for-PR, postmortem hvis bugfix.
