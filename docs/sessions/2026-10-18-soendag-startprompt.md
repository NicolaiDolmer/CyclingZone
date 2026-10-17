# Startprompt: søndag 18/10 (pc1)

Kopiér alt under linjen ind i en ny Claude Code-session på pc1 (mappe `C:\dev\CyclingZone`).

---

Ny session på pc1, søndag 18/10. Kør `git pull --ff-only` og `npm run sync-deps`, og læs `docs/NOW.md`. Du er den eneste aktive session og driver selv merge-køen. Svar på dansk. Stil spørgsmål ét ad gangen med en anbefaling og et billede (PNG, ikke links). Ejeren er ikke meget ved computeren i dag. Hver NY opgave kræver ejerens ja og en planlagt dag (ejer 16/10). Færdiggør det, der allerede er i gang, før du foreslår nyt.

## I dag (ejer-planlagt 16/10)

1. **Afventer oprykning:** flip `promotion_pending_enabled` på ordret "tænd". Vis først et kort med det aktuelle antal fra en ny dry-run i prod (16/10: 55 ryttere på 20 hold, 52 junior→U23 og 3 U23→senior). Opdatér help.json (en+da) samme dag, og verificér efter flippet (flag-værdi, Sentry, et hold i UI).
2. **Discord-webhook:** spørg ejeren, om han vil køre `infisical secrets set "DISCORD_BETA_WEBHOOK_URL=$(Get-Clipboard)" --env=prod` nu. Værdien må aldrig stå i chatten.
3. **Spillerkommunikation (ejeren sender selv):**
   - Roadbook-udkastet `docs/drafts/roadbook-discord-2026-10-15.md`.
   - Discord 7.361-7.363, kun EN, i rå kodeblok.
   - Svarlisten (#6319).
4. **Billeder + go:**
   - #6680, løbskalender-kort. Lav nye billeder; det gamle viser den afviste etape-strimmel. Anbefaling: merge med flaget off, og overvej derefter `race_library_v2` = beta.
   - #6742, hold der ikke stiller op / skade-besked / Train now-advarsel (#6740). Ét samlet før/efter-billede.

   Merge kun på ordret "merge".
5. **Hold øje med** aftentræningen (Sentry). #6504 frigivne ryttere giver stadig en falsk alarm (CYCLINGZONE-9B).

## Mandag (til planen, start ikke i dag)

- #6724 (DOLMERPC).
- #6731 (mindre PR'er).
- #6683, tabelvisning der genbruger #6636; luk derefter #6636/#6634.
- S5-genmåling #6712 → tænd-kort #6699.
- #6703/#6704 prod-målinger.

## Close-out

Følg CLAUDE.md: NOW.md, hygiejne-scripts og status-board.
