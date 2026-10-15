# Race library — SSOT

Design/build-go: owner 14/10/2026, [#6514](https://github.com/NicolaiDolmer/CyclingZone/issues/6514#issuecomment-6175783481). Design and verification: [plan](superpowers/plans/2026-10-14-loebsbibliotek.md).

## Boundary

Read-only lookup under /resultater?tab=archive and /race-archive/:raceSlug. Upcoming is the library default; Resultater's Latest default is unchanged. No calendar generation, race engine, selection writer, /races/:id, race-centre or components/race changes. #3900 owns the calendar overview; #1148 owns museum/records.

## Identity and scope

A concrete edition is race.id, with its persisted season and league_division_id. edition_year is not unique. Measured S1-S4 data replaces catalog/external IDs for three GT families; exact persisted name + race_type therefore identifies candidate families, with editions always shown separately by season/pool. Search normalisation is never an identity key. Renames and collisions require explicit candidates rather than guessed merging.
Scope is senior, a selected existing season and validated division/pool. Shared races (null league_division_id) follow the existing resultsFilter contract. Historical retired pools remain readable. An invalid scope is an error, never a broadened query.

## Status and data

Use deriveRaceStatus. Upcoming contains scheduled and explicitly marked live races; History contains completed only. Unknown/cancelled states are not silently scheduled. A live leader is never an end winner. Completed winners use final gc for stage races and stage for single races, highest persisted stage. Missing result means no documented winner.
Calendar dates come from race_stage_schedule.scheduled_at. Game days come from game_day, shown via toDisplayRaceDay; never derive them from dates. Distance is known only when every expected stage has a valid distance. Route/elevation/sectors come only from persisted profiles of the selected edition.

## Read path

Project only display fields. Page every potentially large query with stable ID ordering; batch result/profile IDs. Upcoming does not read historical result payloads. Complete rider statistics load only when their tab is activated. Errors, auth failures and cancellations are not empty success. The newest full-scope request wins; stale data is hidden on a scope change.
No raw frontend race_pool query. No private engine vectors or balance fields. No notifications or subscriptions to races as a new player feature.

## Presentation

T2 list and T3 edition lookup follow [PAGE_TEMPLATES](design/PAGE_TEMPLATES.md), [TASTE](design/TASTE.md), [TONE_OF_VOICE](TONE_OF_VOICE.md). Mobile: entity name + three data columns; full table is optional, with scrolling only inside its data block.
Mechanics are inherited from [CALENDAR_RULES](CALENDAR_RULES.md) §0/0b, [PLANNING_CENTER_RULES](PLANNING_CENTER_RULES.md) §0/3 and [RACE_ENGINE_RULES](RACE_ENGINE_RULES.md). [SOCIAL_RULES](SOCIAL_RULES.md) applies to public identities. No source rules are changed here.

## Evidence

[Local PG17 baseline](audits/2026-10-14-loebsbibliotek-baseline.md) is synthetic SQL evidence, not a production latency claim. No approved performance SLO exists. Browser/runtime, mobile, dark/light, pagination, query-scope and transition tests must accompany release.

## Navigation and statistics

Legacy exact-name URLs search known seasons; a unique current-season candidate takes precedence, otherwise a sole historical candidate opens in its persisted season. Multiple candidates require explicit selection. React Router decodes the path once; wildcard characters are literal. Missing stage counts remain unknown.
URL filters and optional full-table mode survive edition navigation; the list restores its opening scroll position. DataTable accepts optional fullTable/onFullTableChange; absent props preserve its existing local-state behaviour.
Historical rider statistics retain separate GC/stage wins and points/podiums across all stored classifications, scoped to completed reportable editions. They load only on the statistics tab. Season, pool and race ID selectors are batched at 100; shared editions are deduplicated by race.id.

## Review follow-up, 14 October

Completed/live editions link to the existing /races/:id results without modifying that implementation. All-division rows/selectors and the concrete edition header identify division and pool. With unknown stage totals, options come from distinct persisted profile/schedule stage numbers; no synthetic 1..length options.
Library components/read model and the two permitted route entries use one bounded chunk group with dependency recursion disabled. Shared vendors/other routes remain outside the group. Owner approved +2 KB gzip budget on 14/10; preserve upstream S5 budget increments on main reconciliation. The entry size is unchanged in measured local builds.

## Recovery

An invalid edition season/division/pool exposes an action to the valid default library; it never retries an unchanged invalid scope. Transient read failures retain retry. Statistics mobile defaults explicitly use gcWins/podiums/points; other columns remain selectable through canonical DataTable chips.

Library and edition error headings use the existing common.actions.error translation; the shared primitive fallback must not introduce English headings into Danish views.

Edition lists distinguish loading, errors and a completed zero-row response. A zero-row response uses the canonical no-edition state with return navigation, never a permanent skeleton. Winner batches check cancellation before issuing each request; division choices sort numerically.

Historical season-calendar links carry the clicked race.id and selected season number. Their all-division/all-pool scope preserves the originating season list; resolving a name alone must not replace the clicked historical edition with the active-season edition. SeasonEndPage changes only this existing navigation link, not calendar generation or layout.
