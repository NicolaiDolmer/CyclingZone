# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (re-synket 3/8). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action (ejer-svar modtaget i batch 3/8 — udestående):**
> 1. **Svar 3/8:** klik-pakken = ja til ALLE tre (#2892+#2076+#419 → næste ops-session) · #1150 = genforhandling m. frigivelse (dokumenteret på issuet) · #3199/#3200 = ÉN samlet design-session (dedikeret, starter m. ejeren) · #3120 = lukket uden mutation. **Runde 2-svar 3/8:** #3207 = ja → MERGED · #3132-privatlivstekst = godkendt → PR #3208 (auto-merge; luk #3132 når live) · #2853-mailtekster = ejer læser draft-filen først. **Stadig hos ejeren:** gyldig RESEND_API_KEY + EMAIL_UNSUB_SECRET (DKIM-DNS live, nøglen ugyldig → blokerer #2853-flip + #3201-webhook) · #2853-læsning.
> 2. **Godkendelses-udkast leveret i docs/drafts/ 3/8:** [privatlivstekst #3132](drafts/privatlivstekst-3132-2026-08-03.md) + [3 mailtekster #2853 EN+DA](drafts/mailtekster-2853-2026-08-03.md). Dit ja → Claude implementerer/flipper.
> 3. **Penge-kæden (#2813):** moms-tjek i Alunta + flip-go udestår. **#2736 fornyelses-webhook før ~24/8.**
> 4. **Discord-svar:** ejeren poster selv — udkast i docs/drafts/discord-svar-2026-08-03.md. #2758-automation kører (lokal task 07:30).

> **🟢 #3185/#3119/#3122 FIXET + POST-VERIFICERET 3/8 (PR #3206 live 12:03):** væksten i CYCLINGZONE-44 var transfer-artefakter (vagten manglede ghost-filter, #1906-semantik) — IKKE sweep-skabte dobbeltbookinger. Sweep binder nu i game_day-rum m. monument-afledte vinduer (#3114 sweep-side). Prod efter første sweep-tick: tomme enheder **553→0** (647 nye entries), konflikter **4 (kun historiske Brutaliste-par), 0 nye**. **Verificér i morgen ~08: CYCLINGZONE-44-tick skal sige count=4** → derefter luk #3185. #3120: dry-run viste 0 point/0 kr at modregne → anbefalet luk uden mutation. **Aften-batch 3/8 (Fable) FÆRDIG: 10 issues lukket** (#1688 · #3036 · #3190 · #2792+#3193 · #3132 · #3186 · #3151/#3148 · #3184) — 8 PRs merged, 2 migrationer live+post-verificeret, patch note 7.87 (PR #3221, auto-merge).

> **🔴 Platform i øvrigt:** Supabase gul: #3124 matviews · is_admin anon-kaldbar · 3 analytics-RPC'er åbne (lås i #3196) · #929 slået fra. Prod: 189 brugere, WAU 32, 83 % af 7-28d-kohorten vender aldrig tilbage efter dag 1 (→ #2853-mailloop venter på Resend-nøgle). Lokal dev-boks: Playwright mobile-webkit crasher ved launch på ALLE specs (miljø, opstået efter 29/7) — CI er webkit-gaten indtil rod-årsag findes.

> **📌 Venter i øvrigt på dig:** beslutnings-arkets 60 resterende sager ([ark](audits/beslutnings-ark-2026-07-30.md)) · #2830 · #3109-#3112 · #2881 · #2699 · dedikerede sessioner: #2622 (kan afløses af #3199) · #2675 · #2650 · #2840.

> **📌 Åbne opfølgninger:** #2164 · #3049-#3051 · #2723 (+#3152) · #3172 (CI-flake) · #3114 rest (save-guard-hul åbner ved D1-oprykning efter 23/8 + "Race day 100000"-display → #3107) · identity_events search_path-hærdning (advisor-WARN) · Reddede branches: `feat/2910-fatigue-reset-claim-guard` + `fix/2861-postgrest-in-cap-sweep` · ~75 stale lokale branches.

> **🤖 Working agent:** Claude Code (Fable-orkestrator, 3/8 nat-batch, AKTIV) — 15 opgaver: fair-play #3133-#3137 · #3196 · #3197 · #3198 · #3195 · #3192 · #3191 · #3203 · #3172 · #3202 · Supabase-hærdning #3124+is_admin+identity_events · #3205 · verifikationer #3185 + #3189 (→ evt. #3187/#3188). **Næste kode-session:** #1150 udløbs-håndhævelse (design-valg 3/8; #3208/#3132 ✅ live+lukket 3/8 aften). **Dedikeret design-session:** #3199+#3200 samlet (ejer-valg 3/8).

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. D1 = kun AI. **#1688 er kodens eget HARD-GATE før S3-op/nedrykning.**
- **Sikkerhed:** #691 · #929 · #2802/#2803 — åbne. **Skalering:** #323 (~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag **inden for puljen** (game_day er pulje-relativt i real-tid — transfer på tværs af puljer kan lovligt give "samme" game_day igen, jf. #3185-forensik). Grace afvist. **Pension:** måles på AFSLUTTET sæsons alder.

_Trimmet 3/8 (aften-close-out; #3119-pakken + udkast leveret. Historik i git-log, issue-tråde + docs/audits/)._
