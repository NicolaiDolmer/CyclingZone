import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, RIDERS, evidenceShotPath, revealMobileTableColumn } from "./fixtures.js";

test("reputation sorting spans every server page and uses the displayed number", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/display-flags", route => json(route, { rider_reputation_enabled: true }));
  const rows = Array.from({length:1005}, (_,i) => ({ ...RIDERS[0], id:"sort-"+String(i).padStart(4,"0"),
    firstname:"Fixture", lastname:"Rider "+i, popularity:i===1004?99:20, reputation:i===1004?1:20 }));
  let metadataPages = 0;
  await page.route("**/rest/v1/riders?**", route => {
    const req=route.request();
    if(req.method()==="OPTIONS") return route.fulfill({status:204,headers:corsHeaders(req)});
    const url=new URL(req.url());
    const select=url.searchParams.get("select") || "";
    const ids=url.searchParams.get("id");
    if(select.replaceAll(" ","")==="id,popularity,reputation") {
      metadataPages++;
      const offset=Number(url.searchParams.get("offset") || 0);
      return json(route,rows.slice(offset,offset+1000).map(({id,popularity,reputation})=>({id,popularity,reputation})));
    }
    if(ids?.startsWith("in.(")) {
      const selected=new Set(ids.slice(4,-1).split(",").map(x=>x.replaceAll('"',"")));
      return json(route,rows.filter(r=>selected.has(r.id)).reverse());
    }
    return route.fallback();
  });
  await login(page);
  await page.goto("/riders?sort=reputation&sort_dir=desc");
  const table=page.locator('[data-tour="riders-list"] table').filter({visible:true}).first();
  await expect(table.locator('tbody tr').first()).toContainText("Rider 1004");
  expect(metadataPages).toBeGreaterThan(1);
  await revealMobileTableColumn(page, /^(Reputation|Omdømme)$/);
  await page.getByRole("columnheader", {name:/Reputation|Omdømme/}).filter({visible:true}).first().scrollIntoViewIfNeeded();
  await page.screenshot({path:evidenceShotPath("pr-screens/6209/after-"+testInfo.project.name+".png"),fullPage:true});
  await page.goto("/help?faq=boardProfileRiders");
  await expect(page.getByText(/ikke en regel om at vælge dine syv bedste ryttere/)).toBeVisible();
});
