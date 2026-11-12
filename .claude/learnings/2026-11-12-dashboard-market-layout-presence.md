# Dashboard and market initial layout presence (#8019)

The previous dashboard released its initial layout after a fixed 500ms even if stage presence remained unknown. A later empty response removed a full strip. The latest-result card also mounted after initial layout; its server badge was added in an effect, changing the mobile header height.

Resolve conditional base data before the initial content layout. Publish real stage cards before optional profiles/results, retain them if enrichment fails, and bound secondary presence requests. Derive the result badge synchronously from the server flag while keeping its seen write and celebration effect. Preserve known action links and result lists during refresh errors.

Auctions mobile header actions had moved below the title only after balance metadata arrived. Keep their canonical mobile row from the first render. Screenshot inspection confirmed the settled subtitle is one line; no extra subtitle height is reserved. No player copy, financial logic, or module order changes.

Verification is recorded in the draft PR and #8019. Parent owns matched browser metrics/screenshots and full E2E. Filter/clear layout shifts must be separated from initial navigation metrics; programmatic input can outlive the browser recent-input window.

The remaining auction shift was the mobile live-feed wrapper leaving the viewport. Browser frame sampling proved an initial empty My auctions paint followed by the existing auto-default to All on the next paint. Derive that existing default in the rendered tab/list/content while its URL transition is pending; no guessed whitespace or extra fetch is needed. Auction tab counts use tabular numerals. The first-content-frame browser regression failed on the checkpoint build before the correction.

Latch the first resolved default, including Mine when owned auctions exist. Later realtime removal of the last owned auction must keep that accepted tab; only the initial pending decision may use current involvement to choose All. The browser regression delivers a local-mocked Supabase completion event and checks this transition.
