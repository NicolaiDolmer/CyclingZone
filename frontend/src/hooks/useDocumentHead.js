// useDocumentHead — per-route <title> / meta description / canonical / <html lang>
// + optional JSON-LD (#1404, #1405; Refs #1301).
//
// Hvorfor: SPA'en serverer én statisk index.html (frontend/index.html) til alle
// ruter, så hver public route delte samme <title>/description/canonical. Dette
// hook giver hver rute sin egen head-metadata KLIENT-SIDE efter mount.
//
// VIGTIGT (SPA-begrænsning): metadataen sættes i JavaScript efter first paint.
// JS-kørende crawlere (Googlebot rendrer JS) ser de rute-specifikke værdier;
// ikke-JS-crawlere ser kun index.html-baseline. Fuld dækning kræver
// prerender/SSG — sporet som en senere #1301-checkbox.
//
// Design:
//   • Kerne-DOM-logikken ligger i `applyDocumentHead(doc, win, opts)` — en ren
//     funktion uden React/jsdom-afhængighed, så den kan unit-testes med en
//     minimal fake doc/win (repoet har bevidst ingen jsdom; source-assertion-
//     mønster ellers). Den returnerer en cleanup-funktion.
//   • `useDocumentHead(opts)` kalder den i en useEffect og rydder op ved unmount.
//   • Last-writer-wins mellem ruter der begge bruger hooket: hver rute sætter
//     sine egne værdier ved mount. unmount-cleanup gendanner KUN den oprindelige
//     state, så en hook-løs rute ikke arver en stale titel.

import { useEffect } from "react";

const ORIGIN_FALLBACK = "https://cyclingzone.org";

function ensureMeta(doc, name) {
  let el = doc.querySelector(`meta[name="${name}"]`);
  let created = false;
  if (!el) {
    el = doc.createElement("meta");
    el.setAttribute("name", name);
    doc.head.appendChild(el);
    created = true;
  }
  return { el, created };
}

function ensureLink(doc, rel) {
  let el = doc.querySelector(`link[rel="${rel}"]`);
  let created = false;
  if (!el) {
    el = doc.createElement("link");
    el.setAttribute("rel", rel);
    doc.head.appendChild(el);
    created = true;
  }
  return { el, created };
}

/**
 * Sæt/opdatér document head-metadata. Ren funktion: tager doc + win eksplicit.
 *
 * @param {Document} doc
 * @param {Window} win
 * @param {object} opts
 * @param {string}  [opts.title]        document.title
 * @param {string}  [opts.description]  <meta name="description">
 * @param {string}  [opts.canonical]    absolut canonical-URL. Udeladt → origin+pathname.
 * @param {string}  [opts.lang]         <html lang="">
 * @param {boolean} [opts.noindex]      true → <meta name="robots" content="noindex">
 *                                      og INGEN canonical (rute uden for sitemap).
 * @returns {() => void} cleanup der gendanner den oprindelige state.
 */
