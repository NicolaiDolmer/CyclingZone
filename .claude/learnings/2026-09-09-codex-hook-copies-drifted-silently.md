# Codex' secret-guards driftede 3 måneder, fordi de var gitignorede kopier

**Dato:** 2026-09-09 · **Issue:** #5065 · **Fundet under:** genindførsel af Codex som sidevogn

## Hvad skete der

Codex blev udfaset 11/6. Konfigurationen blev liggende. Da den skulle tages i brug igen 9/9, pegede `.codex/hooks.json` på lokale kopier i `.codex/hooks/` — ikke på de scripts Claude bruger:

| Script | Codex' kopi | Claudes (tracked) | Manglede |
|---|---|---|---|
| `block-dangerous-secret-commands.sh` | 370 linjer | 407 linjer | #3342 (JWT-payload i `.codex.local/test-token*.json`), kategorisk blokering af `get-test-token.mjs --print` — det leak der faktisk skete 4/8 |
| `sanitize-secrets.sh` | 369 linjer | 469 linjer | #3317 + #4493 false-positive-fixes m.fl. |

Hele `.codex/` var i `.gitignore`. Kopierne var derfor usynlige for review, for CI og for den anden PC.

**Havde Codex bare været tændt, ville den have kørt med en secret-guard fra juni** — mod prod, med samme rettigheder som Claude.

## Hvorfor det kunne ske

To fejl der forstærkede hinanden:

1. **En dublet uden en kilde-af-sandhed.** Hooks blev kopieret ind i `.codex/` i stedet for at pege på `.claude/hooks/`. Kopier drifter altid; spørgsmålet er kun hvor længe.
2. **Sikkerhedskonfiguration lå lokal-only.** `.codex/` blev ignoreret som ét hele, fordi `config.toml` bærer MCP-secrets. Det tog hook-konfigurationen med sig — hard rule 2-brud, men usynligt, fordi ingen leder efter det der ikke er i git.

Bag begge: **udfasning uden oprydning**. Konfigurationen blev efterladt i en tilstand ingen ejede. Så længe Codex var slukket, kostede det ingenting — og præcis derfor blev det ikke opdaget før den skulle tændes igen.

## Rettelse

- `.codex/hooks.json` peger nu på `.claude/hooks/` + `scripts/hooks/` — én vedligeholdt kilde per hook. Drift-kopierne er slettet.
- `.gitignore`: `.codex/` → `.codex/*` + `!.codex/hooks.json`. `config.toml` (secrets) forbliver lokal.
- Hook-paritet med `.claude/settings.json` verificeret programmatisk.

## Forward-guard

`scripts/check-agent-token-hygiene.ps1` har nu **`codex-hooks-tracked`**: parser `.codex/hooks.json`, udtrækker hver hook-sti og `FAIL`er hvis nogen af dem ikke er tracked i git. Kører ved hver close-out (obligatorisk per CLAUDE.md).

Negativt testet: en injiceret reference til `.codex/hooks/does-not-exist.sh` gav `FAIL`, og `OK` igen efter gendannelse. En guard der ikke er set fejle, beskytter ingenting.

## Regel at tage med

**En agent-konfiguration der ikke er i git, er ikke vedligeholdt — den er kun endnu ikke opdaget som forældet.** Når et værktøj udfases, skal dets konfiguration enten slettes eller holdes i git; efterladt-og-ignoreret er den tilstand hvor den rådner usynligt.

Beslægtet: [[feedback_secret_leak_prevention]], hard rule 2 (delt context aldrig lokal-only), #4016 (samme klasse: prosa/lokal state der ikke kan håndhæves).
