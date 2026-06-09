# Handoff: Repo Health Check & TdF Launch Prioritization
**Date:** 2026-06-09
**Agent:** Manus AI

## Context
Manus AI has performed a repository health check on the CyclingZone project. The project is currently in a critical phase preparing for the **TdF 2026 Hard Relaunch on June 20th**. Season 1 has just transitioned to Season 2, and the board has been opened.

## Key Findings
1.  **S1 → S2 Transition:** Verified as successful. All gates held, sponsor paid, board opened.
2.  **Relaunch Pivot:** The project is moving towards a legal independence model with fictional riders and a custom value system (`base_value`).
3.  **Critical Path:** The most critical missing piece for the relaunch is the **Relaunch Orchestrator (#1103)**.

## Prioritized Task List for Claude Code
The following tasks should be addressed in this order to ensure a successful TdF launch:

1.  **#1103: Relaunch-orchestrator + founder-badge (frisk sæson 1)**
    *   **Goal:** Create `backend/scripts/relaunchSeason1.js`.
    *   **Dependencies:** `betaResetService.js`, `fictionalLaunchPopulation.js`.
    *   **Status:** Brief exists in `docs/briefs/1103-relaunch-orchestrator.md`.

2.  **#1094: [bug] Uønsket prik udfor alle stats i rytter-fanen**
    *   **Goal:** Fix the dot regression in `frontend/src/pages/RidersPage.jsx`.
    *   **Status:** High priority UI bug.

3.  **#1140: Strømlin ny-spiller-onboarding til ét sammenhængende flow**
    *   **Goal:** Consolidate 6+ onboarding elements into one journey.
    *   **Status:** Critical for new user retention.

4.  **#1162: Progression L1 follow-up: ægte server-side skjuling af potentiale**
    *   **Goal:** Make potential estimates cheat-proof by hiding raw values in API payloads.
    *   **Status:** Security/fair play improvement.

5.  **#1126: Race-selection sætter ikke edition_year**
    *   **Goal:** Ensure `edition_year` is set in `backend/routes/api.js` during race selection.
    *   **Status:** Data integrity fix.

## Recommendations for Next Session
*   Start with **#1103** implementation as it is the foundation for the relaunch.
*   Perform a manual smoke test of the S2 board opening flow as a "Soak-gate" check.
*   Ensure `npm run doctor` passes after the next set of changes.

---
*This document serves as the canonical handoff for the next AI agent session.*
