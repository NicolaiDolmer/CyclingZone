# Ejer-dashboard — backlog-audit 2026-06-11

> Alt på denne side kræver **Nicolai**. Rækkefølgen er den anbefalede arbejdsrækkefølge mod relaunch 20/6.
> Audit-detaljer: `.claude/audits/audit-2026-06-11.md` · Ledger: [#627](https://github.com/NicolaiDolmer/CyclingZone/issues/627)

## 1. Kritisk sti til 20/6 (afhængigheds-rækkefølge)

1. **[#1101](https://github.com/NicolaiDolmer/CyclingZone/issues/1101) ejer-verify af shadow-værdier** i admin-preview — **FLASKEHALSEN**: låser cutover + hele kæden op. Scorecard-værktøjet (#1196) gør det til en ~10-min ja/nej-beslutning. Tag [#1231](https://github.com/NicolaiDolmer/CyclingZone/issues/1231) (baroudeur-anchor, anbefaling: fix nu, lille) i samme arbejdsgang.
2. **[#375](https://github.com/NicolaiDolmer/CyclingZone/issues/375) backup-beslutning** — Supabase Pro ER købt 10/6, men issuet skal afgøres formelt: bekræft at PITR/backups faktisk er aktive FØR den destruktive relaunch-migration. (Anbefaling: bekræft + luk.)
3. **[#1103](https://github.com/NicolaiDolmer/CyclingZone/issues/1103) relaunch-kørsel 20/6** — alt dev-scope er færdigt og generalprøvet (9/9 PASS 11/6); kørslen er gated på (1).
4. **[#1102](https://github.com/NicolaiDolmer/CyclingZone/issues/1102) race-motor runtime-wiring** — motoren har 0 runtime call-sites + vinderrater under mål (flat 62% vs ≥90%); tuning + wiring er det største RESTERENDE kodearbejde før 20/6.
5. **[#1140](https://github.com/NicolaiDolmer/CyclingZone/issues/1140) onboarding** — kræver din design-beslutning før byg.
6. **[#1278](https://github.com/NicolaiDolmer/CyclingZone/issues/1278) relaunch-kommunikation til spillerne** — jo før jo bedre; spillerne handler nu på forældede antagelser.
7. Launch-bugs på high: [#906](https://github.com/NicolaiDolmer/CyclingZone/issues/906) (54 Sentry-events) · [#45](https://github.com/NicolaiDolmer/CyclingZone/issues/45) (gældsloft-exploit) · [#31](https://github.com/NicolaiDolmer/CyclingZone/issues/31) (død knap i økonomi-flow) — natbølge-kandidater.
8. **[#929](https://github.com/NicolaiDolmer/CyclingZone/issues/929)** security-dashboard-klik (2 min, se pkt. 3 nedenfor).

**Åbent spørgsmål der ændrer kæden:** Er [#677](https://github.com/NicolaiDolmer/CyclingZone/issues/677) (fysiologi-stats) stadig launch-blokerende for #1102, eller kører light-motoren på de eksisterende abilities? K-verify 11/6 fandt at kerne-scopet blev deferred post-launch (din beslutning 7/6, koblet til #1021) — i så fald bør #677 omlabeles post-launch og kæden er kortere end NOW.md antyder. **Svar: ☐ launch / ☐ post-launch**

## 2. Prod-checkliste (~10-15 min, lukker 11 done-issues)

AI har allerede maskin-verificeret og lukket 9 i dag. Disse kan kun du se (data-afhængige sider, mock renderer tomt). Log ind på cycling-zone.vercel.app:

**Stop 1 — /board (ét besøg dækker 7):**
- [ ] [#102](https://github.com/NicolaiDolmer/CyclingZone/issues/102) De 9 personlighedstyper er synlige/forklaret (transparens-panel)
- [ ] [#167](https://github.com/NicolaiDolmer/CyclingZone/issues/167) Mål-rækkefølge: 1-års først, 3-års i midten, 5-års sidst
- [ ] [#694](https://github.com/NicolaiDolmer/CyclingZone/issues/694) Board-reaktioner viser ENGELSK på EN-sproget (skift sprog øverst)
- [ ] [#815](https://github.com/NicolaiDolmer/CyclingZone/issues/815) "Stjernesignering"-mål viser antal stjerner krævet
- [ ] [#818](https://github.com/NicolaiDolmer/CyclingZone/issues/818) Note der forklarer forhandlingsrækkefølgen (5 år → 3 år → 1 år)
- [ ] [#989](https://github.com/NicolaiDolmer/CyclingZone/issues/989) "Hvordan måles dette?"-note på 3-årsplanens top-X-mål
- [ ] [#1030](https://github.com/NicolaiDolmer/CyclingZone/issues/1030) Mål/medlemmer er klikbare (affordance)
- [ ] [#821](https://github.com/NicolaiDolmer/CyclingZone/issues/821) Layout-fanerne gør siden læselig (subjektiv dom — din)

**Stop 2 — /finance:** [ ] [#1012](https://github.com/NicolaiDolmer/CyclingZone/issues/1012) Låneformular viser "max lånbart" (gebyr-inkl.) + Brug max-knap

**Stop 3 — /dashboard:** [ ] [#1031](https://github.com/NicolaiDolmer/CyclingZone/issues/1031) Divisions-stilling-rækker + kort er klikbare

**Stop 4 — telefon:** [ ] [#1185](https://github.com/NicolaiDolmer/CyclingZone/issues/1185) Fjern-fra-transferliste virker på mobil (ingen død confirm-dialog) · [ ] [#1007](https://github.com/NicolaiDolmer/CyclingZone/issues/1007) Tjek dit Discord-screenshot: var klagen TOP-bjælken (fixet) eller BUND-tab-baren (ikke rørt)?

**Stop 5 — brand ([#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671)):** [ ] Wordmark/monogram ser rigtigt ud i sidebar + login + landing (begge temaer) · [ ] Discord-serverens ikon bruger det nye icon-512

**Event-gated (ingen handling nu):** [#1187](https://github.com/NicolaiDolmer/CyclingZone/issues/1187) lukkes efter næste weekend-finalization (tilfredshed skal bevæge sig) · [#1115](https://github.com/NicolaiDolmer/CyclingZone/issues/1115) lukkes når næste overbuds-DM leverer (outbox-tabel verificeret på plads).

## 3. Beslutninger (needs-decision — anbefaling pr. styk)

| Issue | Hvad | Anbefaling |
|---|---|---|
| [#375](https://github.com/NicolaiDolmer/CyclingZone/issues/375) | Backup-gap (Pro købt 10/6) | **Bekræft PITR aktiv + luk — FØR relaunch** |
| [#1276](https://github.com/NicolaiDolmer/CyclingZone/issues/1276) | PCM-dump m. rigtige navne i public repo | Beslut A (purge) / B (flyt ud) — før 20/6 |
| [#1277](https://github.com/NicolaiDolmer/CyclingZone/issues/1277) | Resend Pro vs 100 mails/dag | Køb Pro hvis marketing skal bære >100 signups/dag |
| [#1239](https://github.com/NicolaiDolmer/CyclingZone/issues/1239) | Board-DNA giver ikke mening | MVP-design-session FØR 20/6 (eneste billige vindue — alle boards regenereres) |
| [#1231](https://github.com/NicolaiDolmer/CyclingZone/issues/1231) | Baroudeur kan koste 189M | Fix anchors+band nu (lille, sammen med #1101-verify) |
| [#1207](https://github.com/NicolaiDolmer/CyclingZone/issues/1207) | Pensioneret UCI-sync kan skrive til frossen kolonne | Slet koden helt før 20/6 (git-historik = revert) |
| [#401](https://github.com/NicolaiDolmer/CyclingZone/issues/401) | Migration-drift schema-spejle | Option B (CI-guard) — billig, før relaunch-migrationsbølgen |
| [#97](https://github.com/NicolaiDolmer/CyclingZone/issues/97) | Gældsloft hård enforcement | Post-launch; re-baseline mod NY økonomi efter relaunch |
| [#937](https://github.com/NicolaiDolmer/CyclingZone/issues/937) | Mobilapp | PWA, post-launch |
| [#940](https://github.com/NicolaiDolmer/CyclingZone/issues/940) | NPS-måling | Post-launch (lille testergruppe = ikke signifikant) |
| [#941](https://github.com/NicolaiDolmer/CyclingZone/issues/941) | Regnskabsprogram | Beslut Dinero nu; opsæt ~4/7 med Alunta |
| [#942](https://github.com/NicolaiDolmer/CyclingZone/issues/942) | Firma-PC | Ikke nu — værst tænkelige timing |
| [#976](https://github.com/NicolaiDolmer/CyclingZone/issues/976) | Min Aktivitet → Indbakke | Retning låst (din 8/6-kommentar); implementér post-launch |
| [#874](https://github.com/NicolaiDolmer/CyclingZone/issues/874) | Codex-automations | Post-launch samlet review |
| [#1235](https://github.com/NicolaiDolmer/CyclingZone/issues/1235)+[#1237](https://github.com/NicolaiDolmer/CyclingZone/issues/1237) | Board: forhandl OP + saldo-vs-gæld | Post-launch, bundtet i ÉN simulering |
| [#1282](https://github.com/NicolaiDolmer/CyclingZone/issues/1282) | Swap: fjern/flag/instrumentér | Beslut ved relaunch (A: flag-skjul + instrumentér) |
| [#954](https://github.com/NicolaiDolmer/CyclingZone/issues/954) | Roadmap-voting: 20/6-kriterium vs post-launch-label | MVP: statisk synligt roadmap til 20/6; voting post-launch; opdatér launch-planens kriterium |

_(#945 GA4 + #946 helpdesk: besluttet + lukket i dag per din godkendelse.)_

## 4. Discord/community (NUA — reality-checked i dag, alle reelt åbne)

[#419](https://github.com/NicolaiDolmer/CyclingZone/issues/419) Carl-bot/Dyno · [#679](https://github.com/NicolaiDolmer/CyclingZone/issues/679) welcome-flow (nu inkl. #420-scope, launch-high, gated af #671-brand) · [#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428) content-kalender · [#430](https://github.com/NicolaiDolmer/CyclingZone/issues/430) moderatorer (gate: ≥50 medlemmer, har 13) · [#431](https://github.com/NicolaiDolmer/CyclingZone/issues/431) AMA · [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) key-rotation (nedprioriteret til med/post-launch — rotation tæt på launch er selvskade). **Anbefalet minimum før 20/6: #679 + #419** (landingsplads for ekstern push).

## 5. Kuraterede spørgsmål fra auditten (svar når du har tid)

1. [#34](https://github.com/NicolaiDolmer/CyclingZone/issues/34): Hvad viser screenshotet — hvilken forhandling burde ikke kunne lade sig gøre? (Ellers: luk som vag.)
2. [#109](https://github.com/NicolaiDolmer/CyclingZone/issues/109)/[#42](https://github.com/NicolaiDolmer/CyclingZone/issues/42): Beholder fiktive ryttere eksisterende fødselsdatoer, eller fixes U25-data i relaunch-migrationen?
3. [#17](https://github.com/NicolaiDolmer/CyclingZone/issues/17): Lånedesign (renter fra dag ét?) — genbesøges samlet efter nyt værdisystem?
4. [#230](https://github.com/NicolaiDolmer/CyclingZone/issues/230): Proxy-bud: auto-cancel (A), opt-in toggle (B) eller bedre signalering (C)?
5. [#311](https://github.com/NicolaiDolmer/CyclingZone/issues/311): Er max-størrelse på ønskelisten en bedre løsning end det foreslåede?
6. [#56](https://github.com/NicolaiDolmer/CyclingZone/issues/56): Lever sheet-import videre som PCM-fallback, eller dør kodestien?
7. [#680](https://github.com/NicolaiDolmer/CyclingZone/issues/680): Spor A/B superseded af #1105 — må spor D merges ud og issuet lukkes?

## 6. AI kører på kommando (post-launch investigations, klar når du siger til)

AI-ops-serien [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605)/[#609](https://github.com/NicolaiDolmer/CyclingZone/issues/609)/[#622](https://github.com/NicolaiDolmer/CyclingZone/issues/622)–[#633](https://github.com/NicolaiDolmer/CyclingZone/issues/633) · [#797](https://github.com/NicolaiDolmer/CyclingZone/issues/797) mobil-tabel-research · [#1130](https://github.com/NicolaiDolmer/CyclingZone/issues/1130) Clarity-analyse (vindue modent ~13/6) · [#1141](https://github.com/NicolaiDolmer/CyclingZone/issues/1141) board-instrumentering. **I gang nu (11/6):** [#1180](https://github.com/NicolaiDolmer/CyclingZone/issues/1180) admin-relaunch-sweep + [#563](https://github.com/NicolaiDolmer/CyclingZone/issues/563) Infisical-status — resultater lander som issue-kommentarer.
