# Frigivelse midt i et etapeløb venter til løbets slut (#8153)

Status: løsning og tekster godkendt af ejeren 14/11. Intet er bygget; bygges efter bølgen 14/11 (Opus bygger, Fable dømmer før merge).

## Problemet

En rytter, der frigives midt i et etapeløb, forsvinder fra løbet fra næste etape uden resultatrække og uden "udgået". De andre managers ser en rytter forsvinde fra klassementet uden grund.

## Målt udgangspunkt (prod, kun læsning, 14/11)

| | 30 dage | 7 dage |
|---|---|---|
| Frigivelser i alt (`rider_ownership_events.reason = 'release'`) | 2.016 | 75 |
| Heraf rytter midt i et etapeløb (mellem første og sidste etape i `race_stage_schedule`) | 15 | 4 |

Ventetid til sidste etape for de 15: 2,9 dage i snit, 6,7 dage længst. 266 hold frigav mindst én rytter på 30 dage. Tallet 2.016 indeholder alle hændelser med årsagen `release`; om nogle er masse-frigivelser, er ikke undersøgt.

## Ejerens valg (14/11)

1. Frigivelsen bestilles, men træder først i kraft efter etapeløbets sidste etape (samme regel som salg, #8090).
2. Gebyret trækkes straks ved bestillingen.
3. Rytteren tæller i truppen, indtil han er væk.
4. En bestilt frigivelse er endelig og kan ikke fortrydes.

## Løsning

**Ny tabel `pending_rider_releases`** (kun `service_role`, RLS on, samme mønster som `sale_escrows`): `rider_id` (unik for aktive rækker), `team_id`, `fee`, `ordered_at`, `ordered_by`, `status` (`pending` / `executed` / `cancelled_by_system`), `executed_at`. Én aktiv række pr. rytter.

**Bestilling** (`POST /riders/:id/release`): alle dagens tjek er uændrede (auktion, solgt og venter, råd til gebyret, låste penge, trup-minimum). Nyt: er rytteren i et aktivt etapeløb (`getRidersInActiveStageRace`, samme diskriminator som salg bruger), oprettes rækken og gebyret trækkes i samme lås som i dag (`releaseRiderUnderTeamLock`), men `team_id` røres ikke. Svaret siger, at frigivelsen venter, og hvilket løb den venter på. Er han ikke i et aktivt etapeløb, sker alt som i dag.

**Udførelse:** ved løbets finalisering, samme sted som `flushDeferredTransfersForRace`, og som sikkerhedsnet i den eksisterende `deferredTransferHealSweep` (en bestilling, hvis løb er slut, udføres ved næste kørsel). Udførelsen er dagens frigivelse uden gebyr: `team_id = null`, kontraktfelter nulstilles, transfer-opslag lukkes, ejerskabshændelse skrives. Idempotent via `status`.

**Mens den venter:**
- Rytteren kører løbet færdigt og kan ikke sælges, byttes, sættes på auktion eller transferliste (ét delt prædikat ved siden af `getParkedRiderReleaseIssue`).
- Han kan ikke udtages til løb, der starter efter det igangværende etapeløbs sidste etape.
- Han tæller i truppen og i trup-minimum, og lønnen følger de nuværende regler, indtil han er væk.
- Sæsonskifte tvinges ikke igennem, mens der står ventende frigivelser (samme regel som låste salg).

**Spilleren ser:** et mærke på rytteren på holdsiden og rytterprofilen, en linje i bekræftelses-dialogen før bestilling, og to beskeder (ved bestilling og når han er væk).

**Kontakt:** `release_defer_8153`, slukket ved merge. Slukket er bit for bit som i dag.

## Tekster (godkendt af ejeren 14/11, ordret)

| Sted | EN | DA |
|---|---|---|
| Dialogens ekstra linje | He is riding {race}. He leaves your team after the final stage. The fee is charged now and the release cannot be undone. | Han kører {race}. Han forlader dit hold efter sidste etape. Gebyret trækkes nu, og frigivelsen kan ikke fortrydes. |
| Mærke på rytteren | Leaves after {race} | Forlader holdet efter {race} |
| Besked ved bestilling | {rider} will be released after {race}. The fee of {fee} CZ$ has been charged. | {rider} frigives efter {race}. Gebyret på {fee} CZ$ er trukket. |
| Besked ved udførelse | {rider} has left your team. | {rider} har forladt dit hold. |
| Forsøg på at sælge imens | This rider is leaving your team after {race} and cannot be traded. | Rytteren forlader dit hold efter {race} og kan ikke handles. |

Dertil et afsnit i Hjælp og en patch note ved tænding.

## Prøver og dom

- Fast ur i alle prøver (AGENTS regel 16).
- Slukket kontakt: uændret mod main.
- Bestilling midt i løb: gebyr trukket én gang, rytter stadig på holdet, resultatrække på hver resterende etape.
- Udførelse ved finalisering og via sikkerhedsnettet, begge idempotente.
- Dobbelt bestilling, bestilling samtidig med salg, og for lidt på saldoen.
- Penge og ny tabel: Opus bygger, Fable dømmer før merge.

## Ikke med

- At fortryde en bestilling (ejer: endelig).
- Akademi-frigivelse (`academy-release`) og kontraktudløb (#4423): egne spor, hvis de viser samme fejl.
- Vagten CYCLINGZONE-55 røres ikke; den bliver tavs for denne årsag, fordi rytteren ikke længere forsvinder.

## Åbne spørgsmål

- Tænding: for alle på én gang eller beta først (ejerens eget tænd-kort).
