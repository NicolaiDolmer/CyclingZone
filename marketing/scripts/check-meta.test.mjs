// Forward-guard for #5496: meta descriptions <=155 tegn og openGraph.url
// på alle SEO-relevante ruter (samme rutesæt som app/sitemap.ts).
//
// Læser TSX-kildefilerne som tekst i stedet for at rendre HTML, fordi denne
// test kører som del af `npm run lint` (før `next build` i CI, se
// .github/workflows/ci.yml's marketing-lint-build-job). Rendret HTML blev
// brugt til at VERIFICERE fixet manuelt (next build + grep på .next-output),
// men er ikke tilgængeligt på lint-tidspunktet, så guarden læser kilden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const marketingRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const MAX_DESCRIPTION_LENGTH = 155;

function readSource(relPath) {
  return readFileSync(path.join(marketingRoot, relPath), "utf8");
}

// Finder blokken for `${key}: { ... }` ved at balancere krøllede parenteser,
// så nestede objekter (fx openGraph.images[].width) ikke afkorter matchet.
function extractBlock(source, key) {
  const keyIndex = source.indexOf(`${key}:`);
  if (keyIndex === -1) return null;
  const braceStart = source.indexOf("{", keyIndex);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

function extractStringField(block, key) {
  if (!block) return null;
  const match = block.match(new RegExp(`\\b${key}:\\s*\\n?\\s*"([^"]*)"`));
  return match ? match[1] : null;
}

// De 4 undersider ejer selv en DESCRIPTION-konstant.
function ownDescription(source) {
  const match = source.match(/const DESCRIPTION =\s*\n?\s*"([^"]*)"/);
  return match ? match[1] : null;
}

// "/" og "/da" arver description fra deres route-group layout.tsx (siden
// page.tsx ikke selv sætter `description`, jf. Next's metadata-nedarvning).
function layoutDescription(source) {
  const metadataBlock = extractBlock(source, "metadata: Metadata = ") ?? extractBlock(source, "metadata");
  return extractStringField(metadataBlock, "description");
}

function openGraphUrl(source) {
  const ogBlock = extractBlock(source, "openGraph");
  return extractStringField(ogBlock, "url");
}

// Samme 6 ruter som app/sitemap.ts (#5496-scope: kun disse, IKKE de 4
// ukendte OG-sider nævnt i issuet - de afventer ejer-eksport).
const ROUTES = [
  {
    route: "/",
    pageFile: "app/(en)/page.tsx",
    description: { kind: "layout", file: "app/(en)/layout.tsx" },
  },
  {
    route: "/da",
    pageFile: "app/(da)/da/page.tsx",
    description: { kind: "layout", file: "app/(da)/layout.tsx" },
  },
  {
    route: "/how-it-works",
    pageFile: "app/(en)/how-it-works/page.tsx",
    description: { kind: "own" },
  },
  {
    route: "/da/saadan-fungerer-det",
    pageFile: "app/(da)/da/saadan-fungerer-det/page.tsx",
    description: { kind: "own" },
  },
  {
    route: "/pro-cycling-manager-alternative",
    pageFile: "app/(en)/pro-cycling-manager-alternative/page.tsx",
    description: { kind: "own" },
  },
  {
    route: "/da/pro-cycling-manager-alternativ",
    pageFile: "app/(da)/da/pro-cycling-manager-alternativ/page.tsx",
    description: { kind: "own" },
  },
];

for (const { route, pageFile, description } of ROUTES) {
  test(`${route}: meta description er <=${MAX_DESCRIPTION_LENGTH} tegn`, () => {
    const pageSource = readSource(pageFile);
    const value =
      description.kind === "own"
        ? ownDescription(pageSource)
        : layoutDescription(readSource(description.file));

    assert.ok(
      value && value.length > 0,
      `Fandt ingen description for ${route} (kilde: ${description.kind === "own" ? pageFile : description.file})`,
    );
    assert.ok(
      value.length <= MAX_DESCRIPTION_LENGTH,
      `${route}: description er ${value.length} tegn (maks ${MAX_DESCRIPTION_LENGTH}): "${value}"`,
    );
  });

  test(`${route}: openGraph.url er sat`, () => {
    const pageSource = readSource(pageFile);
    const url = openGraphUrl(pageSource);
    assert.ok(url && url.length > 0, `${route}: mangler openGraph.url i ${pageFile}`);
  });
}
