# Agent Dispatch Playbook

_Formål: reducér brugerens rolle fra copy-paste-led til kort beslutning. GitHub issues er koordineringsbussen; repo-dokumenter er varig viden; chat er kun til beslutninger og afklaringer._

---

## Princip

Manus, Claude og Codex skal koordinere via **GitHub issues, labels, issue-comments, PRs og `docs/NOW.md`**. Brugeren skal ikke flytte lange prompts mellem værktøjer.

> **Ny standard:** Brugeren skriver korte kommandoer som `Dispatch #327`, `Prepare #328`, `Mark #337 blocked`, eller `Review agent queue`. Manus omsætter beslutningen til GitHub-kommentarer, labels og repo-docs.

---

## Roller

| Label | Rolle | Primær opgave |
|---|---|---|
| `agent:manus` | Manus | Arkitektur, ADR, prioritering, handoff, risikoafgrænsning og koordinering. |
| `agent:claude` | Claude | Implementering via GitHub Action, PR, tests, close-out-filer og issue-status. |
| `agent:codex` | Codex | Lokal verificering, docs-only cleanup, diff review, testkommandoer og små sikre ændringer. |
| `manual:user` | Nicolai | Dashboard-login, secrets, betalinger, manuelle prod-valg og beslutninger som kræver menneske. |

Der må gerne være flere agent-labels på samme issue, men der skal altid være én tydelig **Next agent action** i nyeste handoff-kommentar.

---

## Dispatch-labels

| Label | Betydning |
|---|---|
| `needs-dispatch` | Issuet er klargjort, men endnu ikke sendt til en agent. |
| `needs-decision` | Manus eller bruger skal træffe valg før build. |
| `manual-review` | Må ikke auto-merges uden menneskelig review. |
| `claude:todo` | Klar til Claude pick-up eller GitHub Action trigger. |
| `claude:blocked` | Claude er stoppet korrekt og venter på input. |
| `claude:done` | PR merged, afventer brugerens verifikation. **Valgfri** — bruger kan også lukke direkte fra `claude:todo`/`claude:in-progress`. Begge mønstre er gyldige (faktisk fordeling ~60/40 til fordel for `claude:done`). |

---

## Handoff-kommentar

Når Manus forbereder et issue, skal der bruges dette format eller en kortere variant med samme felter:

```md
## Agent handoff

**Decision owner:** Manus / Nicolai
**Next agent:** Claude / Codex / Manus / Manual
**Current state:** ready / blocked / in progress / done
**Scope:** Én klart afgrænset slice.
**Do not touch:** Explicitte no-go områder, fx `#242`, DB schema, secrets, UI.
**Verification:** Konkrete kommandoer, workflows eller runtime-checks.
**Codex verification:** Hvis Codex er next agent: konkrete command/browser/connector-checks før close-out.
**Ship policy:** PR only / auto-merge if green / manual review required.
**Blockers:** Ingen / liste over beslutninger.
```

Hvis Claude skal starte via GitHub Action, poster Manus derefter en separat dispatch-kommentar med `@claude` og et kort scope. Lange prompts skal undgås; Claude skal læse issue body, handoff-kommentarer og repo-instruktioner.

---

## Brugerkommandoer

| Bruger skriver | Manus gør |
|---|---|
| `Review agent queue` | Læser åbne issues/labels og anbefaler næste 1-3 handlinger. |
| `Prepare #327` | Skriver handoff-kommentar og labels, men trigger ikke agent. |
| `Dispatch #327` | Poster dispatch-kommentar til den relevante agent. For Claude betyder det `@claude`. |
| `Dispatch #335 and ship` | Kun for lavrisiko-issues: trigger Claude med ship-keyword/auto-merge-policy. |
| `Block #328 pending #327` | Sætter blocker-comment og labels, så ingen agent starter for tidligt. |
| `Close dispatch slice` | Opdaterer docs/status og foreslår commit/issue-close for workflow-ændringer. |

---

## Sikkerhedsregler

| Ændringstype | Default ship-policy |
|---|---|
| Docs-only, lav risiko | Kan auto-merge hvis CI grøn, hvis brugeren udtrykkeligt siger `ship`. |
| Små audit-whitelists eller test-fixes | PR først; auto-merge kun ved lav risiko og klart scope. |
| Secrets, auth, RLS, DB migration, rate limiting, økonomi | `manual-review` og ingen auto-merge uden brugerbeslutning. |
| Arkitektur/ADR | Manus skriver beslutning; Claude/Codex implementerer ikke før ADR er accepteret. |

Manus må ikke trigge en agent på risky issues uden kort brugerbekræftelse. Hvis scope er uklart, skal issuet markeres `needs-decision` eller `claude:blocked` i stedet for at gætte.

---

## Claude-trigger

Repoets Claude Action reagerer på issue-kommentarer med `@claude`. Derfor kan Manus dispatch'e Claude ved at poste en GitHub-kommentar som denne:

```md
@claude take this issue.

Follow the latest **Agent handoff** comment. Keep strict scope discipline.
Ship policy: PR only unless this comment explicitly says `ship` / `auto-merge`.
```

Claude skal derefter oprette branch, commit, PR og close-out efter eksisterende `docs/GITHUB_WORKFLOW.md` og `AGENTS.md`.

---

## Codex-håndtering

Der er ikke dokumenteret en tilsvarende GitHub Action trigger for Codex i repoet. Codex skal derfor indtil videre arbejde ud fra issue body, handoff-kommentarer og docs, men startes manuelt/lokalt.

Codex-instruktioner skal stadig skrives i GitHub issue, ikke sendes som lang chatbesked via brugeren. Brugeren skal højst sige: `Codex: tag #326 og følg handoff`.

### Codex-labels

Brug disse labels når Codex er bedste næste agent:

| Label | Betydning |
|---|---|
| `agent:codex` | Codex ejer næste lokale handling/verifikation. |
| `codex:good-first` | Lille lavrisiko-slice der er god til Codex. |
| `codex:needs-browser` | Kræver Browser-verifikation. |
| `codex:needs-supabase` | Kræver DB/schema/runtime-verifikation. |
| `codex:needs-prod-verify` | Kræver preview/prod-verifikation efter deploy. |
| `codex:blocked-access` | Blokeret af manglende connector, token, login eller manuel handling. |

Se også [`docs/CODEX_WORKFLOWS.md`](CODEX_WORKFLOWS.md).

---

## Close-out for dispatch-arbejde

Når en dispatch-/workflow-slice ændrer dokumentation eller labels, skal close-out være:

1. `docs/AGENT_DISPATCH.md` og eventuelt `docs/GITHUB_WORKFLOW.md` opdateret.
2. Labels oprettet eller verificeret i GitHub.
3. `docs/NOW.md` opdateret kort, hvis næste session-prioritet ændres.
4. Patch notes springes over for docs-only workflow-ændringer uden brugerrettet runtime/UI, men begrundelsen skal nævnes i commit eller issue-comment.
5. Commit + push til `main` efter projektets normale disciplin.

---

_Sidst opdateret: 2026-05-12 — Manus dispatcher-model indført for at fjerne copy-paste mellem agenter._
