# CyclingZone Living World Product Doctrine

Status: Owner-approved direction; amended 2026-06-11 (see Amendments)
Date: 2026-06-08
Scope: Product direction, system priorities, backlog governance, and playtest hypotheses

## Amendments (2026-06-11)

Owner decisions from the core-systems design session ([2026-06-11-kernesystemer-design.md](2026-06-11-kernesystemer-design.md)) override this doctrine on four points:

1. **Swaps are kept** (overrides "remove or strongly deprioritized" under Market and social world).
2. **A daily training action is the game's daily hook.** Riders always follow their programs (the assistant executes); an active daily click grants a bonus (~+25%). "Daily visits rewarding but never mandatory" still holds — only the bonus is login-gated.
3. **The youth auction runs continuously** inside the system auction waves, not as a separate scheduled event.
4. **The academy MVP is a 20/6 launch deliverable** (intake + 8-slot academy + youth in daily training + continuous youth auctions), not a post-evidence layer.

## Purpose

CyclingZone is a persistent multiplayer cycling dynasty game. The player builds a club and follows riders across accelerated generations while a shared world continues around them.

The product succeeds when players:

- return several times per week without feeling forced to log in daily;
- talk with each other about races, riders, transfers, rivalries, and the shared world;
- plan future seasons, rider careers, and club development;
- use and enjoy races, training, youth development, and transfers/auctions;
- suggest improvements because they care about the game's future.

The four product engines are:

1. Races that create credible, discussable stories.
2. Training that makes long-term choices visible and meaningful.
3. Youth development that creates attachment and generational renewal.
4. Transfers and auctions that connect managers through a shared market.

Transfers and auctions are currently the strongest proven engine. Races, training, and youth development are the primary product risks and learning priorities.

## Product Identity

Priority order:

1. Club and rider dynasty simulator.
2. Social transfer and auction game.
3. Credible cycling manager.

All three are connected by multiplayer and an MMO-like living-world feeling. The world should appear to move around the player through scheduled races, results, transfers, rumors, development, rivalries, club milestones, and season history.

The world continues while a player is offline. Irreversible decisions require clear deadlines, warnings, and recovery paths. The game must not silently destroy a club because its manager missed one day.

The expected healthy cadence is:

- minimum competitive cadence: two or three visits per week;
- desired voluntary cadence: four to six visits per week;
- daily visits: rewarding but never mandatory.

## Core Player Loop

The primary return surface is a unified manager inbox or Today page. It answers:

1. What happened in my absence?
2. What changed for my riders and club?
3. What deserves a decision now?
4. What should I prepare next?

The page combines race results, rider development, transfer activity, deadlines, assistant recommendations, world stories, and the next important club action. Existing dashboard, notification, and next-action concepts should converge on this surface over time.

The recurring loop is:

1. Observe the living world.
2. Interpret consequences for club and riders.
3. Make a small number of meaningful decisions.
4. Watch those decisions affect races, development, market value, and stories.
5. Plan further into the season and the next generation.

## Design Principles

### Meaningful decisions, simple presentation

Systems may be deep behind the interface, but the player should see a few understandable choices and consequences. Avoid turning cycling expertise into repetitive administration.

### Explainable simulation

Rankings, invitations, assistant recommendations, development signals, and major outcomes must expose their important causes. Exact formulas need not always be visible, but the player must be able to form and test a mental model.

### No single solved spreadsheet answer

Choices should involve trade-offs, uncertainty, opportunity cost, and club identity. Hidden formulas must not create an unknowable correct answer, and exposed formulas must not collapse the game into one optimal build.

### Persistent, but recoverable

Clubs, riders, economy, relationships, and history persist. Seasonal standings, calendars, and titles reset. Mistakes and relegation matter, but a club must be able to rebuild.

### Fair competition

Payment may buy cosmetics, supporter status, analysis, automation, and convenience. It must not buy stronger riders, faster net development, superior race outcomes, or a higher expected-value youth pipeline.

