# Landing page + design-retning (#672, relateret #671 brand + tone-of-voice)

> **Etableret:** 2026-06-14 (brainstorm-session m. visual companion)
> **Ejer:** Nicolai Dolmer Mikkelsen
> **Status:** Design-retning låst. Tema + tokens afventer brand-guidelines-session (næste session). Byg ikke før brand guidelines + komponent-lag er på plads.
> **Issues:** #672 (landing page, deadline 16/6), #671 (brand-minimum), tone-of-voice.

## Formål

En **ny** landing page bygget fra bunden til kold TdF-trafik (20/6-push: Reddit + Discord). Skal sælge spillet til fremmede der aldrig har hørt om CyclingZone, og konvertere dem til Discord (primært) + waitlist (sekundært). Den eksisterende `/founder-supporter` bevares **urørt** til sit premium-pris-survey-formål senere (egne A/B/C-varianter, tier-præference, admin-side). To sider, to job.

## Beslutninger låst 14/6

| Emne | Beslutning |
|---|---|
| Ny side vs ombyg | **Ny side fra bunden.** `/founder-supporter` bevares til premium-survey. |
| Route | **Bare domæne (cyclingzone.org) viser den nye landing for ikke-loggede-ind.** Loggede-ind ryger stadig til appen (/dashboard). App-routing uændret. |
| Primært CTA | **Discord** (`https://discord.gg/ykysBrWUyC`). Email-waitlist sekundært/nedtonet. |
| Waitlist-form | Let: **email + valgfrit navn** + consent. Skriver til **ny ren tabel** (ikke survey-tabellen). |
| Premium på siden | **Nævnes ikke.** Fairness-løftet dækker det. |
| Billeder | **Data + brand-grafik, ingen fotos** (ruteprofil, klassifikation, bevægelses-streger som motiv). Ingen rettigheds-/IP-problemer. |
| Tema | **Følger brand guidelines + den faktiske app.** Afgøres i brand-guidelines-session, ikke isoleret. Landing skal matche det man møder inde i spillet. |
| Copy | EN-først, DA-sekundær. Kladde leveres; **founder-stemmen skriver Nicolai selv.** Aldrig "free forever"; ingen ordspil i hero. |

## Design-retning (taste-kalibreret mod 3 retninger)

**Base = editorial-clean** (retning B): moderne headline-behandling, masser af luft, ren opbygning, Discord nemt at finde, "Open beta · Free to play"-chip i toppen.

**Signatur = cykel-data fra retning A:** ruteprofil på skærmen + en afdæmpet live-klassifikation (tidsgab, trøjefarver gul/grøn/prik). Proof-of-concept nu; **designes til at skalere op** når tallene vokser (managers online, live-auktioner).

**Fravalgt:** ticker i toppen (ude af v1, kan testes senere ved højere tal). Firkantet gitter-baggrund (retning C) helt ude.

Kort: rolig editorial side med ét skarpt cykel-data-element som fingeraftryk. Clean nok til ikke at være "slop", distinkt nok til ikke at ligne nogen anden.

## Anti-AI design-principper (do/don't, gælder hele sitet)

Se også [[feedback_anti_ai_slop_design_taste]] + [BRAND_BRIEF.md](../../brand/BRAND_BRIEF.md).

- **Undgå:** `rounded-2xl/xl` på alt, guld-glows (`shadow-[0_0_40px...]`), gradient-blobs + grid-overlay-baggrunde, `backdrop-blur` på alle modaler, **emoji som ikoner**, centreret-alt hero, ens kort-grids, samme `accent/30`-tint overalt.
- **Foretræk:** editorial hairline-layouts, stor kondenseret Bebas-type, ægte cykel-data, masser af luft, 2-farvet (gul `#e8c547` + navy `#0e0f15`), INGEN glow, INGEN gradient.
- **Logo:** kun wordmark i header (med de to bevægelses-streger), aldrig wordmark + monogram samtidig. Monogram kun i kvadrat/ikon-kontekster.
- **Fonte:** DM Sans (brød), Bebas Neue (display), Inter Tight (tal/tabulær).

## Sidestruktur (sektioner, oppefra)

