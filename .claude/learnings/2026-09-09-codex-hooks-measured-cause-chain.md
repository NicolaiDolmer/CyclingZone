# Codex hooks: samlet måling og årsagskæde
**Dato:** 2026-09-09 · **Issue:** #5065 · **Version:** Codex CLI 0.153.4.
**Scope:** Frisk CLI startet fra Codex-appens PowerShell-runner på denne PC.
PC1 og en genstartet app-session er ikke målt. Ingen adapter eller matcher-rettelse bygget.

## Konklusion
Flere uafhængige forhold findes samtidig: syv eksisterende trust-definitioner er
ændrede, syv hooks mangler trust, hook-processens PATH kan ikke resolve bash,
og edit-scriptets interne inputkontrakt passer ikke til den observerede patch-payload.
Event-navnene accepteres. Shell-input er allerede normaliseret korrekt.

Dette er en årsagsanalyse, ikke en bestået T1-T4/K1-accepttest.
T1 blev tidligere observeret slippe igennem; T2-T4 er ikke retestet som
blokeringsprøver i denne runde. De to nye, harmløse formatprøver udførtes.

## CLI og genmåling
- `codex update`: 0.135.0 → **0.153.4**. Den nye CLI udførte begge tool-kald;
  den tidligere HTTP 400 om for gammel klient blev ikke gentaget.
- npm advarede om oprydning af den gamle, låste exe, men opdateringen returnerede
  exit 0, og en ny proces rapporterede 0.153.4. Ingen manuel oprydning af npm udført.
- `codex features list`: **hooks stable true**.
- De oprindelige **16 hook-state/trusted_hash-poster var identiske før og efter**
  opdateringen. Senere diagnostisk trust blev fjernet; samme 16 poster er bevaret.
- `/hooks` viste **alle 23** definitioner fra den uændrede projektkonfiguration:
  PreToolUse 13, PostToolUse 4, SessionStart 4, Stop 2. Det er positivt runtime-bevis
  for at disse PascalCase-eventnavne accepteres i 0.153.4. Interne kebab-case-navne
  er ikke grundlag for at omdøbe config-events.
- Browseren viste **9 trusted/aktive, 7 modified og 7 new**. Begge tidligere
  generaliseringer var forkerte: hverken alle 16 eller kun secret-hooken var berørt.

## Status for hver hook før diagnostisk trust
Numrene er en-baserede inden for hvert event i hook-browseren.
"Aktiv" betyder browserens tilladelse til at køre, IKKE observeret policy-håndhævelse.
Alle eksisterende enable-tilvalg blev bevaret; ingen ukendte definitioner.

| Event / nr. | Kommando (script) | Matcher | Trust | Aktiv i browser |
|---|---|---|---|---|
| PreToolUse 1 | `.claude/hooks/block-dangerous-secret-commands.sh` | `""` | modified | nej |
| PreToolUse 2 | `scripts/hooks/block-branch-switch-in-main-checkout.sh` | `Bash` | modified | nej |
| PreToolUse 3 | `scripts/hooks/setup-worktree-if-needed.sh` | `Bash` | modified | nej |
| PreToolUse 4 | `scripts/hooks/lint-gh-issue.sh` | `Bash` | new | nej |
| PreToolUse 5 | `scripts/hooks/check-ci-before-push.sh` | `Bash` | new | nej |
| PreToolUse 6 | `scripts/hooks/check-preflight-before-push.sh` | `Bash` | new | nej |
| PreToolUse 7 | `scripts/hooks/block-blocking-shell-commands.sh` | `Bash` | new | nej |
| PreToolUse 8 | `scripts/hooks/check-now-md-edit.sh` | `Edit` | trusted | ja |
| PreToolUse 9 | `scripts/hooks/block-archived-edit.sh` | `Edit` | trusted | ja |
| PreToolUse 10 | `scripts/hooks/check-now-md-edit.sh` | `Write` | trusted | ja |
| PreToolUse 11 | `scripts/hooks/block-archived-edit.sh` | `Write` | trusted | ja |
| PreToolUse 12 | `scripts/hooks/check-now-md-edit.sh` | `NotebookEdit` | trusted | ja |
| PreToolUse 13 | `scripts/hooks/block-archived-edit.sh` | `NotebookEdit` | trusted | ja |
| PostToolUse 1 | `.claude/hooks/sanitize-secrets.sh` | `Bash` | modified | nej |
| PostToolUse 2 | `.claude/hooks/sanitize-secrets.sh` | `PowerShell` | modified | nej |
| PostToolUse 3 | `.claude/hooks/sanitize-secrets.sh` | `mcp__.*` | modified | nej |
| PostToolUse 4 | `.claude/hooks/sanitize-secrets.sh` | `Read\|Write\|Edit\|Grep` | modified | nej |
| SessionStart 1 | `scripts/session-prefetch-issue.sh` | `""` | trusted | ja |
| SessionStart 2 | `scripts/hooks/ensure-scheduled-tasks.sh` | `""` | trusted | ja |
| SessionStart 3 | `scripts/hooks/setup-worktree-if-needed.sh` | `""` | new | nej |
| SessionStart 4 | `scripts/hooks/set-active-sessions.sh` | `""` | new | nej |
| Stop 1 | `scripts/check-now-md.sh` | `""` | trusted | ja |
| Stop 2 | `scripts/hooks/clear-active-sessions.sh` | `""` | new | nej |

