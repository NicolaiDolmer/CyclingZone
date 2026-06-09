# TdF-launch & validerings-roadmap (langtidskort)

> **Status:** Design godkendt af ejer 9. juni 2026 gennem brainstorm-session.
> **Type:** Strategisk roadmap (ikke en enkelt-feature-spec). Strukturerer ~45 ejer-noter + eksisterende epics i ét sammenhængende fasekort.
> **Produktkompas:** [Living World Product Doctrine](2026-06-08-living-world-product-doctrine-design.md) — fire motorer: løb · træning · ungdom · transfer/auktion.

## 1. Strategien: validerings-drevet balanceret

Vi er i en **valideringsfase**, ikke en vækst- eller dybde-fase. Logikken er:

> få folk ind → hold på dem → lær hvad der virker → beslut løbende om projektet forfølges langsigtet.

Ejer-forventning pr. 9/6: **projektet fuldføres.** Det går godt, folk roser det, så vi gør tingene ordentligt fra start. Det betyder committed sprog udadtil (spiller-roadmap, brand) — ikke forbehold.

To principper former hele kortet:

1. **Bug-kvalitet er en PORT, ikke et spor.** "Folk skal ikke føle spillet er skidt." Bugs blokerer alt andet — man vækster ikke ind i en utæt spand.
2. **Måling er forudsætningen for "beslutte løbende".** Man kan ikke vægte retention vs. vækst uden tal. Et data-fundament SKAL være live inden launch, fordi retention ikke kan måles bagudrettet.

Game-design-pointe der binder vækst og retention sammen: **et viralt loop forudsætter at spillet er værd at dele.** Retention leder derfor en anelse foran vækst — vi tænder ikke referral før kerne-loopet holder.

## 2. Tidslinje & faser (hårde datoer)

TdF 2026: **4.–26. juli** (Grand Départ Barcelona 4/7). Det giver:

```
 NU──────────20/6────────────4/7──────────────────26/7
 │  Fase 0    │   Fase 1       │  Fase 2 (HVIS go)   │   Fase 3
 │ cut PCM    │ polish +       │ fuld marketing      │   dybde
 │ + MVP      │ validering     │ under Touren        │  (hvis forfulgt)
             │            ▲ GO/NO-GO (1. uge af Tour, ~4.–11/7)
```

- **Fase 0 — NU → 20/6:** Working MVP. Alt PCM/UCI ud. Grundpillars "kommet langt". Bugs lukket. Data-fundament + domæne + brand live.
- **Fase 1 — 20/6 → 4/7 (14 dage):** Test, finpuds, uddyb pillars. Validering starter. Folk kommer ind til let test.
- **GATE — 1. uge af Tour (~4.–11/7):** GO/NO-GO ud fra kohorte-data, ikke mavefornemmelse.
- **Fase 2 — 4/7 → 26/7 (HVIS go):** Fuld marketing under Touren (peak cykel-interesse). Viral-loop tændes. Acquisition skaleres.
- **Fase 3 — efter Touren (hvis forfulgt):** Dyb udbygning af de fire motorer.

## 3. De tre tværgående baner

Løber på tværs af faser; alle tre skal være på plads FØR folk sendes ind (validering kræver et helt produkt, ikke et halvt).

