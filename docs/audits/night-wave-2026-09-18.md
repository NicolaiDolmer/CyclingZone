# Dagbølge 2026-09-18 (to dele: 08:15-11:45 og 14:30-ca. 20:00)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 08:15 → 11:45 (afbrudt, ejeren slukkede PC'en) · genoptaget 14:30 → ca. 20:00 |
| Bølger (wave.js) | Formiddag: 1 · eftermiddag: 5 spor/4 laner (run `wf_e140bcb1-1f1`, 17 agenter, 0 frys) + 2 spor/2 laner (run `wf_a399bd7a-bad`) |
| PR'er merget | 20 (8 formiddag + 12 eftermiddag), alle via `scripts/merge-queue.ps1`, én ad gangen |
| Issues → claude:done | Formiddag: #5359 #4521 #2671 #4981 #5201 #5222 #5091 #5092 #5328 #5329 #5283 · eftermiddag: #4582 #5055 #5257 #5259 #5093 |
| Nye issues | #5376 (U23-fødselsbånd, blokerer U23-generering) · #5382-#5391 (10 stk. fra Discord-gennemgangen, dublet-søgt, anonymiseret) |
| Ejer-kort | 4 ved genoptagelsen (#5371 merge · #5093 CI-guard · U23-bånd → #5376 · fair-play → session 19/9) + 4 merge-go (#5378 #5374 #5373 #5380) |
| Recoveries | 0 frys. 2 frys-prober ved 120 min (begge "lever, forlæng") |
| Preflight | GO kl. 14:40 (`.codex.local/night-wave-preflight.json`), keep-awake PID 8420 |

## Merget eftermiddag (squash)

| PR | Indhold | SHA |
|---|---|---|
| #5366 | Read-only rapporter uge 38 (fair-play anonymiseret) | 57bc38928 |
| #5371 | Event-katalog-guard i required CI (anden sessions PR, ejer-go) | 281b39a6c |
| #5377 | Patch note v7.287 | a34f5248b |
| #5378 | #4582 flyt-til-akademi-dialogen siger at kontrakten følger med | 9a1ba41c4 |
| #5372 | #5242 apiFetch skive A (61 kaldsteder) | 0461b845b |
| #5370 | #5055 #5177 posthog-js-lite + flag-ikoner ud af CSS | ecbe6de0e |
| #5374 | #5257 fanen "Alle handler" | 48e5401cf |
| #5373 | #5259 beta-adgang (3 migrationer, post-verificeret mod prod) | c84dbd937 |
| #5358 #5354 #5355 | Dependabot: GHA, rod, backend (minor/patch) | 2cd9b2d48 (sidste) |
| #5380 | #4981 autobud-beskeder samles pr. auktion | 7df3fd05f |
| #5392 | Patch note v7.288 + Discord-udsnit | 8f0b085f0 |
| #5381 | #5093 NOW.md-vagt i required CI | ed1d5b570 |

## Afvigelser/læringer

- **Hændelse (formiddag):** to workers lagde balance-tal og holdnavne i det offentlige repo; fanget før merge. Orkestratorens brief bad selv om det. Postmortem `.claude/learnings/2026-09-18-wave-briefs-og-hard-rule-17.md`; offentligheds-reglen er nu en fast linje i `make-wave-brief.mjs` (test låser den). Indholdet ligger stadig i PR #5368/#5366's commit-historik (refs/pull); kun GitHub Support kan fjerne det.
- **To store UI-spor tog 2,5 time hver** (#5373, #5374). Årsager: begge startede fra næsten nul, begge havde to røde CI-runder på statiske guards der ikke var kørt lokalt (TIER TARGETED), og begge fik BLOKERENDE review på manglende skærmbilleder i PR-body. #5374 brød også hard rule 31 (nye filer i .jsx). **Læring til briefs:** skærmbilleder tages med vite direkte i worktreet + Playwright (virker, bevist af ret-trinnet på #5373), og nye frontend-filer er .ts/.tsx; begge dele skal stå i scopeText.
- **Frontend-test importerede backend-kode** (#5378): grøn lokalt, rød i CI, fordi `@sentry/node` ikke installeres i frontend-build-jobbet. Adfærdstests flyttet til backend.
- **`gh pr checks --watch` i baggrunden dræbes af bølgens cleanup-fase.** Brug en poll-løkke uden `--watch` når en bølge er ved at slutte.
- **Orkestrator-fejl (ejer-feedback):** for lange kort og statusbeskeder, "formentlig" uden verifikation, en forkert issue-kommentar der måtte rettes, egen kode-rettelse i en worker-PR, forsøg på ekstra bølge mens en kørte (blokeret af guarden, som den skal). Memory-reglen om korte enkeltvise kort er strammet.
- **Discord-gennemgang:** MCP-værktøjet kan ikke liste tråde i forum-kanalerne #bugs og #feedback-and-ideas. Det er dér spillerne rapporterer fejl. Hullet er åbent.
- **Ikke verificeret:** PostHog-ingestion efter SDK-skiftet (#5055), handelslisten klikket igennem af en indlogget spiller, et flag i stadie beta set af en beta-tester. Alle tre er ejer-tjek.
