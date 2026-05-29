# Postmortem: 5 fejl-mønstre under memory-konsoliderings-sessionen (#605 P0.3 / #743)

**Dato:** 2026-05-29
**Session:** Claude Code, DOLMERPC — memory/context-trim (#605 P0.3 + #743)
**Severity:** lav (alt fanget i egen verifikation eller skadesfrit), men værd at forebygge — flere er gentagelses-mønstre.

## Sammenfatning

Sessionen leverede sit mål (claude-cold-start 21.087 → 18.943 tok/tur, HOT MEMORY.md 1.832 → 1.199, NOW.md 1.834 → 323). Men undervejs opstod 5 fejl-mønstre. Dette dokumenterer rod-årsag + forebyggelse for hver.

---

## Fejl 1 — Scope-creep-regression (tabte #239/#240)

**Hvad:** Under "merge dubletter / fix stale facts" omskrev jeg `project_slice07_complete.md` til en tyndere version og tabte follow-up-referencerne til #239 (Slice 08) og #240 (callsite-audit). Fanget i min egen efter-verifikation og gendannet til den fulde originale tekst.

**Rod-årsag:** Mandatet var "merge dubletter + fix stale" (additivt/korrigerende). Jeg gled over i "forenkl filen" (subtraktivt) uden at det var aftalt. Ingen mekanisk before/after-check fangede tabet — kun manuel grep bagefter, ved held.

**Hvorfor det er farligt:** memory-dir er en OneDrive-symlink, ikke git-tracked. `git diff` fanger IKKE indholds-tab i memory-filer. Et tabt #N-ref forsvinder usynligt.

**Forebyggelse:**
- Bygget `scripts/check-memory-refs.ps1`: `-Snapshot` før konsolidering, `-Verify` efter → rapporterer enhver #N-ref eller (*.md)-pegepind der fandtes før men er væk nu, per fil.
- Regel (memory/README.md "Sikker konsolidering"): konsolidering må KUN merge/korrigere/demotere — aldrig "forenkle" en fil ved at fjerne substans (issue-refs, fil-pegepinde, kvantitative facts) uden at det er et eksplicit, bekræftet valg.

---

## Fejl 2 — Bulk-`sed` mtime-race → 4 fejlede Edits

**Hvad:** Efter en `sed -i ... *.md` (fileId-redaction over hele memory-dir) fejlede 4 efterfølgende `Edit`-kald med "File has been modified since read". `sed` rørte mtime på ALLE `*.md` mellem mine Read→Edit-par.

**Rod-årsag:** Jeg blandede bulk-mutation (`sed -i` over en hel glob) med målrettede Read→Edit-cyklusser på enkeltfiler i samme arbejdsstrøm. Bulk-operationen invaliderede alle de Reads Edit-værktøjet baserede sig på.

**Forebyggelse:**
- Rækkefølge-regel: kør ALLE bulk-mutationer (`sed -i`, batch-rename) FØRST, eller brug målrettede Edits — bland dem ikke i samme strøm.
- Når en `Edit` fejler med "modified since read": gen-Read og prøv igen (det virkede); eller brug et deterministisk script (jeg endte med en lille Python-indsætter for de 2 WARM-pointers, som ikke har mtime-race-problemet).

---

## Fejl 3 — `gh ... --jq` med escaped quotes fejlede 3×

**Hvad:** `gh issue view N --jq '"...join(\", \")..."'` fejlede gentagne gange med "failed to parse jq expression ... unexpected token \\". Backslash-escaped quotes inde i en single-quoted jq-streng sendes bogstaveligt til jq, som ikke forstår `\"`.

**Rod-årsag:** Forveksling af shell-quoting-niveauer. I `'...'` (single-quote) er `\"` IKKE en escape — det er backslash + quote, og jq's parser knækker.

**Forebyggelse:**
- Ny WARM-regel `feedback_gh_jq_no_escaped_quotes.md`: i `--jq`-udtryk inde i single-quotes, brug komma uden mellemrum (`join(",")`) eller undgå nested quotes helt; brug aldrig `\"`. Til kompleks formattering: `--json` + parse i et separat Python/jq-trin.
- Praktisk default: for issue-visning brug `--json field1,field2` og formattér i et efterfølgende trin frem for inline jq-strenge med quotes.

---

## Fejl 4 — #750: docs/archive/**-guardrail blokerer rutine-arkivering

**Hvad:** Close-out-protokollen foreskrev arkivering af NOW.md-historik til `docs/archive/NOW-YYYY-MM-DD.md`. Men #684 FIX D (sat op samme dag) lagde `Write/Edit/NotebookEdit(docs/archive/**)` i `permissions.deny` — og Bash `mv` ind i mappen blev også blokeret. Resultat: rutine-arkivering umulig for agenten.

**Rod-årsag:** Deny-globben `docs/archive/**` er bredere end intentionen. Intentionen (dokumenteret i AGENTS.md + PARALLEL_WORKTREE_ORCHESTRATION.md) var at beskytte EKSISTERENDE arkiverede docs mod ændring — ikke at forbyde oprettelse af nye.

**Beslutning (bruger, 2026-05-29):** Drop arkivfiler helt. NOW.md trimmes direkte; historik bevares i git-log + issue-tråde. #684-beskyttelsen forbliver fuldt intakt; close-out-protokollen opdateres til at matche (CLAUDE.md + PARALLEL_WORKTREE_ORCHESTRATION.md).

**Forebyggelse:** Når en guardrail (deny-glob) tilføjes, tjek om den kolliderer med en eksisterende rutine i close-out-protokollen. Bredt-scopede globs skal matche den dokumenterede intention.

---

## Fejl 5 — Spildte probe-kald på harness-output-hikke

**Hvad:** Shell-output "hang" gentagne gange (tool-kald eksekverede, men output blev buffered og vist i bursts senere). Jeg brændte ~15+ kald på `echo`-probes for at teste om output var tilbage.

**Rod-årsag:** Harness-niveau-fænomen (ikke en kommando-fejl). Min reaktion — gentagne små probes — var spild; output kom alligevel i batches uanset.

**Forebyggelse:**
- Når output hænger: lav IKKE probe-kald. Fortsæt med rigtigt arbejde der ikke kræver verificeret output (fx `Write` af nye filer, som ikke kræver Read), og verificér ALT samlet i ét kald når bufferen flusher.
- Operationer der KRÆVER verificeret forrige output (Edit efter Read, beslutninger på kommando-resultat) udskydes til output er bekræftet tilbage — hellere det end at handle blindt (jf. Fejl 1).

---

## Hvad gik RIGTIGT (bevar)

- Egen efter-verifikation fangede Fejl 1 før den nåede commit — den disciplin er grunden til at regressionen ikke blev permanent.
- Ærlig rapportering af alle forbehold til brugeren (P0-mål uopnåeligt, memory-dir urørt med begrundelse).
- Idempotente close-out-kommandoer (tjek-om-comment-findes før post).

## Relaterede

#605 (P0.3), #743 (konsolidering), #684 (deny-glob), #750 (archive-konflikt), #742 (session-effektivitet).
Tidligere relateret learning: `.claude/learnings/2026-05-29-read-grep-secret-leak-vector.md` (den forbudte fileId i memory-filer trippede sanitize-hooken — fixet i denne session).