### PORT — Bug-kvalitet
9 high-prio bugs lukkes i Fase 0 ([#1089](https://github.com/NicolaiDolmer/CyclingZone/issues/1089) byttehandel-på-auktion, [#1091](https://github.com/NicolaiDolmer/CyclingZone/issues/1091) autobud-tie, [#1115](https://github.com/NicolaiDolmer/CyclingZone/issues/1115) Discord-DM-regression, [#1090](https://github.com/NicolaiDolmer/CyclingZone/issues/1090), [#1092](https://github.com/NicolaiDolmer/CyclingZone/issues/1092), [#1093](https://github.com/NicolaiDolmer/CyclingZone/issues/1093) m.fl.). Løbende bug-triage gennem alle faser.

### BANE A — Data-fundament (måle-sporet)
**Launch-blokerende.** Detaljer i §5. Uden det er go/no-go-beslutningen blind.

### BANE B — Brand & præsentation
Brand guidelines → hele sitet reskinnet · nyt domæne · tone of voice · engelsk 100% · Help/FAQ-vedligehold · synligt spiller-roadmap · Discord-kanal. Detaljer i §6.

## 4. Launch-bar pr. grundpillar (låst 20/6)

Nye spillere dømmer spillet på disse fire. De skal være "kommet en lang vej" — gode MVP'er hvor nødvendigt, men spilbare og troværdige.

| Pillar | 20/6-bar | Uddybes i Fase 1+ |
|---|---|---|
| **Auktioner** | Kun polish (findes allerede) + autobud-forklaring til spillerne | — |
| **Race engine** | Playable light-afvikling ([#1102](https://github.com/NicolaiDolmer/CyclingZone/issues/1102)), justeres løbende | Løbsform, finpudsning, fuld engine [#1021](https://github.com/NicolaiDolmer/CyclingZone/issues/1021) (Fase 3) |
| **Ungdom/udvikling** | **Ungdomsakademier inde** ([#1149](https://github.com/NicolaiDolmer/CyclingZone/issues/1149)) + ryttere kan udvikle sig ([#1137](https://github.com/NicolaiDolmer/CyclingZone/issues/1137)/[#1138](https://github.com/NicolaiDolmer/CyclingZone/issues/1138)) | Scouting-dybde, fuld livscyklus |
| **Træning** | **GODT** — rigtig, spilbar dybde, mere end teaser ([#1163](https://github.com/NicolaiDolmer/CyclingZone/issues/1163) → mod [#931](https://github.com/NicolaiDolmer/CyclingZone/issues/931)) | Individuelle programmer, fuld dybde |

> **Note om velocity:** Ejer arbejder næsten i døgndrift og leverer hurtigere end standard-estimater antager. Bar-niveauet er sat ambitiøst bevidst. Skeln motor- vs. indholds-bundet arbejde (jf. [[feedback_simulate_before_ship_balance]]).

## 5. Data-fundamentet — go/no-go-kohorten (BANE A, launch-blokerende)

**Kernebegrundelse:** retention kan ikke måles bagudrettet. Skal go/no-go i Tourens 1. uge bygge på "vendte launch-spillerne tilbage dag 3 og dag 7?", så skal grundlaget være på plads **inden 20/6**.

**VERIFICERET 9/6 — fundamentet er ~70% bygget allerede** (ikke greenfield som oprindeligt antaget):
- `player_events`-tabel + `logEvent()`-API (`frontend/src/lib/logEvent.js`) med stabilt `user_id`/`team_id`. Eksisterende events: `session_started`, `auction_view`, `auction_bid_placed`, `transfer_offer_sent`, `notification_clicked` + feature-impressions.
- `get_sprint_metrics`-RPC (`database/2026-05-17-sprint-metrics-rpc.sql`) beregner DAU/WAU/MAU/D7/session-længde live på `/admin/sprint-metrics`.
- Retention bruger UNION af `last_seen` (server-side `/api/presence`, **ikke** consent-gated) + `player_events` → hovedtallet dækker også brugere uden analytics-consent.

**Det reelle gap (3 ting, alle små):**

1. **Signup-kohorte-kurve mangler (🔴 vigtigst).** Nuværende D7 er rullende aggregat ("af alle registreret 7+ dage siden, % aktive nu") — isolerer ikke Tour-kohorten. Kræver **ingen instrumentering**, kun ny SQL: `get_cohort_retention`-RPC (kohorte = signup-uge → retur +1d/+3d/+7d, fra `auth.users.created_at` + `last_seen` + `player_events`) + dashboard-række.
2. **Løb + træning er blinde (🟡).** Funnel kan ~60% bygges fra data (signup→`auth.users`, hold→`teams`, første bud→`auction_bid_placed`). Men der mangler `logEvent`-kald for **løb** (`race_viewed`) og **træning** (`training_focus_set`) — skal tilføjes *samtidig med* #1102 og #1163, ellers valideres blindt på 2 af 4 pillars.
3. **Consent-rate ukendt (🟡).** Funnel-events ud over signup/hold er consent-gated. Ét query afgør om consent-raten bærer funnel-tal, eller om vi læner os på `last_seen`-baserede tal.

**Handling:** opret issue for (1) `get_cohort_retention`-RPC + (2) pillar-events som checklist på #1102/#1163 + (3) consent-rate-query. Knytter an til [#1141](https://github.com/NicolaiDolmer/CyclingZone/issues/1141) (board-instrumentering) og [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) (evidence-roadmap).

## 6. Brand & præsentation (BANE B)

Alle skal være på plads før folk sendes ind / før marketing.

- **🔴 Nyt domæne (NU, i dag/dage):** `cyclingzone.com` er taget. Kandidater: **cyclingzone.app** ($9.99, eksakt brand, anbefalet) eller **playcyclingzone.com** ($11.25, .com-tillid). Go-live via Vercel Domains (auto DNS+SSL) + følge-ændringer: Supabase Auth Site-URL/redirect-allowlist, Railway-CORS, OAuth-callbacks, Sentry origins, canonical/sitemap, 301 fra `.vercel.app`. Beslutning udestår (ejer vælger + køber; Claude Code wirer bagefter).
- **🔴 Engelsk-komplethed:** faktisk audit af hele sitet → grønt "ja, 100%". i18n-leak-check findes ([#1068](https://github.com/NicolaiDolmer/CyclingZone/issues/1068)); kendte huller ([#1084](https://github.com/NicolaiDolmer/CyclingZone/issues/1084) board) lukkes.
- **🔴 Brand guidelines → hele sitet reskinnet ASAP** ([#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481)/[#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671)). **Tone of voice** defineres som del af dette (jf. player-facing copy-regler).
- **Synligt spiller-roadmap:** committed framing ("projektet fuldføres"). Italesæt især ungdomsudvikling · race engine · auktioner · **træning**. Retning, men troværdigt.
- **Help/FAQ-gennemgang + vedligeholdelses-proces:** verificér at området stadig opdateres løbende; etablér rutine så det forbliver opdateret.
- **Discord-kanal:** gennemgang + opsætning som del af launch-prep ([#415](https://github.com/NicolaiDolmer/CyclingZone/issues/415) m.fl.).

## 7. Placering af alle ejer-noter

### Allerede fanget som issues/epics
| Note | Issue |
|---|---|
| Ryttertyper · evne-kategorier (mentale/taktiske/tekniske/fysiske evner) | [#1122](https://github.com/NicolaiDolmer/CyclingZone/issues/1122) |
| Værdier | [#1101](https://github.com/NicolaiDolmer/CyclingZone/issues/1101) |
| Potentiale | [#1138](https://github.com/NicolaiDolmer/CyclingZone/issues/1138)/[#1162](https://github.com/NicolaiDolmer/CyclingZone/issues/1162) |
| Rytterpersonligheder · ryttermålsætninger · holddynamik/trupdynamik/trupsamtaler | [#1154](https://github.com/NicolaiDolmer/CyclingZone/issues/1154) |
| Træning · træningsprogrammer · udvikling | [#1163](https://github.com/NicolaiDolmer/CyclingZone/issues/1163)/[#931](https://github.com/NicolaiDolmer/CyclingZone/issues/931)/[#1137](https://github.com/NicolaiDolmer/CyclingZone/issues/1137) |
| Ungdomsryttere · ungdomsakademier | [#1149](https://github.com/NicolaiDolmer/CyclingZone/issues/1149)/[#1136](https://github.com/NicolaiDolmer/CyclingZone/issues/1136) |
| Løbsprogram · løbsprioriteter (all-in vs. medium) · spilletid/løbsdage | [#1146](https://github.com/NicolaiDolmer/CyclingZone/issues/1146) |
| Deadlineday | [#1151](https://github.com/NicolaiDolmer/CyclingZone/issues/1151)/[#956](https://github.com/NicolaiDolmer/CyclingZone/issues/956) |
| Inflation | [#1101](https://github.com/NicolaiDolmer/CyclingZone/issues/1101)/[#1151](https://github.com/NicolaiDolmer/CyclingZone/issues/1151) |
| Transfer-profit (købspris vs. salgspris) | [#1107](https://github.com/NicolaiDolmer/CyclingZone/issues/1107) |
| National mester/VM/EM | [#1099](https://github.com/NicolaiDolmer/CyclingZone/issues/1099) (renown, delvist) |
| Markedsføring | [#1114](https://github.com/NicolaiDolmer/CyclingZone/issues/1114) |
| Onboarding | [#1140](https://github.com/NicolaiDolmer/CyclingZone/issues/1140) |

### Nye huller — skal oprettes som issues
| Note | Placering | Bemærkning |
|---|---|---|
| **Vækst/viralitets-loop** (gratis premium hvis du deler · rekruter-en-ven · ungdomsrytter for henvisning · virale idéer) | Byg Fase 1, tænd Fase 2 | Strategisk det største nye. Eget design/spec senere. P2W-grænse for præmie: jf. [#1142](https://github.com/NicolaiDolmer/CyclingZone/issues/1142) |
| **Launch-kapacitet** (samtidige oprettelser før marketing) | Fase 1, før gate | Test før acquisition-skalering |
| **Data-fundament** | Fase 0 (blocker) | §5 |
| Løbsform / year-form | Fase 1 → race engine-dybde | Folder ind i race engine |
| Startliste | Fase 3 (race engine-dybde) | |
| Styrt (crashes) | Fase 3 (race engine-dybde) | |
| Vejkaptajner · mentor-ordninger · erfaring påvirker holdet | Fase 3 → holddynamik [#1154](https://github.com/NicolaiDolmer/CyclingZone/issues/1154) | |
| Rytter-nationalitet | Fase 1/3 | Manager-nationalitet findes [#1108](https://github.com/NicolaiDolmer/CyclingZone/issues/1108) |
| Fyre ryttere | Fase 1/3 (transfer-dybde) | Delvist [#933](https://github.com/NicolaiDolmer/CyclingZone/issues/933)/[#33](https://github.com/NicolaiDolmer/CyclingZone/issues/33) |
| Forklaring af autobud (UX) | Fase 0/1 (auktion-polish) | |
| Slette upload af løbsresultater (brugerrettet) | Verificér relevans | Efter PCM/UCI-cut kan resultat-upload være deprecateret — tjek før byg |
| Gennemgang af admin-funktioner | Fase 0 (launch-prep) | Opgave, ikke feature |

## 8. Åbne handlinger (umiddelbar prioritet)

1. **Vælg + køb domæne** (ejer) → Claude Code wirer Vercel/Supabase/Railway.
2. **Opret data-fundament-issue** som Fase 0 launch-blocker + kør tracking-plan-skill.
3. **Engelsk-komplethed-audit** → grønt.
4. **Brand guidelines + tone of voice** → site-reskin.
5. **Opret issues** for de nye huller i §7 (vækst-loop, kapacitet-test først).

## 9. Risici

- **Pillar-bar vs. 20/6:** træning "GODT" + akademier + udvikling på 11 dage er ambitiøst. Mitigering: gode MVP'er + de 14 Fase-1-dage er uddybnings-tid, ikke kun bugfix. Skeln engine- vs. indholds-arbejde.
- **Data tændt for sent:** dræber go/no-go-grundlaget. Derfor launch-blocker.
- **Domæne-skift brækker auth/API:** Supabase/Railway/OAuth-følge-ændringer er obligatoriske, ikke valgfrie.
- **Offentligt roadmap under validering:** committed framing er ejer-besluttet; risiko hvis no-go. Accepteret.