1. **Top-bar:** wordmark (gul på navy) + sprog-toggle + sekundær Discord-knap.
2. **Hero:** "Open beta · Free to play"-chip, editorial headline (kladde, founder finpudser), Discord-CTA primær + "launch email" sekundær, trust-chips (Free to play · No credit card · In your browser). Sidestillet: ruteprofil + afdæmpet live-klassifikation.
3. **How you play:** editorial hairline-rækker (ikke kasse-grid): draft squad · live auktioner · taktik · sæson. Stort Bebas-nummer + tekst + ægte data-detalje pr. række.
4. **Not your usual manager game:** 3 selvsikre produkt-forskelle (strategy over spending · free to play · no install). Bærer fairness/honesty uden at prædike.
5. **Discord (primær):** vægtig sektion med CTA til serveren.
6. **Email (sekundær):** "Prefer email?" + email + valgfrit navn.
7. **FAQ:** kort (gratis? · pay-to-win? · hvornår starter sæsonen? · install?).
8. **Footer:** wordmark + Privacy + Discord. Ingen "by nicolai"-tagline.

## Waitlist (ny tabel)

Ny tabel (fx `launch_waitlist`), ikke `founder_supporter_waitlist` (som har NOT NULL `interest_level`/`preferred_tier` + intet navn-felt). Felter: `email` (required), `name` (optional), `consent_given_at` (required), `source`/utm (attribution), `created_at`. Case-insensitiv unik email. RLS: anon+authenticated INSERT med consent; SELECT kun admin (`is_admin()`). **Migration = database/*.sql auto-applies ved merge → ejer merger PR'en** ([[pr-with-migration-owner-merges]]). Admin-synlighed: udvid AdminWaitlistPage eller simpel admin-read.

## Afhængigheder / åbne punkter (afgøres næste session)

- **Tema + design-tokens:** brand-guidelines-session. Landing arver.
- **Endelig copy (hero, FAQ, founder-tone):** tone-of-voice-session. Nicolai skriver founder-prosa.
- **Ikon-system:** lille SVG-set (lucide-subset eller egne) der erstatter ALLE emoji. Vælges ved byg.
- **Komponent-lag:** Button/Card/Input/Badge/Table som genbrugelige primitiver + ét token-sted + kitchen-sink-side. Fundamentet alt bygger på.

## Sekvens for kommende sessioner

Sporene hænger sammen i en kæde, ikke 6 løse ting:

1. **Tone of voice:** lås honesty-framing ("free to play, aldrig pay-to-win") + anti-slop-copy-regler.
2. **Brand guidelines (#671):** lås tema, farver, type-skala, logo-regler, anti-AI do/don't, den valgte retning. Output = design-tokens.
3. **Komponent-lag + tokens + kitchen-sink.**
4. **Landing page (#672):** første flade på fundamentet. Brug `frontend-design`-skill.
5. **Login/forside:** fjern glow/grid-blob/emoji, ny brand.
6. **UI/UX-sweep i appen:** global focus-ring, standardiserede empty/loading/error-states, ikon-system, error-boundary.

Tone + brand + komponent-lag FØRST = landing, login og app-sweep arver samme fundament (ingen tre-dobbelt-arbejde).

## UX-fund at lukke (fra kode-audit 14/6)

Ingen global focus-ring (kun bestyrelsessiden); ustandardiserede empty/loading/error-states; ingen error-boundary; login 3-mode uden tydelig mode-indikator; dashboard kognitiv overbelastning; tabel-layout-shift (auctions); emoji-ikoner overalt; ingen genbrugelige UI-primitiver (alt inline-kopieret 20-150x = rod-årsag til driften mod generisk).

## Referencer

Visual companion-mocks (gitignored, kan regenereres): `.superpowers/brainstorm/418-1781388326/content/` (v1 → v3 + three-directions). [TONE_OF_VOICE.md](../../TONE_OF_VOICE.md), [BRAND_BRIEF.md](../../brand/BRAND_BRIEF.md), [TDF_2026_LAUNCH_PLAN.md](../../strategy/TDF_2026_LAUNCH_PLAN.md) Spor D.
