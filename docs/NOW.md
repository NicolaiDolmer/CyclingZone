# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT pr. 2/7: [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md)** (tidsfaset plan i dag→2027 + kill-liste på #627).

## Aktiv styring

> **P0 30/6-2/7 ([#2071](https://github.com/NicolaiDolmer/CyclingZone/issues/2071)) LØST:** hotfix PR #2087 merged 2/7, self-healing kørt (13 løb finalized, ~1,43M CZ$ præmier udbetalt, standings genopbygget, monitoring/stall-watchdog tilføjet). Postmortem i `.claude/learnings/2026-07-02-updatestandings-url-limit-p0.md`.
>
> **TdF-vinduet 4/7:** kampagne [#2080](https://github.com/NicolaiDolmer/CyclingZone/issues/2080) FØR første post — attribution [#2079](https://github.com/NicolaiDolmer/CyclingZone/issues/2079) LUKKET 3/7 (alle stier sender nu; 5 ægte prod-rækker + UTM-fangst verificeret). Ejer-klikliste (~30 min, TdF-beredskab): #2076 uptime · #2085 mail-kapacitet · #2092 RAILWAY_TOKEN-trin-1 · #1784 spend-cap · #929 · Alunta-tokens.

> **🎯 Next action:** (1) **#2080 kampagne-drafts før 4/7** (marketing; ejer-godkendt tekst). (2) **#2077 stall-watchdog + ops-kanal** (alarm-hullet fra P0'en; helst før/under TdF-ugen). (3) **#2081-rest** (staged reveal · holdfilter · top-10/"se alle") + luk #2072 efter GT-verify. (4) **Scouting-fane** (#2000-epik rest) + capstone/loft #2100. (5) #2082 trænings-scorecard (harness 5/7, ship 7-9/7; mål ~50% af gap på 5-7 sæsoner). (6) **#1972 backup-drop** ejer-gated på race-uge-stabilitet. (7) **#1996** transfervindue-oprydning: del 1 (kerne — modstrid `getTransferWindowStatus` + admin open/close-endpoints væk; retter latent bug hvor lån/købsopt. blev parkeret-for-evigt) PR åben; del 2 (`seasonTransition`/`squadEnforcement` window-kode) + Deadline Day = opfølgning EFTER TdF (live sæson-cron, rører ikke i vækstuge). **#1995** (etapeløb-udskudt-skifte) næste, bygger på #1996 (genbruger `pending_team_id`, flusher ved løbs-finalisering). Lukket/afklaret 3/7: #2079 (attribution, PR #2144) · #2090 (overlap-guard prod-verificeret) · #2095 om-scopet (ingen direkte PG-forbindelser; kapacitet måles via loadtest #331). Sidefund: mobile-webkit-flaken i core-smoke er rodårsags-LØST 3/7 ([#2145](https://github.com/NicolaiDolmer/CyclingZone/issues/2145), PR #2146 afventer ejer-merge — chunk-reload-nettet kaprede navigationer ved teardown-abort); **landing hydration-fejl LØST 3/7 (PR #2147 — da-klient loggede React #418/#422/#425 mod EN-prerender → hydrér mod EN + skift sprog efter commit; e2e-guard + postmortem)**. **Beslutnings-dag 6/7:** Alunta/CZ Pro + VMan + Discord-migration. Discord-posts kræver ALTID ejer-godkendt tekst.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) afventer godkendelse. Rytterprofil-rework: redesign LIVE 2/7 (#2000, patch note v6.47); rest = Scouting-fane + capstone; design-SSOT `docs/design/design_handoff_rider_profile/`.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 3/7 (session-close); fuld historik i git-log + issue-tråde._
