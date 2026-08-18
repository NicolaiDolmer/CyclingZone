# KVALITETSSESSION 3 — 18/8 (masterplan + backlog + design-blokke)

Ejer-designet 18/8 via 12 struktur-spørgsmål i kvalitetssession 2 (KS2). Arkitekt i hovedtråden, sonnet-workers i worktrees, **Workflow-funktionen til backlog-bølgen** (~15 agenter pr. bølge, adversariel verifikation). Ejeren er ved computeren. Beslutninger stilles ENKELTVIST med anbefaling; **alt nyt design VISES og GODKENDES før byg** (mockup/show_widget — ejer-krav 18/8).

LÆS FØRST: `docs/NOW.md` + `docs/MASTERPLAN.md`. Claim dig i NOW.md (KS2 er lukket eller i close-out — kollidér ikke med dens 3 kvalitets-PR'er, de overdrages hertil, se punkt 2). KS2-kontekst: `docs/audits/` (session-audit 18/8) + git-log.

## HÅRDE REGLER (bindende)
- **AGENTS.md hard rule 18-23** (nye i dag): commit kun bag `scripts/guard-commit-branch.sh` · aldrig skip-logik på main · deploy-verify er del af merge-handlingen · timeout efter samtidighed · **dispatch-forfilter før HVER spawn** (`gh issue view N --json state,labels` + merged-PR-tjek — KS2 sparede en hel worker på det) · post-merge guard-tjek af main.
- Merge-politik uændret (ejer-bekræftet 18/8): type:bug uden migration/spillersynlig UI → ready + auto-merge ved grøn CI + done-flip STRAKS · **UI merges ALDRIG uden ejer-visuelt go** · migrationer: apply post-merge med post-verify (#2642) · prod-datamutationer: dry-run → tal → go → apply → uafhængig verify.
- Balance-tal aldrig på GitHub (hard rule 17). EN først, DA parallelt, ingen em-dash. Screenshots via Playwright headless, ikke Browser-panen.

## PUNKTERNE (i rækkefølge)

1. **MASTERPLAN-AJOURFØRING (først, sætter kursen):** a) Sweep merged PRs + lukkede issues siden 13/8 mod `docs/MASTERPLAN.md` — SLET færdige punkter (ejer-mandat 17/8), trim delvist done til resten. b) **Opdatér masterplan-ARTIFACTEN** (visuel udgave, link i MASTERPLAN.md-headeren) så den matcher — ejeren har set stale artifact-punkter koste en hel spildt worker. c) Triage de nyeste issues IND i planen: DM-kuldet 18/8 (#3912-#3917), weekend-kuldet (#3896-#3901), race-sporet (#3855/#3856/#3864). Spørg ejeren ved tvivl om placering.

2. **KS2-ARVEN — 3 kvalitets-PR'er til visuelt go:** [#3921](https://github.com/NicolaiDolmer/CyclingZone/pull/3921) auktioner (gold-rationering/radius/count-linjer) + dashboard-PR + rytterprofil-PR (find dem: branches `fix/quality-*-contract`, drafts med screenshots i `pr-screens/quality-*`). Vis ejeren screenshots pr. PR → visuelt go → ready + merge → **v7.141** (samlet patch note for alle tre + evt. VK-byg fra punkt 5).

3. **PATCH NOTES-PAKKEN (ejer-krav 18/8):**
   a) **Bagud-sweep website:** merges siden ~10/8 uden patch note (guarden kom først 16/8) → huller samles i ÉN opsamlings-note.
   b) **Discord-opsamling:** mål gabbet præcist (v7.123 ligger klar men upostet — hvad ellers siden sidste postede version?). Skriv ÉN samlet opsamlings-post **kategoriseret efter spilområde** (Løb & resultater / Marked & auktioner / Ryttere & træning / Økonomi / UI & hjælp), EN, klar til copy-paste. **ALDRIG poste selv** — ejeren poster.

