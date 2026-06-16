import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDocumentHead, applyJsonLd } from "./useDocumentHead.js";

// Repoet har bevidst ingen jsdom — men kerne-logikken i applyDocumentHead er en
// ren funktion der kun rører doc/win via et lille interface. Vi bygger en
// minimal fake DOM der dækker netop de metoder funktionen bruger
// (querySelector, createElement, head.appendChild, attributter, .title, .lang).
// Det giver en RIGTIG adfærds-test (create + update + canonical-default +
// cleanup) uden en tung browser-emulering.

function makeFakeDom({ pathname = "/", origin = "https://cyclingzone.org" } = {}) {
  const elements = []; // alle elementer der "findes i head" + html-elementet

  function makeEl(tag) {
    const attrs = {};
    const el = {
      tagName: tag.toUpperCase(),
      _attrs: attrs,
      _parent: null,
      textContent: "",
      get href() {
        return attrs.href;
      },
      set href(v) {
        attrs.href = v;
      },
      setAttribute(k, v) {
        attrs[k] = String(v);
      },
      getAttribute(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
      },
      removeAttribute(k) {
        delete attrs[k];
      },
      remove() {
        const i = elements.indexOf(el);
        if (i >= 0) elements.splice(i, 1);
        el._parent = null;
      },
    };
    return el;
  }

  const htmlEl = makeEl("html");

  const doc = {
    title: "Initial title",
    documentElement: htmlEl,
    createElement: (tag) => makeEl(tag),
    head: {
      appendChild(el) {
        el._parent = doc.head;
        elements.push(el);
        return el;
      },
    },
    querySelector(sel) {
      // Understøtter præcis de selectors funktionen bruger:
      //   meta[name="x"], link[rel="x"], script[...][data-cz-jsonld="x"]
      const metaName = sel.match(/^meta\[name="([^"]+)"\]$/);
      if (metaName) {
        return (
          elements.find(
            (e) => e.tagName === "META" && e.getAttribute("name") === metaName[1],
          ) || null
        );
      }
      const linkRel = sel.match(/^link\[rel="([^"]+)"\]$/);
      if (linkRel) {
        return (
          elements.find(
            (e) => e.tagName === "LINK" && e.getAttribute("rel") === linkRel[1],
          ) || null
        );
      }
      const ld = sel.match(/data-cz-jsonld="([^"]+)"/);
      if (ld) {
        return (
          elements.find(
            (e) => e.tagName === "SCRIPT" && e.getAttribute("data-cz-jsonld") === ld[1],
          ) || null
        );
      }
      return null;
    },
    _elements: elements,
  };

  const win = { location: { origin, pathname } };
  return { doc, win, htmlEl };
}

test("applyDocumentHead sætter title, description, canonical og lang (create)", () => {
  const { doc, win, htmlEl } = makeFakeDom({ pathname: "/login" });
  applyDocumentHead(doc, win, {
    title: "Log in · Cycling Zone",
    description: "Log in to Cycling Zone.",
    canonical: "https://cyclingzone.org/login",
    lang: "en",
  });

  assert.equal(doc.title, "Log in · Cycling Zone");
  assert.equal(htmlEl.getAttribute("lang"), "en");

  const meta = doc.querySelector('meta[name="description"]');
  assert.ok(meta, "description-meta skal være oprettet");
  assert.equal(meta.getAttribute("content"), "Log in to Cycling Zone.");

  const link = doc.querySelector('link[rel="canonical"]');
  assert.ok(link, "canonical-link skal være oprettet");
  assert.equal(link.getAttribute("href"), "https://cyclingzone.org/login");
});

test("canonical defaulter til origin + pathname når den udelades", () => {
  const { doc, win } = makeFakeDom({
    pathname: "/privacy-policy",
    origin: "https://example.test",
  });
  applyDocumentHead(doc, win, { title: "Privacy" });

  const link = doc.querySelector('link[rel="canonical"]');
  assert.equal(link.getAttribute("href"), "https://example.test/privacy-policy");
});