Any premium feature touching sporting outcomes requires player research and an explicit fairness review before implementation.

### Human-driven multiplayer

Human managers should increasingly drive transfers, communication, rivalries, and shared stories. AI provides liquidity and world activity while population is low, then scales down as human activity grows.

## System Direction

### Races and calendar

Target direction:

- approximately 150 race days or stages per 30-day season;
- multiple concurrent events, potentially around five stages per real day;
- one-day races and stage races, including 21-stage grand tours;
- six to eight selected riders depending on race category;
- roughly 60 race days as an upper seasonal workload for a typical rider;
- one team selection at the start of a stage race.

Managers choose which races to enter. The assistant first proposes a complete, editable season plan based on club goals, rider roles, fatigue, development, geography, and qualification. Later, the assistant may auto-enter minor races within explicit player rules.

Fixed-time shared events are the foundation. Live presence is optional. Every important race should produce a useful report, replay, or two-to-five-minute recap.

Pre-race control begins with selection, roles, strategy, and a few conditional instructions. Detailed live tactics are a later hypothesis, only justified by demand and a sufficiently large player base.

Overlapping races create three capacity pressures:

1. fatigue and recovery;
2. captains and suitable helper roles;
3. staff, vehicles, equipment, and operational capacity.

The first two ship before detailed operational capacity. Fatigue normally creates warnings and performance or health risk rather than a hard participation block. Missing minimum staff or equipment may block entry; insufficient quality gives weaker support.

Clubs can buy permanent capacity or rent temporary staff and equipment per race. Rental is accessible to smaller clubs but costs more per race day than permanent capacity. An operations department may improve capacity and rental efficiency, but must remain a secondary club advantage rather than a logistics minigame.

Geography affects cost, recovery, and planning through understandable regions or travel zones, not route-level micromanagement.

### Qualification and divisions

Large races use qualification, ranking, organizer invitations, and wildcards. Smaller races are more open.

Organizers are simulated actors with explainable preferences such as sporting level, nationality, popularity, form, race history, and rival stories. Wildcard applications can present a captain, sporting goal, style, or national profile. Broken promises affect trust only when failure was reasonably controllable.

Divisions provide fair competitive homes while global rankings, cups, monuments, and stories connect the world.

Initial promotion model:

- two transparent promotion places and two relegation places;
- no playoff;
- a visible weighted ranking, initially 60% current season, 30% previous season, and 10% the season before;
- weights remain a tuning hypothesis and must be validated through simulation;
- later parallel leagues may use more promotion places, but dynamic allocation requires separate player research.

Promotion brings higher prestige and sponsor opportunity together with higher salary, travel, and organizational demands. Relegated clubs receive a limited one-season transition, not a large permanent parachute advantage.

Relegation produces mild personality-based dissatisfaction among ambitious riders. A single rebuilding conversation lets the manager present a credible plan. Formal relegation clauses are later contract depth, not initial scope.

### Rider development and training

Riders are the emotional protagonists; the club is the permanent frame. Manager XP is not a parallel progression economy.

Potential is uncertain. Scouting narrows a range rather than revealing a guaranteed future. Talent contains occasional breakthroughs and disappointments.

Training direction:

1. Team strategy and development plans for selected key riders.
2. Individual plans for all riders with staff automation.
3. Detailed schedules, camps, load, recovery, and form peaks only after the simpler loop proves fun.

Training slowly changes permanent abilities while also shaping form and peaks. Potential ceilings and trade-offs prevent unlimited development. Retraining or respecialization is a later, slow, uncertain path that works best for younger riders.

Early health depth should focus on minor illness, small injuries, load, and readable recovery risk. Avoid random career destruction without meaningful warning or agency.

Rider personality begins with role wishes, dissatisfaction, ambition, loyalty, and a few career goals. It should create decisions and stories without becoming a dialogue simulator.

### Youth and generations

One 30-day game season ages a rider by one year. This creates fast generations and expected careers of roughly 10-15 real months.

