# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT pr. 2/7: [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md)** (tidsfaset plan i dag→2027 + kill-liste på #627).

## Aktiv styring

> **P0 30/6-2/7 ([#2071](https://github.com/NicolaiDolmer/CyclingZone/issues/2071)) LØST:** hotfix PR #2087 merged 2/7, self-healing kørt (13 løb finalized, ~1,43M CZ$ præmier udbetalt, standings genopbygget, monitoring/stall-watchdog tilføjet). Postmortem i `.claude/learnings/2026-07-02-updatestandings-url-limit-p0.md`.
>
> **TdF-vinduet 4/7:** kampagne [#2080](https://github.com/NicolaiDolmer/CyclingZone/issues/2080) draftet 4/7 (3 post-drafts + creator-liste + UTM + 7-dages kalender) — **gennemgås med ejer 5/7, intet postet**; draft gemt som issue-kommentar. Attribution [#2079](https://github.com/NicolaiDolmer/CyclingZone/issues/2079) LUKKET 3/7. Ejer-klikliste (~30 min, TdF-beredskab): #2076 uptime (kun backend /health rest) · #2085 mail-kapacitet · #1784 spend-cap · #929 · Alunta-tokens.

> **🎯 Next action:** **(0) PR #2202 venter på din review/merge** — #2082/#1938 akademi-trænings-rekalibrering (sæson-budget-cap + aftagende rate 0.16→0.11→0.08 + hård +1/dag-cap; indeholder migration, derfor ikke selv-merget). (1) #2080 TdF-kampagne → gennemgås med ejer 5/7 (draft klar, intet postet). (2) **#2076-rest:** backend `/health`-uptime-monitor. (3) **#2170** Monuments binding-fri — ejer-beslutning. (4) Discord-feature-backlog #2176–#2183 + FAQ #2184. (5) **#2196** rangliste-perf del 2. (6) **#1996 del 2** + Deadline Day EFTER TdF. (7) **#2000-rest** scouting-fane + capstone/loft #2100. (8) **#1972 backup-drop** ejer-gated. **Shipped 4/7 (Discord-bug-triage, parallel-worktrees):** **#2171** (v6.58) PCM/IRL-datoer fjernet fra 6 løbs-flader (game-day-countdown i stedet); **#2173** (PR #2197, v6.59) tavst holdudtagelse-save-tab rettet — saveAll fortsætter gennem alle løb + tydelig fejl, atomisk `replace_race_selection`-RPC (migration prod-verificeret live); **#2174** (PR #2199, v6.60) i18n danske lækager på indbakke/økonomi/bestyrelse → i18n-koder + CI-leak-guard. Tidligere 4/7: #2158 (v6.54)+#1464-guard; #2167 (v6.55) autofill-binding; #2186/#2189 Sentry/discord; #2175 (v6.57) rangliste-perf matviews (Del 2→#2196). Åbne: #2187, #2188. **Beslutnings-dag 6/7:** Alunta/CZ Pro + VMan + Discord-migration. Discord-posts kræver ALTID ejer-godkendt tekst.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) afventer godkendelse. Rytterprofil-rework: redesign LIVE 2/7 (#2000, patch note v6.47); rest = Scouting-fane + capstone; design-SSOT `docs/design/design_handoff_rider_profile/`.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 3/7 (session-close); fuld historik i git-log + issue-tråde._