## Observerede payloads, kun struktur
Prøven brugte CLI-agentens egne `exec_command` og `apply_patch`, ikke direkte
kald af policy-scripts. Der kom præcis to records fra den midlertidige hook.

- For shell-kaldet var det observerede kanoniske toolnavn **Bash**.
- For patch-kaldet var det observerede kanoniske toolnavn **apply_patch**.
- Begge havde nedenstående struktur. Alle payload-værdier er erstattet af typer.
- Shell-markøren lå i `tool_input.command` i første record, patchteksten i samme
  felt i anden record. Der var intet `file_path`, `old_string` eller `new_string`.

```json
{
  "session_id": "<string>",
  "turn_id": "<string>",
  "transcript_path": "<string>",
  "cwd": "<string>",
  "hook_event_name": "<string>",
  "model": "<string>",
  "permission_mode": "<string>",
  "tool_name": "<string>",
  "tool_input": {
    "command": "<string>"
  },
  "tool_use_id": "<string>"
}
```

## PATH og bash, målt INDE i hook-processen
PowerShell-proben målte PATH og `Get-Command bash -CommandType Application -All`.
**Begge records gav tom kandidatliste og ingen bash-version.**
Der blev altså hverken valgt Git Bash eller WSL-bash i hook-konteksten.

PATH havde `C:\Program Files\Git\cmd`, men hverken
`C:\Program Files\Git\bin` eller `C:\Program Files\Git\usr\bin`.
Efter dump-runden blev den installerede `C:\Program Files\Git\bin\bash.exe`
kørt direkte: GNU bash 5.3.9(1)-release, x86_64-pc-cygwin. Det beviser en fungerende
installation, ikke at hook-processen kunne finde den.

To SessionStart-, fire edit- og én Stop-hook viste fejl med exit 1 i CLI-prøven.
Det er foreneligt med den målte PATH-fejl; den korte UI-fejl alene identificerer
ikke processtartens præcise fejllinje. Manglende bash-resolution er separat målt.

