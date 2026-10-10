# Kædede merge-køer startede for tidligt på en grep (10/10)

**Hvad skete:** Jeg kædede baggrunds-kommandoer: "vent til kø A's output-fil indeholder `[OK]`/`exited`, så start kø B". To gange matchede venteren tekst, som A's kæde havde *kopieret* ind fra en endnu tidligere kø (`tail -3` af en anden output-fil, inkl. `[OK] Hele merge-koeen` og `[exited with code 0]`). Kø B startede, mens kæde A stadig ventede på CI for sine PR'er. Det gik godt kun fordi kæde A endnu ikke var nået til selve merge-kaldet. Ellers havde to køer kørt samtidig (forbudt, [[feedback_one_merge_queue_process]]).

**Regel:**
- Kæd aldrig merge-køer via grep på output-filer. Én kø pr. baggrundskald; start den næste først efter task-notifikationen for den forrige.
- Er en kæde nødvendig: vent på processen (ingen `pwsh ... merge-queue` i `Get-CimInstance Win32_Process`), aldrig på tekst.
- `TaskStop` på en baggrunds-shell stopper ikke nødvendigvis børneprocesser (vite-servere holdt portene). Tjek og stop dem eksplicit.
