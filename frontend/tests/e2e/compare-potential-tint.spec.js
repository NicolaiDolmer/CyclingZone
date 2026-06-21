// Forward-guard for the malformed-Tailwind regression on RiderComparePage's
// "Potential" row: the highlighted row carried `bg-cz-accent/10/30` (two opacity
// modifiers → invalid class → Tailwind emitted nothing → no tint rendered).
// This spec asserts the row gets a real accent tint while the regular stat rows
// stay transparent, so a future double-modifier slip fails CI instead of shipping
// an invisible highlight.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

test("compare potential row renders an accent tint, not a transparent/no-op background", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);

  // Deep-link two riders; the scouting-estimates mock returns non-null for both,
  // so the gated Potential row (`scouting.estimateFor(r.id) !== null`) renders.
  await page.goto("/compare?ids=rider-1,rider-2");

  // Locale- and icon-independent anchor for the Potential row. (#1639 swapped the
  // ◆ glyph for a StarIcon SVG, so we key off a stable data-testid, not the marker.)
  const potentialRow = page.getByTestId("compare-potential-row");
  await expect(potentialRow).toBeVisible();

  const styles = await page.evaluate(() => {
    const potentialRow = document.querySelector('[data-testid="compare-potential-row"]');
    const container = potentialRow?.parentElement;
    // First grid row that is NOT the potential row = a regular stat row (transparent).
    const statRow = container
      ? [...container.children].find(c => c !== potentialRow && c.className.includes("grid"))
      : null;
    const bg = el => (el ? getComputedStyle(el).backgroundColor : null);
    return { potentialBg: bg(potentialRow), statBg: bg(statRow) };
  });

  // Potential row must have a painted background (the accent tint), not transparent.
  expect(styles.potentialBg).toBeTruthy();
  expect(styles.potentialBg).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.potentialBg).not.toBe("transparent");

  // Regular stat rows stay transparent — confirms the tint is the row's own, the
  // highlight reads as distinct, and we didn't accidentally tint the whole table.
  expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(styles.statBg);
});