Unikke observerede PATH-komponenter; brugerprofil og midlertidige/versionerede
stisegmenter er redigeret:
- `<USERPROFILE>\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell`
- `<USERPROFILE>\.codex\tmp\arg0\<temporary>`
- `<USERPROFILE>\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\codex-path`
- `<USERPROFILE>\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\libheif\libheif\bin`
- `<USERPROFILE>\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\jxrlib\jxrlib\bin`
- `<USERPROFILE>\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin`
- `<USERPROFILE>\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\override`
- `C:\Windows\system32`
- `C:\Windows`
- `C:\Windows\System32\Wbem`
- `C:\Windows\System32\WindowsPowerShell\v1.0\`
- `C:\Windows\System32\OpenSSH\`
- `C:\Program Files\Git\cmd`
- `C:\Program Files\GitHub CLI\`
- `C:\Program Files\nodejs\`
- `C:\Program Files\dotnet\`
- `<USERPROFILE>\scoop\apps\postgresql\current\bin`
- `<USERPROFILE>\scoop\shims`
- `<USERPROFILE>\AppData\Local\Programs\Python\Python312\Scripts\`
- `<USERPROFILE>\AppData\Local\Programs\Python\Python312\`
- `<USERPROFILE>\AppData\Local\Programs\Python\Launcher\`
- `<USERPROFILE>\AppData\Local\Microsoft\WindowsApps`
- `<USERPROFILE>\AppData\Local\Programs\Microsoft VS Code\bin`
- `<USERPROFILE>\AppData\Roaming\npm`
- `<USERPROFILE>\.local\bin`
- `<USERPROFILE>\AppData\Local\Microsoft\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe`
- `<USERPROFILE>\AppData\Local\PowerToys\DSCModules\`
- `<USERPROFILE>\AppData\Local\Microsoft\WinGet\Packages\jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe`
- `<USERPROFILE>\AppData\Local\Programs\coderabbit`
- `<USERPROFILE>\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback`
- `<USERPROFILE>\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin`
- `<USERPROFILE>\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd`
- `<USERPROFILE>\AppData\Local\OpenAI\Codex\bin\<version>`

## Årsagskæde: målt kontra udledt
| Område | Målt | Udledning / praktisk konsekvens |
|---|---|---|
| T1, secret | Secret-hook: modified; bash kan ikke resolves | Den springes over uden ny trust; derefter består PATH-problemet |
| T2, pager | Pager-hook: new; shell-payload er Bash/command; bash kan ikke resolves | Trust og bash-opstart mangler. Ingen observeret grund til shell-payload-adapter |
| T3, branch | Branch-hook: modified; samme shell-format/PATH | Samme to stop i kæden; Bash-matcheren er korrekt |
| T4, arkiv | Edit/Write-arkivhooks: trusted/aktive; patch-payload er apply_patch/command; bash kan ikke resolves | Først bash-opstart. Derefter afviser scriptets interne toolnavne-kontrol denne payload, før arkivstien læses |
| Eventnavne | Alle fire PascalCase-events og alle 23 definitioner indlæst | Ingen eventnavne-rettelse begrundet |
| Matcher-aliaser | Fire edit-hook-fejl under den ene patch-prøve; kanonisk payloadnavn apply_patch | Officiel dokumentation forklarer Edit/Write som aliaser; matcherne alene normaliserer ikke payloaden |

Inputkontrollen i `scripts/hooks/block-archived-edit.sh:24-32` accepterer Edit,
Write eller NotebookEdit og læser file_path. `check-now-md-edit.sh:25-32`
accepterer Edit/Write og læser samme felt. At de vil returnere tidligt på den
observerede apply_patch-payload er en **kodeudledning**; det er ikke en ny
runner-test efter PATH-fix. Delte scripts er urørte.

[Officiel dokumentation](https://learn.chatgpt.com/docs/hooks#tool-coverage)
bekræfter Bash-normalisering for exec_command og Edit/Write-aliaser for apply_patch.
[PreToolUse-format](https://learn.chatgpt.com/docs/hooks#pretooluse) bekræfter,
at matcher-aliaserne ikke ændrer det kanoniske tool_name eller command-feltet.
Dokumentationen støtter målingen; den erstatter ikke de to observerede records.

## Trust-regnskab og secret-hygiejne
1. **Før måling:** alle 23 eksisterende hooks blev gennemgået uden tilstandsændringer.
2. **Diagnostisk trust:** én ny PowerShell-probe blev valgt enkeltvis og positivt
   observeret som Trusted. Ingen eksisterende hooks blev trustet eller togglet.
3. **Efter måling:** dump læst i hukommelsen og slettet i samme kald FØR strukturen
   blev udskrevet. Kun feltnavne/typer og redigerede miljødata blev vist.
   Probe-definition, probe-script og harmløs testfil blev fjernet; den ene
   midlertidige trust-post blev tilbagekaldt. De oprindelige 16 poster er bevaret.
4. **Afsluttende trust/reparation:** ikke udført; ejeren krævede måling og stop.
   Ingen bypass-flags. Begge diagnostiske CLI-processer blev set afslutte.

Dumpfilen lå kun i .codex.local/. Under aktiv dump blev kun den autoriserede
harmløse shell-markør, engangsfilens patch og aflæsning/øjeblikkelig sletning kørt.
Ingen payload-værdier, credentials eller rå dumpfiler publiceret.

## Beslutningsgrundlag, ikke implementeret
Første rettelse bør sikre portabel Git Bash-opstart på hver PC og derefter trust.
En maskinspecifik sti må ikke kopieres blindt til den delte config: mulige valg
er PC-lokal PATH-opsætning med genstart af Codex eller en fælles launcher, der
finder den lokale Git for Windows-installation og bruger dens absolutte bash-sti.
Begge PC'er skal verificeres; WSL-bash må ikke vælges ved et uheld.

En eventuel oversættelse bør målrettes patch-inputtet og delegere al policy til
de urørte scripts. Denne måling begrunder ikke en generel shell-adapter eller
udskiftning af de eksisterende Bash/Edit/Write-matchere. Ejeren vælger næste skridt.

## Git-laget: aktivering og første runtime-bevis (9/9, #5065)

Den efterfølgende måling korrigerede også påstanden om manglende Git-hooks:
`.githooks/pre-commit`, `.githooks/pre-push` og `scripts/install-git-hooks.ps1`
var allerede tracked. Lokal `core.hooksPath` pegede imidlertid på `.git/hooks`,
som kun indeholdt samples. Bygget beskyttelse var derfor ikke aktiveret her.

Den eksisterende installer er nu kørt og aflæst tilbage som
`core.hooksPath=.githooks`. Gitleaks 8.30.1 er installeret. Positivt observeret
gennem Git-kald mod isolerede, efterfølgende slettede fixtures:

- `git commit` med staged fake-secret: exit 1 og den specifikke besked
  `PRE-COMMIT BLOCKED: gitleaks found secret`; HEAD uændret.
- `git push` til et lokalt test-remote med en harmløs fil på en forbudt env-sti:
  exit 1 og `Pre-push blokeret: secret-lignende fil`. Ingen fixture sendt til GitHub.

Dette beviser de to secret-kontroller; det beviser ikke pre-push-lint,
PatchNotes-kontrollen eller Python-fallbacken. Gitleaks virker på denne PC,
så fallback var ikke den aktive sti. Commit-latens måles før nogen udvidelse.
Kilderne til de eksisterende Git-hooks og alle delte agent-hooks er urørte.

Installationshullet kan ses i `scripts/setup-new-pc.ps1`: aktivering via
`setup-local.ps1` står kun som manuelt punkt i slut-checklisten. Selve rutinen
installerer Claude user-hooks, men kalder ikke Git-hook-installeren.
`setup-local.ps1` og `install-git-hooks.ps1` skriver begge hooksPath direkte.
Dette viser et hul i den automatiske ny-PC-rutine; det beviser ikke, hvilken
historisk handling der satte denne maskines tidligere hooksPath.
PC1 er ikke målt. Den eksisterende aktiveringskommando derfra er
`pwsh -File scripts/install-git-hooks.ps1 -SmokeTest` fra repo-roden.

Ingen spillerrettet ændring; patch notes er derfor ikke relevante.

### Stopkriterium ramt: commit-latens

Et reelt docs-commit (`bf0fa503`, kun denne læringsnote) på main blev målt med
Stopwatch umiddelbart omkring `git commit`, efter staging og branch-guard:
**7,555 sekunder, exit 0**. Gitleaks rapporterede 138 ms scanning af 1,85 KB;
lint-staged rapporterede ingen staged filer med matchende opgaver. Den samlede
tid overskrider ejerens krav på cirka ét sekund markant. Scannerens egen tid
er ikke hele proces-opstartstiden; resten er endnu ikke profileret og må ikke
uden måling tilskrives lint-staged alene. Push gennem den aktiverede pre-push
lykkedes; token-hygiejnen viste 0 fail, herunder `codex-hooks-tracked` OK.

Ejerens eksplicitte stopkriterium gælder derfor. Git-hooks forbliver aktiveret.
Ingen hook-policy er svækket, ingen agent-hook ændret og ingen ny trust udført.
Portabel Bash-opstart, Git-kontroller for arkiv/NOW, samling af installationsveje,
AGENTS-markering, guard-inventory og endelig T1-T4/K1-verifikation udestår.
#5065 forbliver åben; sessionslåsen nulstilles ved dette stop.

Anbefalet næste handling til ejerens godkendelse: profilér proces-opstart,
gitleaks og lint-staged separat på et normalt docs-commit, og optimér den
målte flaskehals uden at fjerne secret- eller lint-kontroller. Først efter
acceptabel commit-tid fortsættes den allerede aftalte hook-opgave.
