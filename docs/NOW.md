# NOW — Aktuel arbejdsstatus

> **🟢 Seneste close-outs** (detaljer i git-historik + issues/PRs): **2. juni — Pre-launch hærdnings-audit:** multi-agent adversarisk review af alle økonomi-/board-/transfer-commits merged sidste 48t. 3 verificerede regressions, alle i loan-buyout-windowing (#19 Del B, samme rod: overloadet `window_pending`). Fix i [#965](https://github.com/NicolaiDolmer/CyclingZone/pull/965) — ny distinkt `buyout_pending`-status; migration anvendt i prod; 895/895 + 147/147 grøn. Økonomi/board/frontend rene. #19 åben til #965 merged + buyout-verificeret. **2. juni — Pakke B+C** PR [#951](https://github.com/NicolaiDolmer/CyclingZone/pull/951) (search_path-hærdning #927) + [#952](https://github.com/NicolaiDolmer/CyclingZone/pull/952) (#913 dashboard sæson-filter + #915 mid-season plan-lås) merged; #914/#928 lukket working-as-intended. **2. juni — Brainstorm:** founder-feature-dump trieret → 10 nye issues (#954–#963) oprettet. **2. juni — GitHub-audit:** 21 issues lukket. **1. juni — Sundhedsaudit:** #876/#882/#878/#879/#792/#767 lukket; #1-prod-fejl (`lazyWithRetry`, #883) fixet.

## Aktiv styring

> **🎯 Next action:** **Anvend migration `database/2026-06-02-division-fill-from-top.sql` i prod** når PR #962 merges (rykker nuværende 23 div-3-hold op: 20→div 1, 3→div 2). Derefter næste launch-issue: [#787](https://github.com/NicolaiDolmer/CyclingZone/issues/787) sprog eller [#271](https://github.com/NicolaiDolmer/CyclingZone/issues/271) dashboard.
>
> **🤖 Working agent:** Ingen aktiv session.
>
> **Launch-sprint TdF** (`slice:tdf-launch`): [#787](https://github.com/NicolaiDolmer/CyclingZone/issues/787) sprog · [#960](https://github.com/NicolaiDolmer/CyclingZone/issues/960) nulstil · [#816](https://github.com/NicolaiDolmer/CyclingZone/issues/816) >100% · [#271](https://github.com/NicolaiDolmer/CyclingZone/issues/271) dashboard · [#961](https://github.com/NicolaiDolmer/CyclingZone/issues/961) hjælp · [#962](https://github.com/NicolaiDolmer/CyclingZone/issues/962) division · [#959](https://github.com/NicolaiDolmer/CyclingZone/issues/959) etape-V1 · [#963](https://github.com/NicolaiDolmer/CyclingZone/issues/963) besøgs-log.
>
> **Epics (post-launch):** [#954](https://github.com/NicolaiDolmer/CyclingZone/issues/954) Transparens · [#955](https://github.com/NicolaiDolmer/CyclingZone/issues/955) Bestyrelse-UI · [#956](https://github.com/NicolaiDolmer/CyclingZone/issues/956) Deadline-hub · [#957](https://github.com/NicolaiDolmer/CyclingZone/issues/957) Popularitet · [#958](https://github.com/NicolaiDolmer/CyclingZone/issues/958) U23/Junior · [#959](https://github.com/NicolaiDolmer/CyclingZone/issues/959) Etape-resultater.

---

## Standing context (launch-deadline 20. juni)

- **Præmieudbetalinger på pause** indtil præmie-audit-epic [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893) er færdig — udbetal IKKE før da. Kerne-PRs #907/#909/#910 merged; #896-preview afventer ejer-verify (admin → Økonomi → Præmieudbetaling → sæson 1 → "Se status").
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SUPABASE_SERVICE_KEY-rotation åben · [#929](https://github.com/NicolaiDolmer/CyclingZone/issues/929) leaked-password = dashboard-toggle (ejer).
- **TdF launch-prep:** [#676](https://github.com/NicolaiDolmer/CyclingZone/issues/676) Race Engine V1 (stor risiko) · [#672](https://github.com/NicolaiDolmer/CyclingZone/issues/672) landing page · [#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671) brand · [#864](https://github.com/NicolaiDolmer/CyclingZone/issues/864) UI/UX-audit-fund.
- **Ejer-verify udestår:** #793/#19/#896 (claude:done) · merge PR #947 (skill-docs) · #669 fiktive-rytter-auktionstest.

_Opdateret af Claude (Claude Code) 2. juni 2026 — close-out brainstorm-session: 10 feature-issues (#954–#963) på GitHub, next action → #962._
