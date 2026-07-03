# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT pr. 2/7: [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md)** (tidsfaset plan i dag→2027 + kill-liste på #627).

## Aktiv styring

> **P0 30/6-2/7 ([#2071](https://github.com/NicolaiDolmer/CyclingZone/issues/2071)) LØST:** hotfix PR #2087 merged 2/7, self-healing kørt (13 løb finalized, ~1,43M CZ$ præmier udbetalt, standings genopbygget, monitoring/stall-watchdog tilføjet). Postmortem i `.claude/learnings/2026-07-02-updatestandings-url-limit-p0.md`.
>
> **TdF-vinduet 4/7:** kampagne [#2080](https://github.com/NicolaiDolmer/CyclingZone/issues/2080) FØR første post — attribution [#2079](https://github.com/NicolaiDolmer/CyclingZone/issues/2079) LUKKET 3/7 (alle stier sender nu; 5 ægte prod-rækker + UTM-fangst verificeret). Ejer-klikliste (~30 min, TdF-beredskab): #2076 uptime · #2085 mail-kapacitet · #2092 RAILWAY_TOKEN-trin-1 · #1784 spend-cap · #929 · Alunta-tokens.

> **🎯 Next action:** (1) **#2080 kampagne-drafts før 4/7** (marketing; ejer-godkendt tekst). (2) **Ejer-clicks før TdF (~15 min):** **#2154** (opret #ops-webhook + sæt `DISCORD_OPS_WEBHOOK_URL`/`DISCORD_OPS_MENTION` i Railway — aktiverer #2077 ops-kanal → sig til, så verificerer Claude end-to-end) + **#2076** (Sentry uptime-monitor + Discord-action på alarm-regel 559456). (3) **#2158** `race_result`-notifikation død i prod — én-linje-constraint-migration + forward-guard-test (ejer-merger). (4) **#2081-rest** (staged reveal · holdfilter · top-10) + luk #2072 efter GT-verify. (5) **Scouting-fane** (#2000-rest) + capstone/loft #2100. (6) #2082 trænings-scorecard (harness 5/7). (7) **#1972 backup-drop** ejer-gated. **Shipped+merged 3/7:** #2077 stall-watchdog + ops-routing + Sentry-heartbeat (PR #2148); **Discord DM per-type-prefs (PR #2157)** — spillere vælger events pr. Discord-DM, ny `users.discord_dm_prefs`-migration, watchlist+bestyrelse nye DM-strømme (patch note v6.51). **Spøgelsesløb LØST** ([#2149](https://github.com/NicolaiDolmer/CyclingZone/issues/2149), PR #2155): 192 tomme Division 4-løb ryddet, forward-guard på plads; åbent i #2149: scheduler-latency ~103t under catch-up. **Beslutnings-dag 6/7:** Alunta/CZ Pro + VMan + Discord-migration. Discord-posts kræver ALTID ejer-godkendt tekst.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) afventer godkendelse. Rytterprofil-rework: redesign LIVE 2/7 (#2000, patch note v6.47); rest = Scouting-fane + capstone; design-SSOT `docs/design/design_handoff_rider_profile/`.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 3/7 (session-close); fuld historik i git-log + issue-tråde._
