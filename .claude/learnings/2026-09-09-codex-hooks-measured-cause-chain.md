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

## Genoptaget 9/9: profilering, udkast og nyt runtime-stop

Ejeren ændrede mål til docs ≤1,5 s / kode ≤4 s og fjernede tid som stopgrund.
Før rettelser blev hvert trin målt: Bash/merge 52 ms, staged-check 51 ms,
gitleaks inklusive opstart 477 ms, npx lint-staged 1621 ms, direkte lint-staged
642 ms / 408 ms med eksplicit config, ESLint --version 3469 ms. Varm samlet
eksisterende hook: 1801 ms. Disse tider forklarer ikke entydigt den første
7,555 s-måling; senere belastning gav eksempelvis npx 6363 ms.

Forberedt, men **ikke committet eller færdigverificeret**, i arbejdstræet:

- Pre-commit bruger staged arkiv-/NOW-kontrol og genbruger lint-stageds egne
  globs/matcher til no-op. Npx fjernet; direkte installeret ESLint bevares.
- Fem Git-tests bestod: faktisk arkiv-commit afvist, rename væk afvist,
  staged NOW-budgetter afvist og tilladte grænser/CRLF/unstaged filer accepteret.
- Faktiske isolerede commits: docs 1,263 s (mål opfyldt), backend-kode 7,777 s
  (mål ikke opfyldt). Kontroller og staging-backup bevaret; kompromis tilladt.
- setup-new-pc → setup-local → kanonisk install-git-hooks, inklusive secret-test.
  Legacy install-hooks er pegepind; smoke-test kræver specifik secret-afvisning.
- Portable launcher, skærpet tracked-reference-audit, prompts/HOOKS/AGENTS og
  GUARD_INVENTORY med 260 kilder. Inventory-udkastet daterer kun faktiske blokeringer.

### Trust og frisk runner: 23 aktive er stadig ikke bevis

Den afsluttende trust-handling i CLI 0.153.4 blev udført én gang efter config-
ændringer: menuen viste PreToolUse 13/13, PostToolUse 4/4, SessionStart 4/4,
Stop 2/2. Config havde 23 trusted_hash-poster mod 23 definitioner (tidligere 16).
Trust-sessionen blev set afslutte med exit 0. Frisk session
`01a085e5-b708-7903-94fa-08ad25291792` brugte egne exec_command-kald:

| Prøve | Faktisk resultat |
|---|---|
| T1 cat på den aftalte ikke-eksisterende env-sti | IKKE blokeret; PowerShell rapporterede fil ikke fundet |
| T2 git diff | IKKE blokeret; diff blev udført |
| T3 opret testbranch | IKKE blokeret; testbranch blev oprettet |
| K1 no-pager status | Tilladt; exit 0 |

T3 blev straks ryddet op: main gendannet, testbranch slettet, fravær verificeret
med show-ref exit 1. Runneren viste bl.a. hook-timeout efter 5 s, hook exit 1
og invalid Stop-hook JSON. Ingen af disse fejl tæller som policy-blokering.
Testsessionen blev også set afslutte med exit 0. Ingen dump-hook eller nyt dump.

### Ny målt årsag: Python3-alias og fail-open

I Git Bash resolver python3 til WindowsApps-aliaset. En harmløs versionstest
fejlede med Permission denied, exit 126; python fra den installerede Python312
kørte samme test korrekt, exit 0. Secret-hooken vælger udtrykkeligt python3
før python, uden at teste om interpreter virker (linje 46 og 220-234).
Når command-parsningen bliver tom, returnerer den exit 0.

Direkte test gennem den nye launcher med den observerede Bash/command-payload
for T1 gav **exit 0 efter 1,213 s**. Dette er et yderligere hul: Bash og trust
alene er utilstrækkelige. sanitize-secrets.sh har samme interpreter-valg
(linje 64-65); den præcise effekt på hver runner-fejl er ikke bevist.
T2/T3-fejlen er endnu ikke årsagsafklaret og må ikke tilskrives Python uden bevis.

Launcheren har desuden en uafklaret Git-resolution-fejl, når hele testsuiten
starter den fra Bash: fire direkte PowerShell-launcher-tests bestod, men den
samlede suite gav 28 pass / 1 fail (de nye integrationscases). Fejlteksten
var manglende Git Bash-resolution. Det er en fejl i udkastet, ikke et nyt
bevis for en fungerende launcher. Delte scripts er fortsat urørte.

`verify-local.ps1`: backend 118 + 9410 tests (9407 pass, ingen fail i anden
gruppe), frontend 3181 pass. Build fejlede på manglende posthog-js dependency;
ingen ændring i den urelaterede frontend er lavet. Token-hygiejne: 0 fail,
46 tracked scriptreferencer for 23 hook-definitioner.

