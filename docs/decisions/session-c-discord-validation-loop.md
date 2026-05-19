# Session C decision: Discord validation loop

> **Status:** Paste-ready execution pack for the first Discord feedback loop.  
> **Owner:** Manus AI.  
> **Date:** 2026-05-19.  
> **Scope:** `#fair-premium-feedback` channel opener, first poll, top-player DM template and interview flow.  
> **Rule:** English is primary. Danish can be posted directly below the English message or as the first thread reply. Player-facing copy follows `docs/TONE_OF_VOICE.md` and the Session B naming lock.

## 1. Decision summary

Session C turns the approved Session B premium wording into a concrete Discord feedback loop. The first loop is designed to be low-pressure, founder-led and fast to paste. It asks current beta players whether **Premium** can exist without making CyclingZone pay-to-win, then follows up with the most active players through short DMs and interviews.

The player-facing promise remains unchanged:

> **The game must be fair for everyone. You cannot pay for better riders, faster training, or better results.**

The Danish version remains:

> **Spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater.**

| Item | Status | Owner | Notes |
|---|---|---|---|
| Discord channel | Ready to create | Nicolai | Create `#fair-premium-feedback`. |
| Channel opener | Ready to paste | Nicolai | English first, Danish directly below or in thread. |
| First poll | Ready to paste or create as native Discord poll | Nicolai | Use one answer only. Keep open for 24 to 48 hours. |
| Top-player DM | Ready to send | Nicolai | Send to Tier 1 targets from the private top-active-player list. |
| Interview flow | Ready to use | Nicolai | 15 minutes by call or written Q&A. |
| Tracking | Ready to maintain | Nicolai or next AI session | Add counts to `docs/SPRINT_DASHBOARD.md` when live data exists. |

## 2. Posting order for the first feedback loop

The first loop should feel like an invitation, not a product launch. The channel can go live with only the opener and the first poll. DMs can follow immediately after the public post, but they should be sent personally rather than as a bulk blast.

| Step | Where | Action | Done when |
|---:|---|---|---|
| 1 | Discord server | Create `#fair-premium-feedback`. | Channel exists and is visible to beta testers. |
| 2 | `#fair-premium-feedback` | Paste the English channel opener. | Message is posted. |
| 3 | Same channel or thread reply | Paste the Danish version. | Danish testers have the same context. |
| 4 | Same channel | Create Poll 1. | Poll is open for 24 to 48 hours. |
| 5 | DMs | Send the top-player DM to 5 Tier 1 players. | 5 personal DMs sent. |
| 6 | Private note or spreadsheet | Log poll result, DM replies and interview commitments. | Feedback can be counted later. |
| 7 | After 24 to 48 hours | Summarize what was learned. | Short update ready before the next poll. |

## 3. Channel opener, English

Paste this as the first message in `#fair-premium-feedback`.

```text
Welcome to #fair-premium-feedback.

I am opening this channel because I want honest feedback before I build anything around payment.

CyclingZone has been free since the start, and the competitive game should stay fair for every manager. The promise I want to test is simple:

The game must be fair for everyone. You cannot pay for better riders, faster training, or better results.

If Premium happens later, it should be for things like identity, convenience, analytics and ways to back development. It should not buy stronger riders, transfer advantages, better scouting odds, hidden power or better race outcomes.

Please use this channel for objections, ideas, pricing reactions and anything that would make you trust or distrust Premium. Critical feedback is welcome. I would rather hear the hard truth now than build the wrong thing later.
```

## 4. Channel opener, Danish

Post this directly below the English opener or as the first thread reply.

```text
Velkommen til #fair-premium-feedback.

Jeg åbner den her kanal, fordi jeg gerne vil have ærlig feedback, før jeg bygger noget omkring betaling.

CyclingZone har været gratis siden starten, og det konkurrencemæssige spil skal forblive fair for alle managers. Løftet jeg vil teste er enkelt:

Spillet skal være lige for alle. Du kan ikke betale dig til bedre ryttere, hurtigere træning eller bedre resultater.

Hvis Premium kommer senere, skal det handle om ting som identitet, bekvemmelighed, analyser og måder at bakke udviklingen op. Det skal ikke købe stærkere ryttere, transfer-fordele, bedre scout-odds, skjult magt eller bedre løbsresultater.

Brug gerne kanalen til indvendinger, idéer, prisreaktioner og alt der ville få dig til at stole mere eller mindre på Premium. Kritisk feedback er meget velkommen. Jeg vil hellere høre den hårde sandhed nu end bygge det forkerte senere.
```

## 5. First poll

Use a native Discord poll if available. If the server does not have native polls enabled, paste the text version and ask players to react or reply with the option number.

| Field | Value |
|---|---|
| Poll title | Fair Premium principle |
| Question | Would you accept Premium in CyclingZone if it never gives gameplay advantages? |
| Options | Yes; Maybe; No; I need more information. |
| Duration | 24 to 48 hours. |
| Multiple choice | Off. |
| Follow-up prompt | If you choose Maybe, No or I need more information, please add one sentence about what would make it feel fair or unfair. |

### Text fallback

