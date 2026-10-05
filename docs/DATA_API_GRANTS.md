# Explicit Data API access for new tables

Refs #708. Migration SSOT: [MIGRATIONS.md](MIGRATIONS.md); security context:
[RLS classification](decisions/rls-no-policy-classification.md).

Supabase is moving new public tables to opt-in Data API exposure. RLS and
table grants are independent: a policy cannot supply a missing privilege,
and `service_role` bypassing RLS does not supply a table grant. See the
[official guide](https://supabase.com/docs/guides/api/securing-your-api) and
[platform announcement](https://github.com/orgs/supabase/discussions/45329).
The work is scheduled ahead of the project's 30 October deadline; this PR
does not change production defaults or existing privileges.

## Migration contract

Copy [the template](../database/templates/new-public-table.sql) into a dated
migration. The template directory is outside the automatic migration root.
Replace the example name and ownership predicate; do not run the example.

Every new public table declares its intended operations for `anon`,
`authenticated` and `service_role` in one `data-api-access` JSON comment.
An empty list means no access; the reason identifies actual consumers.
Revoke inherited grants from those roles and PUBLIC, then grant only the
declared operations. Enable RLS and add applicable client policies in the
same migration. Keep ownership checks in USING and WITH CHECK as applicable.
Backend-only tables normally leave both client roles empty. No blanket
`GRANT ALL`, and never expand column privileges just to satisfy a linter.

For serial/default-nextval columns, also declare the exact sequence and its
role operations in a `sequences` object alongside `roles`, for example:

```json
"sequences": {"public.example_notes_id_seq": {"anon": [], "authenticated": [], "service_role": ["USAGE"]}}
```

Revoke inherited sequence privileges and grant USAGE only to roles that
insert using that sequence. Sequence SELECT is needed only for consumers
that actually read its value. Identity columns differ from serial defaults;
verify the intended-role insert rather than adding blanket sequence rights.

## Verification

```sh
node --test scripts/audit-table-grants.test.mjs scripts/audit-table-grants.pg.test.mjs
node scripts/audit-table-grants.mjs database/templates/new-public-table.sql
node scripts/audit-table-grants.mjs --base origin/main
```

`--base` audits changed SQL files containing new public table declarations,
including proposals and backdated filenames. The dedicated CI job runs
without secrets on PRs and main changes. The existing policy/write-grant
linter remains responsible for its legacy scope; this guard also covers
SELECT, anonymous access and service-role decisions for new tables.

The scanner reuses the migration statement lexer and checks explicit,
top-level SQL. Dynamic DDL, mixed-case quoted identifiers and column grants
need deliberate parser support/review; never broaden permissions to silence
an unsupported form. It checks declared ACLs and policy presence, not the
truth of a policy predicate, role inheritance or the complete live database.
SQL privileges are runtime database state, so a TypeScript type cannot
enforce this contract.

Run [audit-table-grants.sql](../scripts/audit-table-grants.sql) read-only to
inventory effective table/column/sequence grants and policy coverage. Compare
the results with the declaration and frontend/backend callsites. Column-level
access is reported separately so intentionally hidden columns do not trigger
a broad grant. Test the actual read/write as each intended role on an isolated
database before release. The inventory returns metadata only, not player rows.
An applicable policy with no corresponding privilege is a review finding,
not authorization to grant access. No production repair is automatic.
