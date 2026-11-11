# A configured Claude credential does not configure GitHub authentication

Refs #7440. The weekly workflow reached its analysis step but did not supply
the pinned action's GitHub-token input. The action therefore attempted its
OIDC-to-App-token path, while the workflow had no OIDC permission. Existing
Lighthouse measurements did not prove the later analysis step had succeeded.

Supply the existing scoped job token through the action's supported input.
Keep Claude OAuth, token permissions and measurement policy separate.

Complete the previously agreed Monday-report path with read-only issue
evidence. The reader has an explicit date and bounded GitHub call; unavailable,
invalid or capped data cannot silently become zero. Counts describe created
drop issues, not healthy Lighthouse scores. Tests use fixed time and injected
GitHub output and run through the existing Monday CI entry.

Local verification does not establish successful scheduled operation. Claude
must observe that path after an authorized merge; no production run or issue
post is triggered during implementation.
