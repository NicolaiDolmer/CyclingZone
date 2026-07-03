# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT pr. 2/7: [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md)** (tidsfaset plan i dag→2027 + kill-liste på #627).

## Aktiv styring

> **P0 30/6-2/7 ([#2071](https://github.com/NicolaiDolmer/CyclingZone/issues/2071)) LØST:** hotfix PR #2087 merged 2/7, self-healing kørt (13 løb finalized, ~1,43M CZ$ præmier udbetalt, standings genopbygget, monitoring/stall-watchdog tilføjet). Postmortem i `.claude/learnings/2026-07-02-updatestandings-url-limit-p0.md`.
>
> **TdF-vinduet 4/7:** kampagne [#2080](https://github.com/NicolaiDolmer/CyclingZone/issues/2080) FØR første post — attribution [#2079](https://github.com/NicolaiDolmer/CyclingZone/issues/2079) LUKKET 3/7 (alle stier sender nu; 5 ægte prod-rækker + UTM-fangst verificeret). Ejer-klikliste (~30 min, TdF-beredskab): #2076 uptime · #2085 mail-kapacitet · #2092 RAILWAY_TOKEN-trin-1 · #1784 spend-cap · #929 · Alunta-tokens.

> **🎯 Next action:** (1) **#2080 kampagne-drafts før 4/7** (marketing; ejer-godkendt tekst). (2) **#2081-rest** (staged reveal · holdfilter · top-10/"se alle") + luk #2072 efter GT-verify. (3) **Scouting-fane** (#2000-epik rest) + capstone/loft #2100. (4) #2082 trænings-scorecard (harness 5/7, ship 7-9/7). (5) **#1972 backup-drop** ejer-gated på race-uge-stabilitet. **Shipped 3/7 (afventer ejer-merge):** #2077 stall-watchdog (4 tavse-fejl-checks) + ops-kanal-routing + Sentry-cron-heartbeat — **backend-only**; for at aktivere privat ops-kanal: sæt `DISCORD_OPS_WEBHOOK_URL` + `DISCORD_OPS_MENTION` i Infisical+Railway (ellers falder alarmer gracefully tilbage til general). **#2076 = ejer-kliste** (Sentry uptime + Discord-action på alert 559456 + `railway login`). Merged 3/7: #2145/#2146 (webkit-flake), #2147 (landing-hydration). **Spøgelsesløb LØST 3/7:** 192 tomme Division 4-løb (tier 4, managerløs; ikke 16 — verificeret) ryddet via `cleanup-ghost-tier4-races.mjs` (postmortem `.claude/learnings/2026-07-03-ghost-tier4-calendar-cleanup.md`). Div 1-7 urørt; forward-guard (`poolHasCalendar`) på plads i alle auto-stier; strukturel auto-cleanup ved pulje-tømning foreslået i PR-body. Scheduler-latency op til ~103t under post-chronrebuild-catch-up (throughput 20-33/62 pr. dag) — værd at kigge på separat. **Beslutnings-dag 6/7:** Alunta/CZ Pro + VMan + Discord-migration. Discord-posts kræver ALTID ejer-godkendt tekst.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) afventer godkendelse. Rytterprofil-rework: redesign LIVE 2/7 (#2000, patch note v6.47); rest = Scouting-fane + capstone; design-SSOT `docs/design/design_handoff_rider_profile/`.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 3/7 (session-close); fuld historik i git-log + issue-tråde._
