import assert from "node:assert/strict";
import test from "node:test";

import { splitMessageText } from "./messageSegments.js";

test("ren tekst giver ét segment", () => {
  assert.deepEqual(splitMessageText("Would you take 120k?"), [
    { type: "text", value: "Would you take 120k?" },
  ]);
});

test("tom eller ikke-tekst giver ingen segmenter", () => {
  assert.deepEqual(splitMessageText(""), []);
  assert.deepEqual(splitMessageText(null), []);
  assert.deepEqual(splitMessageText(undefined), []);
});

test("en https-URL bliver et link-segment", () => {
  assert.deepEqual(splitMessageText("se https://cyclingzone.org/riders/9 her"), [
    { type: "text", value: "se " },
    { type: "link", value: "https://cyclingzone.org/riders/9" },
    { type: "text", value: " her" },
  ]);
});

test("afsluttende tegnsætning hører til sætningen, ikke til URL'en", () => {
  assert.deepEqual(splitMessageText("Kig på https://cyclingzone.org/forum."), [
    { type: "text", value: "Kig på " },
    { type: "link", value: "https://cyclingzone.org/forum" },
    { type: "text", value: "." },
  ]);
});

test("en balanceret parentes INDE i URL'en overlever", () => {
  assert.deepEqual(splitMessageText("se https://en.wikipedia.org/wiki/Function_(mathematics) her"), [
    { type: "text", value: "se " },
    { type: "link", value: "https://en.wikipedia.org/wiki/Function_(mathematics)" },
    { type: "text", value: " her" },
  ]);
});

test("en ubalanceret slutparentes hoerer til saetningen", () => {
  assert.deepEqual(splitMessageText("(se https://a.dk)"), [
    { type: "text", value: "(se " },
    { type: "link", value: "https://a.dk" },
    { type: "text", value: ")" },
  ]);
});

test("flere URL'er i samme besked", () => {
  const parts = splitMessageText("http://a.dk og https://b.dk");
  assert.deepEqual(parts.filter(p => p.type === "link").map(p => p.value), ["http://a.dk", "https://b.dk"]);
});

test("javascript: og data: bliver ALDRIG links", () => {
  for (const hostile of [
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "mailto:someone@example.com",
    "example.com/uden-protokol",
  ]) {
    const parts = splitMessageText(hostile);
    assert.equal(parts.every(p => p.type === "text"), true, `${hostile} må ikke blive et link`);
  }
});

test("HTML i teksten forbliver tekst — der er ingen markup-sti", () => {
  const parts = splitMessageText('<img src=x onerror="alert(1)">');
  assert.deepEqual(parts, [{ type: "text", value: '<img src=x onerror="alert(1)">' }]);
});

test("segmenterne sat sammen igen giver den oprindelige tekst", () => {
  for (const text of [
    "hej",
    "se https://cyclingzone.org/forum.",
    "http://a.dk og https://b.dk!",
    "linje 1\nlinje 2 https://c.dk",
  ]) {
    assert.equal(splitMessageText(text).map(p => p.value).join(""), text);
  }
});