Every season includes a youth intake with only one to three serious club candidates. A shared talent pool may supplement the club intake. The club's DNA biases academy output without eliminating surprise.

Rejected academy candidates enter a public youth auction and become free agents if unsold. All clubs may bid; balance comes from price, salary, roster space, and opportunity cost rather than hidden restrictions.

Youth organization evolves in layers:

1. Combined academy roster separate from the maximum 30-rider senior roster.
2. Simple simulated development program.
3. Optional paid establishment and operating costs for distinct Junior and U23 teams.
4. Full shared Junior and U23 calendars after the development loop proves valuable.

Junior means U19, normally ages 17-18. U23 normally means ages 19-22.

Promotion to the senior team requires a senior roster slot and contract. Academy stay uses both a duration and an age limit, with exact values set by playtesting.

### Club development

Permanent club capacities include academy, training, scouting, medical, headquarters, commercial, and operations.

The initial hypothesis is that every mature club can become professional in all areas, while only one or two areas become world-class. Club DNA influences these strengths but also evolves through repeated actions.

This specialization is not sacred. Playtests must compare it with broader max-level progression and determine whether specialization creates identity or merely frustration.

The board provides a strategic frame through one annual strategy conversation and one or two seasonal events. Show fewer simultaneous goals. Measure which goals players understand and use before adding more.

Fans initially affect popularity, sponsor interest, and expectations. Later they may affect merchandise and race income through the same popularity model.

Sponsors begin as meaningful offer choices with money, requirements, and identity. Negotiation and shared sponsor competition follow later.

Club inequality must be meaningful but reversible. New and returning clubs catch up through cheaper development paths, lower divisions, and targeted interventions only when data shows a need.

### Market and social world

Youth riders and free agents primarily use public auctions. Established riders primarily use direct negotiation.

AI generates liquidity, rumors, and interest while population is low. The share of real AI trades decreases as human market participation grows.

Contracts begin as understandable multi-year agreements and renewal decisions. Rider demands and exit risk follow. Full agents and free-agent competition are later depth.

Loans should support development with playing-time expectations, salary or fee terms, recall rules, and an optional clause governing races against the owner.

Swaps should be removed or strongly deprioritized unless usage data proves a distinct need.

Direct communication remains contextual and short, attached to riders, transfers, or rivalries. Free-form community chat remains on Discord.

Friends and following come before alliances. Alliances may later provide identity and shared feeds, but no economic or sporting bonuses.

The public world feed highlights results, large transfers, breakthroughs, rivalries, form, club milestones, and season stories. It must not reveal private strategy.

### History and recognition

Replace the current Hall of Fame concept with true world history:

- seasonal champions and records;
- legendary riders and clubs;
- important transfers and rivalries;
- memorable race moments;
- club museums with trophies and season stories.

Achievements may grant cosmetic titles, frames, profile decoration, or museum items. They never grant economic or sporting power.

Login streaks should be removed. Manager levels should become subtle cosmetic reputation or career history, not a gameplay progression track.

## Scope Buckets

### Now: prove the four engines

- Stable independent race simulation and credible race stories.
- Passive development followed by understandable active training.
- Youth intake and a simple academy loop.
- Strong transfers and auctions with sufficient liquidity.
- A unified Today surface that makes the world legible.
- Instrumentation for return frequency, system usage, and planning behavior.

### Later: deepen proven behavior

- Individual training automation, retraining, camps, and peaks.
- Separate Junior and U23 teams and calendars.
- Organizer relationships, wildcard pitches, and deeper contracts.
- Operations, rentals, travel zones, and broader staff systems.
- Friends, following, rivalries, world history, and club museum.
- Parallel divisions and scalable promotion structures.

### Research before commitment

- Detailed live race tactics.
- Alliances and manager communities.
- Dynamic promotion allocation between parallel leagues.
- Premium features with any sporting connection.
- Whether facility specialization improves identity or restricts players.
- Player demand for deep race replay and broadcast-like experiences.

### Remove or reduce

