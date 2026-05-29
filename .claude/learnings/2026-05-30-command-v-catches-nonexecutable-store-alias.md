# `command -v` fanger ikke-eksekverbare Microsoft Store-aliaser

**Dato:** 2026-05-30
**Issue:** #717 / #726
**PR:** #765

## Symptom

Pre-commit secret-scan blokerede en beviseligt ren commit på en frisk
Windows-PC, med **tom** detalje under "🔴 PRE-COMMIT BLOCKED: secret-pattern
... (python fallback scan)".

## Root cause (to fejl der forstærkede hinanden)

1. **`command -v python3` er ikke et eksekverbarheds-bevis.** På frisk
   Windows 11 er `python3` Microsoft Store app-execution-aliaset i
   `~/AppData/Local/Microsoft/WindowsApps/`. `command -v` ser filen og
   returnerer success — men i en git-hook-subproces kører aliaset ingenting:
   det printer "Python was not found…" til stderr og returnerer exit 9009.

2. **Crash blev tolket som fund.** Hooken havde `RESULT=$(... ) || PY_EXIT=$?`
   efterfulgt af `if [ "$PY_EXIT" -ne 0 ]` → enhver non-zero exit (inkl. en
   interpreter der ikke kan starte) blev læst som "secret fundet". `2>/dev/null`
   skjulte crash-beviset, så detaljen var tom.

## Generaliserbar lektie

- **Verificér eksekverbarhed, ikke eksistens.** Test en kandidat-interpreter
  med en triviel `-c pass` (eller `--version`) før brug. `command -v` /
  `which` siger kun at *noget* ligger på PATH — ikke at det kan køre.
- **Skel "værktøj fejlede" fra "værktøj fandt noget".** Brug en dedikeret
  exit-kode for fund (her: `exit 2`) så et crash (alt andet non-zero) kan
  håndteres separat med en ærlig fejlbesked. Et fail-safe-gate må gerne
  blokere ved tvivl, men det skal *sige* at det er en værktøjsfejl.
- **Skjul ikke stderr på et værktøj du afhænger af.** `2>/dev/null` gjorde
  en diagnosticerbar fejl til et mysterium. `2>&1` + vis output ved uventet
  exit.

## Forebyggelse

- Hook bruger nu eksekverbarheds-verificeret interpreter-valg.
- `setup-local.ps1` advarer hvis gitleaks (den primære scanner) mangler, så
  fallbacken sjældent rammes på en frisk PC.
