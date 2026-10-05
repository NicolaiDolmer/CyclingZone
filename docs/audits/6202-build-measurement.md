# Vercel build measurement, 5 October 2026

Refs #6202. Contract: [VERCEL_BUILD_RULES.md](../VERCEL_BUILD_RULES.md).

## Observed baseline

The connected Vercel API returned 48 distinct production deployments for
cycling-zone between 2026-10-04 00:00 UTC and 2026-10-05 00:00 UTC (exclusive).
All were READY; pagination was exhausted with pages of 20, 20 and 8.
This is an observed deployment count, not independently verified billing
usage or a claim that every record consumed one build. One sampled Git
deployment had both buildingAt and ready timestamps. No settings changed.

## Reproducible decision replay

```sh
node scripts/vercel-build-impact.mjs docs/audits/6202-build-replay.json
```

The manifest pins the same 48 commits and the preceding successful production
deployment. The old main policy requests a build for every record. The new
policy compares each record with the most recent replayed build, retaining
that base when a build is skipped. This models consecutive skipped commits,
rather than checking only each commit's parent.

| Same fixed deployment set | Build decisions | Skips |
|---|---:|---:|
| Existing policy | 48 | 0 |
| Full-history replay (best case) | 15 | 33 |
| Missing base and no usable origin (conservative bound) | 48 | 0 |

The replay permits at most 33 fewer build decisions in this sample; the conservative unavailable-base bound saves none. The observed preview clone lacks origin, so fetching a missing base is not a verified path to savings. This is a historical
projection, not a measured reduction in production usage or cost. The replay
assumes requested builds succeed and the recorded base is available; the real
filter builds conservatively if metadata/fetch/diff fails. Actual dependency
coverage includes the shared backend participation-history projection.

## After release

Pending owner-approved merge. Re-measure the same project over a complete,
comparable UTC window, distinguish build starts/skips/failed builds from
deployment records, and note differences in commit mix. Check Vercel Builds
usage separately before translating decisions into billed savings. No after
production measurement or savings claim is possible from an unmerged PR.
