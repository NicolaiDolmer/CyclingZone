# Train-now PR2: recorded condition responses

The comparison `pr2-condition-before-after.png` uses the same pinned frontend, commit 6c52c88f2, on both sides. PR2 changes backend values; it adds no UI. The worker supplied these responses from the real synthetic PR1 press harness and the new condition readers. This renderer did not invent or recalculate the numbers.

Only the `condition` fragment varies: before has form 57 and fatigue 24, without a next-stage field. After has form 59, fatigue 31 and next-stage fatigue 31. The worker's separately recorded after-stage input also has form 59 and fatigue 31. No before-stage pipeline was fabricated. The worker's backend baseline is df427a24, as recorded in its private provenance; the frozen frontend renderer is independently 6c52c88f2.

The real Chromium views are Danish/light at desktop 1440 by 900 and phone 390 by 844 with touch. The explicit clock is 9 November 2026 at 14:00 UTC, taken from the provenance. Ada Synthetic, every other fixture response, the flags and the common training payload are identical on both sides.

Desktop shows the current fatigue and next-stage estimate agreeing at 31. This older phone card shows current form and fatigue only. Its missing forecast line belongs to the separate #7801 mobile UI fix, which is deliberately not included in this PR2 comparison. The limitation is explicit in the image caption. Neither document has horizontal overflow.

The composite preserves every original screenshot pixel; only external captions were added. Selected synthetic originals are in `originals/`. Complete context screenshots, supplied condition files, provenance, source hashes and helpers remain private under `pr-screens/local/7737-pr2-visual`.

The exact static client was hash-copied into this worktree's private pinned directory and its browser-visible compiled identity was verified in every context. No build, product source/config/git edit, Save, production call or flag change was performed. This is rendering evidence for recorded API-contract states, not a live browser-to-backend/database integration or activation proof. The parent owns PR publication and broader verification.
