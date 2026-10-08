# Natsession 2/10: forældet bølgemarkør efter afvist Workflow + "pending"-grep der aldrig blev tom

Dato: 2026-10-02. Refs #5142, #5562.

## 1. Bølgemarkør skrevet, Workflow afvist

**Hvad skete:** Kl. 02.42 kaldte natsessionen `Workflow({ scriptPath: ".claude/workflows/wave.js" })`. PreToolUse-hooken (`wave-policy.mjs hook`) skrev `.claude/run/wave-active.json` med sessionen som ejer. Derefter afviste auto mode-klassifikatoren selve kaldet. Ingen workflow, ingen worktree, ingen branch, `dispatchStarted: false`, men markøren stod tilbage og ville have blokeret merge-køen (`assert-merge-allowed`) for filer i sporets ownership og enhver ny bølge.

**Opdaget:** ved næste tjek (03.16), fordi markøren pludselig fandtes igen med natsessionens eget session-id som ejer.

**Ryddet op:** verificeret ingen worktree/branch/run, derefter `node scripts/wave-policy.mjs release --wave-id <id> --children-stopped`.

**Regel:** efter et afvist eller fejlet `wave.js`-kald: kør `wave-policy.mjs inspect`. Står der en markør med dit eget session-id og `dispatchStarted: false` uden `workflowRunId`, så frigiv den med det samme. Mulig værktøjsrettelse: lad hooken markere admission som foreløbig, til PostToolUse binder run-id'et, og lad `inspect` flagge foreløbige markører ældre end få minutter.

## 2. Venteløkke der matchede et check-navn

**Hvad skete:** Hovedsessionen ventede på #6032's checks med `gh pr checks 6032 | grep -cE "\bpending\b|..."`. Check-navnet `delta-pending` matcher `\bpending\b` (bindestreg er en ordgrænse), så tælleren blev aldrig 0, og løkken brugte hele sit loft på 30 min, før merge-køen startede. #6032 blev merget 00.50 i stedet for ca. 00.20.

**Regel:** vent på checks via status-kolonnen, ikke fritekst: `gh pr checks N --json bucket --jq '[.[]|select(.bucket=="pending")]|length'`. Eller lad `merge-queue.ps1` selv vente; den bruger `--required`.

## 3. Rullende intake kræver ejerens procestræ

`wave-policy.mjs enqueue` kræver at kalderen er en efterkommer af bølge-ejerens proces. En anden Claude-session kan derfor ikke selv lægge spor ind. I nat gik det via `SendMessage` til ejer-sessionen, som læste sporfilen og kørte `enqueue`. Det virkede, men forudsætter at ejer-sessionen lever og svarer.
