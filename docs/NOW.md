# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt-model i hovedtråden, sonnet-subagenter i worktrees; PR der afventer justering = draft.
> _Verificeret 13/8: hvert issue-nummer herunder er tjekket mod GitHub._

## Aktiv styring

> **🎯 Næste session:** [#3662](https://github.com/NicolaiDolmer/CyclingZone/issues/3662) planlægnings- og designsession — masterplan-synk + de næste 15-25 opgaver designet sammen. Prompt: [`docs/sessions/2026-08-14-naeste-session-prompt.md`](sessions/2026-08-14-naeste-session-prompt.md). Opus 5 høj reasoning, sonnet-subagenter, research som workflow — designet som samtale.

> **⚠️ Ugeplanens præmis udløb 13/8:** *"2.139 AI-ryttere skifter type 23/8"* er målt til **0 af 3.293** ([#3591](https://github.com/NicolaiDolmer/CyclingZone/issues/3591) lukket, negativ-kontrol i tråden). **Rækkefølge-tvangen loft→marked er VÆK.** Torsdagens arbejde færdigt: #3593 merged, #3591 lukket, 516 ryttere re-loftet (5 på spillerhold, værste −2 rating). **Ejer-beslutning 13/8: planlægning før marked** — [PR #3449](https://github.com/NicolaiDolmer/CyclingZone/pull/3449) og markedssweepen får ny dato i #3662-sessionen. Verificeret: sweep-koden findes kun på PR-branchen, intet i main → **udsættelsen kræver ingen handling**.

> **📅 23/8 cutover (10 dage):** markedsvægt→1,0 → [#3393](https://github.com/NicolaiDolmer/CyclingZone/issues/3393) løn → race-day-flip #3459 → mandat #3514. S3 starter 24/8. **Rollback-plan pr. komponent mangler stadig — skal skrives før dagen.** Søndags-gated: #3632 prod-verifikation.

> **⭐ Rating-fundamentet v3 (ejer-designet 13/8):** spec [`2026-08-13-rating-fundament-v3-design.md`](superpowers/specs/2026-08-13-rating-fundament-v3-design.md). Rating = vægtet snit af rollens evner på evne-skalaen; potentiale = samme regnestykke på lofterne; ét tal, én betydning, hele siden. [#3664](https://github.com/NicolaiDolmer/CyclingZone/issues/3664) samling · **[#3665](https://github.com/NicolaiDolmer/CyclingZone/issues/3665) klar at starte** (nul synlige ændringer) · #3666 blokeret på ejer-godkendelse af de 8 opskrifter · #3667 · #3668 rod-fix (evne-skalaen selv). Opsluger #3649.

> **🆕 Ejer-direktiver 13/8:** #3661 fast design-/kvalitetsproces (→ hard rules i `AGENTS.md`) · #3660 UX "kan spilleren stole på det de ser" · #3659 udvikling/træning/lofter forståeligt i UI · #3657 scouting-missioner værdiløse (4 spillere) · #3658 staff-kandidater.

> **🧬 Progressionskæden ([#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564), spec §11-12 = SSOT):** A-E låst. **16/8→23/8, kun flow:** #3631 → #3634. **Efter 23/8:** PR-0 #2798 → PR-1 1-99 → PR-2 remap −6,7 % → trin 2 → trin 3 (#3616). #3503 er IKKE en åben beslutning ("A nu, B senere" låst 7/8).

> **👤 Dine klik:** [PR #3641](https://github.com/NicolaiDolmer/CyclingZone/pull/3641) go (eller drop boardet) · [#3486](https://github.com/NicolaiDolmer/CyclingZone/issues/3486) `VERCEL_TOKEN` (låser #1784) · #2813 penge-gates · #3585 før #2853 + #3600 · **POST kommunikationspakken + akademi-kompensationen** (`docs/discord/2026-08-10-*.md`) + **[patch notes v7.112-7.117](discord/2026-08-12-patch-notes-catchup.md)** (3 blokke, klar til copy-paste).

> **📌 Opfølgninger:** #3640 · #3586 skema-guard · #3172 CI-flake (verify-local upålidelig) · #3620 · #3587/#3628/#2409 · #3353/#3349/#2645/#2164 · #3614 (ejer-parkeret) · #3633. PR-drafts: #3512 (scope-diff først) · #3449 · #3393. Efter cutover: #2223 → #3514 → #3513 → #2960.

> **🧹 Gæld:** åbne 524, done-pukkel 19 (sweep 11/8, [#627-evidens](https://github.com/NicolaiDolmer/CyclingZone/issues/627#issuecomment-5253611225)). 261 oprettet mod 245 lukket på 12 dage — kadence-beslutning, ikke oprydning. Største løftestang: 41 uverificerede Kategori K-kandidater.

> **🤖 Working agent:** Ingen aktiv session. Sidst: rating-fundament-designsession 13/8 (spec + #3664-#3668). [Postmortem 12/8](../.claude/learnings/2026-08-12-aggregatet-viste-det-bedste-medlem-som-helhedens-tilstand.md): fjerde instans af "målt langs den forkerte akse".

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; D1 = kun AI. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag i puljen. **Pension:** måles på AFSLUTTET sæsons alder.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben (service-key-rotation); #929/#2802/#2803 lukkede (verificeret 11/8). **Skalering:** #323.

_Historik i git-log, issue-tråde + docs/audits/._
