# 2026-09-24 · Windows Update genstartede maskinen midt i en natbølge

**Hvad skete:** Natbølge nat-D (12 spor + 7 i kø) kørte fra kl. 02:41. Kl. 04:42:59 startede `TrustedInstaller.exe` en genstart med årsagen "Operativsystem: Opgradering (planlagt)", årsagskode 0x800 (System-log: 1074, 109, 6006/6005). Maskinen genstartede og stod ved login, til ejeren kom kl. ca. 07:15. Bølgen og orkestratoren døde. 10 spor nåede at få PR, 1 var halvfærdig, og 8 blev aldrig startet. Markøren stod tilbage, men `wave-policy.mjs recover` kunne rydde den, fordi genstarten var bevist (andet boot-id og alle processer yngre end ejeren).

**Rod-årsag:** Windows Update planlægger OS-opgraderinger uden for "aktive timer" og genstarter selv. `keep-awake.ps1` forhindrer dvale, men ikke en planlagt genstart. Preflight tjekkede strøm-timeouts, men ikke om en genstart var på vej.

**Fix:**
1. Preflight tjekker `HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired` (og evt. `...\Component Based Servicing\RebootPending`) og giver NO-GO med en klar besked, hvis nøglen findes. Står i sessions-prompten 24/9-c og som bølgespor.
2. Ejeren sætter selv Windows Update "aktive timer", så de dækker natten, eller sætter opdateringer på pause før en natbølge. Det er en systemindstilling, så Claude ændrer den aldrig.
3. Recovery efter genstart: `node scripts/wave-policy.mjs recover --wave-id <id> --owner <session-id>`, og så en ny bølge med de uafsluttede spor.

Refs #5142 #5602
