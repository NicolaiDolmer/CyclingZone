# Natbølge 10/10

- **Workflow:** `wf_3abcb92d-4d1`, 4 laner, 23 spor (12 start + 11 rullende), 59 agenter, 0 fejl, ca. 19,3M subagent-tokens, ca. 5 t 20 min. Hale-tomgang 15,8 %.
- **Ejer-go:** natplan godkendt 00:10 (betaling #4514/#4512 taget ud til mandag).
- **Merget i nat:** #6395 (7.349) · #6396 (7.350) · #6399 (#6285) · #6402 (#6320) · #6404 (#5946).
- **Issues → claude:done:** #6285 #6320 #5946 + audit-flips #6383 #6111 #6035 #6199 #5268 #6342 #6278 #6257 #6229 #6187 #5951. #3813 rullet tilbage til todo (UI-rest).

## Spor og domme

| Issue | PR | Dom | Næste skridt |
|---|---|---|---|
| #6200 official_times_v3 (slukket) | #6397 draft | bemærkninger | enkelte seeds bryder 5/10-reglen; Fable-dommer før tænding |
| #6285 live-gates | #6399 | merget | film-fejl → #6400 |
| #5162 K4 | #6398 | bemærkninger | ejer-go (deploy-verify.yml) |
| #6201 udbrudsstørrelse | – | bekræftet + fix-plan | spec `docs/drafts/spec-6201-official-times-v3-2026-10-11.md`, ejer A/B for menneskehold |
| #5878 Supabase | – | bekræftet + fix-plan | valgkort A/B/C, `docs/audits/2026-10-11-5878-supabase-udfald.md` |
| #5864 ungdomstrup-varsling | #6401 draft | bemærkninger | ny spillertekst → ejer |
| #6320 usolgt ungdomsauktion | #6402 | merget | patch note 7.351 (#6420) |
| #5842 værdier ved skiftet | #6403 | bemærkninger | ejer vælger klokkeslæt 14-20 |
| #5946 Boardroom-mål | #6404 | merget | patch note 7.351 |
| #5897 bestyrelses-reparation | #6405 | bemærkninger | dry-run-tal → ejer; apply = "kør" |
| #5979 påmindelse kommer igen | #6406 | bemærkninger | migration; merge + post-verify |
| #5917 flyt listet rytter | #6407 draft | bemærkninger | UI-billede → ejer |
| #5831 besked fra holdsiden | #6409 | bemærkninger | UI-billede → ejer |
| #6060 kopiér dagsplan | #6410 | bemærkninger | UI-billede → ejer |
| #4522 program pr. gruppe | #6411 | bemærkninger | UI-billede → ejer |
| #5904 lasttest-gate | #6408 | blokerende → rettet (`d2975de0`) | re-review |
| #5843/#6124 | #6418 | #6124 afvist (by design) + bevistest 14/14 | merge (teknisk) |
| #5945/#6207 | #6412 draft | blokerende → rettet (`1c14ffdc`) | re-review + UI-billede |
| #6238 anlægs-procent | #6413 draft | bemærkninger | UI-billede → ejer |
| #6165 bundle | – | bekræftet + fix-plan | recharts → SVG ca. 80 KB, `docs/audits/2026-10-10-bundle-headroom.md` |
| #6370/#6318 | #6414 | bemærkninger | workflow-ændring → ejer; rebase efter #6398 |
| #5978 mål 6-måling | #6416 | bemærkninger | teknisk merge |
| #6123/#5825 | #6419 (A) | blokerende → rettet (`c57257be`) | re-review; B-branchen `fix/5825-mobile-program-catalog-fold` skal rebases på ny A |

## Hændelser
- **Anden merge-kø oven i den første** brød deploy-verify for #6402 (kl. 02:09). Ingen spillerskade; deploy-verify for #6404 og efterfølgende main er grøn. Learning: `.claude/learnings/2026-10-10-second-merge-queue-broke-deploy-verify.md`.
- **To laner skiftede worktree til deres B-branch** midt i rettetrinnet (#5945, #6123), så rettelsen lå ucommittet på forkert branch. Orkestratoren flyttede og committede den. Forslag til wave.js: rettetrinnet skal tjekke `git branch --show-current` mod sporets branch før commit.
- **Bølge-oprydning sprunget over** pga. en hængende e2e-kørsel fra rettetrinnet; markøren frigivet manuelt efter workflow-slut.
