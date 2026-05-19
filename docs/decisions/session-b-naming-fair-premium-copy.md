# Session B decision: naming and fair premium copy

> **Status:** Approved implementation brief for #366 and next player-facing premium communication.  
> **Owner:** Manus AI.  
> **Date:** 2026-05-19.  
> **Scope:** Tier naming, PatchNotes copy, Discord copy, survey wording and landing page copy.  
> **Rule:** English is primary. Danish can appear immediately after or in a thread below. Player-facing text must use the founder-led tone from `docs/TONE_OF_VOICE.md`.

## 1. Decision summary

Session B locks the player-facing naming for the premium conversation. The combined term **Founder Supporter** is retired from player-facing copy because the tone guide explicitly rejects that combined name. The 49 DKK tier should be called **Premium**, the 89 DKK tier should remain **Pro Analyst**, and the 149 DKK tier should remain **Patron**. The first 100 early signups should be called **Founders** or **Founder waitlist members**, not a separate paid tier.

| Concept | Locked player-facing name | Use | Avoid |
|---|---|---|---|
| Free tier | **Free Manager** | The free competitive game. | Any wording that implies free players are limited in the competitive core. |
| 49 DKK tier | **Premium** | Identity, convenience, saved views, history and ways to back development. | Supporter as the public tier name until founder approves it again. |
| 89 DKK tier | **Pro Analyst** | Deeper analytics, comparisons, dashboards, watchlists and exports. | Any wording that implies hidden outcome power. |
| 149 DKK tier | **Patron** | High-trust community and identity tier for superfans. | Any balance voting, hidden economy data or gameplay advantage. |
| Early waitlist status | **Founder** | First 100 early signups can receive permanent identity cosmetics if payment opens later. | Founder Supporter as a combined name. |

The player-facing promise is locked as:

> **The game must be fair for everyone. You cannot pay for better riders, faster training, or better results.**

The Danish version is:

> **Spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater.**

## 2. Implementation guidance for #366

#366 can now move from blocked to ready once Discord link and survey link placeholders are available. The implementation should add a new PatchNotes entry above version 3.58, bumping to the next available version at merge time. The entry date should remain **2026-05-18** if it announces the player conversation that started with the sprint launch, unless the implementer decides the release date must match the actual deploy date.

The entry should not use the words **freemium**, **validation sprint**, **Go/No-Go**, **support** as a verb, **Founder Supporter**, or em-dash punctuation in player-facing strings. It should say **Premium**, **Pro Analyst**, **Patron** and **Founder waitlist** consistently.

| Runtime area | Required wording change | Why |
|---|---|---|
| `frontend/src/pages/FounderSupporterPage.jsx` | Rename page framing from Founder Supporter to Founder waitlist or Premium Founder waitlist. | Founder is a status, not a tier. |
| `frontend/src/lib/waitlistForm.js` | Replace Supporter options with Premium options while preserving existing submitted enum values if the database expects them. | Player-facing label can change without changing stored values. |
| `frontend/index.html` | Replace social copy that says support a fair MMO with back a fair cycling manager MMO. | Support as verb is disallowed in the tone guide. |
| `frontend/src/pages/PatchNotesPage.jsx` | Add the approved copy below. | This is the concrete #366 deliverable. |

## 3. PatchNotes copy for #366

### EN primary

**Category:** Update: a fair premium conversation

CyclingZone has been free since the start, and the competitive game will stay free. I am now asking players whether there is a fair way to make the project sustainable long-term.

The promise is simple: **the game must be fair for everyone. You cannot pay for better riders, faster training, or better results.**

If premium happens later, it would be for identity, convenience, analytics and ways to back development. It would not include stronger riders, transfer advantages, better scouting odds, hidden power or restricted core gameplay.

Over the next few weeks, I will ask for feedback through Discord, a short survey and a non-binding Founder waitlist. No payment is live now, and I am not building Stripe or gating the free game before the community has helped shape the direction.

Links: Discord `[PASTE DISCORD LINK]`, survey `[PASTE SURVEY LINK]`, Founder waitlist `[PASTE WAITLIST LINK]`.

### DA secondary

**Kategori:** Update: en fair premium-samtale

CyclingZone har været gratis siden starten, og det konkurrencemæssige spil forbliver gratis. Jeg spørger nu spillerne, om der findes en fair måde at gøre projektet bæredygtigt på lang sigt.

Løftet er enkelt: **spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater.**

Hvis premium kommer senere, skal det handle om identitet, bekvemmelighed, analyser og måder at bakke udviklingen op. Det skal ikke give stærkere ryttere, transfer-fordele, bedre scout-odds, skjult magt eller begrænse core-spillet for gratis spillere.

I de næste uger beder jeg om feedback via Discord, en kort survey og en uforpligtende Founder-waitlist. Betaling er ikke live nu, og jeg bygger ikke Stripe eller lukker dele af det gratis spil, før communityet har været med til at forme retningen.

