# Codex Workflows — RETIRED (2026-06-25)

> **Denne doc er udfaset.** Cycling Zone er en **solo Claude-operation** siden 2026-06-12:
> ingen OpenAI/Codex. Codex var "the local operator" (hurtig repo-inspektion, små edits,
> issue-hygiejne via `npm run codex:doctor`) — den rolle findes ikke længere.

Der er ingen Codex-cold-start, `codex:doctor`-rutine eller Codex-specifik session-disciplin
at følge. Claude bruger sine egne cold-start-checks (`AGENTS.md` start-sekvens +
`scripts/verify-local.ps1`).

Den fulde historiske Codex-workflow ligger i git-historikken:
`git log --follow docs/CODEX_WORKFLOWS.md`.

> **NB:** Et evt. `codex:doctor`-npm-script i `package.json` er ikke fjernet af denne gravsten —
> ryd op separat hvis det stadig findes og ikke bruges.
