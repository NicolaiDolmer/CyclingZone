# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

> **🟢 Seneste close-outs** (detaljer i git + issue-tråde; ældre trimmet jf. #1275): **14/6 #671 Plan 3:** anti-drift lint-guard (baseline-ratchet, 880 kendte → fejl kun på nye hex/slop/emoji i `frontend/src`) + global error-boundary hærdet (altid-aktiv = ingen white-screen i dev/preview + on-spec ErrorState/Button-fallback, role=alert) — TDD, alle gates grønne, e2e-bevis → PR [#1394](https://github.com/NicolaiDolmer/CyclingZone/pull/1394) **MERGED** (ejer-lås godkendt, danger-tone). **Plan 2c** (PR #1393 merged): fuldt ikon-sæt + Chip/Avatar/ProgressMeter — primitiv-laget komplet. Plan 2a/2b/1 merged (Field/Table/states · overlays · tokens+5 primitiver+`/ui`). **#672 landing-brainstorm:** retning låst (editorial 0-slop), byg gated på #671 + ToV.
## Aktiv styring

> **🎯 Next action (13/6 aften 3) — DESTILLERET PRE-20/6-BLOCKER-LISTE** (launch-blocker-audit færdig). Kernesystemerne er ALLE merged + gated bag flag OFF (flag-flip = #1103-checklisten 20/6). Ægte resterende launch-arbejde:
> - **Kode (claude:todo):** [#672](https://github.com/NicolaiDolmer/CyclingZone/issues/672) landing page + waitlist (deadline 16/6, ekstern indgang) · [#679](https://github.com/NicolaiDolmer/CyclingZone/issues/679) Discord-struktur+welcome · [#1299](https://github.com/NicolaiDolmer/CyclingZone/issues/1299) OG share-billeder · [#1231](https://github.com/NicolaiDolmer/CyclingZone/issues/1231) værdi-baroudeur-gate (kan give >Pogačar — gate FØR fiktiv pop seedes) · [#1139](https://github.com/NicolaiDolmer/CyclingZone/issues/1139) skjul Hall of Fame (blød). _(#1267 board-mål → LUKKET, PR #1387 merged.)_
> - **Ejer-handlinger (ikke kode):** [#1276](https://github.com/NicolaiDolmer/CyclingZone/issues/1276) PCM-dump-IP-beslutning (filer synlige i public repo) · [#1278](https://github.com/NicolaiDolmer/CyclingZone/issues/1278) relaunch-comms til spillere · [#940](https://github.com/NicolaiDolmer/CyclingZone/issues/940) NPS-baseline (juni).
> - **Verify-gates (dev-færdig, kræver ejer-click-through før flag-flip):** #1103 launch-orchestrator (skal køre grønt 20/6 — launch-dagens anker) · #1102 race-motor · #1364/#1101 værdimodel (sandbox) · #959-V1 etape-resultater · #671/#694/#1187.
> - **Epics (info-only):** #680 · #954 transparens-hub · #1105 relaunch.
> - **Andet (kun ejer):** GA4 #1302 Realtime-verify→luk · backend-secrets ud af `frontend/.env` (+#691) · #1337 i18n/tone required-checks · prod-checkliste (~15 min) + backup-spotcheck.
> - **Næste session-kandidat:** #671 UI-fundament — **P1-P3 klar** (P1/2a/2b/2c merged; **Plan 3** MERGED — PR #1394, anti-drift lint + error-boundary-hærdning). Tilbage: **Plan 4** udrulning side-for-side (#672 landing, login, kerne-app: inline-kopi→primitiver, emoji→ikoner — skrumper ui-slop-baselinen). #1231 værdi-gate stadig åben kode-blocker. **Langtidskort:** [TdF-validerings-roadmap](superpowers/specs/2026-06-09-tdf-validation-roadmap-design.md).

> **🤖 Working agent:** Ingen aktiv session. _(Lukket 14/6 sen-5: #671 Plan 3 (anti-drift lint-guard + error-boundary-hærdning) → PR #1394 MERGED (ejer-lås godkendt, danger-tone). Næste: Plan 4 (udrulning side-for-side). · #1284 MEMORY.md over budget.)_

> **📊 Backlog-audit (11/6, fuld):** 345→299 åbne; priority:high 62→31 (ærlig blocker-liste); alle 345 klassificeret. **Ejer-handlinger: [`docs/audits/2026-06-11-ejer-dashboard.md`](audits/2026-06-11-ejer-dashboard.md)** (vigtigst: #1101-verify + #375-backup-bekræft + prod-checkliste ~15 min). Beslutningsrunde 11/6: 22 ejer-svar eksekveret — 6 closes (#375/#1277/#937/#942/#874/#34), #954/#940/#1235/#1237 op-prioriteret, Codex udfases (#1290), design-beslutninger logget på #109/#230/#311/#1207/#1276. Artifact: `.claude/audits/audit-2026-06-11.md`.

## Standing context (launch-deadline 20. juni)

- **Sæson 1→2 skifte UDFØRT + VERIFICERET ([#1155](https://github.com/NicolaiDolmer/CyclingZone/issues/1155)).** Alle gates holdt. Bestyrelsen åbnet.
- **Relaunch-spor (20/6):** Epic #1136 progression — L1 scouting #1138 live, L2 træning teaser #1163 live. **20/6 = hard relaunch til frisk sæson 1** (epic #1105). **Launch-scope udvidet 11/6** (spec `2026-06-11-kernesystemer-design.md`): + daglig træning/form-spine, holdudtagelse/kaptajn/udbrud, akademi-MVP, kontrakt-data-seed.
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SUPABASE_SERVICE_KEY-rotation åben.
- **Skalering (ikke launch-blocker):** infra bærer 100 aktive managers; Supabase Pro købt 10/6 (#1181). Oprydning #1182 (Railway Postgres+Redis) efter launch. Perf-arkitektur-spec (13/6) merged → tracker #1375 (frontend-cache #1373, Realtime-invalidering #1374), alt post-launch.
- **TdF launch-prep:** [#676](https://github.com/NicolaiDolmer/CyclingZone/issues/676) Race Engine V1 · [#672](https://github.com/NicolaiDolmer/CyclingZone/issues/672) landing page · [#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671) brand.

_Trimmet 11/6 aften jf. #1275 (token-gate primær, budget ~1.200 tok); fuld historik i git-log + issue-tråde._
