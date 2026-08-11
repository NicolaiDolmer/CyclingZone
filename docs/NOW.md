# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.
> _Verificeret 11/8 aften: hvert issue-nummer herunder er tjekket mod GitHub._

## Aktiv styring

> **📋 Næste session:** fuld prompt i [`docs/sessions/2026-08-12-naeste-session-prompt.md`](sessions/2026-08-12-naeste-session-prompt.md) — 15 punkter, ejer-designet 11/8. **Eksekvér-krav:** #3639 + #3503 live før resten diskuteres.

> **🎯 Next action:** **[#3639](https://github.com/NicolaiDolmer/CyclingZone/issues/3639)** (dødt træningsfokus — 119 ryttere træner mod et nået loft; mest synlige spillerfix) → **[#3503](https://github.com/NicolaiDolmer/CyclingZone/issues/3503)** (`max(tapered,current)` har sluppet **20,3 %** af bestanden ud af deres potentiale; I1-porten på trin 1 står på 79,7 %. **Håndhæv IKKE nedad** — alle 710 spiller-brud har allerede en evne over loftet) → **[#3582](https://github.com/NicolaiDolmer/CyclingZone/issues/3582)** før #3580/#3578 (ejer 11/8; 21 auktions-kandidater, kun 1 kan bekræftes. **Åben post: BPTrain mangler 40.000**). Derefter #2650+#3461 · #3620 · #3585+#3600 før #2853.

> **📅 To datoer, én dag fra hinanden:** cutover **23/8** (markedsvægt→1,0 → #3393 løn → race-day-flip #3459 → mandat #3514), **S3 starter 24/8**. **Rollback-plan pr. komponent mangler stadig — skal skrives før dagen.** Før da: sweep-drejebog **søndag 16/8** ([#3448](https://github.com/NicolaiDolmer/CyclingZone/issues/3448)/PR #3449 — 8 CodeRabbit-fund + T4-gates først) + [#3632](https://github.com/NicolaiDolmer/CyclingZone/issues/3632) prod-verifikation (søndags-gated; lukket for tidligt 11/8, genåbnet som gated).

> **🧬 Progressionskæden ([#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564), spec §11-12 = SSOT).** Beslutning A-E låst (E 11/8: toprytter = mesterlig i primær, god i sekundær, jævn i resten — og skal stadig opleves stærk). **Før 16/8:** [#3593](https://github.com/NicolaiDolmer/CyclingZone/issues/3593) → [#3591](https://github.com/NicolaiDolmer/CyclingZone/issues/3591) pkt. 2 (kontrolleret re-derive m. dry-run + ejer-go; 61,6 % skifter type). **16/8→23/8, kun flow:** #3631 → #3634. **Efter 23/8:** PR-0 #2798 → PR-1 1-99 → PR-2 remap −6,7 % → trin 2 → trin 3 (#3616).

> **🔓 AFKLARET 11/8 — [PR #3512](https://github.com/NicolaiDolmer/CyclingZone/pull/3512) er hverken unblock eller A/B/C-beslutning:** main grøn på 3/3 seeds, branchen rød på 3/3 (favoriteWinRate 61-63 % mod bånd 25-40 %). Men branchen er 33 commits bagud og main har omskrevet dens kernefiler — test-merge konflikter i `fictionalRiderGenerator.js`. #3295-hypotesen afkræftet. Næste: **scope-diff** → bevidst konfliktløsning → gate igen. Forbliver draft.

> **👤 Dine klik:** [#3553](https://github.com/NicolaiDolmer/CyclingZone/issues/3553) udløbet PAT — **fejler på hver eneste PR** (verificeret på #3637), tag den først · [#3585](https://github.com/NicolaiDolmer/CyclingZone/issues/3585) før #2853 + #3600 · [#3486](https://github.com/NicolaiDolmer/CyclingZone/issues/3486) `VERCEL_TOKEN` (låser #1784) · #2813 penge-gates · **POST kommunikationspakken + akademi-kompensationen** (`docs/discord/2026-08-10-*.md`) · svar forum-spørgsmålet *"what do you mean it can be reversed?"* · patch notes **v7.112-7.116** mangler i Discord (efterslæbet var mindre end antaget — du postede catch-up 10/8).

> **🧹 Vedligeholds-gæld:** done-pukkel **51 → 19**, åbne **555 → 524** (sweep 11/8; evidens på [#627](https://github.com/NicolaiDolmer/CyclingZone/issues/627#issuecomment-5253611225), artifact `.claude/audits/audit-2026-08-11.md`). **Tallet er ikke problemet:** 261 issues oprettet på 12 dage mod 245 lukket — #3154's ~200 er uden for rækkevidde ved den intake. Kadence-beslutning, ikke oprydning. Største løftestang: **41 uverificerede Kategori K-kandidater**.

> **📌 Åbne opfølgninger:** [#3640](https://github.com/NicolaiDolmer/CyclingZone/issues/3640) (over-22-rettelsen ramte også 77 % af under-23) · [#3586](https://github.com/NicolaiDolmer/CyclingZone/issues/3586) skema-guard · [#3172](https://github.com/NicolaiDolmer/CyclingZone/issues/3172) CI-flake gør verify-local upålidelig · #3587 · #3628 · #2409 · #3353/#3349/#2645/#2164 · #3614 (ejer-parkeret) · #3633. Efter cutover (ejer 7/8): #2223 → #3514 → #3513 → #2960.

> **🤖 Working agent:** Ingen aktiv session. Merged 11/8: #3617 (v7.112) · #3630 (v7.113) · #3636+#3637 (#3554 lukket, #3601 delvist) · #3635 (v7.114) · #3618 (v7.115) · #3627 (v7.116). Åbne PR'er: 3 drafts (#3512 · #3449 · #3393). [Postmortem 11/8](../.claude/learnings/2026-08-11-maalinger-der-bliver-mildere-af-det-de-skal-maale.md) — nu tre instanser af "målt langs den forkerte akse".

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; D1 = kun AI. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag i puljen. **Pension:** måles på AFSLUTTET sæsons alder.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben (service-key-rotation); #929/#2802/#2803 lukkede (verificeret 11/8). **Skalering:** #323.

_Historik i git-log, issue-tråde + docs/audits/._
