# 2026-07-25 — Bølge 3: masse-stall af baggrunds-agenter + manglende guard-preflight i kontrakten

## TL;DR
9 af 13 baggrunds-agenter (Agent-tool, worktree-isolation) stoppede stille uden completion-notifikation og stod døde i ~2 timer. Samtidig kostede en ufuldstændig bølge-kontrakt (uden CI-guard-scripts) 3 undgåelige CI-runder. Begge klasser er lukket med konkrete regler nedenfor.

## Symptomer + detektion
- `status="running"`/"message queued" er IKKE bevis for liv. Transcript-`.output`-filen skrives først VED completion → mtime er ubrugelig som puls for Agent-tool-tasks (modsat Workflow-runs).
- Brugbar ground truth: `git -C <worktree> status --porcelain` (dirty-filer) + nyeste fil-mtime i worktree'et (ekskl. node_modules/.git) + `rev-list --count origin/main..HEAD`. 0 writes i 60+ min på en lille opgave = stall.

## Recovery der virker (bevist 10/10 denne bølge)
`TaskStop <id>` efterfulgt af `SendMessage` → agenten genopstår FRA SIT TRANSCRIPT med al læst kontekst intakt. Små spor leverede minutter efter genoplivning. Besked-skabelon: "Din proces hang og blev stoppet. Fortsæt præcis hvor du var i worktree <path> (branch <b>). Levér nu. Alt i forgrunden."

## Regler fremad
1. **Chunk 6-8 agenter ad gangen** — gælder OGSÅ Agent-tool-fanout, ikke kun Workflow-`parallel()`. 13+ samtidige gav CPU-pres (Playwright-timeouts) og masse-stall.
2. **Bølge-kontrakten SKAL indeholde guard-preflighten** (kør fra repo-rod før push): `node scripts/tone-check-em-dash.mjs` · `node scripts/i18n-check-leaks.mjs` · `node scripts/i18n-check-keys.mjs` · `node scripts/lint-swallowed-catches.mjs` · backend-`npx eslint .` ved backend-ændringer (fangede no-dupe-keys som node --test ikke fanger). Frontend-lint alene er ikke nok.
3. **Stall-tjek hver ~30 min** med worktree-ground-truth (pkt. ovenfor); nudge én gang, derefter TaskStop+resume.
4. **Parallelle sessioner på samme repo:** forvent base-drift i merge-refs (semantiske konflikter CI ser men lokal base ikke gør). Ved main-afhængig fix: `gh pr update-branch`, ALDRIG kun `gh run rerun` (stale merge-ref). Cancelled check med 0 steps = infra → rerun er ok.
5. **Orkestrator-committet gate:** verifikations-kommandoen skal stå i SAMME `&&`-kæde som commit/push — en `| grep`-pipeline nulstiller exit-koden (pushede flaky-test-fix før verifikation; gik godt, var forkert).

## Bør i HOT memory?
Nej — natbølge-runbook + denne fil dækker; runbook'en bør få pkt. 1-2 skrevet ind (opfølgning).
