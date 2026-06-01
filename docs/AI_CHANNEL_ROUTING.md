# AI_CHANNEL_ROUTING.md — kanal-til-task-matrix

> **Læs hvornår:** Når du står med en opgave og er i tvivl om hvilken AI-kanal du skal bruge. Ellers skipper du den.
> **Kilde:** Klassificering fra workflow-analyse 2026-05-22 (`docs/archive/2026-05-22-workflow-analyse.md`, sektion 3-4). Tracker: [#556](https://github.com/NicolaiDolmer/CyclingZone/issues/556).
> **Sidst opdateret:** 2026-05-22.

## Hvorfor docen findes

Du har 6 AI-kanaler i daglig drift (Claude Code PC1, Claude Code PC2, Claude chat PC, Claude chat mobil, Cowork, Dispatch). Kanal-valg sker implicit hver gang — og det er det største enkelte hul i AI-workflowet per analyse i [#555](https://github.com/NicolaiDolmer/CyclingZone/issues/555). Denne doc gør valget eksplicit: hvilken kanal er optimal til hvilken task, og hvilke aldrig bør bruges.

## Kanal-inventory (kort)

| Kanal | God til | Dårlig til |
|---|---|---|
| **Claude Code (PC1/PC2)** | Multi-fil edits, git/npm/tests/builds, hooks, plan mode | Strategi-samtaler, lange research-tasks, visuel review |
| **Claude chat (PC)** | Project Knowledge søgning, strategi/prioritering, web search, issue-grooming, generere Claude Code-prompts | Direkte fil-edits, lange agentiske workflows |
| **Claude chat (mobil)** | Læse status, godkende plans, mini-beslutninger, dispatch-trigger | Lange kodeblokke, multi-fil context, komplekse prompts |
| **Claude Cowork** | Lokale filsystem-tasks der IKKE er kode (Excel, screenshots, doc-formatering) | Kode-implementation, tasks der kræver løbende beslutning |
| **Dispatch (mobil→PC)** | Asynkrone fetches/audits uden beslutninger | Beslutninger undervejs, high-blast-radius (deploy, migrations, sletninger) |

> Cowork-note: "research preview" per Anthropic — vent med kritiske workflows til det er stable.

## Use-case → kanal matrix

| Use case | Optimal kanal | Alternative | Aldrig brug |
|---|---|---|---|
| Læs `NOW.md` status | Mobil-chat | PC-chat | Cowork (overkill) |
| Tag beslutning om next slice | PC-chat | Mobil-chat | Claude Code |
| Skriv Claude Code-prompt | PC-chat | Mobil-chat | Claude Code |
| Implementer feature (multi-fil) | Claude Code PC1/PC2 | — | Chat, Cowork |
| Bugfix (1 fil) | Claude Code | PC-chat (kun planning) | Mobil |
| Investigation / kode-audit | Claude Code (plan mode) | PC-chat (read-only) | Mobil, Cowork |
| Update `PatchNotesPage.jsx` | Cowork (draft) + Claude Code (commit) | Claude Code direkte | Mobil |
| Excel race-results import | Cowork (lokalt) + Claude Code (DB) | Claude Code direkte (manuel kopi) | Chat, Mobil |
| Audit memory drift ([#78](https://github.com/NicolaiDolmer/CyclingZone/issues/78)) | Dispatch (asynk) | PC-chat manuel | Mobil direkte |
| Review PR | PC-chat | Mobil-chat (skim) | Claude Code |
| Tjek deploy-status efter push | Mobil-chat (Vercel MCP) | PC-chat | Claude Code (overkill) |
| Lokal Codex-verifikation af issue/PR | Codex | Claude Code | Mobil |
| Browser-smoke af lokal frontend | Codex + Browser | Claude Code | Mobil |
| Vercel/Supabase/Sentry connector-check | Codex | PC-chat | Mobil hvis beslutning kræver context |
| Generér postmortem efter incident | PC-chat (kontekst-tung) | Claude Code (læser logs) | Mobil, Cowork |
| Strategisk overvejelse (fx fuld-tid) | PC-chat (lang dialog) | Mobil-chat (tænk-arbejde) | Claude Code |
| Doc-konsolidering (fx 3 epics → 1) | PC-chat (planning) + Claude Code (commits) | Claude Code direkte | Mobil |
| Tjek "hvor var jeg?" efter pause | Mobil-chat (`NOW.md`-læsning) | Claude Code SessionStart-hook | — |
| Brand/marketing-tekst | PC-chat | Cowork (hvis lokale filer) | Claude Code |

**Vigtigste indsigt:** De fleste tasks involverer 2 kanaler, ikke 1. `PC-chat planlægger → Claude Code implementerer` er det mest almindelige mønster. Det er ikke ineffektivt — det er det rigtige.

## Anti-patterns ("aldrig brug X til Y")

Aldrig-kolonnen i matrixen er ikke konvention — det er konkrete fejl-modes vi har set:

| Forbudt kombination | Hvorfor |
|---|---|
| **Claude Code som første kontakt med ny feature** | Optimerer mod kodebase-fokus → savner bredt overblik. Plan i chat først, implementér i Code. |
| **Mobil til multi-fil context** | Skærmen er for lille, typing-friction for høj, læsbarhed på kodeblokke dårlig. Brug mobil til tænk-arbejde, ikke implementation. |
| **Cowork til kode-implementation i kodebasen** | Det er Claude Codes domæne. Cowork er til ikke-kode lokale filer. |
| **Chat til direkte fil-edits i kodebasen** | Container-filsystem ≠ dit faktiske setup. Brug chat til at generere prompts/diffs som Code udfører. |
| **Dispatch til high-blast-radius tasks** | Deploy, migrations, sletninger må ikke køre uden din løbende verifikation. Dispatch er til low-risk asynk. |
| **Claude Code til review af eksisterende PR** | Du ender med implementation-fokus. Chat er bedre til at læse + score + give feedback. |
| **Chat til lange agentiske workflows** | Cowork gør det bedre med filsystem-adgang. |
| **Mobil til komplekse prompts** | Typing-friction → genererer halvfærdige instruktioner. Skriv på PC, copy-paste til mobil hvis dispatch. |

## Når du er i tvivl

1. **Er det implementation i kodebasen?** → Claude Code.
2. **Er det beslutning, strategi, eller "skal vi gøre X eller Y?"** → PC-chat.
3. **Er du væk fra PC'en og det haster ikke?** → Mobil-chat eller Dispatch (afhængig af om det skal udføres eller bare gennemtænkes).
4. **Er det lokale filer der IKKE er kode?** → Cowork.
5. **Er der overlap?** → Det er normalt. Vælg første kanal efter listen ovenfor; den næste kanal kommer naturligt.

## Cross-refs

- Workflow-analyse (kilde): [`docs/archive/2026-05-22-workflow-analyse.md`](archive/2026-05-22-workflow-analyse.md), sektion 3-4.
- Agent-rolle-matrix (hvem ejer hvilken beslutning + SLA + reassign-protokol): [`docs/AI_COUNCIL.md`](AI_COUNCIL.md) (B12, [#564](https://github.com/NicolaiDolmer/CyclingZone/issues/564)).
- Mobile → Claude Code task-format (5-linje template + eksempler): [`docs/prompts/mobile-to-code.md`](prompts/mobile-to-code.md) (B8, [#562](https://github.com/NicolaiDolmer/CyclingZone/issues/562)).
- Session-prompt templates (når Claude Code modtager en task):
  - Bugfix: [`docs/prompts/bugfix.md`](prompts/bugfix.md) (5-fase flow med gates) — B7, [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561).
  - Investigation: [`docs/prompts/investigation.md`](prompts/investigation.md) (hypothesis-tracking, evidence-first) — B7, [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561).
  - Postmortem: [`docs/prompts/postmortem.md`](prompts/postmortem.md) (struktur for `.claude/learnings/`) — B7, [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561).
  - Ultrareview economy/finalization: [`docs/prompts/ultrareview-economy.md`](prompts/ultrareview-economy.md).
- Dispatch-konkret playbook (safe/forbidden tasks + verification on return): [`docs/DISPATCH_PLAYBOOK.md`](DISPATCH_PLAYBOOK.md) (B2, [#557](https://github.com/NicolaiDolmer/CyclingZone/issues/557)).
- Cowork-konkret playbook: planned senere ([fase C i analyse-doc, B3]).
- Tracker: [#555](https://github.com/NicolaiDolmer/CyclingZone/issues/555) (workflow-analyse epic) → [#556](https://github.com/NicolaiDolmer/CyclingZone/issues/556) (denne doc).
