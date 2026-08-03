# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (re-synket 3/8). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action:**
> 1. **I morgen:** #1150-SESSION (starter med snak; design "genforhandling m. frigivelse" besluttet 3/8) · ejer-beslutninger fra nat-batchen: **prisbånd-aktivering** (0,10×/2,2× klar, #3133) · **lån-gate + auktionsspærre** (#3134, tænkepause) · **whitelist-resten** (#3223-kandidater) · **Vercel WA-toggle** (#3235 — ejeren bad om påmindelse) · klik-pakken (#2892+#2076+#419 → ops-session).
> 2. **Stadig hos ejeren:** gyldig RESEND_API_KEY + EMAIL_UNSUB_SECRET (blokerer #2853-flip + #3201) · #2853-mailtekster ([draft](drafts/mailtekster-2853-2026-08-03.md)) · penge-kæden #2813 (moms-tjek + flip-go).
> 3. **Discord:** ejeren poster selv — known-issues-tekster (trænings-labels + forecast) leveret i nat-batch-chatten 3/8; #2758-automation kører (07:30).

> **🟢 Nat-batch 3/8 (Fable) FÆRDIG: 18 leverancer, 18 PRs merged (#3220-#3242), 17 issues lukket.** Fair-play-kæden #3133-#3137 leveret (mekanik live men SLÅET FRA — aktivering = ejer) · Supabase-hærdning post-verificeret · økonomi-audit 13 fund (→ #3236 forecast-hul, priority:high) · vækst-dashboard /admin/growth m. 110 dages backfill · resultat-vælgere m. ægte datoer · transferliste-badge+filter · scout-historik · trænings-label-fix · 3 FAQ-svar fra motorkoden · sponsor-risikopræmie · klik-fixes /races+/team · #3185 lukket (count=4 stabilt) · #3189-verdikt: Clarity-tal = stitching-artefakt ~200× (fix hører til #2041). Patch note 7.88. Læringer + nye guards: `.claude/learnings/2026-08-03-nat-batch-orchestration.md` + `scripts/preflight-pr.ps1` (nu obligatorisk før push). Aften-batch tidligere 3/8: 10 issues, 8 PRs, patch 7.87.

> **🔴 Platform i øvrigt:** Supabase: kun #929 leaked-password tilbage (ejer-toggle; matviews/is_admin/RPC-advisors løst eller dokumenteret 3/8). Prod: 189 brugere, WAU 32, 83 % af 7-28d-kohorten vender aldrig tilbage efter dag 1 (→ #2853-mailloop venter på Resend-nøgle). Lokal dev-boks: Playwright mobile-webkit crasher ved launch på ALLE specs (miljø, opstået efter 29/7) — CI er webkit-gaten indtil rod-årsag findes.

> **📌 Venter i øvrigt på dig:** beslutnings-arkets 60 resterende sager ([ark](audits/beslutnings-ark-2026-07-30.md)) · #2830 · #3109-#3112 · #2881 · #2699 · dedikerede sessioner: #2622 (kan afløses af #3199) · #2675 · #2650 · #2840.

> **📌 Åbne opfølgninger:** #2164 · #3049-#3051 · #2723 (+#3152) · #3172 (fixet — luk ~17/8 efter 2 ugers grøn CI) · #3114 rest (save-guard-hul åbner ved D1-oprykning efter 23/8 + "Race day 100000"-display → #3107) · Reddede branches: `feat/2910-fatigue-reset-claim-guard` + `fix/2861-postgrest-in-cap-sweep` · ~75 stale lokale branches.

> **🤖 Working agent:** Claude Code (Fable-orkestrator, NATBØLGE 3→4/8, AKTIV fra 23:47) — kører parallelt med verdensklasse-batch 3/8-closeout; rører IKKE dens PRs (#3251/#3252/#3255/#3260/#3262) eller worktrees. Spor: verifikationer (#3185/#2731/#2736/#3263) · balance-opfølgninger report-only (drift-vagt, transfer-hul spor A/B gated OFF) · sæsonskifte 23/8 (#2752/#2361/#3114/#3107 + cutover-drejebog) · retention (#2180/#3115/#2356/#3007/#2042A) · økonomi/platform. Morgenrunde ~07:30 (ét samlet dossier). **Næste kode-session:** #1150 udløbs-håndhævelse (design-valg 3/8). **Dedikeret design-session:** #3199+#3200 samlet (ejer-valg 3/8).

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. D1 = kun AI. **#1688 er kodens eget HARD-GATE før S3-op/nedrykning.**
- **Sikkerhed:** #691 · #929 · #2802/#2803 — åbne. **Skalering:** #323 (~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag **inden for puljen** (game_day er pulje-relativt i real-tid — transfer på tværs af puljer kan lovligt give "samme" game_day igen, jf. #3185-forensik). Grace afvist. **Pension:** måles på AFSLUTTET sæsons alder.

_Trimmet 3/8 (aften-close-out; #3119-pakken + udkast leveret. Historik i git-log, issue-tråde + docs/audits/)._
