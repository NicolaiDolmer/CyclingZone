# Natbølge 2026-11-04 (PC1, 3/11 21:00 → 4/11 08:30)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 21:55 → 07:30 (7 bølger via `wave.js`) |
| Bølger / spor | 7 / 22 spor (13 bygge, 9 undersøgelse); 0 frys, 0 døde lanes |
| PR'er åbnet af bølgerne / merged i nat | 9 / 7 (+ 8 eksisterende PR'er merget af PC1, heraf 6 Codex-TS) |
| Merged i alt | 15: #7592, #7595, #7590, #7597, #7586, #7593, #7594, #7604, #7596, #7601, #7603, #7598, #7599, #7606, #7605 |
| Lagt klar til ejer (ikke merget) | #7602, #7608, #7609 (+ #7579 fra før) |
| Issues → claude:done | #7587, #7582 |
| Issues lukket af Til dørs på nattens bevis | #7439, #7330, #7388, #6971, #2794, #6683, #7566, #7568, #6853, #4259, #7232, #7092 |
| Recoveries | 0 (én sti-fejl: #6172-sporet sprunget over, rettet i #7597 punkt 8) |
| Preflight | GO kl. ca. 21:50 (.codex.local/night-wave-preflight.json) |

## Afvigelser/læringer
- **Merge-klassifikatoren er sandheden, ikke prompten.** Natprompten kaldte fire PR'er "regel 35"; `merge-queue.ps1` markerede alle som ejer-go. Ejeren gav go i chatten (logget på #7495). Spørg om kategorier FØR ejeren går i seng, ellers bygges der kun.
- **Ejer-go pr. kategori virker:** "bølge-tooling, CI-hastighed, TypeScript, D's forkert-info-rettelser" gav 12 natmerges uden flere spørgsmål.
- **Wave 2.0 (#7597) holdt i første rigtige kørsel:** straks-frigivelse og lanes der selv retter røde checks (actionlint, static-guards, warning-budget blev rettet af lanerne før færdig-melding). Balance-internals-junction virkede i alle nye worktrees.
- **Sekventielle TS-PR'er deler baseline-fil:** hver merge kræver main-merge + `check-ts-core-ratchet.mjs --update-baseline` i næste PR (ca. 20 min pr. PR). Kandidat til automatisering i merge-køen.
- **To motor-PR'er med fælles bro-signatur konflikter altid** (#7586/#7590 `simulateStage`): løs med union, kør hele v4-sættet (1519 tests) før push.
- **Fund:** replay af prod-etaper var ikke bit-identisk på PC1, fordi motoren brugte `localeCompare` uden sprog (da-DK: "aa" = "å"). Prod er upåvirket (en-US). Rettelse #7609 klar. Se `.claude/learnings/2026-11-04-1857-locale-dependent-sort.md`.
- **Auto-mode blokerede** en prod-dry-run via Infisical (#4211); ingen omgåelse. Ejeren kører den selv.
