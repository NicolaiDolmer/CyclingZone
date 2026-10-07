# Prompt: GitHub-audit og triage, man 5/10 (sideløbende session)

Kopiér alt under stregen ind som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`. Anbefalet: **Sonnet**, indsats medium. Hovedsessionen kører samtidig (staging-worker #5904 + planlægning #6148), så rør ikke deres branches/worktrees.

---

GitHub-audit 5/10. Brug skillen `github-housekeeping`. Byg intet, og merg ikke.

**Omfang (målt 5/10 kl. 11):** 710 åbne issues · 24 `triage:new` · 9 `needs-ai-triage` · 29 `claude:done` men åbne · ca. 20 forældreløse worktrees og mange "stale" lokale branches (session-start-hooken lister dem).

**Rækkefølge**
1. **Done men åbne (29):** verificér hvert issue mod koden/prod/merget PR (aldrig PR-body alene). Lav en liste: "kan lukkes" (med bevis) / "ikke færdigt" (flip label tilbage) / "ejer skal se". Kendte fra 4/10: #6115 #6149 #6150 #6151 #6152 #6154 #6168 #5387 #5388 #5845. Luk ikke selv. Ejeren lukker per label-state-maskinen i `docs/GITHUB_WORKFLOW.md`.
2. **Triage (24 + 9):** sæt type/priority/cat/area-labels, find dubletter (link til originalen), og skriv én linje klar tekst pr. issue om hvad det er. Spillerfund anonymiseres (repoet er offentligt).
3. **Worktrees og branches:** dry-run-liste over worktrees uden åben PR og over lokale branches, der er merget og slettet på origin. Slet først efter ejerens ok. Tjek altid for ucommittede ændringer først. Rør ikke `fix/6129-*`, `chore/5904-*`, `codex/5692-*` eller noget, `.claude/run/wave-active.json` nævner.

**Aflevering:** ét samlet forslag med A/B pr. gruppe (ikke 100 enkeltpunkter) og tal. Ejeren godkender samlet. Derefter udfører du det godkendte og kører skillens retro.

**Regler:** forklar issues i klar tekst, aldrig bart `#N` · `Refs` ikke `Closes` · ingen prod-skrivninger · rør ikke `docs/NOW.md` (hovedsessionen ejer den) · `gh`/`git` kaldes bart, ikke bag `cd`.
