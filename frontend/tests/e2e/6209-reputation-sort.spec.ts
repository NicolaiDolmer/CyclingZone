import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, RIDERS, evidenceShotPath, revealMobileTableColumn } from "./fixtures.js";

test("reputation sorting spans every server page and uses the displayed number", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00Z"));
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/display-flags", route => json(route, { rider_reputation_enabled: true }));
  const rows = Array.from({length:1005}, (_,i) => ({ ...RIDERS[0], id:"sort-"+String(i).padStart(4,"0"),
    firstname:"Fixture", lastname:"Rider "+i, popularity:i===1004?99:i===1003?1:20, reputation:i===1004?1:i===1003?100:20 }));
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
    if (select.includes("firstname") && url.searchParams.has("order")) {
      const [key, direction] = (url.searchParams.get("order") || "reputation.desc").split(".");
      const ordered=[...rows].sort((a,b) => direction === "asc" ? Number(a[key])-Number(b[key]) : Number(b[key])-Number(a[key]));
      const offset=Number(url.searchParams.get("offset") || 0), limit=Number(url.searchParams.get("limit") || 50);
      return route.fulfill({status:200,contentType:"application/json",headers:{...corsHeaders(req),"content-range":offset+"-"+(offset+limit-1)+"/1005"},body:JSON.stringify(ordered.slice(offset,offset+limit))});
    }
    return route.fallback();
  });
  await login(page);
  await page.goto("/riders?sort=reputation&sort_dir=desc");
  const table=page.locator('[data-tour="riders-list"] table').filter({visible:true}).first();
  await expect(table.locator('tbody tr').first()).toContainText("Rider 1003");
  await expect(table.locator('tbody tr').nth(1)).toContainText("Rider 1004");
  expect(metadataPages).toBeGreaterThan(1);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).not.toContainText("reputation.band.");
  await revealMobileTableColumn(page, /^(Reputation|Omdømme)$/);
  await page.getByRole("columnheader", {name:/Reputation|Omdømme/}).filter({visible:true}).first().scrollIntoViewIfNeeded();
  await page.screenshot({path:evidenceShotPath("pr-screens/6209/after-"+testInfo.project.name+".png"),fullPage:false});
  await page.goto("/riders?sort=popularity&sort_dir=desc");
  await expect(page.locator('[data-tour="riders-list"] table').filter({visible:true}).first().locator("tbody tr").first()).toContainText("Rider 1003");
  await page.goto("/help?faq=boardProfileRiders");
  await expect(page.getByText(/ikke en regel om at vælge dine syv bedste ryttere/)).toBeVisible();
});
