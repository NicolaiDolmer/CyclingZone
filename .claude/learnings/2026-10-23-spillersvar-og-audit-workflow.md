# 2026-10-23 · Spillersvar + backlog-audit på DolmerPC

## Hvad skete
1. **Første Workflow-kald gik ud med pladsholder-args** (`k: []`, `done: []`, `protected: "PLACEHOLDER"`). Det blev kun stoppet, fordi agent-guarden tilfældigvis blokerede (død bølge). Var guarden grøn, var 0 kandidater blevet "auditeret" og rapporteret som rent.
2. **En død Codex-bølge blokerede alt agent-arbejde på maskinen.** `.claude/run/wave-active.json` pegede på owner-pid 42544 og fire workers i state `running`, men ingen af processerne levede (sidst skrevet 22/10 19:57). Ingen session havde opdaget det.
3. **Svarudkast startede med en undskyldning** ("Sorry for the slow answer") i stedet for svaret, mod reglen "svar først på spørgsmålet". Fanget ved gennemlæsning før publicering, ikke af tone-tjekket.
4. **PR'er merget undervejs gjorde svarkort forældede** (#7067 merget 08:25, mens kortet sagde "ved at blive testet"). Auditten fangede det; ellers var et forkert statusord gået ud til en spiller.

## Hvorfor
1. Jeg skrev scriptet før jeg havde besluttet, hvordan data skulle ind (args vs. filer), og satte pladsholdere "for nu".
2. Bølge-recovery er ejer-/Codex-styret, og ingen rutine tjekker om `wave-active.json` peger på levende processer.
3. Tone-tjekket (`findDocTermViolations` + egne regex) tjekker ord, ikke struktur.
4. Svarudkast skrives på et øjebliksbillede af PR-status.

## Fremover
- Workflow-input: lad agenterne læse en fil i `$TEMP` med kendte indeks-intervaller, og kald aldrig Workflow med pladsholder-args. Tæl input i main-loopet lige før kaldet.
- Ved session-start på en maskine med `wave-active.json`: tjek at owner-pid og `running`-workers lever (`Get-Process -Id`); død bølge → meld til ejeren straks.
- Svarudkast: første sætning = svaret. Undskyldning og tak til sidst.
- Før publicering af svarkort: `gh pr view <nr> --json state,mergedAt` for hver PR, et kort nævner.
