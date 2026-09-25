// #5402: Indstillinger-siden (/profile) er delt i faner. Testen holder tre ting
// fast uden at rendere komponenten (node --test indlaeser ikke .jsx):
//   1. fane-reglen i lib/settingsTabs.ts (?tab=, ankre, standardfane),
//   2. at HVER sektion paa siden staar i praecis den fane kortet siger, og at
//      ingen sektion er tabt i flytningen fra den lange scroll-side,
//   3. at dyb-links fra andre sider lander paa den rigtige fane.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_SECTION_TAB,
  SETTINGS_TABS,
  resolveSettingsTab,
  settingsSectionId,
} from "../lib/settingsTabs.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const source = read("./ProfilePage.jsx");

test("standardfanen er Konto, og et ukendt ?tab= falder tilbage til den", () => {
  assert.equal(DEFAULT_SETTINGS_TAB, "account");
  assert.deepEqual(resolveSettingsTab(null), { tab: "account", section: null });
  assert.deepEqual(resolveSettingsTab("nope"), { tab: "account", section: null });
  assert.deepEqual(resolveSettingsTab(""), { tab: "account", section: null });
});

test("et gyldigt ?tab= aabner den fane", () => {
  for (const tab of SETTINGS_TABS) {
    assert.deepEqual(resolveSettingsTab(tab), { tab, section: null });
  }
});

test("et anker uden ?tab= vaelger sektionens fane og ruller den frem", () => {
  assert.deepEqual(resolveSettingsTab(null, "#discord"), { tab: "notifications", section: "discord" });
  assert.deepEqual(resolveSettingsTab(null, "#beta"), { tab: "beta", section: "beta" });
  assert.deepEqual(resolveSettingsTab(null, "#team"), { tab: "account", section: "team" });
  // DOM-id'et virker ogsaa som anker
  assert.deepEqual(resolveSettingsTab(null, "#settings-privacy"), { tab: "privacy", section: "privacy" });
});

test("et eksplicit ?tab= vinder over et anker fra en anden fane", () => {
  assert.deepEqual(resolveSettingsTab("privacy", "#discord"), { tab: "privacy", section: null });
  assert.deepEqual(resolveSettingsTab("notifications", "#discord"), { tab: "notifications", section: "discord" });
});

test("ukendte eller misdannede ankre ignoreres", () => {
  assert.deepEqual(resolveSettingsTab(null, "#findes-ikke"), { tab: "account", section: null });
  assert.deepEqual(resolveSettingsTab(null, "#%E0%A4%A"), { tab: "account", section: null });
  assert.deepEqual(resolveSettingsTab(null, "#"), { tab: "account", section: null });
  assert.deepEqual(resolveSettingsTab(null, "#constructor"), { tab: "account", section: null });
});

test("hver fane har et panel, og hver sektion staar i sin egen fanes panel", () => {
  const chunks = source.split('<TabPanel value="').slice(1);
  const panels = new Map<string, string[]>();
  for (const chunk of chunks) {
    const tab = chunk.slice(0, chunk.indexOf('"'));
    const body = chunk.slice(0, chunk.indexOf("</TabPanel>"));
    const sections = [...body.matchAll(/settingsSectionId\("([a-z-]+)"\)/g)].map(m => m[1]);
    assert.ok(!panels.has(tab), `fanen ${tab} har to paneler`);
    panels.set(tab, sections);
  }
  assert.deepEqual([...panels.keys()].sort(), [...SETTINGS_TABS].sort(), "et panel pr. fane, ingen ekstra");

  const expected = new Map<string, string[]>();
  for (const [section, tab] of Object.entries(SETTINGS_SECTION_TAB)) {
    expected.set(tab, [...(expected.get(tab) ?? []), section]);
  }
  for (const tab of SETTINGS_TABS) {
    assert.deepEqual(
      [...(panels.get(tab) ?? [])].sort(),
      [...(expected.get(tab) ?? [])].sort(),
      `fanen ${tab} rendrer ikke praecis sine sektioner`,
    );
  }
});

test("ingen sektion er tabt: alle ti kort fra scroll-siden findes stadig", () => {
  // Kortenes titler fra den lange side (foer #5402). Forsvinder en af dem fra
  // ProfilePage.jsx, er en indstilling tabt i opdelingen.
  const titles = [
    "account.title", "appearance.title", "selectionReminder.title", "beta.title",
    "assistant.title", "privacy.title", "subscription.title", "forumCategories.title",
    "team.title", "discord.title",
  ];
  for (const key of titles) {
    assert.ok(source.includes(`t("${key}")`), `${key} mangler paa siden`);
  }
  assert.equal(Object.keys(SETTINGS_SECTION_TAB).length, titles.length);
  for (const section of Object.keys(SETTINGS_SECTION_TAB)) {
    assert.equal(
      source.split(`settingsSectionId("${section}")`).length - 1, 1,
      `${settingsSectionId(section as keyof typeof SETTINGS_SECTION_TAB)} skal staa paa praecis eet kort`,
    );
  }
});

test("fanen styres af URL'en (?tab=), ikke af lokal state", () => {
  assert.match(source, /useSearchParams\(\)/);
  assert.match(source, /resolveSettingsTab\(searchParams\.get\("tab"\), hash\)/);
  assert.match(source, /<Tabs value=\{activeTab\} onChange=\{setTab\}>/);
});

test("hver fane har en label paa engelsk og dansk", () => {
  for (const lang of ["en", "da"]) {
    const json = JSON.parse(read(`../../public/locales/${lang}/profile.json`));
    assert.ok(json.tabs?.label, `${lang}: tabs.label mangler`);
    for (const tab of SETTINGS_TABS) {
      assert.ok(typeof json.tabs?.[tab] === "string" && json.tabs[tab].length > 0, `${lang}: tabs.${tab} mangler`);
    }
  }
});

test("dyb-links fra andre sider lander paa den rigtige fane", () => {
  const cases = [
    { file: "./DashboardPage.jsx", tab: "notifications", section: "discord" },
    { file: "./NotificationsPage.jsx", tab: "beta", section: null },
  ];
  for (const { file, tab, section } of cases) {
    const match = read(file).match(/"(\/profile[?#][^"]*)"/);
    assert.ok(match, `${file} linker ikke til en fane paa /profile`);
    const url = new URL(match[1], "https://example.test");
    assert.deepEqual(resolveSettingsTab(url.searchParams.get("tab"), url.hash), { tab, section }, file);
  }
});
