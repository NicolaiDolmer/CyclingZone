import { test } from "node:test";
import assert from "node:assert/strict";
import { splitForumLinks } from "./forumLinkify.ts";

const cases: [string, string[]][] = [
  ["se https://cyclingzone.org/forum/abc.", ["https://cyclingzone.org/forum/abc"]],
  ["(https://example.com/a_(b))", ["https://example.com/a_(b)"]],
  ["https://example.com/?q=1&x=2,", ["https://example.com/?q=1&x=2"]],
  ["http://a.dk og https://b.dk", ["http://a.dk", "https://b.dk"]],
  ["www.example.com/test", ["www.example.com/test"]],
  ["ordhttps://example.com ordwww.example.com æhttps://a.dk", []],
  ["javascript:alert(1) data:text/html,x vbscript:x file:///a mailto:a@b.dk //www.a.dk", []],
  ['<img src=x onerror=1>', []],
  ['https://a.dk" onmouseover="x', ["https://a.dk"]],
  ["https://example.com/a[b]}", ["https://example.com/a[b]"]],
  ["https://example.com/a{b}]", ["https://example.com/a{b}"]],
  ["https://a.dk.,;:!?", ["https://a.dk"]],
  ["https://[::1]/test", ["https://[::1]/test"]],
  ["https:// https://?bad www. https://[invalid]", []],
  ["HTTPS://example.com WWW.example.com", ["HTTPS://example.com", "WWW.example.com"]],
  ["https://example.com/" + "a".repeat(20000), ["https://example.com/" + "a".repeat(20000)]],
  ["", []],
  ["før\n https://a.dk\n efter", ["https://a.dk"]],
  ["//https://a.dk javascript:https://a.dk mailto:www.a.dk", []],
];
for (const [index, [input, expected]] of cases.entries()) {
  test(`URL segmentation case ${index + 1}`, () => {
    const segments = splitForumLinks(input);
    assert.equal(segments.map(s => s.value).join(""), input);
    assert.deepEqual(segments.filter(s => s.type === "link").map(s => s.value), expected);
    for (const segment of segments) {
      if (segment.type === "link") {
        assert.equal(segment.href, new URL(/^www\./i.test(segment.value) ? `https://${segment.value}` : segment.value).href);
        assert.ok(["http:", "https:"].includes(new URL(segment.href).protocol));
      }
    }
  });
}

test("typographic quotes delimit URLs without changing their destination", () => {
  const text = "\u201chttps://example.com\u201d \u2018https://example.com/path\u2019";
  const segments = splitForumLinks(text);
  assert.deepEqual(segments.filter(s => s.type === "link").map(s => s.href), [
    "https://example.com/", "https://example.com/path",
  ]);
  assert.equal(segments.map(s => s.value).join(""), text);
});
