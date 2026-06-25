# Agent Dispatch Playbook — RETIRED (2026-06-25)

> **Denne doc er udfaset.** Den beskrev en multi-agent dispatch-bus hvor **Manus** omsatte
> korte ejer-kommandoer (`Dispatch #327`, `Prepare #328`) til GitHub-kommentarer/labels og
> koordinerede **Codex**. Med **solo Claude-operation** siden 2026-06-12 (ingen Manus, ingen
> Codex) er der ingen agenter at dispatche til eller koordinere imellem.

Claude picker selv issues fra `claude:todo` (se `AGENTS.md` start-sekvens) og ejer alle
beslutninger. Konflikt-håndtering gælder kun parallelle Claude-sessioner samme PC (worktrees) —
se [`docs/AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md).

Claudes **egen** mobil→PC-dispatch (scheduled-tasks, Claude mobile app Dispatch, RemoteTrigger)
er uberørt og bor i [`docs/DISPATCH_PLAYBOOK.md`](DISPATCH_PLAYBOOK.md).

Historik: `git log --follow docs/AGENT_DISPATCH.md`.
