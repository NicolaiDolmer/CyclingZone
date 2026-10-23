# 23/10: merge-dagen blev 5 timer forsinket

**Hvad:** Lovet "alle merget ~kl. 13", færdig ~kl. 19. 27+ PR'er merget, men med lange pauser.

**Rodårsager (egne):**
1. `gh pr update-branch` på 12 PR'er på én gang fyldte Actions (~100 kørsler i kø). Ingen merges i over en time. Reglen stod allerede i GITHUB_WORKFLOW.md.
2. Hjemmelavede kø-wrappere omkring merge-queue.ps1:
   - et manglende check blev talt som grønt,
   - TaskStop dræbte kun skallen, så 3 køer kørte samtidig,
   - køen stoppede ikke ved rød deploy/main og mergede derfor #7080 og #7036 oven på rødt.
3. En PR med konflikt (#6988) blokerede hele køen i flere runder.
4. Kø-værktøj (#7104) blev bygget midt på merge-dagen, og 7 Codex-runder konkurrerede med merges.

**Rodårsager (eksterne):**
- deploy-verify hang 2x i 40 min på Railway SKIPPED (#7098, rettet i #7112).
- Railway-deployet af #7100 fejlede én gang forbigående.
- npm-netværksfejl i CI.

**Permanent:**
- Memory `feedback_merge_day_protocol` (HOT).
- #7104: klar først, opdatér kun den forreste, SKIP, deploy-tog og Close-OpenTrain.
- #7112: Railway SKIPPED er færdigt.
- GITHUB_WORKFLOW.md punkt 8: aldrig masseopdatering.
