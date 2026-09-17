# 2026-09-16: assigned planning role bypassed i18n parity (#5289)

Root cause: RaceColumn uses races:selection.${ROLE_KEY[role]}. selection.hunter was absent in both EN and DA. The namespace was loaded; CSS uppercase made i18next's raw fallback appear as SELECTION.HUNTER. Both editable and locked lineups shared the failure.

Scope checked: captain, sprint_captain, hunter, helper and free_role. Helpers intentionally have no assigned badge on the day board; their role card resolves through racehub.roleCard.rider. Selection uses selection labels plus HunterExplainer, while season planning and race team/tactics use tacticsOrders.roleLabel. All resolve in both languages with fallback disabled after the fix. Strategy role rules have their own existing translated labels.

Fix: add selection.hunter to both races resources and a short EN/DA patch note. No gameplay, data, feature flag or role-contract change. PLANNING_CENTER_RULES section 2 and RACE_ENGINE_RULES section 1 remain unchanged; help.json and FEATURE_REGISTRY need no update.

Why the guards missed it: key-coverage only compared locale parity; page-untranslated checks pages without useTranslation; namespace-inline checks namespace availability, not individual keys; nav-strings checks hardcoded navigation labels. None checked the finite dynamic lookup used by the badge.

Prevention: extend the existing key-coverage guard to expand local literal maps in template lookups and verify every resulting key in every language. Covers JS/JSX/TS/TSX, explicit namespaces, literal nullish fallbacks and missing/empty/placeholder values. Arbitrary expressions, imported maps and ambiguous multiple hook namespaces remain outside its documented scope. No new CI job. A type cannot currently prove that an untyped JSX lookup exists in independent runtime locale JSON; this is a resource-coverage check.

Evidence: guard fixture initially passed incorrectly when a key was absent in BOTH languages, then failed correctly after the guard extension. The extended guard failed on the actual source for EN and DA selection.hunter before the locale fix. Browser regression initially failed at the visible Udbrudsjæger assertion in both editable and locked states. Browser fixtures use mocked auth/API data; no production writes.

Handoff: PR awaits owner merge. NOW.md belongs to the orchestrator and was intentionally not edited.