Links: Discord `[PASTE DISCORD LINK]`, survey `[PASTE SURVEY LINK]`, Founder-waitlist `[PASTE WAITLIST LINK]`.

## 4. Discord copy

### Announcement post, EN

**Help shape a fair premium model for CyclingZone**

CyclingZone has been free since the start, and I want the competitive game to stay fair for every manager.

I am now exploring whether premium could make long-term development sustainable without turning the game into pay-to-win. The promise I want to test is simple:

**The game must be fair for everyone. You cannot pay for better riders, faster training, or better results.**

Premium, if it happens later, would be for things like identity, convenience, analytics and ways to back development. It would not buy stronger riders, transfer advantages, better scouting odds, hidden power or better race outcomes.

I do not have all the answers yet. That is why I am asking before building payment.

If you have three minutes, please answer the survey: `[PASTE SURVEY LINK]`

If you want to register interest without paying today, join the Founder waitlist: `[PASTE WAITLIST LINK]`

Please share honest thoughts in `#fair-premium-feedback`. Critical feedback is welcome.

### Announcement post, DA

**Hjælp med at forme en fair premium-model for CyclingZone**

CyclingZone har været gratis siden starten, og jeg vil have at det konkurrencemæssige spil forbliver fair for alle managers.

Jeg undersøger nu, om premium kan gøre den langsigtede udvikling bæredygtig uden at gøre spillet pay-to-win. Løftet jeg vil teste er enkelt:

**Spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater.**

Premium, hvis det kommer senere, skal handle om identitet, bekvemmelighed, analyser og måder at bakke udviklingen op. Det skal ikke købe stærkere ryttere, transfer-fordele, bedre scout-odds, skjult magt eller bedre løbsresultater.

Jeg har ikke alle svarene endnu. Derfor spørger jeg, før jeg bygger betaling.

Hvis du har tre minutter, så svar gerne på surveyen: `[PASTE SURVEY LINK]`

Hvis du vil vise interesse uden at betale i dag, kan du skrive dig på Founder-waitlisten: `[PASTE WAITLIST LINK]`

Skriv gerne ærlige tanker i `#fair-premium-feedback`. Kritisk feedback er meget velkommen.

### Feedback channel opener, EN

Welcome to **#fair-premium-feedback**.

This channel is for honest feedback about whether CyclingZone can have premium without becoming pay-to-win.

The promise is:

**The game must be fair for everyone. You cannot pay for better riders, faster training, or better results.**

Please use this channel for objections, ideas, pricing reactions and anything that would make you trust or distrust premium. I would rather hear hard feedback now than build the wrong thing later.

### Feedback channel opener, DA

Velkommen til **#fair-premium-feedback**.

Kanalen er til ærlig feedback om, hvorvidt CyclingZone kan have premium uden at blive pay-to-win.

Løftet er:

**Spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater.**

Brug gerne kanalen til indvendinger, idéer, prisreaktioner og alt der ville få dig til at stole mere eller mindre på premium. Jeg vil hellere høre den hårde feedback nu end bygge det forkerte senere.

## 5. Discord polls

| Poll | Question | Options |
|---|---|---|
| Fairness trust | Would you accept premium in CyclingZone if it never gives gameplay advantages? | Yes; Maybe; No; I need more information. |
| Premium value | Which possible premium benefit sounds most valuable to you? | Advanced analytics; Profile cosmetics or themes; Saved filters and dashboards; Historical reports; Discord Founder role; Founder badge or Founder Wall; None of these. |
| Biggest concern | What would worry you most about premium in CyclingZone? | Pay-to-win risk; Price too high; Splitting the community; Not enough value; I do not want premium in the game; Other. |

## 6. Survey copy

### Survey title

CyclingZone premium feedback

### Survey intro

CyclingZone is exploring whether premium can make long-term development sustainable while keeping the competitive game fair for everyone.

The rule is simple: **the game must be fair for everyone. You cannot pay for better riders, faster training, or better results.**

Premium would focus on identity, convenience, analytics and ways to back development. This survey takes about three minutes and helps decide what should be built, what should wait and what should never be sold.

### Recommended questions

