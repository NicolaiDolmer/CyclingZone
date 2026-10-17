# i18n Glossary — Cycling Zone

> Refs [#410](https://github.com/NicolaiDolmer/CyclingZone/issues/410), [#6785](https://github.com/NicolaiDolmer/CyclingZone/issues/6785). Source-of-truth for domæne-termer på tværs af locales. Opdatér ved oversættelses-tvivl ELLER når nye domæne-termer introduceres.

## Konventioner

- **Proper nouns** (CZ$, Cycling Zone, Founder Supporter): oversættes IKKE — samme i alle locales.
- **Domæne-substantiver** (Squad, Manager): oversættes hvis der findes en god match; ellers behold engelsk (cykling-fag er anglo-domineret).
- **Action-verb** (Bid, Sign, Loan): vælg den mest naturlige form i mål-sproget — ikke 1:1 oversættelse.
- **Tone:** dansk = direkte/uformel (matcher eksisterende stil). Engelsk = samme tone, ikke corporate.

## Termer

| English | Dansk | Kontekst | Må IKKE oversættes? |
|---|---|---|---|
| Squad | Trup | Den samlede gruppe af 16+ rytterkontrakter under én manager | nej |
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

## Navne oversættes aldrig

Rytternavne, holdnavne og løbsnavne står ens i alle sprog: "Tour de France", "Paris-Roubaix", "Ronde van Vlaanderen", "Il Lombardia" og hver enkelt rytters navn. Det gælder også spillernes egne hold- og managernavne. Produktnavne følger samme regel: Cycling Zone, CZ$, CZ Pro, Founder, Patch Notes, Deadline Day.

Det der oversættes, er ordene omkring navnet ("etape", "løb", "klassiker"), ikke navnet selv. Løbstyperne Grand Tour og Monument bruges som de er i alle sprog.

## Cykelfagtermer (en, da, fr, es, nl)

> Refs [#6785](https://github.com/NicolaiDolmer/CyclingZone/issues/6785). Etablerede cykeltermer pr. sprog, ikke ord-for-ord-oversættelser. Engelsk er kilden i locale-filerne; dansk er det eksisterende UI-ord. fr, es og nl er endnu ikke åbnet for spillere (trigger: #4110). Termerne her er udgangspunktet for en kaptajn; en indfødt gennemlæsning kan ændre dem, og ændringen skrives så ind her FØR locale-filerne rettes.

| Begreb | en | da | fr | es | nl |
|---|---|---|---|---|---|
| peloton | peloton (også bunch) | feltet | peloton | pelotón | peloton |
| udbrud | breakaway | udbrud | échappée | escapada | ontsnapping |
| klassement | general classification (GC) | klassement | classement général | clasificación general | algemeen klassement |
| etape | stage | etape | étape | etapa | etappe |
| enkeltstart | time trial | enkeltstart | contre-la-montre | contrarreloj | tijdrit |
| holdtidskørsel | team time trial | holdtidskørsel | contre-la-montre par équipes | contrarreloj por equipos | ploegentijdrit |
| holdkaptajn | captain | holdkaptajn | leader | jefe de filas | kopman |
| hjælperytter | helper (domestique) | hjælperytter | équipier | gregario | knecht |
| sprinttog | sprint train | sprinttog | train de sprint | tren de sprint | sprinttrein |
| slutspurt | final sprint (bunch sprint) | slutspurt | sprint final | sprint final | eindsprint |
| nedkørsel | descent | nedkørsel | descente | descenso | afdaling |
| brosten | cobbles | brosten | pavés | adoquines | kasseien |
| mur | wall | mur | mur | muro | muur |
| klassiker | classic | klassiker | classique | clásica | klassieker |
| formtop | peak form | formtop | pic de forme | pico de forma | topvorm |
| bjergtrøje | mountains jersey | bjergtrøje | maillot à pois | maillot de la montaña | bergtrui |
| pointtrøje | points jersey | pointtrøje | maillot vert | maillot verde | puntentrui |
| ungdomstrøje | youth jersey | ungdomstrøje | maillot blanc | maillot blanco | jongerentrui |
| rytter | rider | rytter | coureur | ciclista | renner |
| løb | race | løb | course | carrera | koers |
| sæson | season | sæson | saison | temporada | seizoen |
| division | division | division | division | división | divisie |

Noter til tabellen:

- **holdkaptajn** er rytteren hjælperyttere kører for. Det er IKKE vejkaptajnen (fr capitaine de route, es capitán de ruta, nl ploegkapitein), som er en anden rolle i faget. Brug derfor leader, jefe de filas og kopman, og lad "capitaine", "capitán" og "ploegkapitein" stå fri til den anden betydning.
- **trøjerne** bruger fagets etablerede navne (fr/es: grøn for point, hvid for ungdom, prikket eller bjerg for bjergkonkurrencen). Opfind ikke nye navne eller farver.
- **nl** bruger flamsk-neutral cyklingsprog (ploeg, koers, renner, kopman, knecht, peloton). Det er fagets eget ord i både Vlaanderen og Nederland, så der skal ikke vælges side.
- **es** bruger "sprint" som i sprogtesten; en indfødt kan vælge RAE-formen "esprint". Skriv valget her, så det er ens overalt.

## Spil- og UI-termer i fr, es, nl

Fra sprogtesten ([#6586](https://github.com/NicolaiDolmer/CyclingZone/issues/6586), `2026-10-13-6586-sprogtest-sonnet.md`), udvidet med nl og de huller testen pegede på. Samme term overalt i et sprog; driver den, er det en fejl.

| English | Dansk | fr | es | nl |
|---|---|---|---|---|
| Squad | Trup | effectif | plantilla | selectie |
| Board | Bestyrelse | Direction | Directiva | Bestuur |
| Auction | Auktion | enchère | subasta | veiling |
| Bid | Bud | enchère (verbe: enchérir) | puja (verbe: pujar) | bod (werkwoord: bieden) |
| Manager | Manager | manager | mánager | manager |
| Academy | Akademi | académie | academia | academie |
| Watchlist / Wishlist | Ønskeliste | liste de suivi | lista de seguimiento | volglijst |
| Clubhouse | Klubhus | Siège du club | Sede del club | Clubhuis |
| Transfer window | Transfer-vindue | période des transferts | mercado de fichajes | transferperiode |
| Rider loan | Lån (rytter) | prêt | cesión | uitleen |
| Finance loan | Lån (finans) | emprunt | préstamo | lening |

Noter:

- **Watchlist og Wishlist er samme funktion.** Engelsk har to ord (`common:watchlist`, `auctions:wishlistButton`), dansk bruger "ønskeliste" til begge. I fr, es og nl bruges ÉN term til begge, så filterknappen i auktioner siger fx "Uniquement ma liste de suivi" og ikke et andet ord end menupunktet. Sprogtesten oversatte dem ulige; det er den fejl, reglen lukker.
- **Rider loan og finance loan** er to forskellige ting (`loan_agreements` mod `loans`). Oversæt dem aldrig til samme ord.
- Uændret i alle sprog: Patch Notes, Deadline Day, Hero & Agony, CZ$, Cycling Zone, CZ Pro, Founder.

## Formatering er ikke oversættelse

Tal, valuta, datoer og klokkeslæt oversættes ikke i locale-filerne. De formateres af `Intl` efter det aktive sprog, via `frontend/src/lib/intl.js` (`formatNumber`, `formatCurrency`, `formatDate`, `formatDateTime`) og `frontend/src/lib/intlLocale.ts` (`intlLocale`, `formatClock24`). Skriv aldrig "1.234", "12,5 %" eller "15. okt." ind i en oversættelse; send tallet eller datoen som parameter. `scripts/i18n-check-hardcoded-formats.mjs` stopper nye hardkodede formater (fast "da-DK", `toFixed` med `%`, håndskrevne separatorer).

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

Fransk: `{count, plural, one {# coureur} other {# coureurs}}`. `one` dækker 0 og 1 ("0 coureur"), ikke kun 1.
Spansk: `{count, plural, one {# ciclista} other {# ciclistas}}`
Hollandsk: `{count, plural, one {# renner} other {# renners}}`

fr og es har desuden kategorien `many` (kun for hele millioner og op, fx "1 million de coureurs"). Spillets tal når ikke dertil, så en `other`-gren er nok. Kom `many` ind i en streng, skal `other` stadig stå ved siden af.

## Sprog-koder (BCP 47)

- `da` — dansk (Danmark)
- `en` — engelsk (kanonisk; mappes til 🇬🇧-flag selvom det dækker en-US + en-GB)
- `en-XA` — pseudo-locale (dev-only, aktiveres med `?pseudo=1`)
- `fr`, `es`, `nl`: planlagt (kaptajn-flowet i [`README.md`](README.md#tilføj-et-sprog)). Koden er ren sprogkode uden region; formatering vælges af `intlLocale()`, som giver et sprog uden region videre til `Intl` uændret.
