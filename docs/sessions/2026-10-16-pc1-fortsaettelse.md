# Startprompt: pc1 fortsættelse (efter 15/10)

Ny session på pc1. Kør `git pull --ff-only`, læs `docs/NOW.md` og denne fil. Svar på dansk i ALLE beskeder. Stil spørgsmål ét ad gangen med en anbefaling, og vis billeder (PNG via SendUserFile) før et UI-spørgsmål. Byggearbejde køres via `.claude/workflows/wave.js` (ejer-opt-in står i CLAUDE.md).

## Spørg ejeren først (ét ad gangen)

1. **Animationsretning for løbshistorien (#6643).** Prototype med tre retninger: https://claude.ai/artifact/CA4LsBcohcSusZXr9gTRWG (kilde: OneDrive er ikke nødvendig; filen er publiceret). Anbefaling: A (TV-grafik) i "Whole stage" + B's gab-kurve som strimmel under + C's perspektiv-vej i "Final 5 km", der slutter på en fotofinish-liste (ingen opdigtede hjulafstande). Ejer 15/10: #6643 merges IKKE til beta, før animationerne er af meget høj standard. Højde-fix og etiket-fix ligger allerede på `feat/6570-race-story`.
2. **Review-gaten (#6657):** ejeren opretter et Codex-miljø (chatgpt.com/codex/cloud/settings/environments), ELLER reglen løsnes til Codex-review på et vilkårligt commit + Claude-markør på HEAD. Anbefaling: løsn reglen.

## Arbejde der venter

- **#6680 kalender-kort (#6514):** bølgen er færdig. Ret `perf-gate` (bundle-budget), `frontend-smoke` og eventuelle `backend-tests`/`static-guards`, vis ejeren ét før/efter-billede, merge på go. Derefter enqueue #6683 (ikoner + Kalender | Tabel med kategori-kolonne; spec og ejer-valg "farvet streg" står på issuet). wave-policy afviser #6683, indtil #6680 er merget (fælles filer).
- **U23/junior-kalender:** #6670 er merget. Kør dry-run (`buildSeasonCalendar.js ... --dump-plan`) og vis ejeren, før noget skrives.
- **Akademi:** pull-optag skal tændes før søn 18/10 kl. 00 på ejer-go (#6155). PR #6662 (hent-knap) og #6673 (optag 2.0, draft, røde checks) skal afklares.
- **Motor-drafts:** #6658 (udbrudsstørrelse), #6671 (AI-ungdom) mangler review og merge inden for bånd.
- **#6186 hjælp vs. v4:** kortlægningen ligger privat i OneDrive `balance-internals/6186/` (indeholder tuning-tal). Lav en tekst-PR til help.json (EN+DA) + RACE_ENGINE_RULES.md med kvalitative formuleringer. Opsummering på issuet.
- **#6490:** mål aftenens træningsafregning 15/10 og 16/10 mod baseline efter indeks-droppet.
- **Forsiden #6665:** ejer 15/10: launch-mail må fjernes, Discord skal være nem at tilmelde sig. Tages i en separat session.

## Oprydning

- Lokal server på port 3917 (`next start`) og worktree `C:/dev/cz-wt-6665shot` blev efterladt af et skærmbillede-job. Kør `pwsh -File scripts/close-out-cleanup.ps1` og fjern worktreet.
- Worktrees `C:/dev/cz-wt-6643sq`, `C:/dev/cz-wt-6672fix` kan fjernes, når deres branches er merget.
- `MEMORY.md` og `AGENTS.md` var over token-budget 15/10 (`scripts/check-agent-token-hygiene.ps1`).