| # | Required | Type | Question | Options |
|---:|---|---|---|---|
| 1 | Yes | Multiple choice | How would you describe your current interest in CyclingZone? | Casual curiosity; I would test it; I want to play regularly; I want to help shape it; I am not interested. |
| 2 | Yes | Multiple choice | How often would you realistically play a browser-based cycling manager if the game loop is strong? | Daily; Several times per week; Weekly; Only during major races; Rarely. |
| 3 | Yes | Linear scale 1 to 5 | How important is it that CyclingZone avoids pay-to-win completely? | 1 = Not important; 5 = Extremely important. |
| 4 | Yes | Linear scale 1 to 5 | How clear is this promise: "The game must be fair for everyone. You cannot pay for better riders, faster training, or better results"? | 1 = Not clear; 5 = Very clear. |
| 5 | Yes | Checkbox | Which premium features would you value? | Profile badge; Profile themes; Saved dashboards; Advanced analytics; Rider comparison tools; Transfer watchlists; Historical reports; Discord role; Data export; Founder Q&A; None. |
| 6 | Yes | Multiple choice | What would you most likely pay for Premium if you loved the game? | 0 DKK/month; 29 DKK/month; 49 DKK/month; 69 DKK/month; I prefer annual pricing; Not sure. |
| 7 | Yes | Multiple choice | What would you most likely pay for Pro Analyst with advanced data tools? | 0 DKK/month; 49 DKK/month; 89 DKK/month; 119 DKK/month; I prefer annual pricing; Not sure. |
| 8 | Yes | Multiple choice | Would you join a non-binding Founder waitlist? | Yes; Maybe; No. |
| 9 | No | Long text | What would make CyclingZone worth paying for while staying fair? | Open text. |
| 10 | No | Long text | What would make you lose trust in premium? | Open text. |
| 11 | Yes | Multiple choice | Where did you hear about CyclingZone? | Discord; Friend; Reddit; Existing cycling community; Search; Other. |
| 12 | No | Short text | If you want to join the Founder waitlist or help with a short interview, leave your email or Discord username. | Email or Discord username. |

### Survey confirmation message

Thank you for helping shape CyclingZone. Your feedback will directly influence what gets built, what waits and what should never be sold.

If you left contact details for the Founder waitlist or an interview, I will follow up before any payment goes live. The competitive game will remain fair.

## 7. Landing page copy

### Hero

| Element | EN | DA |
|---|---|---|
| Eyebrow | Open beta, fair premium discussion | Open beta, fair premium-samtale |
| Headline | Build your cycling team. Race the world. Back a fair manager game. | Byg dit cykelhold. Kør mod verden. Bak et fair managerspil op. |
| Subheadline | CyclingZone is a browser-based cycling manager where tactics, long-term planning and community rivalry matter. I am exploring premium, but the rule is simple: the game must be fair for everyone. You cannot pay for better riders, faster training, or better results. | CyclingZone er et browserbaseret cykelmanagerspil, hvor taktik, langsigtet planlægning og community-rivalitet betyder noget. Jeg undersøger premium, men reglen er enkel: spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater. |
| Primary CTA | Join the Founder waitlist | Skriv dig på Founder-waitlisten |
| Secondary CTA | Give feedback in the 3-minute survey | Giv feedback i den korte survey |

### Premium promise

| Element | EN | DA |
|---|---|---|
| Title | CyclingZone must stay fair | CyclingZone skal forblive fair |
| Body | Premium can unlock identity, convenience, analytics and ways to back development. It cannot unlock better race results, faster training, stronger riders, transfer advantages, improved scouting odds or hidden power. | Premium kan låse op for identitet, bekvemmelighed, analyser og måder at bakke udviklingen op. Det kan ikke låse op for bedre løbsresultater, hurtigere træning, stærkere ryttere, transfer-fordele, bedre scout-odds eller skjult magt. |

### Tier cards

| Tier | Price | Player-facing value |
|---|---:|---|
| Free Manager | 0 DKK | Full competitive access. Nothing is cut from the core game. Free managers stay competitive. |
| Premium | 49 DKK/month or 490 DKK/year | Identity, profile themes, saved filters, extended history and community role. |
| Pro Analyst | 89 DKK/month | Advanced analytics, rider comparison, scouting dashboards, transfer watchlists and data export. |
| Patron | 149 DKK/month | Founder identity, cosmetic credit, dev Q&A and non-balance roadmap input. |

### Founder waitlist note

Founder is not a separate paid tier. It is an early waitlist status for the first 100 players who want to be considered if payment opens later. Joining is non-binding. There is no payment today.

### FAQ

| Question | Answer |
|---|---|
| Is CyclingZone becoming pay-to-win? | No. The competitive core must stay fair. Premium is for identity, convenience, analytics and ways to back development. |
| Can free managers compete? | Yes. Free managers have full access to the competitive core game. |
| Can premium users buy stronger riders or faster training? | No. Those things should never be sold. |
| Is payment live now? | No. This is feedback and waitlist only. Payment only opens later if the community response is positive and the offer stays fair. |
| What happens if players do not want premium? | Then premium waits, and the focus returns to retention, gameplay and community growth. |

## 8. Close-out status

This document resolves the naming part of #366. It does not implement frontend strings directly. The next technical session should apply this copy to `PatchNotesPage.jsx` and update the landing page and waitlist labels where they currently contradict `docs/TONE_OF_VOICE.md`.
