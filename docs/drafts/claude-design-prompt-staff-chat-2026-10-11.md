# Claude Design-prompt: wireframes til idéerne fra #staff-chat 11/10

Kilde: #staff-chat 11/10 2026, 08:57-10:23 dansk tid (testerne om Tour e1, enkeltstart og hvad der er det næste). Spillernavne er udeladt. Tidsgab i ungdoms-/holdklassement er udeladt, fordi det allerede er bygget (#6384, PR #6466).

Kopiér alt under stregen ind i Claude Design.

---

I'm designing features for **Cycling Zone**, a browser-based multiplayer cycling manager game (think Football Manager / Hattrick / Pro Cycling Manager, but in the browser). Players manage a team, set tactics and follow races that a simulation engine runs. I need **low-to-mid fidelity wireframes** that show **2-3 alternative solutions per idea** so I can choose a direction. Show each option side by side, with a one-line label for the trade-off (e.g. "A: compact, always visible" / "B: on demand, more detail").

## Visual language (keep it, don't invent a new style)
- Dark theme first (near-black background, light text), light theme exists too.
- Editorial calm: thin hairline borders, 5 px card radius, **no shadows, no colored side bars, no boxes inside boxes**.
- Gold is rationed: **one gold primary button per view**, plus gold for leader markers (jerseys, "leader" pills).
- All numbers in tabular figures (time gaps like `+0:22`, ratings, percentages).
- Stroke icons only, never emoji.
- Real cycling data is the imagery: stage profiles, time gaps, jersey colours, nation flags. No stock photos, no decorative gradients.
- Data first, explanation after: the thing the player came to see sits at the top; help text is short and lives behind an info icon or a fold.
- Every screen in two sizes: **desktop 1440** and **mobile 390** (players use Android phones a lot; nothing may scroll horizontally at page level).
- UI copy in English.

## Idea 1 · Favourites on the start list (highest priority)
Testers want to know who the favourites are before a stage, like TV graphics or PCM's 3/2/1-star favourites. It should not reveal the engine's hidden numbers; it's based on what players can see: real results this season (stage wins, GC results), rider type and how well the rider fits the route ("route match", 0-100, already exists).
- Categories to consider: stage win (every day), GC, points jersey, mountain jersey, youth jersey, team classification.
- Where it lives: the race page (has tabs Overview / Results / Stages / Teams) and/or the start list.
- Show: top 5 favourites per category with 3/2/1 stars, the player's own riders highlighted ("YOU" badge), and a short "why" (e.g. "2 stage wins this season · route match 88").
- Options to explore: (A) one compact favourites card on the stage overview, (B) a full "Favourites" tab with all categories, (C) stars inline on the start list rows.

## Idea 2 · "How surprising was this result?"
A climber with clearly worse time-trial ability won a 40 km time trial because of a great day-form roll. The result was valid, but players read it as a bug. They want to see when a result was a surprise and why, Hattrick-style ("this is how it went in 100 other simulations").
- On a finished stage: mark the winner as favourite / outsider / big surprise, and say why in one line (day form, fatigue, tactics, crash).
- Optional: a small distribution graphic, e.g. "In 100 re-runs the winner finished top 10 in 31, won 4" and "most likely winner: rider X (won 27 of 100)".
- Options: (A) one line plus a badge on the result row, (B) an expandable "Why this result" panel under the results table, (C) a small chart card next to the race recap.

## Idea 3 · What a stage label means ("Long day")
Stages show tags like "Long day", "Reduced sprint", "Bunch sprint", "Breakaway-friendly". Players misread "Long day" on a 40 km time trial (they thought endurance mattered more than time-trial ability). We need the tag to say clearly what it does.
- Options: (A) tag plus tooltip with one plain sentence and the 2-3 abilities that matter most today, (B) a small "What matters today" strip under the stage profile (ability icons ranked), (C) the tag removed and replaced by the ranked abilities only.

## Idea 4 · Race day vs. training at home (development 2.0)
Today it's better for young riders to stay home and train than to race junior/U23 races, which makes youth races pointless. The plan is that racing must pay off at least as much as training. Players need to **see** that when they pick riders for a race.
- Show for a rider (and for a selected squad): expected development from racing this race day versus staying home training, split by the abilities the stage uses (e.g. "+0.6 climbing from this mountain stage vs +0.4 at home").
- Also show age and potential in the picture: young riders develop fast, older ones slower; decline after the peak is mainly physical abilities.
- Places to show it: the race selection panel (picking riders for a race), the rider profile development tab, and the training page.
- Options: (A) a small "+x race / +y home" comparison chip on each rider row in the selection panel, (B) a side-by-side mini bar chart per ability on the rider profile, (C) a squad-level summary card ("Racing this week: +3.1 total development vs +2.4 at home").

## Idea 5 · Race film for one-day races
Stage races have a "race film" (a playback of the stage: groups, breakaway, gaps, key moments on the stage profile). One-day races have no race film at all. Show how the existing race film concept fits a one-day race page (one long profile, key moments, final kilometre), and where it sits on the page.
- Options: (A) same race film module as stage races placed at the top of the Results tab, (B) a condensed "key moments" timeline along the profile with the full film behind a button.

## Output I want
For each idea: the 2-3 options as wireframes (desktop + mobile), a one-line trade-off per option, and your recommendation with one sentence why. Keep annotations minimal and numbered.
