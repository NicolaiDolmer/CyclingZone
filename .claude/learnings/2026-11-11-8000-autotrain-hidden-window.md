# 2026-11-11 · Auto-toget åbnede terminalvinduer på PC1 (#8000, #8002)

**Symptom:** Den planlagte opgave "CyclingZone merge-auto-tog" åbnede af og til et synligt terminalvindue på PC1, selvom den var registreret med `pwsh -WindowStyle Hidden`.

**Rodårsag:** På Windows 11 er Windows Terminal standardkonsol. En planlagt opgave, der starter en konsol-app, får et terminalvindue, før `-WindowStyle Hidden` kan nå at virke, så flaget skjuler ikke noget.

**Rettelse:** Opgaven starter `conhost.exe --headless node merge-autotrain.mjs --log` direkte, uden PowerShell-wrapper. Verificeret på PC1: kørsel 13:03:34, resultat 0, intet vindue. Samtidig fjernet Discord-alarmen om klare PR'er (ejer-valg).

**Forebyggelse:** Nye planlagte Windows-opgaver i repoet starter via `conhost.exe --headless`, aldrig `-WindowStyle Hidden`.