test("cleanup gendanner forrige title og fjerner oprettede elementer", () => {
  const { doc, win } = makeFakeDom({ pathname: "/founder-supporter" });
  const cleanup = applyDocumentHead(doc, win, {
    title: "Founder · Cycling Zone",
    description: "Back the project.",
    canonical: "https://cyclingzone.org/founder-supporter",
    lang: "da",
  });

  assert.equal(doc.title, "Founder · Cycling Zone");
  assert.ok(doc.querySelector('meta[name="description"]'));
  assert.ok(doc.querySelector('link[rel="canonical"]'));

  cleanup();

  assert.equal(doc.title, "Initial title", "title skal gendannes");
  assert.equal(
    doc.querySelector('meta[name="description"]'),
    null,
    "oprettet description-meta skal fjernes ved cleanup",
  );
  assert.equal(
    doc.querySelector('link[rel="canonical"]'),
    null,
    "oprettet canonical skal fjernes ved cleanup",
  );
});

test("update: et eksisterende meta/canonical opdateres og gendannes (ikke fjernes)", () => {
  const { doc, win } = makeFakeDom({ pathname: "/" });
  // Forhåndssæt en baseline-meta + canonical, som index.html ville have.
  const baseMeta = doc.createElement("meta");
  baseMeta.setAttribute("name", "description");
  baseMeta.setAttribute("content", "Baseline description");
  doc.head.appendChild(baseMeta);
  const baseCanon = doc.createElement("link");
  baseCanon.setAttribute("rel", "canonical");
  baseCanon.setAttribute("href", "https://cyclingzone.org/");
  doc.head.appendChild(baseCanon);

  const cleanup = applyDocumentHead(doc, win, {
    title: "Home",
    description: "Route description",
    canonical: "https://cyclingzone.org/home",
  });

  assert.equal(baseMeta.getAttribute("content"), "Route description");
  assert.equal(baseCanon.getAttribute("href"), "https://cyclingzone.org/home");

  cleanup();

  assert.equal(
    baseMeta.getAttribute("content"),
    "Baseline description",
    "eksisterende meta skal gendannes, ikke fjernes",
  );
  assert.equal(
    baseCanon.getAttribute("href"),
    "https://cyclingzone.org/",
    "eksisterende canonical skal gendannes",
  );
  assert.ok(
    doc.querySelector('meta[name="description"]'),
    "baseline-meta skal stadig findes efter cleanup",
  );
});

test("noindex sætter robots-meta og dropper canonical (ingen rod-canonical)", () => {
  const { doc, win } = makeFakeDom({ pathname: "/reset-password" });
  applyDocumentHead(doc, win, { title: "Reset password", noindex: true });

  const robots = doc.querySelector('meta[name="robots"]');
  assert.ok(robots, "robots-meta skal oprettes ved noindex");
  assert.match(robots.getAttribute("content"), /noindex/);
  assert.equal(
    doc.querySelector('link[rel="canonical"]'),
    null,
    "noindex-rute må ikke få en canonical",
  );
});

test("applyJsonLd injicerer ét script og er idempotent ved gentaget kald", () => {
  const { doc } = makeFakeDom({ pathname: "/" });
  const data = { "@context": "https://schema.org", "@type": "VideoGame", name: "Cycling Zone" };

  const cleanup1 = applyJsonLd(doc, "videogame", data);
  let scripts = doc._elements.filter((e) => e.tagName === "SCRIPT");
  assert.equal(scripts.length, 1, "præcis ét JSON-LD-script");
  assert.match(scripts[0].textContent, /VideoGame/);

  // Gentaget kald med samme id må ikke duplikere.
  const cleanup2 = applyJsonLd(doc, "videogame", data);
  scripts = doc._elements.filter((e) => e.tagName === "SCRIPT");
  assert.equal(scripts.length, 1, "ingen duplikering ved gentaget injection");

  cleanup2();
  scripts = doc._elements.filter((e) => e.tagName === "SCRIPT");
  assert.equal(scripts.length, 0, "cleanup fjerner scriptet");
  cleanup1();
});
