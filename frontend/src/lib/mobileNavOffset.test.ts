import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MOBILE_NAV_OFFSET_VAR,
  formatNavOffset,
  publishMobileNavOffset,
  clearMobileNavOffset,
} from "./mobileNavOffset.ts";

function fakeRoot() {
  const props = new Map<string, string>();
  return {
    props,
    style: {
      setProperty(name: string, value: string) {
        props.set(name, value);
      },
      removeProperty(name: string) {
        const prev = props.get(name) ?? "";
        props.delete(name);
        return prev;
      },
    },
  };
}

test("#5561: menuens højde bliver til en px-længde", () => {
  assert.equal(formatNavOffset(56), "56px");
  assert.equal(formatNavOffset(56.4), "56px");
});

test("#5561: skjult menu (desktop, display:none) giver 0px, ikke et negativt eller tomt offset", () => {
  assert.equal(formatNavOffset(0), "0px");
  assert.equal(formatNavOffset(-10), "0px");
  assert.equal(formatNavOffset(Number.NaN), "0px");
  assert.equal(formatNavOffset(undefined), "0px");
  assert.equal(formatNavOffset(null), "0px");
});

test("#5561: publish skriver variablen, clear fjerner den igen", () => {
  const root = fakeRoot();
  publishMobileNavOffset(root, 56);
  assert.equal(root.props.get(MOBILE_NAV_OFFSET_VAR), "56px");
  publishMobileNavOffset(root, 0);
  assert.equal(root.props.get(MOBILE_NAV_OFFSET_VAR), "0px");
  clearMobileNavOffset(root);
  assert.equal(root.props.has(MOBILE_NAV_OFFSET_VAR), false);
});

test("#5561: variabelnavnet matcher klassen i de tre bundbjælker", async () => {
  const { readFile } = await import("node:fs/promises");
  const files = [
    "../components/CookieBanner.jsx",
    "../components/ReleaseUpdateBanner.jsx",
    "../components/NpsPrompt.jsx",
  ];
  // Klassen står som ét bogstaveligt ord: en skabelonstreng her ville Tailwind
  // scanne som en (ugyldig) klasse og vælte CSS-minificeringen i buildet.
  const expectedClass = "bottom-[var(--cz-mobile-nav-offset,0px)]";
  assert.ok(expectedClass.includes(MOBILE_NAV_OFFSET_VAR));
  for (const rel of files) {
    const src = await readFile(new URL(rel, import.meta.url), "utf8");
    assert.ok(src.includes(expectedClass), `${rel} skal stå over bundmenuen på mobil`);
    assert.ok(!/fixed inset-x-0 bottom-0\b/.test(src), `${rel} må ikke længere sidde fast i bottom-0`);
  }
});
