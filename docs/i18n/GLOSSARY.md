# i18n Glossary — Cycling Zone

> Refs [#410](https://github.com/NicolaiDolmer/CyclingZone/issues/410). Source-of-truth for domæne-termer på tværs af locales. Opdatér ved oversættelses-tvivl ELLER når nye domæne-termer introduceres.

## Konventioner

- **Proper nouns** (CZ$, Cycling Zone, Founder Supporter): oversættes IKKE — samme i alle locales.
- **Domæne-substantiver** (Squad, Manager): oversættes hvis der findes en god match; ellers behold engelsk (cykling-fag er anglo-domineret).
- **Action-verb** (Bid, Sign, Loan): vælg den mest naturlige form i mål-sproget — ikke 1:1 oversættelse.
- **Tone:** dansk = direkte/uformel (matcher eksisterende stil). Engelsk = samme tone, ikke corporate.

## Termer

| English | Dansk | Kontekst | Må IKKE oversættes? |
|---|---|---|---|
| Squad | Hold | Den samlede gruppe af 16+ rytterkontrakter under én manager | nej |
| Roster | Trupopstilling | Den udvalgte gruppe af 9 ryttere til et specifikt løb | nej |
| Bid | Bud | Beløb afgivet i en auktion | nej |
| Auction | Auktion | 24-timers åbent budrunder for én rytter | nej |
| Manager | Manager | Brugeren bag et hold (samme term i begge sprog) | nej |
| Transfer Window | Transfer-vindue | Tidsperiode hvor handel er tilladt mellem managers | nej |
| Season | Sæson | Én kalendercyklus (10-12 uger) med races + standings | nej |
| Patch Notes | Patch Notes | Versionshistorik for ændringer (samme term i begge sprog — gamer-konvention) | ja |
| Deadline Day | Deadline Day | Sæson-finalens marked-event (samme term — proper noun) | ja |
| Watchlist | Ønskeliste | Brugerens private liste af ryttere de overvåger | nej |
| Board | Bestyrelse | Manager's "trust"-system — tildeler perks ved milestones | nej |
| Founder Supporter | Founder Supporter | Pre-launch betaler-tier (samme term i begge sprog — brand) | ja |
| Cycling Zone | Cycling Zone | Produktnavn | ja |
| CZ$ | CZ$ | Spil-valuta (Cycling Zone Dollars) | ja |
| Race | Løb | Et enkelt cykelløb (Tour de France-etape, klassiker, etc.) | nej |
| Standings | Rangliste | Sorteret liste over managers' point | nej |
| Sponsor Income | Sponsorindkomst | Halvårlig CZ$-injektion fra sponsorater | nej |
| Loan | Lån (rytter) / Lån (finans) | TVETYDIG — `loan_agreements` = rytter-leje. `loans` = finans-lån. Brug context-specifik form. | nej |
| Rookie | Rookie | Ung rytter under udvikling (samme term — cykling-jargon) | ja |
| Team name | Holdnavn | 3-30 tegn — bliver in-game team-navn (signup-felt) | nej |
| Manager name | Managernavn | Brugerens viste navn på holdprofil | nej |
| Password | Adgangskode | Auth-feltet (ikke "kodeord" — for at matche Apple/Google-konvention på dansk) | nej |
| Log in | Log ind | Imperativ — separate ord på dansk ("log ind"), ikke "logind" | nej |
| Sign up | Opret konto / Sign up | Dansk = "Opret konto" (matcher eksisterende UI). Engelsk = "Sign up" eller "Create account" | nej |
| Reset link | Reset-link | Hybrid term — "reset" forbliver engelsk på dansk (ingen god match) | nej |
| Onboarding | Onboarding | Beholder engelsk i begge sprog (ingen direkte dansk term) | ja |
| Tour (onboarding) | Tour | Guided walkthrough på Riders/Auctions/Board/Finance | ja |
| Division | Division | Liga-niveau (samme term — sportsjargon) | ja |
| League | Liga | Konkurrence-format på tværs af managers | nej |
| Inbox | Indbakke | Notifikations-feed (samme metafor i begge sprog) | nej |
| Settings | Indstillinger | Profil-konfiguration | nej |

## Genvejstaster + emoji-status

| Tegn | Anvendelse |
|---|---|
| 🟢 | "Klar / Live / OK" — bruges i NOW.md status |
| 🟡 | "I gang / Pending" |
| 🔴 | "Blokeret / Fail" |
| 🆕 | "Ny" |
| 🇩🇰 / 🇬🇧 | LanguageSwitcher flag-ikoner (gb = engelsk per UX-konvention) |

## Pluraliseringsregler (ICU MessageFormat)

Engelsk: `{count, plural, one {# rider} other {# riders}}`
Dansk: `{count, plural, one {# rytter} other {# ryttere}}`

Begge sprog har same plural-kategorier (one/other) — ingen særlig regel for dansk dual som i fx slavisk.

## Sprog-koder (BCP 47)

- `da` — dansk (Danmark)
- `en` — engelsk (kanonisk; mappes til 🇬🇧-flag selvom det dækker en-US + en-GB)
- `en-XA` — pseudo-locale (dev-only, aktiveres med `?pseudo=1`)
