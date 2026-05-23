# Postmortem: YAML block-literal indent-trap i GitHub Actions workflows

> 2026-05-23, fundet under [#501](https://github.com/NicolaiDolmer/CyclingZone/issues/501) / [PR #594](https://github.com/NicolaiDolmer/CyclingZone/pull/594).

## TL;DR

Multi-line shell-strings inde i YAML `run: |` block-literals kan bryde block-literal-indentation usynligt hvis fortsættelseslinjer er ved column 0. Resultat: GitHub Actions parser workflow som invalid, returnerer ingen synlig fejl, og runs fejler stille med 0s execution-time. `verify-deploy.ps1` reporterer falske failures til evigt.

## Hvad skete

`.github/workflows/sprint-metrics-snapshot.yml` (oprettet 2026-05-18) fejlede 30/30 historiske runs siden oprettelse. Fejl var ikke åbenbar fordi:

- `gh run view <ID>` returnerede generisk "This run likely failed because of a workflow file issue."
- `gh workflow list` viste workflow med `name = "<full path>"` i stedet for korrekt `name`-felt (kun synligt hvis man sammenlignede med andre workflows)
- `gh workflow run sprint-metrics-snapshot.yml` returnerede HTTP 422 "Workflow does not have 'workflow_dispatch' trigger" — trods linje 24 eksplicit havde `workflow_dispatch:`
- 30/30 runs havde `event: push` trods workflow kun trigger på `schedule` + `workflow_dispatch` (phantom-runs er GitHubs signal at workflow er broken)
- 0 schedule-triggered runs siden oprettelse

## Rod-årsag

YAML `|` block-literal kræver at ALLE indholds-linjer er indenteret mindst som blokkens første linje. Eksempel fra sprint-metrics-snapshot.yml lines 92-96:

```yaml
- name: Commit dashboard snapshot
  run: |
          git commit -m "chore(metrics): snapshot $(date)
This is the body, which starts at column 0 by mistake.
And so does this line.
          "
```

YAML-parseren ser de uindenterede linjer som top-level YAML-keys → invalid syntax. GitHub Actions logger ikke parse-fejl visibly; den producerer bare runs med phantom event.

## Hvorfor det forblev usynligt i 5 dage

- 100% failure-rate så ingen "før/efter" diff
- Phantom `event: push` skjulte at workflow aldrig kørte schedule-trigger
- `verify-deploy.ps1`-støj blev habituated som "ah, sprint-metrics fejler bare"
- Andre 21 workflows kørte fint så CI ikke totalt broken

## Lessons

1. **Workflows der fejler 100% siden oprettelse mistænkeliggør parse-bug** — Hvis et workflow ALDRIG har kørt successfully, er det ikke et flaky problem; det er strukturelt broken.

2. **`gh workflow list` med `name == path`-mismatch er rød-flag-signatur** — Når workflow's `name`-felt vises som path-strengen er det fordi parser ikke nåede frem til `name:`-key. Tilføj denne tjek til monitoring/CI.

3. **YAML `run: |` med multi-line shell-strings er en footgun** — Brug `-m` flags til `git commit` ELLER `cat > /tmp/x.md <<EOF` + `--body-file` for at undgå inline multi-line strings i YAML.

4. **`gh run view` har dårlig signal-til-noise** — Generisk "workflow file issue"-fejlmeddelelse er ikke aktionabel. Brug `gh api repos/.../actions/runs/<ID>` for raw payload.

5. **Phantom `event: push` på workflows uden push-trigger = parse-fail** — Hvis workflow kun har `schedule` + `workflow_dispatch` men runs viser `event: push`, er det broken.

## Mitigation (issues oprettet)

- [#596](https://github.com/NicolaiDolmer/CyclingZone/issues/596) — Decision: re-enable med proper fix vs. fjern permanent
- [#597](https://github.com/NicolaiDolmer/CyclingZone/issues/597) — CI YAML-validator (`actionlint`) der fanger denne klasse fremover

## Bonus-finding under Session M

Subagent (Agent C under [#501](https://github.com/NicolaiDolmer/CyclingZone/issues/501)) kunne ikke skrive til workflow-fil pga. Write/Bash-sandbox-denial. Valgt fallback: `git mv` til `.yml.disabled` — eneste skrive-operation der ikke krævede file-content. Pragmatisk, men gør #596 nødvendig som follow-up.
