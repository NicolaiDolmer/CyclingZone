# Reviewer-verdikt laeses fra workflow-journalen, aldrig ved tekst-match i transcriptet (14/9)

## Hvad skete

Orkestratoren (Fable) meldte ejeren at #5123's reviewer havde sagt BLOKERENDE, og at sporet var i
ret-trin. Det var forkert: reviewerens verdikt var BEMAERKNINGER (ingen blokerende fund). Ordet
"BLOKERENDE" stod i reviewerens transcript fordi briefen og tjeklisten naevner det, og et
`grep BLOKERENDE` paa hele transcript-filen fangede det. Samme fejl ramte #4964 (ogsaa
BEMAERKNINGER). Ejeren fik et go-kort 40 min senere end noedvendigt, og en forkert melding
undervejs.

## Hvorfor

Transcript-filerne (`subagents/workflows/<run>/agent-<id>.jsonl`) indeholder prompt, tjeklister
og tool-input; ordet forekommer altsaa uanset verdikt. Den eneste kilde til verdikten er
journalens `result`-entry: `journal.jsonl` -> `{"type":"result","agentId":..., "result":{"verdict":
"GODKENDT|BEMAERKNINGER|BLOKERENDE", "summary":..., "findings":[...]}}`, mappet til spor via
`{"type":"started","agentId":...,"label":"review #N ..."}`.

## Regel

- Verdikt = `journal.jsonl` result.verdict for agenten med label `review #N`. Intet andet.
- Ingen verdikt endnu = "review koerer", ikke et gaet.
- Vaerktoej: `scratchpad/verdicts.mjs`-varianten der laeser journalen (ikke transcript-grep) boer
  ligge i repoet som `scripts/wave-verdicts.mjs` (opfoelger).
- Samme princip for spor-resultater: `result.status` (koert/skipped/unstarted), ikke commit-log.

## Forward-guard

Naeste boelge: orkestratoren maa kun skrive "reviewer GODKENDT/BLOKERENDE" i et go-kort med
journalens verdikt som kilde; kortet skal naevne "ingen re-review" naar et ret-trin er koert uden
ny review (som #5089 og #4067 i dag).

Refs #5142 #5220
