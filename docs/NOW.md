# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (re-synket 3/8). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action — MORGENRUNDE 4/8 (dossier ligger i natbølge-chatten):**
> 1. **Transfer-hul-principsvar** (afgør #3282 spor A + #3275 spor B, begge gated OFF; tal adversarielt verificeret, tier3 reelt 17 pga. akademi-bug i poolBalance — fix før go/no-go). 2. **UI-go's m. screenshots:** #3283 sæson-UX · #3285 (#3107) · #3286 (#2042A) · #3287 (#3115-drivere) · #3279 (#3007-tour) · #3288 (#2793 — migration FØR merge) · #3289 (narrativ-pakke — NOW.md ud af diffen). 3. **#3263-dep** (anbefaling: merge). 4. **Aften-batchens 4 hale-PRs** (#3252/#3255/#3260/#3262 armeret men BEHIND — ét update-branch pr. styk sætter dem i mål; #3274 patch-note-draft skal renummereres, 7.89 er taget). 5. Resten: prisbånd-flip (#3133) · lån-gate (#3134) · whitelist (#3223) · #481-logo · #3050 scope A · #1147-timing · TAU 0,40→0,45 · Vercel WA (#3235) · Supabase 2-min-klik (OTP-expiry + #929). **Derefter:** #1150-session · design-session #3199+#3200.
> 2. **Stadig hos ejeren:** RESEND_API_KEY + EMAIL_UNSUB_SECRET (#2853/#3201) · #2853-mailtekster ([draft](drafts/mailtekster-2853-2026-08-03.md)) · penge-kæden #2813.

> **🟢 NATBØLGE 3→4/8 FÆRDIG: 16 PRs merged (#3267→#3294), 9 drafts m. screenshots, 4 issues lukket (#2731 #3114 #3266 #3269), 3 migrationer applied+post-verificeret, patch note 7.89 live.** Adversarial verify-fase fangede 5 talfejl (korrigeret på PRs; #3293). Højdepunkter: #3172-rod-årsag (IPC fjernet strukturelt, ny klokke ~18/8) · #2887-rehire-fix · #2180-varsel+auto-udtag · welcome-notif (gap 2a-hypotesen MODBEVIST — ingen dæknings-bug) · cutover-preflight+runbook (FUND: S3-kalender = 0 races!) · decay-claim-guard før 23/8 · drift-vagt count+tier + klynge-SE. D1-agent-hang recovered (respawn i samme worktree). Vercel-gap selvhelet. Detaljer: [night-wave-2026-08-04.md](audits/night-wave-2026-08-04.md).

> **🔴 Platform:** Supabase: OTP-expiry + #929 = 2-min dashboard-klik ([hardening-doc](audits/2026-08-04-supabase-hardening.md)). Prod 189 brugere, WAU 32; 83 % af 7-28d-kohorten forsvinder efter dag 1 (#2853 venter på Resend-nøgle). #2736 Alunta-cron: første kørsel ~23:49 4/8 (tjek næste nat; fornyelse 31/8). Playwright mobile-webkit lokalt = miljø-issue, CI gater. Railway MCP blev unauthorized i nat (re-auth i interaktiv session).

> **📌 Venter i øvrigt på dig:** beslutnings-arkets 60 sager ([ark](audits/beslutnings-ark-2026-07-30.md)) · #2830 · #3109-#3112 · #2881 · #2699 · sessioner: #2622 (evt. afløst af #3199) · #2675 · #2650 · #2840-rest.

> **📌 Åbne opfølgninger:** #3290 (RPC-hul, omkring 23/8) · #2164 (ved S2→S3; triage-kommentar ligger på issuet, også #3049-#3051) · #2723 (+#3152) · #3172 (luk ~18/8 efter grøn CI — klokken NULSTILLET 4/8) · S3-kalender ikke materialiseret (GO/NO-GO-script: scripts/preflight-season-cutover.ps1) · is_academy-fix i poolBalance.js før reseed-beslutning · #2180-rest (frontend-knap + Discord-valg) · Reddede branches: `fix/2861-postgrest-in-cap-sweep` (2910-claim-guard-mønstret genbrugt i #3271) · ~75 stale lokale branches.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. D1 = kun AI. **#1688 er kodens eget HARD-GATE før S3-op/nedrykning.**
- **Sikkerhed:** #691 · #929 · #2802/#2803 — åbne. **Skalering:** #323 (~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag **inden for puljen** (game_day er pulje-relativt i real-tid — transfer på tværs af puljer kan lovligt give "samme" game_day igen, jf. #3185-forensik). Grace afvist. **Pension:** måles på AFSLUTTET sæsons alder.

_Trimmet 4/8 (natbølge-close-out. Historik i git-log, issue-tråde + docs/audits/)._