4. **DESIGN-BLOKKENE (med ejeren, én ad gangen, mockup → godkendelse → byg):**
   a) **S2-SÆSONRECAP (tidskritisk — klar FØR søndag 23/8):** hver managers sæsonhistorie ved sæsonslut (øjeblikke, awards, tal — delbar). FORFILTER FØRST: der findes allerede en sæson-dokumentar/recap-flade (help-entry `seasonDocumentary`, `3366-saeson-recap.png`, SeasonExperiencePreviewPage) — mål hvad der ER, design forbedringen oven på, genopfind intet.
   b) **RACE-TEATRET #3859:** afspiller v2 ligger som draft [PR #3863](https://github.com/NicolaiDolmer/CyclingZone/pull/3863) (v1 ejer-afvist; v2 ægte silhuet + bundle 924→926 KB afventer go). Event-loggen flyder LIVE fra 18/8 kl. 11 (#2410 bevist). Genoptag: vis v2 → go/justér → færdiggør afspiller + etapeside. #3914 (resultat øverst + sammenklappelige sektioner) designes SAMMEN med etapesiden.
   c) **EJER-DIREKTIVERNE, rækkefølge:** [#3901](https://github.com/NicolaiDolmer/CyclingZone/issues/3901) sæsonskiftet S2→S3 FØRST (cutover om 5 dage — kommunikation/fees/oplevelse) → [#3900](https://github.com/NicolaiDolmer/CyclingZone/issues/3900) sæson-overblik løb/ruter (**#3915 dagens-etaper-på-dashboard er nært beslægtet — design samlet**) → [#3899](https://github.com/NicolaiDolmer/CyclingZone/issues/3899) økonomi-forecast (respektér værdi-sporets gates; design-delen er fri, tal-delen er gated af #3393-sessionen).
   d) **TRÆNINGS-FØLELSEN (ejer-forslag 18/8):** design-blok om træningens feedback-OPLEVELSE. AFGRÆNSNING: rør IKKE caps/progression-matematik (trin 7-sporet, ons/tor, #3798/#3592) — kun fladen/formidlingen oven på eksisterende data (kvitteringer, momenter, forventnings-styring).

5. **VK-FUNDENE fra KS2 (alle 4 ejer-valgt; design vises før byg):** a) vedvarende "overbudt"-markering i auktionsrækker (i dag 4-sek toast) · b) delta/bevægelses-signaler på dashboardets frosne moduler (koordinér med #2-merges!) · c) trajektorie-linje i rytter-hero · d) budkrigs-markør i auktionshistorik. Audit-grundlag: KS2's scratchpad-rapporter er destilleret i session-auditten; fil:linje-referencer i `docs/audits/`-materialet.

6. **DM-BUGS (design-først, ejeren godkender FØR byg):** [#3913](https://github.com/NicolaiDolmer/CyclingZone/issues/3913) trøje-point viser præmiepoint (HIGH — vis før/efter-design) · #3916 fane-state på andres hold · #3912 digest-deeplink. #3917 (sprint-investigation) er motor-analyse: kør målingen, rapportér, byg intet uden go.

7. **BACKLOG-WORKFLOW (mål: net −40 af 533):** Workflow-funktionen, ~15 agenter pr. bølge: forfilter → klassificér (done-verificér / småbug-fixable / won't-do-kandidat / dublet) → småbug-workers i worktrees → **adversariel verifikation af hvert fix/lukning** → lukninger med evidens + draft-PR'er. Won't-do-bundter a 15-20 til ejer-domme (én linjes begrundelse pr. issue). Done-flips STRAKS pr. merge.

8. **#3903 UNGDOMSAUKTIONS-KVOTEN (deadline FØR 21/8):** frisk måling (usolgt-rate, prisniveau, kø-længde, cutover-overlap) → A/B med anbefaling → ejer-dom → implementér valget.

## IKKE I DENNE SESSION (gated andetsteds)
**Løn-design #3393+#2840 — SKAL stadig BOOKES som egen session FØR søndag (mind ejeren om det ved close-out!)** · kalender-pakken #3862 + regenerering (kalender-session) · trin 7 #3798 + #3592-indfoldning + frie-agent-backfill (ons/tor, ejer-planlagt) · værdi-sporets beslutninger (#3449/#3729/#3732/#3756) · race-day-flip/cutover-flader (søndag, ejer+Claude) · #3066-genmåling (trin 7-sessionen, events ≥19/8 → genåbn).

## CLOSE-OUT
Session-audit i `docs/audits/` · done-flips verificeret · v7.141 + Discord-udkast leveret · NOW.md: Working agent nulstilles, 🎯 → løn-design-session (før søndag!) + ons/tor trin 7 · masterplan + artifact ajour (slet færdige!) · token-hygiejne-scriptet kørt · deploy-verify + guard-tjek efter sidste salve.
