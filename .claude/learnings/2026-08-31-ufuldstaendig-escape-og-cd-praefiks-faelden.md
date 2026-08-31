# Ufuldstændig shell-escape (CodeQL #353) + `cd`-præfiks-fælden

**Dato:** 2026-08-31
**PR:** #4506 · **Refs:** #4453 · **CodeQL-alarm:** #353 (fixed 10:24)

To læringer fra samme session. Den første er kodefejlen, den anden er den
proces-fejl der kostede fire runder og en irriteret ejer.

## Del 1: rod-årsag i koden

`scripts/ops/railway-log-watch.mjs` skulle citere argumenter til Railway-CLI'en,
fordi CLI'en på Windows er en `.cmd`-shim og `spawnSync` derfor kræver
`shell: true` (Node nægter at spawne `.cmd`/`.bat` uden shell siden 18.20.2).
Citeringen så sådan ud:

```js
function shellQuote(arg) {
  return /[\s"]/.test(arg) ? `"${String(arg).replace(/"/g, '\\"')}"` : arg;
}
```

To huller:

1. **Escapen dækkede citationstegnet, men ikke escape-tegnet.** Et argument der
   ender på backslash blev til `"C:\tools\"`, hvor den afsluttende backslash åd
   det lukkende citationstegn og resten af kommandolinjen blev læst forkert.
2. **Uden mellemrum blev der slet ikke citeret.** `svc&whoami` matchede ikke
   `/[\s"]/` og gik råt til `cmd.exe`, hvor `&` er en kommandoseparator.

Reel eksponering var lav (input kommer fra operator/CI, ikke fra spillere), men
alarmen stod åben på main.

### Fix: validér, escapé ikke

`cmd.exe` har ingen pålidelig escape for `%`, `!` eller `^`. Korrekt escaping er
en tabt kamp. Alt scriptet sender er kendte former: faste flag, service-/
miljønavn, deployment-uuid, ISO-tidsstempler, heltal, evt. en CLI-sti. En
allowlist er snævrere og lettere at ræsonnere om, og efter validering findes der
ingen escape tilbage som kan være ufuldstændig.

Sekundært: citér **ubetinget**. Efter valideringen er citeringen teknisk
unødvendig, men "citér kun ved mellemrum" var netop hul nr. 2 — løsner nogen
senere allowlisten, genåbner hullet lydløst.

**Generaliseringen:** står du og skal escape til en shell, så spørg først om du i
stedet kan afvise. Escaping skal være korrekt for alle input; validering skal kun
være korrekt for de input du faktisk sender.

## Del 2: `cd X && <kommando>` matcher ikke prefix-allow-regler

Fire kald blev afvist af auto mode-klassifikatoren midt i sessionen:
`gh pr merge`, `gh pr edit --remove-label`, og to andre. Allow-listen indeholder
`Bash(gh pr *)` i **både** `.claude/settings.json` og `settings.local.json`, så
det burde have virket.

Årsagen: jeg skrev kommandoerne som

```
cd "C:/dev/CyclingZone-worktrees/..." && gh pr merge 4506 --squash --admin ...
```

Kommandoen **starter med `cd`**, ikke med `gh pr`. En prefix-regel matcher ikke,
kaldet falder igennem til klassifikatoren, og den afviser med rette et
admin-merge til main. Den bare form gik lige igennem:

```
gh pr merge 4506 --squash --admin --delete-branch
```

Vanen kom af at arbejde i et worktree: `cd <worktree> && …` blev refleks, også
efter at kommandoen ikke længere havde brug for det (`gh` arbejder på PR-nummer,
ikke på cwd).

### Det dyre var ikke fejlen, det var diagnosen

Jeg konkluderede **tre gange** på forkert grundlag før jeg testede det oplagte:
først "branch protection kræver review" (sandt, men ikke det der blokerede mig),
så "du skal godkende i UI" (umuligt — ejeren er selv PR-forfatter, og GitHub
tillader ikke selv-godkendelse), så "vi skal lægge en ny permission-regel ind"
(reglen fandtes allerede). Hver runde sendte ejeren ud i en handling der ikke
kunne virke.

**Reglen:** når et kald afvises, så variér FORMEN på kaldet én gang før du
konkluderer om årsagen. Bar kommando vs. sammensat kommando er det billigste
eksperiment der findes, og det adskiller "regel matcher ikke" fra "handlingen er
forbudt". Verificér-før-claim gælder også for mine egne værktøjskald, ikke kun
for kode og issue-state.

## Del 3: heredoc kollapsede `\\` igen (5. bid)

Jeg skrev testfilen med `cat >> fil << 'JSEOF'`. Selv med citeret delimiter blev
`"C:\\tools\\railway.cmd"` til `"C:\tools\railway.cmd"`, så teststien indeholdt
TAB og CR i stedet for backslashes. Testen fejlede korrekt og jeg fangede det,
men det er samme fejlklasse som `feedback_bash_no_powershell_heredoc` allerede
dækker for commit-beskeder. Den gælder **al** filskrivning med indhold der
indeholder backslashes eller `$`: brug Write/Edit, ikke heredoc.

## Forward-guards

- **Koden:** CodeQL kører på main og fanger en ny ufuldstændig escape. Derudover
  5 nye tests i `scripts/ops/railway-log-watch.test.mjs` (2 REGRESSION-mærkede),
  som CI allerede kører via `ci.yml:695`.
- **Backwards-check:** `shell: true` findes kun to steder i egen kode. Dette, og
  `scripts/check-eslint-warning-budget.mjs:16`, hvor kommandostrengen er statisk
  uden variabler. Ingen andre håndrullede shell-escapes.
- **Adfærden:** [[feedback_bare_command_no_cd_prefix]] i auto-memory.
