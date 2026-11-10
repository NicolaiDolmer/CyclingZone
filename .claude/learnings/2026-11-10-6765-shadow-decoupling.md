# Ranking shadow must not delay legacy publication

Refs #6765, PR #7959. Initial failure: legacy errors, cooldown and training deferral skipped shadow maintenance. The first decoupling placed shadow before legacy under its claim, which could postpone the visible ranking and heartbeat by the shadow version-drain budget.

Owner correction 10 November: attempt maintenance after legacy publication/finish, including legacy failures. Never reuse its released token/version. The existing unleased budget leaves remaining work queued for later ticks; the existing SQL writer fence remains authoritative. OFF retains its frozen RPC order and lease/version drain. No reader change or planner setting.

Four regression requirements failed before the correction and pass afterward: all entry points publish while shadow is blocked; failed legacy still gets shadow; slow unleased backlog remains pending; overlapping callers share maintenance. Tests also cover lost legacy lease, independent shadow failure, cooldown, both deferred paths and fail-closed configuration.

Fresh native PG17 baseline and paired before/after/parity evidence are in the investigation report. A local fixture is not a production SLA or proof of 10x capacity. Player text/patch note exception: invisible technical work behind an OFF control; Claude owns release communication. No merge, activation or production writes.

Independent review found and reproduced an overlapping follow-up when maintenance ran outside the queue slot. The coordinator wrapper now finishes publication and then maintenance before releasing that slot; the regression was RED then GREEN and re-review was clean.

Afternoon Claude-review correction (P1 plus related P2): deferred/unavailable or admission-skip callers could leave the queue and run their finally fallback beside an active legacy writer; a second reserve caller could also overlap a blocked reserve pass. Both overlaps were reproduced in deterministic tests before the fix. The existing queue now offers atomic idle-only admission: fallback owns the same slot when idle, otherwise skips without creating or replacing pending legacy work. It rechecks the attempt marker after admission. Active ordinary maintenance remains queued and OFF is unchanged. Queue tests cover immediate slot ownership, pending legacy preservation, release after error and later reuse. Native PG17 baseline on a6136437c used 2,304,000 synthetic rows; no production calls or settings changed.
