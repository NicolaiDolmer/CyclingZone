# Discord — ugentlig content-kalender (struktur)

> Owner-prep doc for [#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428). Epic: discord-community.
> Dette er en **cadence-struktur**: faste slot-typer + faktuelle prompts. Selve post-teksten skriver ejeren (founder-stemme). Placeholders er markeret `[FOUNDER-PROSA: ejer skriver]`.

## Rytme-afstemning (læs først)

To rytmer mødes her — de er ikke i konflikt, men dækker forskellige ting:

- **Projekt-drifts-rytme (`docs/PLAN.md` §"Ugentlig drifts-rytme", Man/Ons/Fre):**
  - Mandag = uge-plan + roadmap + metrics-review.
  - Onsdag = community-update: **Discord-post (#428)** + patch notes publiceret + broadcastet.
  - Fredag = FEATURE FRIDAY: ship + annoncér én poleret søjle-forbedring.
- **Issue #428's content-kalender (Man/Ons/Søn):** Mandag recap · Onsdag poll · Søndag "Manager of the Week".

Onsdag er fælles-ankeret (begge rytmer siger "community-update onsdag"). Mandag og Fredag/Søndag overlapper kun delvist. Strukturen nedenfor folder begge sammen i ÉN ugekalender, så drifts-rytmen og Discord-content ikke konkurrerer om opmærksomhed.

[EJER-BESLUTNING: hvilken ugedag ejer "fejringen"/showcase-slottet?
- **Fredag (følg drifts-rytmens Feature Friday):** fordel: ét stærkt ugentligt højdepunkt, alt samlet på feature-dagen. Omkostning: weekenden (hvor mange spiller) har intet planlagt content.
- **Søndag (følg #428's Manager of the Week):** fordel: rammer weekend-aktiviteten + giver mandags-recap råstof. Omkostning: splitter fejringen væk fra feature-annonceringen om fredagen.
- Alternativ: kør Fredag = Feature Friday (produkt) OG Søndag = Manager of the Week (community) som to forskellige slot-typer — koster ét ekstra ugentligt post men dækker både produkt og community. Strukturen nedenfor lister begge så valget er let.]

## Slot-typer (genbrugelige skabeloner)

Hver slot har: kanal · effort · formål · faktuelle prompts (hvad der skal udfyldes) · prosa-placeholder.

### Mandag — "Weekend recap" (~10 min)
- **Kanal:** `#sæson-resultater`
- **Formål:** vis at noget skete i weekenden; giv social proof + navne på skærmen.
- **Faktuelle prompts (data ejeren henter):**
  - Top 5 sæson-bevægelser fra weekenden (manager + point-delta + årsag: transfer/race-win).
  - 1-2 interessante manager-historier (ikke nødvendigvis top-50).
  - Næste races navn + starttidspunkt (Europe/Copenhagen).
- **Struktur:**
  ```
  🚴 Uge [XX] recap

  Top movers:
  🥇 [manager] — [+XX point] ([årsag])
  🥈 [manager] — [+XX point] ([årsag])
  🥉 [manager] — [+XX point] ([årsag])

  Highlight: [FOUNDER-PROSA: ejer skriver én manager-historie]

  Næste race: [navn] — [dag] kl. [tid]
  ```

### Onsdag — "Community poll" + patch-notes-anker (~5-10 min)
- **Kanal:** `#general` (poll) — patch notes broadcastes hvor I normalt poster releases.
- **Formål:** lav-friktion engagement + bind onsdagens drifts-rytme (patch notes publiceret + broadcastet) sammen med community-input.
- **Faktuelle prompts:**
  - Ét dilemma-spørgsmål med reaction-poll. Faktuelle eksempel-vinkler (ikke færdig copy):
    - "Hvilken rytter ville du bruge 5M på?"
    - "Bedst i 2026: klassiker-specialist eller GT-rytter?"
    - "Lille budget — sprinter eller klatrer først?"
  - Link/resumé af ugens patch notes (hvis der er en release).
- **Note:** poll-resultatet = råstof til mandags-recap eller patch notes. Genbrug det.
- **Struktur:**
  ```
  🗳️ [FOUNDER-PROSA: ejer skriver dilemma-spørgsmål]
  Reagér: [emoji A] = [valg A] · [emoji B] = [valg B]

  📋 Denne uges patch notes: [link/resumé hvis release]
  ```

### Fredag — "Feature Friday" (~følger feature-arbejdet)
- **Kanal:** annoncerings-/release-kanal (samme som patch notes).
- **Formål:** drifts-rytmens Feature Friday — ship + annoncér én poleret søjle-forbedring.
- **Faktuelle prompts:**
  - Hvilken søjle/feature blev forbedret (navn + 1-linjes hvad-ændrede-sig).
  - Evt. før/efter-screenshot eller kort klip.
- **Prosa:** `[FOUNDER-PROSA: ejer skriver feature-annoncering i egen stemme — marketing-prosa ejes af founder, jf. PLAN.md §"Ugentlig drifts-rytme".]`

### Søndag — "Manager of the Week" (~15 min) — [valgfri, se EJER-BESLUTNING ovenfor]
- **Kanal:** `#hold-showcase`
- **Formål:** løft én manager (rotér — ikke kun top-50); pin i 7 dage.
- **Faktuelle prompts (interview-light, 3 spørgsmål):**
  - Taktik/tilgang.
  - Favorit-rytter.
  - Ét råd til nye managers.
- **Struktur:**
  ```
  ⭐ Manager of the Week: [navn]

  Taktik: [svar]
  Favorit-rytter: [svar]
  Råd til nye: [svar]

  [FOUNDER-PROSA: ejer skriver kort intro/afslutning]
  ```
  *Pin i 7 dage.*

## Uge-overblik (kombineret)

| Dag | Slot | Kanal | Effort | Drifts-rytme-kobling |
|---|---|---|---|---|
| Mandag | Weekend recap | `#sæson-resultater` | ~10 min | + uge-plan/metrics (internt) |
| Onsdag | Community poll + patch notes | `#general` / release-kanal | ~5-10 min | = community-update (PLAN.md) |
| Fredag | Feature Friday | release-kanal | feature-afhængig | = Feature Friday (PLAN.md) |
| Søndag | Manager of the Week [valgfri] | `#hold-showcase` | ~15 min | community-ekstra (#428) |

## Operationelle noter (fra #428)

- [ ] [EJER-HANDLING] Læg faste reminders i egen kalender for de valgte dage/tidspunkter (Europe/Copenhagen).
- [ ] [EJER-HANDLING] Forbered første uges posts på forhånd (batch).
- [ ] [EJER-BESLUTNING: commit til 4 ugers fast cadence før evaluering? #428 foreslår dette — fordel: nok data til at vurdere hvad der virker. Omkostning: 4 ugers fast forpligtelse. Alternativ: 2 uger + tidlig justering.]
- **Delegering senere:** når community er etableret (≥30 aktive, [antagelse: tærskel fra #428]), kan onsdags-poll delegeres til en frivillig moderator.

## Hvad denne doc bevidst IKKE indeholder

- Færdig post-copy (founder-stemme = ejerens).
- Eksakte klokkeslæt (ejer-kalender-beslutning).
- Kanal-navne der ikke allerede er nævnt i #428 — verificér de faktiske kanal-navne i serveren før første post [antagelse: kanal-navne `#sæson-resultater`, `#general`, `#hold-showcase` stammer fra #428].