Stop følger ejerens kriterium om en måling, der modsiger det hidtidige grundlag.
Ingen færdigmelding eller lukning af #5065. Sessionslåsen nulstillet. Git-hooks
forbliver aktive; implementeringsudkastet bevares til review i arbejdstræet.
Næste beslutning: tilladelse til at gøre interpreter-valget runtime-verificeret
i de delte secret-scripts, eller en ny runtime-bootstrap uden policy; derefter
ret launcherens Bash-kontekst, afklar T2/T3 og gentag hele runner-beviset.
Patch notes/FEATURE_REGISTRY er ikke relevante: ingen spillerrettet ændring.

## Afsluttet måling efter ejerens korrektion og udvidede mandat (9/9)

Udkastet blev først sikret i **b9cefa11**, committet og pushed før yderligere
ændringer. Sessionslåsen blev genoptaget i **669cbfe4**. Den ovenstående stopstatus
er historik, ikke slutresultatet. Ejer godkendte ændring af de delte secret-scripts
og accepterede kodecommit **7,777 s**; docscommit **1,263 s** opfyldte ≤1,5 s.

### Observation → årsag → handling → bevis

| Observation | Årsag | Handling | Bevis / begrænsning |
|---|---|---|---|
| Bash fandtes ikke på hook-PATH | Gits bin/usr/bin manglede; oprindelig bootstrap kunne ikke starte | Tracked PowerShell-launcher finder lokal Git Bash og giver barnet Git-værktøjer på PATH | Runtime-opstart målt; ingen WSL eller hardkodet PC-sti |
| 7 modified + 7 new, ikke alle 16 gamle hashes ugyldige | Trust var delvis; den første forklaring generaliserede forkert | Review af faktiske definitioner; samlet trust efter konfiguration | Endeligt 23/23 entries og aktive hooks; trust er ikke længere en åben årsag |
| Shell-matchere virkede allerede | Codex normaliserer exec_command til Bash/command | Ingen matcher-/payload-adapter | Observerede feltnavne nedenfor; T2/T3 blokerer nu med uændret policy |
| apply_patch mangler file_path | De eksisterende edit-scripts kan ikke udlede stien | Ingen skrøbelig patch-parser; arkiv/NOW håndhæves på staged Git-data | Faktisk arkiv-commit blokeret, NOW-fixtures inkl. grænser og unstaged forskel |
| Python3-stub eksisterede, men kørte ikke | command -v beviser ikke en interpreter; secret-parser faldt åbent igennem | Begge secret-scripts bruger fælles runtime-probe, afviser WindowsApps, blokerer fejl med exit 2 | 12 runtime-cases: eksisterende Claude-fixtures samt ingen Python, falsk probe, WindowsApps og scanner-crash |
| Launcheren fejlede i login Git Bash med exit 2 og CODEX HOOK STARTUP FAILED | git --exec-path var korrekt, men LASTEXITCODE i pipeline var null; fallback antog forkert rod for mingw64/bin/git.exe | Validér den faktiske Git-directory og håndtér begge Git-installationsstier | Samme login-kontekst giver nu pagerens specifikke exit 2; Python-rettelsen alene løste ikke dette |
| T1/T2/T3 gav stadig Hook failed, code 1, selv med fungerende scripts | Ydre PowerShell -Command ændrede native exit 2 til 1 | Alle 23 kommandoer afsluttes med `; exit $LASTEXITCODE`, derefter samlet re-trust | Før regressionstest: 1 !== 2; efter: exit 2; frisk runner blokerer alle tre |
| Stop meldte invalid JSON | Manuel JSON-interpolation kunne ikke escape anførselstegn i gh --body-reminder | JSON.stringify serialiserer samme advisory besked | JSON parse bestod; frisk Stop viste den citerede reminder uden JSON-fejl |
| Git-hooks tracked og omtalt som aktive, men kun samples i valgt hooksPath | Aktivering fandtes kun i manuel ny-PC-slutcheckliste; oprindelsen til denne PCs config er ukendt | Kanonisk installer aktiveret; automatisk setup-new-pc → setup-local → install-git-hooks | Rigtig Git-commit med staged fake-secret afvist, rigtig push med forbudt filnavn afvist |

De første hypoteser blev gentagne gange indsnævret af måling: matchere var ikke
fejlen; trust gjaldt kun nogle hooks; Git-laget manglede aktivering, ikke kode;
PATH-reparation var utilstrækkelig uden fungerende Python og korrekt exit-transport.
Ingen enkelt af disse rettelser var tilstrækkelig alene.

### Diagnostik og trust-regnskab

