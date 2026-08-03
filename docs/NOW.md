# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (re-synket 3/8). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action (ejer — dagens pakke, 3/8):**
> 1. **Klik-pakken (~15 min):** #2892 genaktivér 25 Sentry-monitorer · #2076 UptimeRobot-konto · #419 Carl-bot-invite.
> 2. **Penge-kæden (#2813-gates):** support-e-mail + moms-tjek i Alunta (`charge_vat`, 4900/26500 øre ekskl. moms!) + sig til når jeg må flippe `CHECKOUT_PAUSED`. En spiller spurgte 31/7 aktivt "Is the pro already active?" — kunden venter. Dernæst #3104 etape D (/pro-indgang) + **#2736 fornyelses-webhook før ~24/8**.
> 3. **Beslutninger i én runde:** #3120 (dry-run-tal → dit ja) · #3037 make-good · mobil-bundbar A/B (#3102) · privatlivstekst #3132 (telemetri verificeret live 3/8: 581 events/178 brugere) · go til #2758 daglig Discord-automation (design klar på issuet) · #2853 e-mail-tekster.
> 4. **Discord-svar (jeg drafter, du godkender ordret):** soren1207 (kontraktudløb) · #2889 (løn/sponsor) · smukkethomsen/thelamba (#2883 hul 4) · evt. friisisch (styrt-frustration, #2944).

> **🔴 Ugesweep 3/8 (27/7-3/8, alle kanaler):** 14 nye issues **#3190-#3203** — heraf **7 ejer-direktiver fra #feedback-from-dolmer** (vækst-dashboard #3196 · resultat-defaults #3197 · økonomi-audit #3198 · forum+polls #3199 · spillerbeskeder #3200 · admin-notifikation #3201 · daglig Discord-automation → #2758). Vigtigste bugs: **#3194 mobil-trænings-regression** (sandsynligt PR #3075) · #3193 global rank-mismatch (koordinér m. #2792, nu prio:high). 9 evidens-kommentarer (#2887 #2944 #3115 #2792 #2758 #2813 #2557 #929 #3132) · 3 verificerede closes (#3052 #3130 #3180).

> **🔴 Platform-triage 3/8:** Sentry **CYCLINGZONE-44 er escalating, IKKE historik** — dobbeltbooking vokser 4→7 par på 4 dage ([#3185](https://github.com/NicolaiDolmer/CyclingZone/issues/3185) P0, rodårsag formodet #3119 → **næste kode-session**). Railway sund (0 5xx/7d, deploy grøn). Supabase gul: #3124 matviews · is_admin anon-kaldbar · 3 analytics-RPC'er åbne for alle spillere (lås i #3196) · #929 stadig slået fra. Prod: 189 brugere, WAU 32, DAU 8, 1 abonnement, **83 % af 7-28d-kohorten vender aldrig tilbage efter dag 1**.

> **📌 Venter i øvrigt på dig:** beslutnings-arkets 60 resterende sager ([ark](audits/beslutnings-ark-2026-07-30.md)) · #2830 · #3109-#3112 (Sentry-triage) · #2881-datareparation · #2699 (udskudt 30/7) · dedikerede sessioner: #2622 (poll → kan afløses af #3199-forum) · #2675 · #2650 · #2840 (model A, dry-run-harness).

> **📌 Åbne opfølgninger:** #3036 (countback) · #2164 (D3→D4) · #3049-#3051 · #2723 omdømme-synlighed (kandidat til prio-løft, +#3152) · #3172 (CI-flake, 3. gang = rod-årsag) · #3095-kompensation = dry-run i #3174 · Reddede branches: `feat/2910-fatigue-reset-claim-guard` + `fix/2861-postgrest-in-cap-sweep` (verificér/slet) · ~75 stale lokale branches.

> **🤖 Working agent:** Ingen aktiv session. **Næste kode-session:** #3119 (+#3122) — stopper #3185-væksten · derefter #3194 (mobil-regression) · #3038 (23/8-blokeren).

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. D1 = kun AI. **#1688 er kodens eget HARD-GATE før S3-op/nedrykning.**
- **Sikkerhed:** #691 · #929 · #2802/#2803 — åbne. **Skalering:** #323 (~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag. Grace afvist. **Pension:** måles på AFSLUTTET sæsons alder.

_Trimmet 3/8 (ugesweep-close-out; 30/7-31/7-blokkene komprimeret til stadig-åbne fakta. Historik i git-log, issue-tråde + docs/audits/)._
