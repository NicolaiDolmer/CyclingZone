# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md); [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145). Fire motorer: løb, træning, ungdom, transfer/auktion. **Plan-SSOT pr. 2/7: [docs/audits/2026-07-02-ejer-dashboard.md](audits/2026-07-02-ejer-dashboard.md)** (tidsfaset plan i dag→2027 + kill-liste på #627).

## Aktiv styring

> **🔴 P0-incident 30/6-2/7 ([#2071](https://github.com/NicolaiDolmer/CyclingZone/issues/2071)):** div 4-aktivering (263→455 løb) fik `updateStandings`' `.in(alle-ids)` til at fejle på hvert etape-run → rangliste frosset, 13 løb ufinaliserede, 1,43M CZ$ præmier tilbageholdt, 0 resultater siden 1/7 17:04Z. Rod-årsag reproduceret; **hotfix-PR [#2087](https://github.com/NicolaiDolmer/CyclingZone/pull/2087) (backend-only, 2498/2498 tests) AFVENTER EJER-MERGE** — derefter self-healing (recovery + auto-prize + standings). Post-merge-verify: 13 løb completed + prize_paid_at sat + standings-stamp frisk + incident-besked til spillere + patch note. Postmortem: `.claude/learnings/2026-07-02-updatestandings-url-limit-p0.md`. Separat GC-arkitektur-bug [#2072](https://github.com/NicolaiDolmer/CyclingZone/issues/2072) SKAL fixes før GT 14/7 (sammen med [#2081](https://github.com/NicolaiDolmer/CyclingZone/issues/2081) GC-undervejs).
>
> **Shipped 2/7:** PR #2069 (signup: resend + auto-hold efter confirm) + **PR #1909 CZ Pro Slice 1 (billing-rails — go-live gated på ejerens Alunta-plan/tokens, jf. #1903)**. Strategi-session: fuld backlog-audit (339 issues, 38 agenter, 12 prod-prober) → 16 nye issues #2070-#2086, 10 verificerede closes, 5 label-fixes; Discord-sweep filet.
>
> **TdF-vinduet åbner 4/7:** kampagne-pakke [#2080](https://github.com/NicolaiDolmer/CyclingZone/issues/2080) + attribution-fix [#2079](https://github.com/NicolaiDolmer/CyclingZone/issues/2079) (UTM har været 100 % død siden 15/6) FØR første post. Ejer-kvarter: #2076 uptime · #2085 mail-kapacitet · #1784 spend-cap · #929 · `railway login` · Alunta-tokens. Div 3 = 22/24 i alle puljer → [#2075](https://github.com/NicolaiDolmer/CyclingZone/issues/2075) div 4-beredskab haster.

> **🎯 Next action:** (1) **GC-fix #2072+#2081 SHIPPET i denne PR** (akkumulering fra persisterede etaperækker + fulde klassementer pr. mellem-etape + løbende stilling på løbssiden; backend-only, ingen migration; scorecard: alle 6 afsluttede etapeløb havde GC-modstrid — allerede publicerede resultater lades stå). **Post-merge-verify 3/7 ~18:05:** Volta Algarvia etape 4 → løbende stilling synlig på løbssiden + `gcAccumulationScorecard.js --name=Algarvia` efter finalen 4/7 skal vise 0 modstrid. (2) **#2000 rytterside-faner (PR #2037) færdige senest 3/7.** (3) #2080 kampagne-drafts + #2079 attribution før 4/7. (4) Ejer-klikliste sammen med Claude "senere i dag 2/7": #2076 uptime · #2085 mail-kapacitet · #1784 spend-cap · #929 · #2092 RAILWAY_TOKEN. Verify i aften: 18:00-slottet kører KUN due etaper (#2090 lukkes derefter). Shipped 2/7: P0 #2071 (1,69M udbetalt, rangliste frisk) · overlap-guard #2091 · patch note v6.41 + godkendt Discord-notat postet · CZ Pro-rails #1909. Beslutnings-dag 6/7: Alunta/CZ Pro + VMan + Discord-migration + trænings-scorecard (#2082: harness 5/7, ship 7-9/7; **ejer-mål: ~50 % af gap på 5-7 sæsoner, peak 27-28**). Marketing: ~10k DKK juli, 2026 maks 50k (Meta/Reddit/Google) — først når #2079 måler. Kill-liste eksekveret (−53; #671+#680 undtaget). Discord-posts kræver ALTID ejer-godkendt tekst.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. Op/nedrykning: forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) afventer godkendelse. Rytterprofil-rework: åbne slices på draft-PR #2037 (Udvikling/Resultater/Historik/Interesse) + capstone afventer ejer-wireframe; design-SSOT `docs/design/design_handoff_rider_profile/`.
- **Sikkerhed:** #691 key-rotation · #929 leaked-password — åbne. **Skalering:** #323 post-monetisering; perf #1375.

_Trimmet 2/7 (strategi-session); fuld historik i git-log + issue-tråde._