- Login streak pressure.
- Manager XP as a power system.
- Current Hall of Fame implementation in favor of world history.
- Swap complexity without demonstrated usage.
- Excessive simultaneous board goals.
- Detailed travel, staffing, and training administration before the core loops prove fun.

## Measurement and Learning

The north-star behavior is voluntary multi-week engagement, not daily compulsion.

Track:

- weekly active managers and visits per active manager;
- D7 and D30 return rates;
- percentage of managers planning future races or seasons;
- race report and replay consumption;
- training-plan creation and revision;
- youth intake, academy retention, promotion, auction, and sale behavior;
- transfer bids, negotiations, auctions, and manager-to-manager interactions;
- Discord or in-product discussion themes;
- feature suggestions tied to actual system use;
- reasons for inactivity and return.

Each major issue must state:

1. Which of the four engines it strengthens.
2. Which player behavior should change.
3. What evidence would justify expansion.
4. What outcome would cause simplification or removal.

Quantitative data must be paired with interviews, Discord feedback, and observation. Feature request volume alone is not proof of value.

## Backlog Governance

This document is the product compass, not a second task tracker.

GitHub remains the execution source of truth:

- one product-direction epic links the four engine epics and cross-cutting living-world work;
- existing epics remain owners of implementation scope;
- sub-issues represent testable increments;
- milestones represent delivery commitments;
- labels describe priority, system, risk, and decision state;
- a GitHub Project may later add `Now`, `Next`, `Later`, `Research`, and `Remove` views plus iterations.

Recommended review rhythm:

- weekly: verify the next few executable issues still support the doctrine;
- after every meaningful playtest: record evidence and update affected hypotheses;
- after each 30-day game season: review retention, system usage, balance, and requested improvements;
- quarterly or after a major population change: review product doctrine and long-term epics.

Do not create duplicate issues when an existing issue can be clarified. Close or relabel stale issues when the doctrine explicitly removes their premise.

## Existing GitHub Alignment

- #1105 remains the launch-critical relaunch epic.
- #1102 remains the launch race-engine increment; deeper race experience follows evidence.
- #1136 remains the progression and lifecycle epic.
- #1137 and #1138 establish passive development and uncertain potential.
- #931 remains active training.
- #932 remains the academy loop.
- #958 should be reframed so a simple youth development program precedes full Junior and U23 calendars.
- #1142 should resolve to equal expected sporting value: premium may add information, presentation, or convenience, never stronger expected youth output.

The follow-up GitHub pass should:

1. Create one product-direction epic for the living-world doctrine.
2. Link existing race, progression, youth, market, Today, social, history, and instrumentation work.
3. Add only missing issues revealed by the doctrine.
4. Reprioritize contradictory or stale issues.
5. Record deferred hypotheses as research issues, not promised features.

## Risks

### Too much scope before the core is fun

Mitigation: build each system in layers, require usage evidence before adding depth, and keep `Now` narrow.

### Persistent inequality discourages newcomers

Mitigation: divisions, reversible advantages, development paths, market opportunity, and evidence-based catch-up.

### Offline progression feels punitive

Mitigation: predictable schedules, warnings, assistants, editable plans, and no silent catastrophic deadlines.

### Simulation feels arbitrary

Mitigation: seeded and testable systems, visible causal explanations, forecasts, and post-event reports.

### Monetization damages trust

Mitigation: equal expected sporting value, explicit fairness review, and player research before sports-adjacent premium features.

### Documentation becomes another stale plan

Mitigation: issues own execution, this doctrine owns direction, review dates are explicit, and contradictions are resolved rather than accumulated.

## Immediate Follow-up

After owner review of this written specification:

1. Write a GitHub backlog implementation plan.
2. Create or update the product-direction epic and affected issues.
3. Update current planning documents to point to this doctrine and remove contradictory guidance.
4. Establish the first evidence review around races, training, youth, and transfers.

No user-facing runtime behavior changes in this specification, so patch notes are not required.
