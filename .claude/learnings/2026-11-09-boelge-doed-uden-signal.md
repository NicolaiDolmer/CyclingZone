# Bølgen døde uden signal, og statusfilen sagde "kører" (9/11)

**Symptom:** fem spor stod stille i knap to timer, mens `wave-policy inspect` viste `running`. Ejeren opdagede det ud fra opgavelisten i appen, før Claude gjorde.

**Rodårsag:** workflowets agenter stoppede kl. 19.35, samtidig med en afbrudt tur og kontekstskift. Ingen notifikation kom. Markøren følger kun Claude-hovedprocessen, som stadig levede, så den kan ikke se, at agenterne er væk.

**Rettet:** låsen frigivet af ejeren med `recover --owner-override`; sporene overtaget af Codex (#7911).

**Forebyggelse:**
- Efter afbrudt tur eller kontekstskift: tjek agent-transskripternes sidste skrivetid under `subagents/workflows/<runId>`, før "kører" siges til ejeren.
- Branch-tavshed over 30 min er et fund, der skal meldes, ikke noget der venter på næste spørgsmål.
- En merge-kø startes altid med synlig log (`Tee-Object`), aldrig `Select-Object -Last` alene: den skjulte, at køen ventede på et review-tjek, der aldrig startede.
