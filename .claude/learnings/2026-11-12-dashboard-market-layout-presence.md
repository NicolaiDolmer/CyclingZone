# Dashboard and market initial layout presence (#8019)

The previous dashboard released its initial layout after a fixed 500ms even if stage presence remained unknown. A later empty response removed a full strip. The latest-result card also mounted after initial layout; its server badge was added in an effect, changing the mobile header height.

Resolve conditional base data before the initial content layout. Publish real stage cards before optional profiles/results, retain them if enrichment fails, and bound secondary presence requests. Derive the result badge synchronously from the server flag while keeping its seen write and celebration effect. Preserve known action links and result lists during refresh errors.

Auctions mobile header actions had moved below the title only after balance metadata arrived. Keep their canonical mobile row from the first render and reserve the measured two-line subtitle geometry. No player copy, financial logic, or module order changes.

Verification is recorded in the draft PR and #8019. Parent owns matched browser metrics/screenshots and full E2E. Filter/clear layout shifts must be separated from initial navigation metrics; programmatic input can outlive the browser recent-input window.
