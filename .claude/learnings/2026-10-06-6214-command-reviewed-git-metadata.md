# Git metadata must be probed before worker dispatch

Refs #6214. A writable worktree did not prove access to FETCH_HEAD, object-store
or the shared owned branch ref. Four workers discovered the same block late.

The supported CLI automatic-review mode handles specific command escalation
inside workspace-write; it is mutually exclusive with --sandbox. Keep reviewer
and investigate roles read-only. A fixed local helper tests/removes only owned
metadata markers before any implementation worker; missing/mismatched proof
fails closed. No blanket .git grant or sandbox bypass is introduced.

Native experiments also showed why TEMP fixtures can give a false isolation
proof: TEMP itself may be writable. A fresh out-of-TEMP dummy repo exposed a
branch-lock failure with overly narrow static path grants. Those grants were
not shipped. Existing worktree recovery needs observed terminal state and a
fresh permission proof; a duplicate normal wave remains rejected.
