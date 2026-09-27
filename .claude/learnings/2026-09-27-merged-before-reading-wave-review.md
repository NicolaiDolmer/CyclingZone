# Merget en bølge-PR før reviewerens dom var læst (27/9, #5816)

**Hvad skete:** Natsessionen 26-27/9 merged PR #5816 (v4 udbrud + segmenter, bag slukket flag) under den
stående undtagelse "motor bag slukket v4", så snart CI og deploy verify var grønne. Monitoren viste
branchen som "finished" i `wave-active.json`, men bølgens reviewer-agent havde allerede givet dommen
BLOKERENDE: den nye finale-regel `caughtBunchShiftSeconds` manglede en test. Dommen stod kun i
workflowets slutresultat, der først kom efter hele bølgen.

**Konsekvens:** ingen for spillerne (flaget off). Testen blev tilføjet i opfølgeren på #5817 og merget
samme nat.

**Rod-årsag:** "finished" i markøren betyder at lanen er færdig, ikke at reviewet er godkendt. Den
stående undtagelse kræver "CI + rent diff + CodeRabbit", og det blev læst som en fuld gate, selvom
bølgens egen reviewer er en ekstra gate.

**Regel fremover:** før en bølge-PR merges midt i en bølge: læs reviewerens dom i
`subagents/workflows/<runId>/journal.jsonl` (type `result`, felt `review`). BLOKERENDE = ingen merge,
uanset stående undtagelse. Venter dommen stadig, så vent.
