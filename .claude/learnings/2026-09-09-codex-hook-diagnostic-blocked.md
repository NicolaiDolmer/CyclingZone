# Codex hooks: verificeret trust-problem, diagnostik blokeret af CLI-version

**Dato:** 2026-09-09 · **Issue:** #5065 · **Status:** uafsluttet; adapter ikke bygget.

## Observationer og deres grænser

- Tidligere T1 gennem appens exec_command nåede PowerShell og gav fil-ikke-fundet;
  ingen secret-hook-blokering blev observeret.
- Codex CLI 0.135.0 viste secret-hooken som "Modified since last trusted".
  Før diagnostisk trust viste browseren 6 aktive PreToolUse-hooks, 2 aktive
  SessionStart-hooks og 1 aktiv Stop-hook. Påstanden "alle hooks springes over"
  var derfor forkert. Trust er en verificeret del af problemet.
- Bare `bash` kunne ikke resolves i appens PowerShell-runner. Git Bash virkede
  via absolut sti til branch-guarden. Dette måler IKKE hook-processens PATH.
- De delte shell-hooks kræver Bash/command; edit-hooks kræver Claude-toolnavne
  og file_path. Det beviser deres inputkontrakt, ikke hvad Codex faktisk sender.
- En midlertidig PowerShell-probe blev tilføjet med dumpmål under .codex.local/.
  Den skulle måle stdin, PATH, bash-resolution og bash-version uden at afhænge
  af bash for opstart. Kun harmløse testkald blev forsøgt.
- To egne tool-kald i den allerede åbne app-session skabte ingen dumpfil.
  Det er ikke bevis for, at en frisk session ville gøre det samme.
- CLI-sessionens forsøg på de to prøvekald blev afvist før tool-kald med HTTP 400:
  "The 'gpt-6-astra' model requires a newer version of Codex."
  To SessionStart-hooks fejlede desuden med exit 1; årsagen blev ikke fastslået.

## Trust-regnskab og operatørfejl

1. Diagnostisk trust: kun proben blev først valgt og set som Trusted i hook-browseren.
   En efterfølgende prøveprompt blev fejlagtigt sendt, mens hook-menuen stadig var
   åben. Genvejstaster ændrede enabled-tilvalg og trustede også pager-hooken.
   Fejlen blev meldt til ejeren. De tidligere aktive hooks blev slået til igen,
   pager-hooken slået fra, og prompten først sendt efter positiv observation af
   det rigtige promptfelt. Ingen model-tool-kald skete under menu-fejlen.
2. Afsluttende trust: IKKE udført. Efter CLI-stop blev de to nyoprettede trust-poster
   fjernet og seks enabled-overrides fjernet; de oprindelige 16 trusted_hash-poster
   blev bevaret. Ingen bypass-flags blev brugt.

## Årsag og næste verifikation

Den endelige årsagskombination er endnu ukendt. Trust-problemet er observeret;
CLI-versionens inkompatibilitet blokerer målingen. Hook-PATH og faktiske payloads
er IKKE observeret, så hverken PATH-fejl eller nødvendig shell-oversættelse må
rapporteres som bevist. Matcher-navne må heller ikke udledes af model-toolnavne.

Næste trin kræver en kompatibel CLI/session: gentag den afgrænsede dump-runde,
slet dump straks, fjern probe, og afgør først derefter behovet for adapter eller
portabel bash-opstart. Den endelige accept er T1-T4 blokeret og K1 tilladt gennem
egne tool-kald i en frisk session. Tests skal derefter ind i den eksisterende suite.

## Oprydning og læring

CLI-processen blev set afslutte. Dumpfilen blev positivt kontrolleret: den blev
aldrig oprettet. Probe, testfil og hook-definition blev fjernet. Delte hooks og
ejerens launch.json er urørte. Ingen payload-værdier eller secrets er publiceret.

Kontrollér terminalens aktuelle skærmbillede før tekstinput: samlet Escape/paste
kan blive menu-genveje. Et Trusted-mærke beviser tilladelse, ikke korrekt afvikling.
Dokumentation: https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks
