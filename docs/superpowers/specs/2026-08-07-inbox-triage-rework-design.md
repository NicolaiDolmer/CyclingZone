# Indbakke-rework: Triage-indbakken (Retning A, mod cockpit-mål B)

> **Status:** Design ejer-godkendt 2026-08-07 (retning + tier-split). Implementering ikke påbegyndt.
> **Forankring:** [#2223](https://github.com/NicolaiDolmer/CyclingZone/issues/2223) (indbakke-UI-rework) under epic [#62](https://github.com/NicolaiDolmer/CyclingZone/issues/62) (Manager Inbox).
> **Audit-grundlag:** 6 parallelle research-spor 7/8 (frontend, backend, GitHub, Discord, prod-data, benchmark). Nøgletal og fund er refereret inline.

## Ejer-beslutninger (2026-08-07)

1. **Retning: A nu, B som fast slutmål.** A = triage-indbakke med notifikations-kontrakt. B = manager-cockpittet (FM-modellen: indbakken som primær landingsflade, "Næste træk" foldet ind). Alle delvalg i A designes B-kompatibelt.
2. **Tier-split godkendt** inkl. det bevidste fravalg: højt læste men ikke-handlingskrævende typer (auction_won/lost 92-99 % læst, scout_report_ready 96 %) ligger i FYI-laget og tæller IKKE på badgen.

## Diagnose (kort)

- Ingen tier-inddeling i datamodel/kode → badge tæller alt → median 81 ulæste/bruger, badge dødt som signal. Kun 37,7 % af alle notifikationer læses.
- Støj = 3 typer: `selection_warning` (94 % aldrig åbnet, ~1.600/uge), `race_result` (82 %), `stage_result` (77 %).
- Deep links lander ved siden af handlingen for transfer-tilbud (rytterprofil har ingen accept/afvis-UI; `/transfers` kan ikke modtage offer-id). 5+ spillere har klaget (#3496, #3491, #3493).
- Spillere ruter uden om indbakken (kalender = "kortest load-time").
- Fundament sundt: ét choke-point (`notifyUser`, 24h-dedup), realtime-publikation, i18n-koder, terminator-mønster i `groupNotifications.js`, dormant e-mail-loop (#2853).

## Kontrakten (kernen i reworket)

Hver notifikationstype får tre obligatoriske egenskaber:

1. **Tier:** `action` | `fyi`. Kun `action` tæller på badgen. Nyt felt/afledning i datamodellen (design-detalje afgøres i implementering: kolonne vs. kodemapping — kodemapping anbefales, én SSOT i `notificationTypes.js`).
2. **Deep link-mål der lander på handlingen.** Destinationssider skal kunne modtage et id og fremhæve/åbne det konkrete element (fx `/transfers?offer=<id>`, `/auctions?auction=<id>`). Kontrakt-regel: intet nyt notifikations-link uden at destinationen kan modtage det.
3. **Livscyklus (selv-løsende action-items).** Et action-item forsvinder fra køen når den underliggende tilstand er håndteret (bud afgivet, tilbud besvaret, udtagelse sat, auktion afgjort) — generalisering af det eksisterende terminator-mønster. FYI auto-arkiveres efter visning/tidsvindue.

**Kanal-routing følger tieret:** action → realtime (in-app + Discord-DM opt-in); FYI → grupperet in-app + daglige digests (Discord kl. 20 / e-mail kl. 19, begge sweeps findes). E-mail-aktivering er fortsat ejer-gated (#2853).

## Tier-mapping (godkendt)

**Action (badge-tællende):**
| Type(r) | Løser sig selv når |
|---|---|
| `transfer_offer_received`, `transfer_counter`, swap-offers | tilbud besvaret/udløbet |
| `auction_outbid` — **kun hvis spilleren reelt ikke fører** (fixer falske positiver ved auto-bud, spillerklage 22/6) | nyt bud afgivet eller auktion afgjort |
| `board_critical` (tvangssalg, bonus-tilbud) | konsekvens håndteret |
| `selection_warning` — ÉN post pr. løb (erstatter dagens spam) | udtagelse sat eller auto-pick kørt |
| `contract_expiring` | fornyet/håndteret/udløbet |
| `squad_below_minimum`, `emergency_loan_breach` | tilstand rettet |
| `academy_graduation_ready` | oprykning besluttet |

**FYI (alt andet):** race/stage-resultater (grupperet pr. dag, **eget hold i fokus** — jf. ejer-beslutning 4/8 om resultatsiden + #3493), økonomi (`salary_paid`, `sponsor_paid`, lån), akademi-drip, `auction_won`/`auction_lost`/`bid_received`, `transfer_interest`, watchlist, `scout_report_ready`, sæson, milepæle, `welcome`, `admin_notice`.

## UI (mockup = kontrakt, vist og godkendt 7/8)

To-lags side på T1-template: **"Needs action"**-kø øverst (kort med handlingsknapper direkte i beskeden, countdown på tidskritiske, én guld-primærknap pr. view) + **"Since your last visit"**-digest-grupper nedenunder (sammenfoldelige, auto-læst). Badge = antal i handlingskøen alene. Copy EN-first, DA-second. Bevarede regler: hairline borders, 5px radius, tabular figures, stroke-ikoner.

## Issues der opsluges/berøres

Opsluges af reworket: #3496 (tilbud → beslutningen), #3491 (scout → scout-fane), #3493 (etape eget hold), #3439 (badge-loft — bortfalder reelt når badgen kun tæller handlinger), #3505 (`board_critical` frontend-gap; minimal fix kan tages før reworket). Relateret men separat: #3492 (arkivering af døde tilbud), #1464 (forward-guard, audit-kommentar 7/8), #2853 (e-mail-flip, ejer), #3200/#3201 (spiller-DM/ejer-notifikation — B-lag).

## Grænseflader til parallelle sessioner (design-frys her)

- **Bestyrelses-rework (producent):** forbruger kontrakten — `board_critical` = action, `board_update` = FYI. Bestyrelsens notifikations-INDHOLD designes i dens egen session.
- **Dashboard-rework (aftager):** "Næste træk"/`useActionSummary` bør på sigt læse handlingskøen som SSOT i stedet for egen pending-logik (`inboxPending.js` dækker i dag kun transfer/swap). Selve dashboard-designet ejes af dens session; i B foldes fladerne sammen.

## Implementerings-slices (forslag, afgøres ved igangsættelse)

1. **Kontrakt-fundament:** tier-mapping i `notificationTypes.js`, badge-count omlægges til action-tier, deep-link-modtagelse på `/transfers` + `/auctions`.
2. **Handlingskøen:** ny NotificationsPage-top med inline-handlinger + selv-løsende livscyklus (backend-resolver pr. action-type).
3. **FYI-laget:** digest-grupper, auto-arkivering, eget-hold-fokus i resultatgrupper, `selection_warning`-konsolidering (én pr. løb).
4. **Kanal-efterslæb:** DM-routing efter tier, digest-polish. (E-mail-flip fortsat #2853.)

Hver slice: preflight + fuld e2e (alle 3 projekter) + preview-verifikation med seed-data + ejer-go på UI før merge (UI-reglen).

## Forward-guards (fra audit — skal med i implementeringen)

- Tier-mapping OG DM-pref-nøgler får paritetstest mod `NOTIFICATION_TYPES` (lukker `discordDmPrefs`-hullet).
- `financeNotificationContract.test.js`-falsk-tryghed er meldt på #1464 (stale `schema.sql` + regex-blindt spread-mønster) — løses sammen med kontrakt-fundamentet.
- Ingen nye præcis-time-gates i sweeps (postmortem 6/8); dedup-log bærer én-gang-garantien.