```text
Poll 1: Fair Premium principle

Would you accept Premium in CyclingZone if it never gives gameplay advantages?

1. Yes
2. Maybe
3. No
4. I need more information

If you choose Maybe, No or I need more information, please add one sentence about what would make it feel fair or unfair.
```

## 6. Top-player DM template

Send this to the Tier 1 DM targets identified in `docs/SPRINT_DASHBOARD.md`. The dashboard currently names Swatt Team, Visma, Chris Machines, Soudal Quick-Step and Decathlon CMA CGM as the top 5 with Discord handles available in the private source file. Do not paste private emails into public repo docs.

```text
Hey [name/team], thanks for being one of the active testers in CyclingZone.

I am opening a short feedback loop about whether CyclingZone can have Premium later without becoming pay-to-win. I am not trying to sell anything now. I want honest feedback before I build payment.

The promise is: the game must be fair for everyone. You cannot pay for better riders, faster training, or better results.

Would you be willing to do one of these this week?

1. Answer the first poll in #fair-premium-feedback.
2. Send me 3 to 5 written thoughts here in DM.
3. Do a short 15-minute call or written Q&A.

The main thing I want to learn is what would make Premium feel fair, and what would make you lose trust in it.
```

### Shorter DM if the player is already active in Discord

```text
Hey [name/team], quick one because you have been active in CyclingZone.

I just opened #fair-premium-feedback to test whether Premium could exist without pay-to-win. No payment is live, and I am not trying to sell anything. I want honest feedback before building.

Could you answer Poll 1 and, if you have time, send me one thing that would make Premium feel fair and one thing that would make you lose trust?
```

## 7. Interview flow

The interview should take 15 minutes. It can be a call, Discord chat or written Q&A. The opening line matters because it reduces social pressure and makes criticism safer.

### Opening script

```text
Thanks for taking the time. I am not trying to sell anything in this chat. I am trying to understand whether CyclingZone can ever have Premium in a way that stays fair.

The promise I am testing is: the game must be fair for everyone. You cannot pay for better riders, faster training, or better results.

I am especially interested in honest objections. If something feels wrong, that is useful feedback.
```

### Question flow

| Section | Primary question | Follow-up |
|---|---|---|
| Player motivation | What makes you come back to CyclingZone right now? | What would make you stop playing? |
| Fairness | What does pay-to-win mean to you in a cycling manager game? | Which paid features would immediately feel unfair? |
| Trust | When you read the fairness promise, does it feel clear and believable? | What proof would make it more believable? |
| Value | Which Premium benefits would actually improve your experience? | Why that one, and what problem would it solve? |
| Analytics | Would Pro Analyst style features such as rider comparison, watchlists or exports matter to you? | Would those feel like convenience, or hidden power? |
| Pricing | If you loved the game, what monthly price would feel like an easy yes, a maybe and too expensive for Premium? | Would annual pricing feel better than monthly? |
| Founder waitlist | Would you join a non-binding Founder waitlist before payment exists? | What would you need to see first? |
| Community | What should Discord be used for if the game grows? | What would make the community worth staying in? |
| Closing | What is the one thing I should not monetize under any circumstances? | What should I build or fix before asking anyone to pay? |

### Closing script

```text
Thank you. I will summarize what I learn from the first feedback loop before making any payment decision.

If I quote the feedback publicly, I will keep it anonymous unless you explicitly say otherwise.
```

## 8. Feedback logging template

Use this simple table in a private note or spreadsheet. Public repo updates should contain counts and anonymized themes only.

| Field | Example |
|---|---|
| Date | 2026-05-19 |
| Source | Poll, channel reply, DM, interview |
| Player | Private handle or internal label |
| Sentiment | Positive, mixed, negative, needs more info |
| Fairness clarity | Clear, unclear, not discussed |
| Main value driver | Analytics, identity, convenience, history, community, none |
| Main concern | Pay-to-win, price, community split, low value, other |
| Quote | Anonymized quote or paraphrase |
| Follow-up needed | Yes or no |

## 9. First 48-hour success criteria

This loop is successful if it produces concrete learning, not only positive sentiment. A small number of strong objections is useful because it shows where the Premium promise needs to be clearer.

| Metric | Minimum useful signal | Strong signal |
|---|---:|---:|
| Poll votes | 5 | 10 or more |
| Written channel replies | 3 | 7 or more |
| DM replies from top players | 3 of 5 | 5 of 5 |
| Interview commitments | 1 | 2 or more |
| Clear pay-to-win objections | Any specific objection captured | Pattern visible across multiple players |

## 10. Follow-up update after 24 to 48 hours

Use this after the first poll and DMs have produced at least a few replies.

```text
Quick update on the Premium feedback loop.

Thank you to everyone who voted, replied or sent me a DM. I am looking for three things right now:

1. Whether the fairness promise is clear.
2. Which Premium benefits would actually feel useful.
3. What would make players lose trust.

I will keep the competitive game fair. If the feedback shows that Premium would hurt trust, I would rather wait than build the wrong thing.
```

## 11. Close-out status

This document completes Session C as a paste-ready Discord feedback pack. It does not confirm that the messages have been posted, the Discord channel has been created or the DMs have been sent. Once Nicolai posts the opener and poll, the next repo update should mark the relevant `docs/SPRINT_DASHBOARD.md` Week 1 checkboxes as live and add actual early metrics where available.
