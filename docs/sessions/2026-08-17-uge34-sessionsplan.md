# Uge 34-sessionsplan (ejer-designet 17/8 via 8 spørgsmål, race-oplevelses-sessionen)

> Cutover søndag 23/8. Tre fokuserede sessioner i rækkefølge (ejer-valgt), derefter cutover
> hvor ejer + Claude sidder sammen hele forløbet (ejer-valgt). Motor v4-design (#3855) og
> pressen ligger i S3 uge 1 (ejer-valgt). Denne fil er de næste sessioners startprompter.

## Session 1 (tir/ons): S3-kalenderen — scorecard-go + store forbedringer

**Mål:** S3-kalenderen står færdig og ejer-godkendt FØR 23/8.

1. Gennemgå #3546-pakkens dry-run-scorecard med ejeren (PR fra 17/8-worktree: GT 17-18,
   Giro-sprednings-rodfix, afgørelses-invariant, itt_hilly). Grønt scorecard → merge →
   regenerering med ejeren ved tasterne.
2. **Ejer-udvidelse 17/8: "vi skal lave flere store forbedringer til løbskalenderen for
   sæson 3. Se gerne forslag fra discord."** Start med Discord-sweep: megathreaden
   ("Season 3 calendar megathread"), #dansk-snak 8/8, #feedback-and-ideas siden 8/8 +
   sidepunkterne fra #3547 (triple-overlap-afklaring, reduced-sprint-visualisering,
   næste-sæsons-kalender-visning) og #3471 (kalender-spor med identitet). Læg forslagene
   som beslutningsoplæg, ét ad gangen, tal + anbefaling.
3. Regenererings-protokol: ejeren ser live-kalenderen + scorecardet før den "atombombe"
   (ejer-review-reglen). Backup/rollback-værktøjet fra PR #3835 genbruges.

## Session 2 (ons/tor): Trin 7-overgangssessionen (FØR cutover, ejer-valgt 17/8)

Følg NOW.md's definerede treer: (1) mål på staging (`staging-3746-trin7`) hvor stor den
OPLEVEDE ændring er pr. spiller (prognose-bånd-flytninger pr. gennemsnitshold), (2) byg
engangspanelet "Hvad ændrede sig for dine ryttere?", (3) finpuds spillerbeskeden ud fra
målingen. Derefter A0-beslutningerne (merge-go for PR #3798 + Potentiale-omdøbning) →
A1 → A2-A5. Bemærk: trin 7-flip SAMMEN med/lige efter cutover er nu muligheden ejeren
har åbnet — flip-beslutningen er stadig ejer-gated.

## Session 3 (tor/fre): Race-oplevelsen til S3-start

**Mål:** S3's første løbsdage FØLES nye. Forudsætning: #2410 S1 merged + migration
applied + flag ON (ejer-go 17/8: "ON straks efter verify").

1. #3859 etapesiden før/under/efter + løbsfilm-afspilleren (mockup-kontrakt godkendt;
   draft-PR + screenshots til ejer-go; lazy-loaded, bundle-vagt ~6 KB).
2. #3858 Race Centre hvis tid (kontrakt godkendt; "Around the divisions"-strippen må udgå).
3. De 6 godkendte renderer-forbedringer verificeres i S1-generatorens output mod ægte data.

## Cutover søndag 23/8

Ejer + Claude sammen hele forløbet (ejer-valgt 17/8). Drejebog:
docs/2026-08-23-cutover-drejebog.md. Indhold: race-day-flip + mandat-backfill.
Ejer-klik før dagen: post race-day-beskeden (cutover-beskeder besked 1).

## S3 uge 1 (24-31/8)

- **#3855 motor v4 design-spec-session** (ejer-valgt timing) — segment-model, rng-budget,
  kalibrerings-strategi, simulér-før-ship-harness, cutover-plan. Byg først efter spec-godkendelse.
- **Pressen** (ejer-formet 17/8): TRE formater — (1) wire-notits 2-3 sætninger ALLE etaper,
  (2) fuld reportage KUN store løb/afgørende etaper (trigger: løbsklasse/trøjeskift/drama-
  significance), (3) **optakter** (ejer-prioriteret): preview fra rutedata + startliste + GC,
  bor i etapesidens FØR-tilstand + Race Centre. Design-session før byg.
- #3856 backfill-beslutning når filmen har bevist sig.
