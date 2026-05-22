# Mobile → Claude Code task-templating

> Standard-format når du står på mobilen og vil sende en konkret implementations-task videre til Claude Code på PC. Designet 2026-05-22 per [#562](https://github.com/NicolaiDolmer/CyclingZone/issues/562) (B8). Opdatér hvis felterne i praksis viser sig at savne kontekst eller indeholde fluff.

## Hvorfor formatet eksisterer

Friction-mønstret: bruger planlægger på mobil (chat eller dispatch), Claude Code skal eksekvere på PC — men "tænke-arbejdet" lander typisk som prosa der mangler de 3-4 ting Claude Code behøver for at gå i gang uden første-runde af "hvad mente du her?". Resultatet er enten en spildt opklarings-runde eller en implementation der rammer ved siden af.

Fem linjer er nok. Færre felter sparer typing på mobilen; flere felter er fluff.

## Formatet

```
Mål: <1 sætning — hvad skal opnås, ikke hvordan>
Filer: <kommasepareret liste eller "find selv" hvis ukendt>
Acceptance: <hvad skal være sandt før session lukkes>
Refs: <#issue, #PR, doc-path, learnings-path, screenshot-link>
Blockers: <hvad mangler/uafklaret, eller "ingen">
```

**Felt-regler:**

- **Mål** beskriver outcome, ikke implementation. "Fix sponsor-modal duplicate i18n-key" — ikke "ændr `sponsor.json` linje 42".
- **Filer** må være vagt hvis du ikke ved det. `find selv` er en gyldig værdi og signalerer at investigation er del af opgaven.
- **Acceptance** er et eksplicit færdighedskriterium, ikke "det virker". Eksempler: "begge sprog har én entry pr. key", "Playwright core-smoke passerer", "postmortem committed til `.claude/learnings/`".
- **Refs** er ALT der hjælper Claude Code med at finde kontekst hurtigt. Issue-numre er stærkeste signal (linker til labels, comments, related work).
- **Blockers** = bevidste uafklarede ting. Tving dig selv til at skrive "ingen" hvis intet er uafklaret — det er en eksplicit grøn-light.

## Eksempler

### Eksempel 1 — bugfix (smalt scope)

```
Mål: Fix duplicate "sponsor.confirm" i18n-key i da/en bundles.
Filer: frontend/src/i18n/locales/{da,en}/sponsor.json
Acceptance: Én entry pr. key i begge filer; npm run build clean.
Refs: #XXX (rapporteret af bruger via screenshot på mobil-chat).
Blockers: ingen.
```

### Eksempel 2 — docs-only (denne session selv som meta-eksempel)

```
Mål: Tilføj mobile→Claude-Code prompt-template til docs/prompts/.
Filer: docs/prompts/mobile-to-code.md (ny), docs/AI_CHANNEL_ROUTING.md (cross-ref).
Acceptance: Acceptance criteria på #562 alle ✅; docs-only label sat.
Refs: #562 (denne task), #555 (workflow-analyse tracker), #561 (B7 udvider biblioteket bagefter).
Blockers: ingen.
```

### Eksempel 3 — investigation med ekstern blocker

```
Mål: Find rod-årsag til at backend cron skipper finalization søndag aften.
Filer: find selv (start ved backend/cron.js + backend/lib/auctionFinalization.js).
Acceptance: Postmortem i .claude/learnings/<dato>-<slug>.md med rod-årsag + forward-guard; fix-plan kommenteret på issue.
Refs: #XXX (incident-rapport), docs/GAME_INVARIANTS.md (finalization-paths).
Blockers: Railway-logs fra sidste søndag mangler — bruger henter manuelt før session kan starte.
```

## Anti-patterns

- **Prosa-format ("hej, kan du fixe sponsor-modal-bugen vi snakkede om i går?")** — Claude Code har ikke konteksten "vi snakkede om". Skriv det ud.
- **Implementation i "Mål"-feltet** — Claude Code skal vælge HVORDAN; du fortæller HVAD og HVORFOR.
- **"Acceptance: det virker"** — ikke et kriterium. Definér hvad "virker" betyder konkret.
- **Tomt Blockers-felt** — udelad ikke feltet. Skriv eksplicit "ingen". Det er forskellen på "jeg har tænkt mig færdig" og "jeg glemte at skrive om der var blockers".

## Sådan bruges fra mobilen

1. Åbn mobil-chat (Claude eller Dispatch).
2. Copy-paste skabelonen ovenfor; udfyld de 5 linjer.
3. Send som første message i en ny PC-side session, eller paste i dispatch-prompt.
4. Claude Code starter med konteksten og kan gå direkte i gang uden opklarings-runde.

For tasks der kræver investigation FØR du ved hvad du vil implementere, brug i stedet PC-chat til at lave en plan og generér derefter en `mobile-to-code`-formet task fra plan-outputtet.

## Cross-refs

- Kanal-til-task matrix: [`docs/AI_CHANNEL_ROUTING.md`](../AI_CHANNEL_ROUTING.md) (B1, [#556](https://github.com/NicolaiDolmer/CyclingZone/issues/556)).
- Prompt-bibliotek udvidelse: [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561) (B7, planlagte yderligere templates).
- Dispatch-konkret playbook: [#557](https://github.com/NicolaiDolmer/CyclingZone/issues/557) (B2).
- Workflow-analyse (kilde): [`docs/archive/2026-05-22-workflow-analyse.md`](../archive/2026-05-22-workflow-analyse.md), sektion 5B + 10.
- Tracker: [#555](https://github.com/NicolaiDolmer/CyclingZone/issues/555).
