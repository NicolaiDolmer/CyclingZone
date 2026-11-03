# Natbølge 2026-11-02

Refs #7476.

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 23:35 → 04:35 |
| Agenter launched / fuldført / døde | 13 / 13 / 0 |
| PR'er åbnet / merged | 10 (#7477-#7486) / 4 (#7459, #7477, #7483, #7486) |
| Issues → claude:done | #7246, #5059 |
| gh-401-retries (preflight-probe + bølge) | 0 |
| Recoveries (type) | 0 |
| Preflight | GO kl. 23:40 (.codex.local/night-wave-preflight.json) |

## Udfald pr. opgave
- Opgave 1 close-out: #7477 merged (build-stop + MASTERPLAN).
- Opgave 2 krav 5-oprydninger: #7483 (#5059) merged. #7482 (#6207), #7485 (#6461), #7484 (#6523) og #7481 (#6641, #6940) er grønne på Codex, men venter på Claude-markøren for højrisiko-filer. Auto-mode afviste selvgodkendelse, så ejeren skal give go.
- Opgave 2b: #7459 merged; migrationen post-verificeret.
- Opgave 3: #7478 (#6156, dayFormFaq) åben, ikke merget.
- Opgave 4a/4b: #7479 (Help samlet) og #7480 (patch note 7.392) som drafts.
- Ekstra: #7486 rettede rød main (registry-freshness på race-library-v2).

## Afvigelser/læringer
- Main var rød på registry-freshness fra 1/11: et beta-flip fjernede `decision`/`decide_by`. `decide_by` 2026-10-25 er overskredet og kræver en ny ejer-dato.
- Wave-workerne flippede issues til `claude:done` ved PR-åbning, ikke ved merge. De er sat tilbage til `claude:todo` (#6207, #6461, #6523, #6641, #6940).
- Merge-køen ventede 40 min pr. PR på en review-gate, der krævede en Claude-markør, som natten ikke kunne give. Højrisiko-oprydninger bør have markøren eller ejer-go med i nattens prompt.
- `check-build-stop-pr` læser kun kommaseparerede Refs (`Refs #A, #B`).
