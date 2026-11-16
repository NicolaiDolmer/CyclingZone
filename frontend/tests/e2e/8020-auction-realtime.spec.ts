import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, TEST_USER, TEST_TEAM, RIVAL_TEAM, AUCTIONS, json, evidenceShotPath, waitForStableSnapshotTarget } from "./fixtures.js";

const NOW = "2026-11-12T12:00:00Z";
for (const width of [375, 1440]) {
  test(`#8020 committed closing-seconds delta reaches price and countdown before 400ms at ${width}px`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
    await page.setViewportSize({ width, height: 900 });
    await installNetworkMocks(page); await stabilizePage(page);
    await page.addInitScript(user => {
      const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ exp: 1893456000, role: "authenticated" }))}.fixture-signature`;
      localStorage.setItem("sb-cycling-zone-e2e-auth-token", JSON.stringify({ access_token: token, refresh_token: "e2e-refresh-token", token_type: "bearer", expires_at: 1893456000, user }));
    }, TEST_USER);
    const initial = { ...AUCTIONS[0], id: "auction-realtime-8020", current_price: 100000,
      calculated_end: "2026-11-12T12:00:05Z", status: "active", current_bidder_id: RIVAL_TEAM.id,
      current_bidder: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name }, seller_team_id: RIVAL_TEAM.id,
      seller: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name }, rider: { ...AUCTIONS[0].rider, team_id: RIVAL_TEAM.id },
    };
    let rows = [initial];
    await page.route("**/rest/v1/auctions?**", route => json(route, rows));
    let send: ((table: string, type: string, record: Record<string, unknown>) => void) | undefined;
    await page.routeWebSocket(/realtime\/v1\/websocket/, socket => {
      socket.onMessage(message => {
        if (typeof message !== "string") return;
        const [joinRef, ref, topic, event, payload] = JSON.parse(message);
        if (event === "phx_join") {
          const changes = (payload.config?.postgres_changes ?? []).map((change: Record<string, unknown>, i: number) => ({ ...change, id: i + 1 }));
          socket.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: changes } }]));
          if (topic === "realtime:auctions-live") send = (table, type, record) => {
            const change = changes.find((item: { table: string }) => item.table === table);
            socket.send(JSON.stringify([joinRef, null, topic, "postgres_changes", { ids: [change.id], data: {
              schema: "public", table, type, commit_timestamp: NOW, columns: [], old_record: {}, record,
            } }]));
          };
        } else if (event === "heartbeat" || event === "phx_leave") {
          socket.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
        }
      });
    });
    // #8290 (installed after routeWebSocket so it wraps the mock socket): the 350 ms guard measures the app,
    // from the realtime message arriving in the browser to the DOM showing it, never the test harness.
    // The watch is armed and awaited BEFORE the send, and the DOM watch starts synchronously inside the
    // socket's own message dispatch (our listener is registered in the constructor, so it runs before
    // the app's onmessage). An earlier version armed the watch with an un-awaited evaluate: under CI load
    // it landed after the DOM had already changed and then waited for the next unrelated mutation (the
    // 1 s countdown tick), which is the 700-1000 ms that failed CI while the app itself took tens of ms.
    // page.clock.setFixedTime only freezes Date; timers and performance.now keep running in real time.
    await page.addInitScript(() => {
      type Watch = { marker: string; id: string; kind: "closing" | "removed"; receivedAt?: number; changedAt?: number };
      let armed: Watch | undefined;
      const done = (watch: Watch) => {
        const rows = [...document.querySelectorAll(`[data-auction-row="${watch.id}"]`)];
        const row = rows.find(el => el.getBoundingClientRect().height > 0);
        return watch.kind === "removed" ? rows.length === 0 : !!row?.textContent?.includes("125.000") && !row.querySelector('[role="timer"]');
      };
      const start = (watch: Watch) => {
        watch.receivedAt = performance.now();
        const observer = new MutationObserver(() => {
          if (watch.changedAt === undefined && done(watch)) { watch.changedAt = performance.now(); observer.disconnect(); }
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      };
      const Native = window.WebSocket;
      Reflect.set(window, "WebSocket", class extends Native {
        constructor(...args: ConstructorParameters<typeof WebSocket>) {
          super(...args);
          this.addEventListener("message", event => {
            if (armed && armed.receivedAt === undefined && typeof event.data === "string" && event.data.includes("postgres_changes") && event.data.includes(armed.marker)) start(armed);
          });
        }
      });
      Reflect.set(window, "__rtArm", (watch: Watch) => { armed = watch; });
      Reflect.set(window, "__rtResult", () => armed && armed.receivedAt !== undefined && armed.changedAt !== undefined
        ? { visible: true, elapsed: armed.changedAt - armed.receivedAt } : null);
    });
    const reads: Array<{method: string; path: string}> = [];
    let observing = false;
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (observing && request.method() !== "OPTIONS" && (path.startsWith("/rest/v1/") || path.startsWith("/api/"))) reads.push({ method: request.method(), path });
    });
    await page.goto("/auctions?tab=all");
    const row = page.locator('[data-auction-row="auction-realtime-8020"]:visible').first();
    await expect(row).toBeVisible(); await expect(row.getByRole("timer")).toContainText("0:05");
    await expect.poll(() => typeof send).toBe("function"); await waitForStableSnapshotTarget(page);
    observing = true;
    // Elapsed = browser receives the realtime message -> DOM shows the change, both read in the page.
    // The 5 s poll ceiling only keeps a genuine failure from hanging; the guard is the 350 ms assertion.
    const arm = (kind: "closing" | "removed", marker: string) =>
      page.evaluate(watch => (Reflect.get(window, "__rtArm") as (w: unknown) => void)(watch), { id: initial.id, kind, marker });
    const finish = async () => {
      const read = () => page.evaluate(() => (Reflect.get(window, "__rtResult") as () => { visible: boolean; elapsed: number } | null)());
      await expect.poll(read, { timeout: 5000 }).not.toBeNull();
      return (await read()) ?? { visible: false, elapsed: Number.POSITIVE_INFINITY };
    };
    await arm("closing", '"current_price":125000');
    rows = [{ ...initial, current_price: 125000, calculated_end: "2026-11-12T12:02:00Z" }];
    send!("auctions", "UPDATE", { id: initial.id, current_price: 125000, calculated_end: rows[0].calculated_end });
    const result = await finish();
    expect(result.visible).toBe(true); expect(result.elapsed).toBeLessThan(350);
    await page.waitForTimeout(500); expect(reads).toEqual([]);
    await arm("removed", '"status":"completed"');
    rows = []; send!("auctions", "UPDATE", { id: initial.id, status: "completed", current_bidder_id: RIVAL_TEAM.id });
    const removed = await finish();
    expect(removed.visible).toBe(true); expect(removed.elapsed).toBeLessThan(350);
    await page.waitForTimeout(500); expect(reads).toEqual([]);
    send!("auction_bids", "INSERT", { id: "unrelated-bid", auction_id: "unrelated", team_id: RIVAL_TEAM.id, amount: 100, bid_time: NOW });
    await page.waitForTimeout(500); expect(reads).toEqual([]);
    await test.info().attach("realtime-closing-proof", { body: JSON.stringify({ width, closesInSeconds: 5, extensionSeconds: 120, visibleMs: result.elapsed, resourceReads: reads.length, myTeam: TEST_TEAM.id }), contentType: "application/json" });
  });
}


test("#8020 own settlement removes the row but waits for fresh money reads before another bid", async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW)); await page.setViewportSize({ width: 375, height: 900 });
  await installNetworkMocks(page); await stabilizePage(page);
  await page.addInitScript(user => {
    const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ exp: 1893456000, role: "authenticated" }))}.fixture-signature`;
    localStorage.setItem("sb-cycling-zone-e2e-auth-token", JSON.stringify({ access_token: token, refresh_token: "e2e-refresh-token", token_type: "bearer", expires_at: 1893456000, user }));
  }, TEST_USER);
  const base = { ...AUCTIONS[0], status: "active", calculated_end: "2026-11-12T12:05:00Z", seller_team_id: RIVAL_TEAM.id, seller: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name } };
  const own = { ...base, id: "own-settles-a", rider_id: "own-settles-rider", current_price: 50000, current_bidder_id: TEST_TEAM.id, current_bidder: { id: TEST_TEAM.id, name: TEST_TEAM.name }, rider: { ...AUCTIONS[0].rider, id: "own-settles-rider", team_id: RIVAL_TEAM.id } };
  const other = { ...base, id: "other-b", rider_id: "other-rider", current_price: 100000, current_bidder_id: RIVAL_TEAM.id, current_bidder: { id: RIVAL_TEAM.id, name: RIVAL_TEAM.name }, rider: { ...AUCTIONS[0].rider, id: "other-rider", team_id: RIVAL_TEAM.id } };
  let rows = [own, other]; let holding = false, teamHeld = false, snapshotHeld = false;
  let release!: () => void; const fresh = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/rest/v1/auctions?**", async route => {
    if (route.request().method() !== "GET") return route.fallback();
    if (holding) { snapshotHeld = true; await fresh; }
    return json(route, rows);
  });
  await page.route("**/rest/v1/teams?**", async route => {
    if (route.request().method() !== "GET" || !new URL(route.request().url()).searchParams.has("user_id")) return route.fallback();
    if (holding) { teamHeld = true; await fresh; }
    return json(route, { ...TEST_TEAM, balance: holding ? 410000 : 500000 });
  });
  let posts = 0;
  await page.route("**/api/auctions/other-b/bid", route => {
    if (route.request().method() !== "POST") return route.fallback();
    posts += 1;
    const amount = route.request().postDataJSON().amount;
    rows = [{ ...other, current_price: amount, current_bidder_id: TEST_TEAM.id, current_bidder: { id: TEST_TEAM.id, name: TEST_TEAM.name } }];
    return json(route, { ok: true });
  });
  let send: (() => void) | undefined;
  await page.routeWebSocket(/realtime\/v1\/websocket/, socket => {
    socket.onMessage(message => {
      if (typeof message !== "string") return;
      const [joinRef, ref, topic, event, payload] = JSON.parse(message);
      if (event === "phx_join") {
        const changes = (payload.config?.postgres_changes ?? []).map((change: Record<string, unknown>, i: number) => ({ ...change, id: i + 1 }));
        socket.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: changes } }]));
        if (topic === "realtime:auctions-live") send = () => {
          const change = changes.find((item: { table: string }) => item.table === "auctions");
          socket.send(JSON.stringify([joinRef, null, topic, "postgres_changes", { ids: [change.id], data: { schema: "public", table: "auctions", type: "UPDATE", commit_timestamp: NOW, columns: [], old_record: {}, record: { id: own.id, status: "completed", current_bidder_id: null, seller_team_id: null } } }]));
        };
      } else if (event === "heartbeat" || event === "phx_leave") socket.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
    });
  });
  await page.goto("/auctions?tab=all");
  const ownRow = page.locator('[data-auction-row="own-settles-a"]:visible');
  const otherRow = page.locator('[data-auction-row="other-b"]:visible');
  await expect(ownRow).toBeVisible(); await expect(otherRow).toBeVisible();
  await expect.poll(() => typeof send).toBe("function");
  try {
    rows = [other]; holding = true; send!();
    await expect(page.locator('[data-auction-row="own-settles-a"]')).toHaveCount(0);
    await expect.poll(() => teamHeld && snapshotHeld).toBe(true);
    await expect(page.locator("main header .cz-skeleton-static")).toBeVisible();
    await page.screenshot({ path: evidenceShotPath("pr-screens/8020-own-settlement-pending.png"), fullPage: true });
    const bid = otherRow.getByRole("button", { name: "Afgiv bud", exact: true });
    const handle = await bid.elementHandle(); await bid.click();
    await page.getByRole("dialog").getByRole("button").last().click();
    await expect.poll(() => handle!.isDisabled()).toBe(true);
    expect(posts).toBe(0);
    release();
    await expect.poll(() => posts).toBe(1);
    await expect(page.locator("main header")).toContainText("410.000");
    await expect(page.locator("main header .cz-skeleton-static")).toHaveCount(0);
    await page.screenshot({ path: evidenceShotPath("pr-screens/8020-own-settlement-confirmed.png"), fullPage: true });
  } finally { release(); }
});
