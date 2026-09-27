# Natbølge 2026-09-27 (natsession 26/9 → 27/9)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 23:55 → 02:40 (bølge wf_f9363de3-390); opfølgere til ca. 03:00 |
| Agenter launched / fuldført / døde | 27 / 27 / 0 (6 spor inkl. rolling intake, reviewer pr. spor) + 3 WAVE-FOLLOWUP + 1 READ-ONLY-analyse |
| PR'er åbnet / merged | 3 nye (#5815, #5816, #5817) + 3 eksisterende gjort klar (#5800, #5801, #5810) / 2 merged (#5816, #5817, stående undtagelse "motor bag slukket v4") |
| Issues → claude:done | #5812, #5813 |
| gh-401-retries (preflight-probe + bølge) | 0 målt |
| Recoveries (type) | 0 |
| Preflight | GO kl. 23:50 (.codex.local/night-wave-preflight.json) |

Overtaget fra workflow-sessionen 26/9: bølge wf_7b7ece81 kørte færdig hos den gamle session (#5803, #5809, #5810). Ejer-go: nat-prompten `private-handoffs/2026-09-27-nat-session-prompt.md` (ejer-godkendt 26/9 23:10).

## Spor

- #5812 v4: flade etaper ét segment + udbrud uden forspring → PR #5816, merget.
- #5813 v4: tidsgrænse på bakkede etaper + jagt-gulv på flade finaler → PR #5817, merget (enqueued via rolling intake efter #5812).
- #5814 tilmeldings-påmindelse (ny mailtype) → PR #5815, venter på ejer-merge og "send".
- #4385 upkeep pr. løbsdag → PR #5800 gjort klar; 6 spillertekster sande med flaget on/off (2 opfølgere efter reviewets fund).
- #4629 træningsprogrammer (beta) → PR #5801, før/efter-billede.
- #5805 U23-sortering → PR #5810, CI rød→grøn (sortering i kolonne-headeren, stadig 8 ryttere på første skærm).

## Afvigelser/læringer

- **#5816 merget før reviewerens BLOKERENDE-dom var læst** (manglende test for `caughtBunchShiftSeconds`). Flag off, ingen spillerskade; testen landede med #5817. Learning: `.claude/learnings/2026-09-27-merged-before-reading-wave-review.md`.
- **Rolling intake:** et spor enqueued mens de andre laner var idle, blev først taget da sidste aktive lane blev færdig.
- **Klassifikatoren blokerede read-only prod-scripts** (`seedYouthPools.js`, `parkingDryRun.js`). Kommandoerne står i ejerens morgenrapport. Lanerne kunne derimod køre testpakken og kalender-tørkørslen.
- **Reviewer fandt ægte tekstfejl uden for PR-scope** (rules.json og 2 FAQ-svar usande med upkeep-flaget on). Det er værdien af reviewerens "gamle læsere"-tjek.
