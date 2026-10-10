# Morgenblok 10/10: kort til ejeren (ét ad gangen)

Kilde: natsessionen 10/10. Rækkefølge efter natprompten. Hvert kort har nøgletal i selve spørgsmålet.

## 1. Form og formtoppe (#6156): hvornår tændes de?
Kortet ligger på issuet (17/10 samlet eller ved S5 25/10). Draft-PR #6305 er udgangspunktet. Nattens #6285-tvillingetest bekræfter: formtop har i dag ingen virkning i motoren (`groups.ts:61` sender `form: null`).

## 2. MASTERPLAN
Kun færdigt fjernet, rækkefølgen er uændret. Forslag: tilføj #6400 (løbsfilmen skjuler en indhentning, fundet af den nye kædetest) under "Resultat, mærker og løbsfilm". Ja/nej.

## 3. Roadmap (9 ændringer, billede `pr-screens/roadmap-10-10/card.png`)
Forslag + SQL: `docs/drafts/roadmap-proposal-2026-10-10.md`. Vigtigst: "Training fixes" siger i dag, at Train now ikke længere låser. Den låser nu bevidst. Godkend alle 9, eller sig hvilke ud. Underspørgsmål: skal "Form og formtoppe" stå som "in progress" nu eller først efter kort 1?

## 4. Discord: roadbook + patch notes
- Roadbook-udkast: `docs/drafts/discord-roadbook-2026-10-10.md` (ingen datoer eller tal, jeg-form).
- Patch note 7.351 (PR #6420, web): usolgt egen U23/junior-rytter bliver på holdet; Boardroom viser de mål, du skrev under på. Merge efter dit OK.
- Catch-up 7.345-7.350 til Discord fik du kl. 00:15.
- Åbent: "upkeep 0" stod på listen over næste roadbook, men jeg fandt ingen kilde til, hvad punktet skal sige.

## 5. GitHub-audit: done-issues du kan lukke
Liste med én linje pr. issue: `docs/audits/github-audit-2026-10-10.md`. Ca. 30 er klar (merget, på main, patch note eller ingen spillertekst). Nattens merges tilføjer #6285 #6320 #5946 #6187 #5951.

## 6. PRer der venter på dig
| PR | Hvad | Hvorfor du |
|---|---|---|
| #6398 | Chunk-fejl K4: carry-forward-probe + fejl pr. release (#5162) | rører deploy-verify.yml |
| #6403 | Værdier ændres ikke ved sæsonskiftet (#5842) | klokkeslæt for søndagens værdikørsel: pladsholder 14, du vælger 14-20 |
| #6401 | Varsling når en ungdomstrup bliver for lille ved kontraktudløb + S4->S5-forhåndsvisning (#5864) | ny spillertekst EN+DA |
| #6406 | Slettet holdudtagelses-påmindelse kommer ikke igen (#5979) | ny tabel (migration via auto-migrate) |
| #6405 | #5897 skærpet gate + frisk dry-run af bestyrelses-reparationen | tal til dig; apply kræver dit "kør" |
| #6414 | frontend-freshness + deploy-verify-filter + cron-ventetid (#6370/#6318) | workflow-ændring; skal rebases efter #6398 |
| #6416 | Mål 6-målingen forankret på favoritternes gruppe (#5978) | teknisk, kan merges af mig efter dit OK til kort 6 |
| #6418 | Bevistest: assistenten overskriver ikke selvvalgt U23-udtagelse (#6124 = by design) | teknisk |
| #6397 | Slukket revision official_times_v3 (#6200) | motor: enkelte seeds bryder stadig din 5/10-regel; Fable-dommer før tænding |
| #6408 | Lasttest-gate for en hel løbsdag (#5904) | reviewet BLOKERENDE, rettet af bølgen; re-review |

UI-drafts (ét før/efter-billede hver i `pr-screens/<issue>/`, merge kun efter dit go): #6409 besked fra holdsiden (#5831) · #6410 kopiér dagsplan (#6060) · #6411 assistentens program pr. gruppe (#4522) · #6407 flyt listet rytter mellem trupper (#5917) · #6413 samme procent for træningsanlægget (#6238) · #6412 juniorhold der ikke kan starte + rutematch (#5945/#6207, re-review) · #6123/#5825 nulstil til holdprogram + mobilkatalog.

## 7. Beslutninger fra nattens undersøgelser
- **#5878 database-vagt:** valgkort A (kun alarm) / B (alarm + automatisk genstart, højst én pr. time) / C (Supabase' egen). Audit: `docs/audits/2026-10-11-5878-supabase-udfald.md`.
- **#6165 bundle:** headroom 1,0 KB. Størst gevinst: recharts erstattet med SVG (ca. 80 KB, spillervendt donut i sæsonrapporten). Rapport: `docs/audits/2026-10-10-bundle-headroom.md`.
- **#6201 udbrudsstørrelse:** bekræftet under trappen; spec til official_times_v3 i `docs/drafts/spec-6201-official-times-v3-2026-10-11.md`.
- **#6318:** skal 30-min-jobs være "deferred" i deploy-verify (hurtigere merges, svagere bevis)? Konsekvens beskrevet i #6414.

## 8. PostHog-nøgle (#6310)
Du opretter `POSTHOG_PERSONAL_API_KEY` (kun Query: Read).