Den supplerende launcher-probe registrerede kun processtadier og feltnavne i
gitignored `.codex.local/`; kun harmløst K1 blev kørt. Alle probe-filer blev læst
og slettet straks, og diagnosekoden fjernet. Der er ingen varig payload-logning.
Observeret struktur (værdier fjernet, undtagen den relevante tool-type):

```text
{session_id, turn_id, transcript_path, cwd, hook_event_name, model,
 permission_mode, tool_name: Bash, tool_input: {command}, tool_use_id}
```

Probe-runden beviste, at stdin nåede barnet og K1 returnerede 0. En hypotese om
stdin-streaming som fejlkilde blev forkastet: buffering ændrede ikke T1-T3-fejlen.
Den endelige launcher videresender rå bytes, uden buffering-adapter eller parser.

Trust-rækkefølge: særskilt diagnostisk dump-trust tidligere i sagen; første
samlede 23-hook-trust før Python-/exit-fundet; derefter afsluttende samlet review
af de 23 ændrede exit-kommandoer, **efter token-hygiejne 0 fail**.
Sidste trust-session: `01a0860a-65f9-7ee3-8e7c-bcb821c57929`, afsluttet exit 0.
Menuen viste PreToolUse 13/13, PostToolUse 4/4, SessionStart 4/4, Stop 2/2.
Antallet af trusted_hash-poster blev genmålt til 23 mod 23 definitioner.
Ingen bypass blev brugt. Kommandoer/trust ændres ikke efter sluttesten.

### Positivt slutbevis fra egne tools i en frisk session

CLI 0.153.4, session **01a0860b-3ece-7732-be39-c956de75a716**:

| Test | Resultat |
|---|---|
| T1 `cat .env.findes-ikke` | `Command blocked by PreToolUse hook`, navngiven secret-hook og env-fil-læser-afvisning |
| T2 `git diff` | `Command blocked by PreToolUse hook: BLOCKED: git diff uden --no-pager` |
| T3 `git checkout -b codex-hook-selvtest` | `Command blocked by PreToolUse hook: [branch-lock] BLOKERET` |
| K1 `git --no-pager status -sb` | Tilladt, shell exit 0 på main |
| Git-T4 | Isoleret fixture med rigtigt `git commit`: STAGED-DOCS BLOCKED: archive, HEAD ikke oprettet; fixture fjernet |

Præcis fire exec_command-kald i sluttesten, ingen genforsøg eller branch-cleanup
nødvendig. Sessionen afsluttede med exit 0. Tidligere testbranches blev fjernet
straks efter fejlede prøver; fravær kontrolleret med show-ref exit 1.
K1 viste sandbox-advarsel om adgang til brugerens Git-ignore, men lykkedes.
Dette beviser CLI-runneren på denne PC; PC1 og en allerede åben Desktop-session
har ikke automatisk samme runtime-bevis.

### Regression og afgrænsning

- Før: hooksuite 28 pass / 1 fail; Bash-sanitizer 33/33. PowerShell-fixtureharness
  fejlede med exit 127 uden Git-værktøjer på PATH; derfor ingen scanner-konklusion
  fra det første harness-run. Den eksisterende Python3-parser blev særskilt set
  returnere 0 på T1, og nye runtime-tests fejlede før reparation.
- Efter: hooksuite **29 pass / 0 fail**, med **23** Node-integrationstests;
  Bash-sanitizer **33/33**, PowerShell-harness med fungerende Git-PATH **48/48**,
  inklusive alle fire `.claude/hooks/test-fixtures/` og sikre kontrolcases.
- Git-installerens smoketest genkørt: gitleaks 8.30.1 blokerede staged fake-secret.
  Fallback er ikke nødvendig på denne PC. Tidligere pre-push-filnavnsbevis består.
- Flere staged docs havde en callback-fejl: Array.some sendte indeks videre som
  picomatchs returnObject-flag. En eksplicit callback retter det; regressionen
  beviser at to docs slet ikke starter lint-staged/ESLint. Alle lint-globs bevares.
- Python-audit af begge mapper og begrundelser for advisory fail-open står i
  GUARD_INVENTORY.md. Secret-patterns og eksisterende scanner-grænser er bevaret.
- Fuld verify-local blev kørt tidligere: backend- og frontend-tests bestod,
  frontend-build fejlede på manglende installeret posthog-js. Dette er ikke et
  grønt build-bevis; ingen spillerkode eller dependency-baseline blev ændret.
- Ingen patch notes eller FEATURE_REGISTRY-ændring: kun agent-/Git-infrastruktur.

PC1: `git pull --ff-only`, `pwsh -File scripts/setup-local.ps1`, derefter review
og trust i `/hooks`, genstart og kør Del A i CODEX_PROMPTS.md. En aktiv hook uden
en observeret afvisning må fortsat ikke få en bevisdato.
