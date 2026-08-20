# Kvalitetssession 2 — 18/8 (session-audit)

Prompt: `docs/sessions/2026-08-18-kvalitetssession-2-prompt.md`. Arkitekt (Fable) i hovedtråden, sonnet-workers/agenter i baggrunden. Alle 9 punkter leveret; ejeren traf 14 enkeltvise domme undervejs.

## Leveret pr. punkt

1. **CodeQL:** #185 (format-string) + #184 (regex-escape) fixet korrekt (PR #3909, merged + auto-merged), begge alerts verificeret `fixed` på main 07:58Z — **0 åbne CodeQL-alerts**.
2. **Opsamling:** #3878/#3893/#3671 landede via formiddagssessionen (gated som aftalt). **#3684:** det klargjorte fix var INERT (0 snapshot-diffs; parent-`td`-masker maler børn) og første ombygning bestod ikke sin negativ-test (fullPage-tolerance) — endeligt fix = umaskeret ELEMENT-snapshot af ny statColor-sektion på /ui, **bevist med negativ-test på alle 3 projekter** (PR #3918, merged; learning: `2026-08-18-pixel-mask-hid-badge-colors.md`). **Timeline-beviset:** tom tabel kl. 09:53 var FORVENTET (flag tændt EFTER gårsdagens sidste etape); første row landede 11:08 (1 race, 9 events) → Detector A-suppression fjernet (PR #3919, merged) + Sentry-capture på persist-fejlstierne (PR #3910, merged). v7.140 + Race Centre-help-entry (en+da) shipped (PR #3920, merged).
3. **Kvalitets-offensiven:** 3 adversarielle kode-audits (dashboard/rytterprofil+træning/marked-auktioner) → 36 fund; topfund spot-verificeret (gold-i-hver-række + CZ$-suffiks ÆGTE; "stars only"-fundet FALSK POSITIV — kontrakten var forældet ift. landing 1). Ejer-domme: CZ$-suffiks beholdes (kontrakt rettet); dashboard-bredde → ejeren bad om verdensklasse-vurdering (overdraget KS3-design). 3 worker-PR'er med mekaniske kontrakt-fixes: **#3921 auktioner (draft, klar)** + dashboard + rytterprofil (workers melder i mål; alle drafts m. screenshots). **Overdraget til KS3: visuelt go + merge + v7.141.** VK-fund (overbudt-persistens, dashboard-deltaer, hero-trajektorie, budkrigs-markør) → alle 4 ejer-valgt til KS3.
4. **#3592:** forfilter fandt at PR #3739 allerede brød 2 af 4 delmængde-par. Måling: gc/tt 63,8 % uafgjort, brostens/rouleur 74,1 % (kontrol 7-10 %). Kandidat (caps-only ejerskabsfunktion i `youthRoleFactor` + gc.time_trial 3→2) fjerner begge par (0 %), bivirkning baroudeur −20,1/brostens −12,1. **Ejer-valg: foldes ind i trin 7.** Materiale: `docs/audits/2026-08-18-3592-caps-formning/`; krav noteret på #3803.
5. **#3733:** alle 3 domme truffet på visuelle mockups — to-linje-split · kort neutral no-signal-copy (beroligelse fravalgt) · profil + én samlet søndags-notifikation. Design-lås dokumenteret på issuet.
6. **#3719/#3720:** måling + A/B forelagt; **ejer-valg: udskudt til løn-design-sessionen.**
7. **#3066:** dispatch-forfilter fangede at issuet var SHIPPED+LUKKET 17/8 (PR #3825) — sparede en hel worker. Acceptkriterie-query kørt: 1 tvivls-event efter deploy (muligvis gammel bundle); genmåles i trin 7-sessionen, events ≥19/8 → genåbn.
8. **#3661:** 5 regler destilleret, ejer-godkendt, committet som **AGENTS.md hard rule 19-23** (omnummereret efter parallel-sessionens regel 18 branch-guard).
9. **Hygiejne:** ejer-bundtet (6) dømt → #3621/#3498/#3133/#3134/#2883 lukket, #2840 → løn-session. #3614-rest: dry-run målt — 0 reparerbare i dag (60 i aktiv auktion), plan ~22/8 står. NOW/masterplan ajourført + trimmet.

## Deploy-verify + guard-tjek (regel 20/23)
Efter hver salve: production-deploys READY på Vercel (verificeret for 3ec9cd5c, 0cd7b002, v7.140-merge); CI på main grøn hele vejen (CodeQL/Deploy verify/i18n/AI-Autopilot/Lighthouse).

## Hændelser + læringer
- **Delt-checkout-kollision:** mit e2e-baggrundsjob skiftede hoved-checkoutets branch mens en parallel session committede — deres commits landede på min feature-branch. Løst via cherry-pick-afklaring + rebase; parallel-sessionen byggede samtidig `scripts/guard-commit-branch.sh` + hard rule 18, som denne session tog i brug med det samme.
- **To attrap-fixes afsløret på #3684** (inert selector + tolerance-ædt vagt) — kun negativ-testen beviste den tredje. Læring skrevet.
- **Dispatch-forfilteret virkede dobbelt** (#3066-worker sparet; #3592 halveret scope) — nu hard rule 22.

## Ejer-domme i sessionen (14)
#3733×3 · #3592-ship-gate · #3719/#3720-A/B · CZ$-format · ejer-bundt×6 · AGENTS-regler · v7.140-tekst. + 12 KS3-design-svar.

## Overdraget til KS3
3 kvalitets-draft-PR'er (visuelt go + merge + v7.141) · dashboard-bredde-spørgsmålet (verdensklasse-vurdering) · VK-fund×4 · [KS3-prompt](../sessions/2026-08-18-kvalitetssession-3-prompt.md). **Løn-design-session bookes FØR søndag.**