export function applyDocumentHead(doc, win, opts = {}) {
  if (!doc || !doc.head) return () => {};
  const { title, description, canonical, lang, noindex = false } = opts;

  const restore = [];

  // ---- <title> ----
  if (typeof title === "string") {
    const prev = doc.title;
    doc.title = title;
    restore.push(() => {
      doc.title = prev;
    });
  }

  // ---- <html lang> ----
  if (typeof lang === "string" && doc.documentElement) {
    const prev = doc.documentElement.getAttribute("lang");
    doc.documentElement.setAttribute("lang", lang);
    restore.push(() => {
      if (prev === null) doc.documentElement.removeAttribute("lang");
      else doc.documentElement.setAttribute("lang", prev);
    });
  }

  // ---- <meta name="description"> ----
  if (typeof description === "string") {
    const { el, created } = ensureMeta(doc, "description");
    const prev = el.getAttribute("content");
    el.setAttribute("content", description);
    restore.push(() => {
      if (created) el.remove();
      else if (prev !== null) el.setAttribute("content", prev);
      else el.removeAttribute("content");
    });
  }

  // ---- <meta name="robots"> (noindex) ----
  if (noindex) {
    const { el, created } = ensureMeta(doc, "robots");
    const prev = el.getAttribute("content");
    el.setAttribute("content", "noindex, nofollow");
    restore.push(() => {
      if (created) el.remove();
      else if (prev !== null) el.setAttribute("content", prev);
      else el.removeAttribute("content");
    });
  }

  // ---- <link rel="canonical"> ----
  // noindex-ruter (uden for sitemap, fx /reset-password, /ui) får IKKE en
  // canonical der peger på roden — det ville fortælle crawlere at de ER
  // kanoniske sider. Vi fjerner i stedet en evt. arvet canonical.
  if (noindex) {
    const existing = doc.querySelector('link[rel="canonical"]');
    if (existing) {
      const prevHref = existing.getAttribute("href");
      const parent = existing.parentNode;
      const next = existing.nextSibling;
      existing.remove();
      restore.push(() => {
        if (prevHref !== null) {
          existing.setAttribute("href", prevHref);
          if (parent) parent.insertBefore(existing, next);
        }
      });
    }
  } else {
    let href = canonical;
    if (typeof href !== "string" || href.length === 0) {
      const origin = (win && win.location && win.location.origin) || ORIGIN_FALLBACK;
      const pathname = (win && win.location && win.location.pathname) || "/";
      href = origin + pathname;
    }
    const { el, created } = ensureLink(doc, "canonical");
    const prev = el.getAttribute("href");
    el.setAttribute("href", href);
    restore.push(() => {
      if (created) el.remove();
      else if (prev !== null) el.setAttribute("href", prev);
      else el.removeAttribute("href");
    });
  }

  return () => {
    // Gendan i omvendt rækkefølge (LIFO) så created/remove-par matcher.
    for (let i = restore.length - 1; i >= 0; i -= 1) restore[i]();
  };
}

const JSON_LD_ATTR = "data-cz-jsonld";

/**
 * Inject/fjern et <script type="application/ld+json"> med en stabil id, så
 * gentagne mounts (StrictMode / re-render) ikke duplikerer scriptet.
 *
 * @param {Document} doc
 * @param {string} id   stabil identifikator (data-cz-jsonld="{id}")
 * @param {object|null} data  JSON-LD-objekt; null/undefined fjerner et evt.
 *                            eksisterende script med samme id.
 * @returns {() => void} cleanup der fjerner scriptet igen.
 */
export function applyJsonLd(doc, id, data) {
  if (!doc || !doc.head || !id) return () => {};
  const selector = `script[type="application/ld+json"][${JSON_LD_ATTR}="${id}"]`;
  const remove = () => {
    const existing = doc.querySelector(selector);
    if (existing) existing.remove();
  };
  // Ryd evt. eksisterende (idempotent) før vi injicerer.
  remove();
  if (data == null) return remove;

  const el = doc.createElement("script");
  el.setAttribute("type", "application/ld+json");
  el.setAttribute(JSON_LD_ATTR, id);
  el.textContent = JSON.stringify(data);
  doc.head.appendChild(el);
  return remove;
}

/**
 * React-hook: sæt per-route head-metadata for hele komponentens levetid.
 * Re-kører når en af de primitive opts ændrer sig (fx sprogskift).
 */
export function useDocumentHead({ title, description, canonical, lang, noindex } = {}) {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    return applyDocumentHead(document, window, {
      title,
      description,
      canonical,
      lang,
      noindex,
    });
  }, [title, description, canonical, lang, noindex]);
}

/**
 * React-hook: inject JSON-LD struktureret data for komponentens levetid.
 * `data` bør være memoiseret af kalderen (eller en stabil konstant) så effekten
 * ikke re-kører unødigt; vi serialiserer den til dependency-sammenligning.
 */
export function useJsonLd(id, data) {
  const serialized = data == null ? null : JSON.stringify(data);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    return applyJsonLd(document, id, serialized == null ? null : JSON.parse(serialized));
  }, [id, serialized]);
}

export default useDocumentHead;
