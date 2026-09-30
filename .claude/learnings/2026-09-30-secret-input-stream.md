# Large PreToolUse input failed before scanning

The owner-approved recovery in #5928 could not execute: the input guard returned
`tool-input scan failed` before the MCP request reached the database. The same
failure reproduced with a large harmless string, independent of SQL or secrets.

Both PreToolUse scanners exported the entire JSON payload through environment
variables. PostToolUse had already moved to stdin in #5326, but PreToolUse retained
the process-start bottleneck. Only the payload transport changed: full UTF-8 stdin
now feeds the original scanner code, patterns and path rules. Failure stays closed.

Regression evidence: large harmless Unicode input passes; a synthetic named
secret at EOF and a secret-file path still block specifically; malformed JSON,
missing Python, bad stubs and scanner crashes still block. Twenty tests passed.
Independent read-only review found no weakening or bypass.

Do not treat a scanner failure as a leak or a safe result. Reproduce with harmless
input, restore full scanning, then verify the active runner before resuming the
authorized operation. No player-data write occurred during this repair. Patch
notes and feature registry changes are unnecessary for hook transport only.
