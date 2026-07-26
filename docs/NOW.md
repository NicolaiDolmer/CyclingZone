# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring — cutover I AFTEN

**Sidste S1-etape søndag 26/7 19:00 · cutover ~19:30-20:30 · S2 dag 1 = MANDAG AFTEN 18:00-20:40** (ejer-valg 26/7: hele mandagen til sponsorvalg/holdudtagelse; DB-retiming kørt + post-verificeret, 41 pulje-løb, tirsdag+frem uændret, sæsonslut stadig søn 23/8). Drejebog: [SEASON_TRANSITION_CHECKLIST](SEASON_TRANSITION_CHECKLIST.md) · post-cutover: [#2846](https://github.com/NicolaiDolmer/CyclingZone/issues/2846).

> **🎯 Next action (ejer):**
> 1. 🔴 **Post selv Discord-beskeden** om mandag-aften-tiderne (færdig tekst i session-opsummering 26/7, ejer poster selv) — skal ud FØR i aften.
> 2. 🔴 **[#2851](https://github.com/NicolaiDolmer/CyclingZone/issues/2851): endelig 48/96/9-liste ~17:30** godkendes FØR "Afslut sæson". Mandagsvagt flyttet til ~17:45-18:15.
> 3. **Efter cutover (Claude kører):** honours-SQL (`database/2026-07-26-2863-season-honours.sql`) · achievements-backfill (EFTER op/nedrykning) · ryd 91 S2-peaks · verificér `AVG(fatigue)=0` · #2894/#2902-backfill (1.326 ryttere) · apply #3016-migration (PR #3027) + re-verify scout-varsler · luk 7 gated done (#2589 #2744 #2745 #2835 #2894 #2902 #2925).
> 4. **Ejer-ja udestår:** datareparation #2881 (48 ryttere, SQL klar) · #2892 Sentry-kvote (26/27 cron-monitorer disabled) · #1903 bekræft om abonnementet 25/7 var dit testkøb · **NYT: svar-ark m. 49 A/B-beslutninger** i [`docs/audits/2026-07-26-ejer-beslutnings-batch.md`](audits/2026-07-26-ejer-beslutnings-batch.md) (hurtigst: "følg anbefalingerne").

> **✅ 26/7:** Formiddag: #2700-varsel SENDT (59/59); backlog-audit 517→466, 51 closes ([#627](https://github.com/NicolaiDolmer/CyclingZone/issues/627)). Prioritering: [`backlog-priorities-2026-07-26.md`](audits/backlog-priorities-2026-07-26.md). Eftermiddag: cutover-preflight grøn + runde 2: 466→457, 49 beslutnings-briefs ([audit-pm](../.claude/audits/audit-2026-07-26-pm.md)). Aften-runde 3: **457→452** (5 closes: #2718 #2719 #2976 #2819 #2886) + #2900/#2916 todo→done + allerede_loest-bucket 100 % gennemgået ([audit-eve](../.claude/audits/audit-2026-07-26-eve.md)); bifund: scout-varsel-typerne er allerede i prod-constrainten (kun `season_transition_risk` mangler). Draft-PR #3029 (#230) klar til merge EFTER cutover. 2 reddede worktree-branches til review efter cutover. Post-cutover-kandidat: #88 (sæt strict=true → luk).

> **📈 Prod:** 161 brugere · ~62 % af nye vender aldrig tilbage · 41 WAU / 8 DAU · 1 abonnement (25/7). Anskaffelsen virker, fastholdelsen gør ikke.

> **Næste sessioner efter cutover:** (a) "allerede løst"-verifikation — 60+ kandidater i prioriterings-docen, realistisk 30-50 closes · (b) ejer-beslutnings-batch (49 issues venter kun på A/B-valg) · (c) s2_uge1-sporet som bølge · (d) fælles planner-design-session (#2905, mockups i `docs/screenshots/wave3-2507/2905/`). Bølge 1-4-historik: git-log + patch notes 7.62-7.64.

> **🤖 Working agent:** Claude Code (denne session, 26/7 ~16:30): #3030 hotfix — auto-prize-sweep død (.in()-URL over gateway-grænse), 688k CZ$ ubetalt. Skal lande FØR cutover ~19:00.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden.
- **Sikkerhed:** #691 · #929 · #2802/#2803 — alle åbne. **Skalering:** #323 (genbesøg ved ~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag. Grace afvist (#1941 = design, ikke bug).

_Trimmet 26/7 (backlog-audit + cutover-prep). Historik i git-log, issue-tråde + docs/audits/._
