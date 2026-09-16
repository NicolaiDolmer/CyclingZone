# Rider database navigation and scout parity (#5292)

- #1777 / PR #2055 persisted auction tabs in query parameters. #3916 / PR #3935 did the same for team tabs and reset tabs when team identity changed.
- RidersPage already used ridersUrlState before this change. The ordinary profile visit/browser-back test passed on the base revision; its existing persistence was present and working for that case.
- Reproduced gap: navigate from a filtered list to the same route via app navigation, edit filters, then go back. The component stays mounted. Its initializer does not run again and its effect writes stale filters over the restored URL.
- Restore changed URL state before effects run. Keep the existing parser, serializer and session fallback; skip redundant URL replacements.
- Reuse AuctionsPage's ScoutablePotentiale and useScouting. No new scouting rules or API mutations are introduced.
- Owner approved design A on September 16 after mobile sketches: name plus rating, value and potential/scout by default. Salary remains selectable.
- UI references: docs/design/PAGE_TEMPLATES.md (T2/D-047), docs/design/TASTE.md; market rules: docs/TRANSFER_MARKET_RULES.md. Gameplay contracts remain unchanged.
- Verify real navigation in browser tests, including still-mounted routes, reset/reload and direct row actions. Serializer unit tests alone cannot catch a React lifecycle problem.
