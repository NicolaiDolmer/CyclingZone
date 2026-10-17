// #6768 - kontrast-vagt paa tokens i index.css, begge temaer.
// WCAG 2.x-formel. Kontroller/kanter/baand >= 3:1 (1.4.11), tekst >= 4,5:1 (1.4.3).
// --border er bevidst hairline (TASTE) og maales IKKE mod 3:1 - kun pinnet, saa
// ingen "retter" den ved et uheld. Kontroller bruger --border-strong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "index.css"), "utf8").replace(/\r\n/g, "\n");

function block(startMarker: string): string {
  const start = css.indexOf(startMarker);
  assert.ok(start >= 0, `kunne ikke finde ${startMarker} i index.css`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function tokensOf(blockText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of blockText.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) out[m[1]] = m[2].trim();
  return out;
}

const THEMES: Record<string, Record<string, string>> = {
  light: tokensOf(block("\n:root {\n  color-scheme: light;")),
  dark: tokensOf(block('\n[data-theme="dark"] {\n  color-scheme: dark;')),
};

const hexToRgb = (h: string): number[] => {
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  assert.ok(m, `forventede #rrggbb, fik ${h}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
};
const channels = (v: string): number[] => v.trim().split(/\s+/).map(Number);
const rgbaOf = (v: string) => {
  const m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v);
  assert.ok(m, `forventede rgba(...), fik ${v}`);
  return { rgb: [+m[1], +m[2], +m[3]], a: +m[4] };
};
const over = (fg: number[], a: number, bg: number[]): number[] => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: number[]): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number[], b: number[]): number => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

for (const [name, t] of Object.entries(THEMES)) {
  const hex = (k: string): number[] => {
    assert.ok(t[k], `${name}: ${k} mangler`);
    return hexToRgb(t[k]);
  };
  const surfaces: Record<string, number[]> = { body: hex("--bg-body"), card: hex("--bg-card"), elevated: hex("--bg-elevated"), subtle: hex("--bg-subtle") };

  test(`${name}: --border-strong og slukket kontakt >= 3:1 mod alle flader`, () => {
    for (const token of ["--border-strong", "--toggle-off"]) {
      for (const [sName, s] of Object.entries(surfaces)) {
        const r = ratio(hex(token), s);
        assert.ok(r >= 3, `${name} ${token} mod ${sName}: ${r.toFixed(2)}:1 < 3:1`);
      }
    }
  });

  test(`${name}: slukket tommel >= 3:1 mod sporet, tændt tommel (on-accent) >= 4,5:1 mod accent`, () => {
    const thumb = ratio(hex("--toggle-thumb"), hex("--toggle-off"));
    assert.ok(thumb >= 3, `${name} tommel mod spor: ${thumb.toFixed(2)}:1 < 3:1`);
    const on = ratio(hex("--on-accent"), channels(t["--accent"]));
    assert.ok(on >= 4.5, `${name} on-accent mod accent: ${on.toFixed(2)}:1 < 4,5:1`);
  });

  test(`${name}: dagsbaandets celler >= 3:1 mod baandet (subtle), body og card`, () => {
    for (const token of ["--day-cell", "--day-cell-mine", "--day-cell-hover"]) {
      for (const sName of ["subtle", "body", "card"]) {
        const r = ratio(hex(token), surfaces[sName]);
        assert.ok(r >= 3, `${name} ${token} mod ${sName}: ${r.toFixed(2)}:1 < 3:1`);
      }
    }
  });

  test(`${name}: "i dag"-ringen (text-1) >= 3:1 mod alle dagsceller`, () => {
    for (const token of ["--day-cell", "--day-cell-mine"]) {
      const r = ratio(hex("--text-1"), hex(token));
      assert.ok(r >= 3, `${name} ring (text-1) mod ${token}: ${r.toFixed(2)}:1 < 3:1`);
    }
  });

  test(`${name}: dag med eget loeb kan skelnes fra dag uden`, () => {
    const r = ratio(hex("--day-cell-mine"), hex("--day-cell"));
    assert.ok(r >= 1.3, `${name} day-cell-mine mod day-cell: ${r.toFixed(2)}:1 < 1,3:1`);
  });

  test(`${name}: brødtekst (text-1/2/3) >= 4,5:1 paa alle flader`, () => {
    for (const token of ["--text-1", "--text-2", "--text-3"]) {
      for (const [sName, s] of Object.entries(surfaces)) {
        const r = ratio(hex(token), s);
        assert.ok(r >= 4.5, `${name} ${token} mod ${sName}: ${r.toFixed(2)}:1 < 4,5:1`);
      }
    }
  });

  test(`${name}: status-tekst paa sin -bg (oven paa card) >= 4,5:1`, () => {
    for (const status of ["success", "danger", "warning", "info"]) {
      const { rgb, a } = rgbaOf(t[`--${status}-bg`]);
      const bg = over(rgb, a, surfaces.card);
      const r = ratio(channels(t[`--${status}`]), bg);
      assert.ok(r >= 4.5, `${name} ${status} mod ${status}-bg: ${r.toFixed(2)}:1 < 4,5:1`);
    }
  });
}

test("--border er uroert (hairline-design, TASTE)", () => {
  assert.equal(THEMES.light["--border"], "#e5e0d5");
  assert.equal(THEMES.dark["--border"], "#2a2d3a");
});

test("kontrol-tokens er registreret som --color-cz-* i @theme", () => {
  for (const [name, source] of [
    ["border-strong", "--border-strong"],
    ["toggle-off", "--toggle-off"],
    ["toggle-thumb", "--toggle-thumb"],
    ["day-cell", "--day-cell"],
    ["day-cell-mine", "--day-cell-mine"],
    ["day-cell-hover", "--day-cell-hover"],
  ]) {
    assert.ok(css.includes(`--color-cz-${name}: var(${source});`), `--color-cz-${name} mangler i @theme`);
  }
});

// Codex (#6792): tændt kontakt beholder border-strong-kanten; accent alene er
// ca. 1,5:1 mod lyse flader, så sporets kant ville forsvinde i lyst tema.
test("tændt kontakt beholder --border-strong-kanten (Toggle + CookieBanner)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const toggle = readFileSync(join(here, "..", "components", "ui", "Toggle.jsx"), "utf8");
  assert.ok(!/peer-checked:border-cz-accent/.test(toggle), "Toggle må ikke skifte kanten til accent i tændt tilstand");
  assert.match(toggle, /border border-cz-border-strong/);
  const cookie = readFileSync(join(here, "..", "components", "CookieBanner.jsx"), "utf8");
  assert.ok(!/"border-cz-accent bg-cz-accent/.test(cookie), "CookieBanner-kontakten beholder border-strong");
});
