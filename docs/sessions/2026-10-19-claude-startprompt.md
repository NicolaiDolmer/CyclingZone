# Startprompt: Claude Code, næste session efter merge-aftenen 18/10

Virker fra enhver PC (pc1/NicolaiPC eller DolmerPC). Kør `git pull --ff-only` i `C:\dev\CyclingZone`, læs `docs/NOW.md` og denne fil. Svar på dansk. Ejeren bruger ofte Remote Control: skriv det vigtige i slutteksten og send billeder som fil. Stil spørgsmål ét ad gangen med anbefaling og en forklaring for en ikke-udvikler.

## Ny PC-session (DolmerPC): tjek først

1. `git pull --ff-only`. Rør en `*package-lock.json` sig, så kør `npm run sync-deps` (CLAUDE.md trin 5).
2. `pwsh -File scripts/link-onedrive-context.ps1` (memory + Supabase-context via OneDrive-hardlinks; se `docs/CROSS_PC_SETUP.md`).
3. Codex-agentstandarderne er kun installeret på NicolaiPC. Installér dem først, når #6874 er merget: `pwsh -NoProfile -File scripts/codex-setup.ps1` (dry-run) og derefter `-Apply`.

## 1. Merge #6680 og #6780 (ejer-go givet 18/10, ordret "merge 6680" og "merge 6780")

Begge PR'er er klar: CI grøn, alle Codex-fund rettet eller flyttet til opgaver (#6875, #6876), og en uafhængig reviewer-agent fandt intet. Det eneste, der mangler, er review-gatens Claude-markør for HEAD (#6680 `927f1c3fe`, #6780 `e9c916c76`).

- **Hvorfor den mangler:** sessionen 18/10 skrev selv rettelserne, og auto-mode afviser, at forfatteren godkender egen kode (korrekt). Se `.claude/learnings/2026-10-18-review-markoer-selvgodkendelse.md`.
- **Gør:** markøren skal sættes af en session, der ikke har skrevet koden. Det er DENNE session (en ny session), som ikke har rørt diffs'ene. Review diffen `369e9b991..927f1c3fe` (#6680) og `68b3eed5c..e9c916c76` (#6780) og sæt så `node scripts/review-gate.mjs post-claude-review --pr N --verdict clean`. Er der pushet nyt siden, gælder markøren den nye HEAD.
- **Derefter:** `scripts/merge-queue.ps1 -Pr "6680,6780"` (én kø, i rækkefølge) og meld bagefter.
- **Efter #6680:** flaget `race_library_v2` oprettes som off. Tilføj `flag: race_library_v2` i `docs/FEATURE_REGISTRY.yml` og kør `node scripts/generate-feature-status.mjs`, hvis PR'en ikke allerede har gjort det (tjek). #6875 rettes før "tænd beta".
- **Efter #6780:** prod-scriptet `backend/scripts/dev/closeStaleMandates6773.mjs` køres IKKE uden eget ejer-go. Rækkefølgen er dry-run → vis ejeren listen → `--apply`.

## 2. #6874 Codex' agent-opsætning (ejer 18/10: "Codex retter")

Claude-review 18/10 står i PR-kommentaren. Setup-scriptet er godkendt, og custom-roller er runtime-verificeret (explorer-barn med `gpt-6-luna`/`low` fra rollefilen). Codex retter 11 svækkelser i AGENTS.md; den vigtigste er, at regel 35's ejer-gate-liste skal stå i AGENTS.md selv. Når Codex har pushet:
- Re-review KUN de 11 punkter. Tjek `AGENTS.md ≤ 13.000 bytes`, at de 22 ankre består (`scripts/check-agent-token-hygiene.ps1`), og at sessionsmandatet "Denne session (18/10)" er fjernet.
- Grøn CI + review-gate → merge via merge-køen. Codex merger aldrig selv. #605 lukkes IKKE.

## 3. Playwright Smoke er rød på main (5 dage, 14-18/10)

Audit 18/10. Find årsagen read-only først. #5792 (`claude:blocked`) har en forældet statuskommentar.

## Holdes åbne (ejer-beslutninger, spørg ikke igen)

- #6636/#6634: kilde til Kalender | Tabel (#6683, bygges efter #6680). Luk først, når koden er flyttet over.
- #6248: merges med Udvikling 2.0-pakken (#6110), ikke alene (ejer 7/10).
- #6665 forside: ejeren har skærmbilleder (18/10) og læser selv; spørg ikke.
- #6839, #6819/#6820, #6849/#6843/#6813: mandagens liste i NOW.md.

## Roadmap (prod)

Gruppe A rettet 18/10 (#6463, #5864, #5848, #6186, #6638 → shipped/fixed). Resterende drift er bevidst:
- **B**, S5-motorpunkterne #6362, #6363, #6201, #6645, #6648: flippes først, når S5-løb kører og spillerne kan mærke dem. Brug `roadmap-flip.mjs --issue N`, dry-run først, og ejerens "kør".
- **C**, ikke færdige: #5915 (+1-loftet venter på #6248), #5904 (venter på #6780), #5878 (#6490 åben), #5978 og #5385 (claude:todo igen).
