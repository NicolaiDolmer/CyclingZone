# Natbølge 2026-08-06 — Verdensklasse bølge 1 (epic #3395)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 5/8 ~23:35 → 6/8 ~12:15 (inkl. ejer-styret token-pause ~08:15-10:45) |
| Agenter launched / fuldført / døde | 6 / 6 / 0 (2 killed i token-pause, begge resumed via SendMessage i samme worktree med intakt kontekst) |
| PR'er åbnet / merged | 6 / 6 (#3403, #3404, #3405, #3406, #3432, #3437) + sidegevinst #3386 merged i lukkerunden |
| Issues → claude:done | #3396, #3397, #3398, #3399, #3400, #3401, #3402 + #3099 |
| Patch notes | v7.97 (Final Km, agent-skrevet) · v7.98 (Maiden Win, Hero & Agony, narrative notifikationer) · v7.99 (auktions-reveal, sæsondokumentar) |
| Migrationer applied post-merge | 3 kørsel (4 filer): `discord_race_digest_log` · `rider_career_events` + `career_milestone`-type · `season_documentaries` + fakta-RPC + LLM-flag — alle idempotente, alle post-verificeret |
| gh-401-retries | Ikke systematisk målt; ingen blokerende 401 (retry-wrapper brugt overalt) |
| Recoveries (type) | 2 (token-pause-kill → SendMessage-resume i samme worktree; begge leverede komplet) |
| Preflight | GO 5/8 ~23:30 (`.codex.local/night-wave-preflight.json`) |
| Tokens (subagenter) | ~4,6 mio. på tværs af 6 agenter (0,39-0,66 mio. pr. agent) |

## Afvigelser/læringer

1. **Delt-checkout-commit på fremmed branch (4. bid af klassen).** En parallel session skiftede hoved-checkoutet til `fix/3416-*` mens denne bølge kørte. Orkestratorens branch-guard fangede det første commit-forsøg (tavst exit 1) — men GENTAGET uden guard committede patch notes på den fremmede branch. Recovery: commit eksporteret, `git reset HEAD~1`, fremmed tree restaureret urørt, commit cherry-picked til main via midlertidigt worktree. Fuld postmortem: `.claude/learnings/2026-08-06-shared-checkout-cross-session-commit.md`.
2. **perf-gate additiv drift bed to gange i samme bølge** (#3405: 874→879; #3432: 882→885 — main var i mellemtiden bumpet til 882 af andre merges). Kendt #2511-klasse: gaten måler PR-builds, ikke summen. Det strukturelle fix (i18n-namespace-split ud af index-chunken) er nu presserende — hver eneste frontend-PR skal hæve loftet.
3. **ui-anti-drift + canvas-eksport:** anden forekomst af undtagelsesklassen "canvas kan ikke bruge CSS-tokens" (`heroAgonyExport.js` → `seasonDocumentaryExport.js`). Hvis en tredje kommer, bør klassen generaliseres i EXEMPT-listen (fx `*Export.js`-konvention) i stedet for fil-for-fil.
4. **Agent-instruksen "rør ikke PatchNotesPage.jsx" er utilstrækkelig:** to agenter redigerede `frontend/src/data/patchNotes.js` (data-SSOT'en) — bogstavet fulgt, ånden brudt, og det gav en merge-konflikt i #3432. Fremtidige bølge-prompts skal nævne BEGGE filer eksplicit.
5. **PR-merge-watcher-lektion:** GitHubs `mergeStateStatus=BLOCKED` er normaltilstanden mens required checks kører — en watcher må kun alarmere på MERGED/CLOSED/ægte check-FAILURE (og `audit`-falsk-rød er i øvrigt død nu, #3435).
6. **Chunk-modellen + individuelle Agent-spawns virkede:** ingen barrier-hang, per-agent-notifikationer, token-pause midt i bølgen kostede intet arbejde (resume med intakt kontekst). Merge-kadencen holdt køen ≤5 hele vejen.
7. **Følgefund filed:** #3407 (stale mobile-webkit `planner.png`-snapshot fra #3179 — root-causet uafhængigt af 3 agenter).

## Kontekst

Bølge-indhold, evidens og bølge 2-3-planen: `docs/superpowers/specs/2026-08-05-verdensklasse-game-plan.md` + epic #3395 (tjekliste opdateret 6/8). Refs #605 (velocity-trend).
